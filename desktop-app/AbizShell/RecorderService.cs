using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace AbizShell
{
    /// <summary>
    /// Связь программы АБИЗ с фоновой службой «AbizRecorder» (видеорегистратор склада).
    /// Если служба установлена — АБИЗ один раз получает для неё отдельный ключ «только видео»
    /// и кладёт его в C:\ProgramData\AnodBiz\recorder\key; дальше служба работает сама,
    /// даже когда в АБИЗ никто не вошёл. Если службы нет — запись ведёт сама программа, как раньше.
    /// </summary>
    public static class RecorderService
    {
        private const string SkudApiUrl = "https://bizwor.ru/api/skud-api";
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
        private static string? _handedToken;

        public static string KeyFile => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AnodBiz", "recorder", "key");

        public static bool IsInstalled
        {
            get
            {
                try
                {
                    using var k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\AbizRecorder");
                    return k != null;
                }
                catch { return false; }
            }
        }

        /// <summary>Вызывается вместо SkudRecorder.EnsureStarted: служба есть — передаём ей ключ, нет — пишем сами.</summary>
        public static void Start(string? apiToken)
        {
            if (string.IsNullOrEmpty(apiToken)) return;
            if (!IsInstalled)
            {
                SkudRecorder.EnsureStarted(apiToken);
                GateBridge.EnsureStarted(apiToken);
                return;
            }
            SkudRecorder.StopAll();
            GateBridge.StopAll();
            if (_handedToken == apiToken) return;
            _handedToken = apiToken;
            _ = Task.Run(() => HandKeyAsync(apiToken));
        }

        private static async Task HandKeyAsync(string apiToken)
        {
            for (int attempt = 0; attempt < 20; attempt++)
            {
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Post, SkudApiUrl)
                    {
                        Content = new StringContent(JsonSerializer.Serialize(new { action = "rec_key" }), Encoding.UTF8, "application/json"),
                    };
                    req.Headers.Add("X-Authorization", apiToken);
                    using var resp = await Http.SendAsync(req);
                    var root = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
                    if (root.TryGetProperty("key", out var k) && k.ValueKind == JsonValueKind.String)
                    {
                        string key = k.GetString() ?? "";
                        Directory.CreateDirectory(Path.GetDirectoryName(KeyFile)!);
                        string old = File.Exists(KeyFile) ? File.ReadAllText(KeyFile).Trim() : "";
                        if (old != key) File.WriteAllText(KeyFile, key);
                        return;
                    }
                    if ((int)resp.StatusCode == 401) { _handedToken = null; return; }
                }
                catch { }
                await Task.Delay(TimeSpan.FromSeconds(30));
            }
            _handedToken = null;
        }
    }
}
