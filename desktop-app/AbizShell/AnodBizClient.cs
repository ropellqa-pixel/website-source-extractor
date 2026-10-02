using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Клиент сервера anod.saou.ru. Два вида методов:
    /// — статические (RegisterDeviceAsync, CheckDeviceStatusAsync, RequestLoginLinkAsync,
    ///   CheckNetworkAsync) — не требуют токена сотрудника, вызываются как AnodBizClient.Метод(...);
    /// — методы экземпляра (QueryAsync, SearchEmployeesAsync) — требуют токен,
    ///   создаются как new AnodBizClient(apiToken).
    /// Раньше DeviceManager вызывал статические методы на "new AnodBizClient()" без токена —
    /// единственный конструктор требует string apiToken, поэтому код не компилировался.
    /// Здесь это исправлено: статика вызывается напрямую через имя класса.
    /// </summary>
    public class AnodBizClient
    {
        private readonly HttpClient _http;

        private const string DataApiUrl = "https://functions.poehali.dev/e40aca0d-1c72-49c0-84a1-cf57b44984ec";
        private const string AuthApiUrl = "https://functions.poehali.dev/0cc75331-123f-465b-a6da-01ba5f142bfa";

        public AnodBizClient(string apiToken)
        {
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            if (!string.IsNullOrEmpty(apiToken))
                _http.DefaultRequestHeaders.Add("X-Authorization", apiToken);
        }

        /// <summary>Проверка сети — не требует токена, используется и до, и после привязки.</summary>
        public static async Task<bool> CheckNetworkAsync()
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                var response = await http.PostAsJsonAsync(DataApiUrl, new { table = "companies", op = "select", limit = 1 });
                return response.IsSuccessStatusCode;
            }
            catch { return false; }
        }

        /// <summary>Универсальный запрос к data-api (CRUD по любой разрешённой таблице).</summary>
        public async Task<JsonElement> QueryAsync(object body)
        {
            var response = await _http.PostAsJsonAsync(DataApiUrl, body);
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }

        /// <summary>Поиск сотрудника по части ФИО (для поиска админом в окне "Поиск сотрудников").</summary>
        public async Task<JsonElement> SearchEmployeesAsync(string query)
        {
            return await QueryAsync(new
            {
                table = "profiles",
                op = "select",
                filters = new[] { new { col = "full_name", op = "ilike", value = $"%{query}%" } }
            });
        }

        // --- Устройства (auth-api) — статические, без токена сотрудника ---

        private static async Task<JsonElement> PostAuthAsync(object body)
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            string json = JsonSerializer.Serialize(body);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var resp = await http.PostAsync(AuthApiUrl, content);
            var respStr = await resp.Content.ReadAsStringAsync();
            return JsonDocument.Parse(respStr).RootElement;
        }

        /// <summary>Регистрация устройства при первом запуске — получает 9-значный device_code.</summary>
        public static async Task<string> RegisterDeviceAsync(string hostname)
        {
            var root = await PostAuthAsync(new { action = "register_device", hostname });
            if (root.TryGetProperty("device_code", out var codeProp))
                return codeProp.GetString() ?? throw new Exception("Пустой device_code в ответе сервера");
            throw new Exception("Не удалось получить код устройства");
        }

        /// <summary>Опрос статуса привязки устройства. "pending" — ждём, "linked" — есть api_token.</summary>
        public static async Task<(string status, string? token)> CheckDeviceStatusAsync(string deviceCode)
        {
            var root = await PostAuthAsync(new { action = "device_status", device_code = deviceCode });
            string status = root.TryGetProperty("status", out var stProp) ? stProp.GetString() ?? "pending" : "pending";
            string? token = root.TryGetProperty("api_token", out var tkProp) ? tkProp.GetString() : null;
            return (status, token);
        }

        /// <summary>Запрос одноразового кода автовхода в браузер — по токену устройства/сотрудника.</summary>
        public static async Task<string?> RequestLoginLinkAsync(string apiToken)
        {
            try
            {
                var root = await PostAuthAsync(new { action = "request_login_link", api_token = apiToken });
                return root.TryGetProperty("code", out var codeProp) ? codeProp.GetString() : null;
            }
            catch { return null; }
        }
    }
}
