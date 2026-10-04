using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Удалённое автообновление программы.
    /// Зам. директора выпускает новую версию на сайте (раздел «Управление ПК» → «Выпустить версию»).
    /// Программа проверяет выпуск при запуске, раз в 10 минут и по команде с сайта; если версия
    /// новее — скачивает архив, сверяет контрольную сумму, распаковывает рядом и запускает
    /// помощника (скрипт PowerShell), который после закрытия программы заменяет файлы и
    /// запускает обновлённую АБИЗ. Права администратора не нужны, если папка программы
    /// доступна на запись (установщик выдаёт такие права папке AbizShell).
    /// </summary>
    public static class Updater
    {
        private const string ControlApiUrl = "https://functions.poehali.dev/f01f3da3-3368-428a-919d-fe5933bc5ab8";
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(3) };
        private static int _running;

        public static string CurrentVersion => RemoteControlClient.AppVersion;

        /// <summary>Готовое к установке обновление (уже скачано и распаковано).</summary>
        public static string? StagedDir { get; private set; }
        public static string? StagedVersion { get; private set; }

        public static event Action<string>? Ready;

        private static bool IsNewer(string remote, string local)
        {
            static int[] P(string v) => v.Split('.', '-').Select(x => int.TryParse(x, out var n) ? n : 0).Concat(new[] { 0, 0, 0 }).Take(4).ToArray();
            var a = P(remote); var b = P(local);
            for (int i = 0; i < 4; i++) if (a[i] != b[i]) return a[i] > b[i];
            return false;
        }

        /// <summary>Проверить и скачать обновление. Возвращает true, если новое обновление готово к установке.</summary>
        public static async Task<bool> CheckAndDownloadAsync(string apiToken)
        {
            if (string.IsNullOrEmpty(apiToken)) return false;
            if (Interlocked.Exchange(ref _running, 1) == 1) return false;
            try
            {
                string json = JsonSerializer.Serialize(new { action = "check_update", api_token = apiToken, edition = Edition.Kiosk ? "abiz" : "admin" });
                using var resp = await Http.PostAsync(ControlApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
                var root = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
                if (!root.TryGetProperty("version", out var v) || v.ValueKind != JsonValueKind.String) return false;
                string version = v.GetString()!;
                if (!IsNewer(version, CurrentVersion)) return false;
                if (StagedVersion == version && StagedDir != null && Directory.Exists(StagedDir)) return true;

                string url = root.GetProperty("url").GetString() ?? "";
                string sha = root.TryGetProperty("sha256", out var s) ? s.GetString() ?? "" : "";

                string baseDir = Path.Combine(Path.GetTempPath(), "AbizUpdate");
                Directory.CreateDirectory(baseDir);
                string zipPath = Path.Combine(baseDir, $"abiz-{version}.zip");

                await DownloadAsync(url, zipPath);
                using (var fs = File.OpenRead(zipPath))
                {
                    var hash = Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
                    if (!string.IsNullOrEmpty(sha) && hash != sha)
                    {
                        _ = RemoteControlClient.LogAsync(apiToken, "note", $"Обновление {version}: архив повреждён при скачивании, повтор позже");
                        return false;
                    }
                }

                string dir = Path.Combine(baseDir, "v" + version);
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                ZipFile.ExtractToDirectory(zipPath, dir);
                // В архиве программа лежит во вложенной папке (АБИЗ\ или АБИЗ-Админ\) — найдём её по exe.
                string exeName = Path.GetFileName(Environment.ProcessPath ?? "AbizShell.exe");
                string? exe = Directory.GetFiles(dir, exeName, SearchOption.AllDirectories).FirstOrDefault();
                if (exe == null)
                {
                    _ = RemoteControlClient.LogAsync(apiToken, "note", $"Обновление {version}: в архиве нет {exeName} — выпуск не для этой программы");
                    return false;
                }
                try { File.Delete(zipPath); } catch { }

                StagedDir = Path.GetDirectoryName(exe);
                StagedVersion = version;
                _ = RemoteControlClient.LogAsync(apiToken, "note", $"Обновление {version} скачано и готово к установке");
                Ready?.Invoke(version);
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                Interlocked.Exchange(ref _running, 0);
            }
        }

        private static async Task DownloadAsync(string url, string target)
        {
            // Формат «шаблон|количество частей»: архив загружен на сервер частями.
            using var output = File.Create(target);
            var pieces = url.Split('|');
            if (pieces.Length == 2 && int.TryParse(pieces[1], out int count))
            {
                for (int i = 1; i <= count; i++)
                {
                    string partUrl = pieces[0].Replace("{n:03d}", i.ToString("000"));
                    byte[]? data = null;
                    for (int attempt = 0; attempt < 4 && data == null; attempt++)
                    {
                        try { data = await Http.GetByteArrayAsync(partUrl); }
                        catch { await Task.Delay(2000); }
                    }
                    if (data == null) throw new IOException("Не удалось скачать часть обновления");
                    await output.WriteAsync(data);
                }
            }
            else
            {
                using var stream = await Http.GetStreamAsync(url);
                await stream.CopyToAsync(output);
            }
        }

        /// <summary>
        /// Установить скачанное обновление: запустить помощника, который дождётся закрытия программы,
        /// скопирует новые файлы поверх и запустит АБИЗ снова. После вызова программу нужно закрыть.
        /// </summary>
        public static bool ApplyAndRestart()
        {
            if (StagedDir == null || !Directory.Exists(StagedDir)) return false;
            string appDir = AppContext.BaseDirectory.TrimEnd('\\');
            string exePath = Environment.ProcessPath ?? Path.Combine(appDir, "AbizShell.exe");
            int pid = Environment.ProcessId;
            string script = Path.Combine(Path.GetTempPath(), "AbizUpdate", "apply.ps1");
            string log = Path.Combine(Path.GetTempPath(), "AbizUpdate", "apply.log");
            File.WriteAllText(script, $@"
$ErrorActionPreference = 'Continue'
try {{ Wait-Process -Id {pid} -Timeout 30 -ErrorAction SilentlyContinue }} catch {{}}
Start-Sleep -Milliseconds 800
$ok = $false
for ($i = 0; $i -lt 10 -and -not $ok; $i++) {{
  try {{
    robocopy '{StagedDir}' '{appDir}' /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -lt 8) {{ $ok = $true }} else {{ Start-Sleep 2 }}
  }} catch {{ Start-Sleep 2 }}
}}
""$(Get-Date) copy ok=$ok code=$LASTEXITCODE"" | Out-File -Append '{log}'
Start-Process -FilePath '{exePath}' -WorkingDirectory '{appDir}'
", new UTF8Encoding(true));
            Process.Start(new ProcessStartInfo("powershell.exe",
                $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{script}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            return true;
        }
    }
}
