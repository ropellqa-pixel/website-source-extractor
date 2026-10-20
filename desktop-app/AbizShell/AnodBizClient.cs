using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Клиент сервера bizwor.ru. Два вида методов:
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

        private const string DataApiUrl = "https://bizwor.ru/api/data-api";
        private const string AuthApiUrl = "https://bizwor.ru/api/auth-api";

        public AnodBizClient(string apiToken)
        {
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            if (!string.IsNullOrEmpty(apiToken))
                _http.DefaultRequestHeaders.Add("X-Authorization", apiToken);
        }

        private static readonly HttpClient PingHttp = new() { Timeout = TimeSpan.FromSeconds(8) };

        /// <summary>
        /// Проверка связи с сервером. Раньше проверка шла к data-api без токена — сервер
        /// всегда отвечал "не авторизован", и программа считала, что интернета нет.
        /// Теперь используется отдельное действие ping, которое не требует входа.
        /// Любой ответ сервера = связь есть; нет связи только при ошибке сети/таймауте.
        /// </summary>
        public static async Task<bool> CheckNetworkAsync()
        {
            for (int attempt = 0; attempt < 2; attempt++)
            {
                try
                {
                    var content = new StringContent("{\"action\":\"ping\"}", Encoding.UTF8, "application/json");
                    using var response = await PingHttp.PostAsync(AuthApiUrl, content);
                    return true;
                }
                catch
                {
                    await Task.Delay(1000);
                }
            }
            return false;
        }

        public enum SignInResult { Ok, WrongPassword, DeviceRevoked, NoNetwork }

        /// <summary>
        /// Вход сотрудника: пароль проверяется на сервере (тот, что директор задал в ЛК).
        /// Поэтому смена пароля в личном кабинете действует сразу, без ожидания.
        /// </summary>
        public static async Task<(SignInResult result, string fullName)> DeviceSignInAsync(string apiToken, string password)
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                string json = JsonSerializer.Serialize(new { action = "device_signin", api_token = apiToken, password });
                using var resp = await http.PostAsync(AuthApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
                var root = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
                if ((int)resp.StatusCode == 200)
                {
                    string name = root.TryGetProperty("full_name", out var n) ? n.GetString() ?? "" : "";
                    return (SignInResult.Ok, name);
                }
                if ((int)resp.StatusCode == 403) return (SignInResult.DeviceRevoked, "");
                return (SignInResult.WrongPassword, "");
            }
            catch
            {
                return (SignInResult.NoNetwork, "");
            }
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
            if (root.TryGetProperty("error", out _) && !root.TryGetProperty("status", out _))
                return ("notfound", null);
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