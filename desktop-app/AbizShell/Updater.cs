using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Удалённое автообновление программы.
    /// Зам. директора выпускает версию на сайте («Управление ПК» → «Выпустить версию»).
    /// Программа проверяет выпуск при запуске, каждые 10 минут и по команде с сайта. Если версия
    /// новее — скачивает архив (частями, параллельно, с повторами), сверяет контрольную сумму,
    /// распаковывает и ставит: помощник ждёт закрытия программы, сохраняет старую версию,
    /// копирует новые файлы, запускает АБИЗ. Если новая версия не запустилась — возвращает старую.
    /// Каждый шаг виден заму на сайте (поле «Обновление» у ПК).
    /// </summary>
    public static class Updater
    {
        private const string ControlApiUrl = "https://bizwor.ru/api/device-control";
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(2) };
        private static int _running;

        public static string CurrentVersion => RemoteControlClient.AppVersion;
        public static string? StagedDir { get; private set; }
        public static string? StagedVersion { get; private set; }

        /// <summary>Что сейчас с обновлением — уходит на сервер с каждым сигналом «я в сети».</summary>
        public static string Status { get; private set; } = "";

        private static string WorkDir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AbizShell", "Update");

        private static int[] Parse(string v)
        {
            var nums = Regex.Matches(v ?? "", @"\d+").Select(m => int.TryParse(m.Value, out var n) ? n : 0).ToList();
            while (nums.Count < 4) nums.Add(0);
            return nums.Take(4).ToArray();
        }

        public static bool IsNewer(string remote, string local)
        {
            var a = Parse(remote); var b = Parse(local);
            for (int i = 0; i < 4; i++) if (a[i] != b[i]) return a[i] > b[i];
            return false;
        }

        /// <summary>Проверить и скачать обновление. true — новое обновление готово к установке.</summary>
        public static async Task<bool> CheckAndDownloadAsync(string apiToken)
        {
            if (string.IsNullOrEmpty(apiToken)) return false;
            if (Interlocked.Exchange(ref _running, 1) == 1) return StagedDir != null;
            try
            {
                string json = JsonSerializer.Serialize(new { action = "check_update", api_token = apiToken, edition = Edition.Kiosk ? "abiz" : "admin" });
                using var resp = await Http.PostAsync(ControlApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
                var root = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
                if (!root.TryGetProperty("version", out var v) || v.ValueKind != JsonValueKind.String)
                {
                    Status = "";
                    return false;
                }
                string version = v.GetString()!;
                if (!IsNewer(version, CurrentVersion))
                {
                    Status = "";
                    return false;
                }
                if (StagedVersion == version && StagedDir != null && Directory.Exists(StagedDir)) return true;

                string url = root.GetProperty("url").GetString() ?? "";
                string sha = root.TryGetProperty("sha256", out var s) ? s.GetString() ?? "" : "";

                Directory.CreateDirectory(WorkDir);
                string zipPath = Path.Combine(WorkDir, $"abiz-{SafeName(version)}.zip");

                Status = $"скачивается {version}";
                await DownloadAsync(url, zipPath, p => Status = $"скачивается {version}: {p}%");

                using (var fs = File.OpenRead(zipPath))
                {
                    var hash = Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
                    if (!string.IsNullOrEmpty(sha) && hash != sha)
                    {
                        Status = $"ошибка {version}: архив повреждён, повтор через 10 мин";
                        try { File.Delete(zipPath); } catch { }
                        return false;
                    }
                }

                string dir = Path.Combine(WorkDir, "v" + SafeName(version));
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                ZipFile.ExtractToDirectory(zipPath, dir);
                try { File.Delete(zipPath); } catch { }

                string exeName = Path.GetFileName(Environment.ProcessPath ?? "AbizShell.exe");
                string? exe = Directory.GetFiles(dir, exeName, SearchOption.AllDirectories).FirstOrDefault();
                if (exe == null)
                {
                    Status = $"ошибка {version}: в архиве нет {exeName} (выпуск не для этой программы)";
                    return false;
                }

                StagedDir = Path.GetDirectoryName(exe);
                StagedVersion = version;
                Status = $"готово к установке {version}";
                return true;
            }
            catch (Exception ex)
            {
                Status = "ошибка обновления: " + ex.Message;
                return false;
            }
            finally
            {
                Interlocked.Exchange(ref _running, 0);
            }
        }

        private static string SafeName(string v) => Regex.Replace(v, @"[^\w.\-]", "_");

        private static async Task DownloadAsync(string url, string target, Action<int> progress)
        {
            var pieces = url.Split('|');
            if (pieces.Length == 2 && int.TryParse(pieces[1], out int count))
            {
                // Части по ~1,5 МБ качаем по 4 одновременно — в разы быстрее, чем по одной.
                var parts = new byte[count][];
                int done = 0;
                using var gate = new SemaphoreSlim(4);
                var tasks = Enumerable.Range(1, count).Select(async i =>
                {
                    await gate.WaitAsync();
                    try
                    {
                        string partUrl = pieces[0].Replace("{n:03d}", i.ToString("000"));
                        for (int attempt = 0; ; attempt++)
                        {
                            try { parts[i - 1] = await Http.GetByteArrayAsync(partUrl); break; }
                            catch when (attempt < 5) { await Task.Delay(1500 * (attempt + 1)); }
                        }
                        progress(Interlocked.Increment(ref done) * 100 / count);
                    }
                    finally { gate.Release(); }
                });
                await Task.WhenAll(tasks);
                using var output = File.Create(target);
                foreach (var p in parts) await output.WriteAsync(p);
            }
            else
            {
                using var stream = await Http.GetStreamAsync(url);
                using var output = File.Create(target);
                await stream.CopyToAsync(output);
            }
        }

        /// <summary>
        /// Поставить скачанное обновление и перезапустить программу. Помощник (PowerShell):
        /// ждёт закрытия АБИЗ → копирует старую версию в резерв → ставит новую → запускает.
        /// Если новая версия не запустилась за 40 секунд — возвращает старую и запускает её.
        /// </summary>
        public static bool ApplyAndRestart()
        {
            if (StagedDir == null || !Directory.Exists(StagedDir)) return false;
            string appDir = AppContext.BaseDirectory.TrimEnd('\\');
            string exePath = Environment.ProcessPath ?? Path.Combine(appDir, "AbizShell.exe");
            string exeName = Path.GetFileNameWithoutExtension(exePath);
            string backup = Path.Combine(WorkDir, "backup");
            string log = Path.Combine(WorkDir, "update.log");
            string script = Path.Combine(WorkDir, "apply.ps1");
            int pid = Environment.ProcessId;

            // Можно ли писать в папку программы (иначе один раз понадобятся права администратора).
            bool writable;
            try { string probe = Path.Combine(appDir, ".abiz-write-test"); File.WriteAllText(probe, "1"); File.Delete(probe); writable = true; }
            catch { writable = false; }

            static string Q(string s) => "'" + s.Replace("'", "''") + "'";
            string ps = $@"
$ErrorActionPreference = 'Continue'
function Log($m) {{ ""$(Get-Date -Format s) $m"" | Out-File -Append -Encoding utf8 {Q(log)} }}
Log 'старт установки {StagedVersion}'
try {{ Wait-Process -Id {pid} -Timeout 40 -ErrorAction SilentlyContinue }} catch {{}}
Get-Process -Name {Q(exeName)} -ErrorAction SilentlyContinue | Where-Object {{ $_.Id -ne $PID }} | Stop-Process -Force -ErrorAction SilentlyContinue
& sc.exe stop AbizRecorder 2>$null | Out-Null
Start-Sleep -Milliseconds 800
if (Test-Path {Q(backup)}) {{ Remove-Item {Q(backup)} -Recurse -Force -ErrorAction SilentlyContinue }}
robocopy {Q(appDir)} {Q(backup)} /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
$ok = $false
for ($i = 0; $i -lt 8 -and -not $ok; $i++) {{
  robocopy {Q(StagedDir)} {Q(appDir)} /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -lt 8) {{ $ok = $true }} else {{ Log ""копирование, код $LASTEXITCODE""; Start-Sleep 2 }}
}}
Log ""файлы скопированы: $ok""
& sc.exe start AbizRecorder 2>$null | Out-Null
$p = Start-Process -FilePath {Q(exePath)} -WorkingDirectory {Q(appDir)} -PassThru
Start-Sleep 40
if (-not $p -or $p.HasExited) {{
  Log 'новая версия не запустилась — возвращаю прежнюю'
  & sc.exe stop AbizRecorder 2>$null | Out-Null
  Start-Sleep 2
  robocopy {Q(backup)} {Q(appDir)} /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  & sc.exe start AbizRecorder 2>$null | Out-Null
  Start-Process -FilePath {Q(exePath)} -WorkingDirectory {Q(appDir)}
}} else {{ Log 'новая версия работает' }}
";
            File.WriteAllText(script, ps, new UTF8Encoding(true));

            var psi = new ProcessStartInfo("powershell.exe",
                $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{script}\"")
            {
                UseShellExecute = !writable,
                CreateNoWindow = writable,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            if (!writable) psi.Verb = "runas";
            try { Process.Start(psi); }
            catch (Exception ex)
            {
                Status = "ошибка установки: " + ex.Message;
                return false;
            }
            Status = $"устанавливается {StagedVersion}";
            return true;
        }

        /// <summary>Последние строки журнала установки (после перезапуска — что получилось).</summary>
        public static string LastInstallLog()
        {
            try
            {
                string log = Path.Combine(WorkDir, "update.log");
                if (!File.Exists(log)) return "";
                var lines = File.ReadAllLines(log);
                return string.Join(" | ", lines.Skip(Math.Max(0, lines.Length - 3)));
            }
            catch { return ""; }
        }
    }
}
