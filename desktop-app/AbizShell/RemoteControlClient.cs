using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Связь с сервером удалённого управления (функция device-control).
    /// Программа каждые несколько секунд шлёт heartbeat: сообщает, что она онлайн и где
    /// (на экране входа или сотрудник в системе), и забирает команды от зам. директора
    /// (заблокировать, сообщение на экран, снимок экрана, запустить RuDesktop, обновить).
    /// </summary>
    public static class RemoteControlClient
    {
        private const string ControlApiUrl = "https://functions.poehali.dev/f01f3da3-3368-428a-919d-fe5933bc5ab8";
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(12) };

        public const string AppVersion = "3.5";

        public class Command
        {
            public string Id { get; set; } = "";
            public string Name { get; set; } = "";
            public JsonElement Payload { get; set; }
            public string? PayloadString(string key) =>
                Payload.ValueKind == JsonValueKind.Object && Payload.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String
                    ? v.GetString() : null;
        }

        public class Heartbeat
        {
            public bool Ok { get; set; }
            public bool Revoked { get; set; }
            public bool RemoteLock { get; set; }
            public string? LockMessage { get; set; }
            public List<Command> Commands { get; } = new();
        }

        /// <summary>Сообщить серверу, что ПК онлайн, и забрать команды. presence: "login" или "working".</summary>
        public static async Task<Heartbeat> HeartbeatAsync(string apiToken, string presence, string userName)
        {
            var result = new Heartbeat();
            if (string.IsNullOrEmpty(apiToken)) return result;
            try
            {
                string json = JsonSerializer.Serialize(new
                {
                    action = "heartbeat",
                    api_token = apiToken,
                    presence,
                    user_name = userName ?? "",
                    app_version = AppVersion,
                    update_status = Updater.Status,
                });
                using var resp = await Http.PostAsync(ControlApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
                var root = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
                if ((int)resp.StatusCode == 401)
                {
                    result.Revoked = root.TryGetProperty("revoked", out var r) && r.ValueKind == JsonValueKind.True;
                    return result;
                }
                result.Ok = root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;
                result.RemoteLock = root.TryGetProperty("remote_lock", out var rl) && rl.ValueKind == JsonValueKind.True;
                result.LockMessage = root.TryGetProperty("lock_message", out var lm) && lm.ValueKind == JsonValueKind.String ? lm.GetString() : null;
                if (root.TryGetProperty("commands", out var cmds) && cmds.ValueKind == JsonValueKind.Array)
                {
                    foreach (var c in cmds.EnumerateArray())
                    {
                        result.Commands.Add(new Command
                        {
                            Id = c.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "",
                            Name = c.TryGetProperty("command", out var nm) ? nm.GetString() ?? "" : "",
                            Payload = c.TryGetProperty("payload", out var pl) ? pl.Clone() : default,
                        });
                    }
                }
            }
            catch { }
            return result;
        }

        /// <summary>Отчитаться о выполнении команды. Для снимка экрана передаётся base64 JPEG.</summary>
        public static async Task ReportResultAsync(string apiToken, string commandId, string result, string? screenshotBase64 = null)
        {
            if (string.IsNullOrEmpty(apiToken) || string.IsNullOrEmpty(commandId)) return;
            try
            {
                var payload = new Dictionary<string, object?>
                {
                    ["action"] = "command_result",
                    ["api_token"] = apiToken,
                    ["command_id"] = commandId,
                    ["result"] = result,
                };
                if (!string.IsNullOrEmpty(screenshotBase64)) payload["screenshot"] = screenshotBase64;
                string json = JsonSerializer.Serialize(payload);
                using var _ = await Http.PostAsync(ControlApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
            }
            catch { }
        }

        /// <summary>Непрочитанные сообщения общего чата для сотрудника этого ПК.</summary>
        public static async Task<(int count, string lastId, string sender, string text)> ChatUnreadAsync(string apiToken)
        {
            if (string.IsNullOrEmpty(apiToken)) return (0, "", "", "");
            try
            {
                string json = JsonSerializer.Serialize(new { action = "chat_unread", api_token = apiToken });
                using var resp = await Http.PostAsync(ControlApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
                var root = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
                int count = root.TryGetProperty("count", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetInt32() : 0;
                if (count == 0 || !root.TryGetProperty("last", out var last) || last.ValueKind != JsonValueKind.Object) return (0, "", "", "");
                string S(string n) => last.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
                return (count, S("id"), S("sender_name"), S("content"));
            }
            catch { return (0, "", "", ""); }
        }

        /// <summary>Отметить чат прочитанным (сотрудник открыл раздел «Чат»).</summary>
        public static async Task MarkChatReadAsync(string apiToken)
        {
            if (string.IsNullOrEmpty(apiToken)) return;
            try
            {
                string json = JsonSerializer.Serialize(new { action = "chat_mark_read", api_token = apiToken });
                using var _ = await Http.PostAsync(ControlApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
            }
            catch { }
        }

        /// <summary>Записать событие в журнал активности ПК (вход, выход и т.п.).</summary>
        public static async Task LogAsync(string apiToken, string kind, string message)
        {
            if (string.IsNullOrEmpty(apiToken)) return;
            try
            {
                string json = JsonSerializer.Serialize(new { action = "device_log", api_token = apiToken, kind, message });
                using var _ = await Http.PostAsync(ControlApiUrl, new StringContent(json, Encoding.UTF8, "application/json"));
            }
            catch { }
        }
    }
}
