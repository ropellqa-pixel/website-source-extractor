using System;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Получение ссылок на видео камер с сервера (функция cameras-api). Логины и пароли камер
    /// хранятся только на сервере — программа получает лишь временную ссылку на поток.
    /// Доступ — по токену привязанного устройства.
    /// </summary>
    public static class CamerasClient
    {
        private const string CamerasApiUrl = "https://functions.poehali.dev/246cb9d5-b997-40d1-8f46-082cafe7879e";
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

        public record Result(string? Url, string? Error, string Name = "");

        private static async Task<(int status, JsonElement body)> PostAsync(string apiToken, object body)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, CamerasApiUrl)
            {
                Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("X-Authorization", apiToken);
            using var resp = await Http.SendAsync(req);
            string text = await resp.Content.ReadAsStringAsync();
            JsonElement root;
            try { root = JsonDocument.Parse(text).RootElement.Clone(); }
            catch { root = JsonDocument.Parse("{}").RootElement.Clone(); }
            return ((int)resp.StatusCode, root);
        }

        private static string? Str(JsonElement e, string name) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

        /// <summary>
        /// Живое видео камеры по началу названия (например «Зал»). Если такой нет — камера по умолчанию.
        /// </summary>
        public static async Task<Result> LiveByNameAsync(string? apiToken, string namePrefix)
        {
            if (string.IsNullOrEmpty(apiToken))
                return new Result(null, "Компьютер не привязан к системе — камеры недоступны. Обратитесь к директору.");
            try
            {
                var (status, list) = await PostAsync(apiToken, new { action = "list" });
                if (status == 401) return new Result(null, "Компьютер отвязан от системы — камеры недоступны.");
                if (!list.TryGetProperty("cameras", out var cams) || cams.ValueKind != JsonValueKind.Array || cams.GetArrayLength() == 0)
                    return new Result(null, Str(list, "error") ?? "Камеры ещё не добавлены в системе.");

                var all = cams.EnumerateArray().ToList();
                var cam = all.FirstOrDefault(c => (Str(c, "name") ?? "").StartsWith(namePrefix, StringComparison.OrdinalIgnoreCase));
                if (cam.ValueKind == JsonValueKind.Undefined)
                    cam = all.FirstOrDefault(c => c.TryGetProperty("is_default", out var d) && d.ValueKind == JsonValueKind.True);
                if (cam.ValueKind == JsonValueKind.Undefined) cam = all[0];

                var r = await LiveAsync(apiToken, Str(cam, "id") ?? "");
                return r with { Name = Str(cam, "name") ?? "" };
            }
            catch
            {
                return new Result(null, "Нет связи с сервером. Пробуем снова...");
            }
        }

        /// <summary>Живое видео камеры по её id. Медленные камеры повторяем до 3 раз.</summary>
        public static async Task<Result> LiveAsync(string apiToken, string cameraId)
        {
            string? lastError = null;
            for (int i = 0; i < 3; i++)
            {
                try
                {
                    var (_, body) = await PostAsync(apiToken, new { action = "live", id = cameraId, quality = "sd" });
                    string? url = Str(body, "url");
                    if (!string.IsNullOrEmpty(url)) return new Result(url, null);
                    lastError = Str(body, "error") ?? "Камера не ответила";
                    if (!lastError.Contains("не ответила", StringComparison.OrdinalIgnoreCase)) break;
                }
                catch
                {
                    lastError = "Нет связи с сервером";
                }
                await Task.Delay(800);
            }
            return new Result(null, lastError);
        }

        /// <summary>Ссылки, которые разрешено открывать во встроенном видеоплеере (облако камер).</summary>
        public static bool IsTrustedStreamUrl(string? url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
            return uri.Scheme == Uri.UriSchemeHttps && uri.Host.EndsWith(".bcloud365.net", StringComparison.OrdinalIgnoreCase);
        }
    }
}
