using System;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace AbizShell
{
    /// <summary>
    /// Хранит device_code и api_token в реестре текущего пользователя (HKCU) и
    /// общается с сервером через статические методы AnodBizClient — без создания
    /// экземпляра клиента, т.к. до привязки устройства токена ещё нет.
    /// </summary>
    public static class DeviceManager
    {
        private const string RegistryKey = @"Software\AbizShell";
        private const string DeviceCodeKey = "DeviceCode";
        private const string ApiTokenKey = "ApiToken";

        public static string? GetDeviceCode()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RegistryKey);
                return key?.GetValue(DeviceCodeKey) as string;
            }
            catch { return null; }
        }

        public static void SaveDeviceCode(string code)
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(RegistryKey);
                key.SetValue(DeviceCodeKey, code);
            }
            catch { }
        }

        public static string? GetApiToken()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RegistryKey);
                return key?.GetValue(ApiTokenKey) as string;
            }
            catch { return null; }
        }

        public static void SaveApiToken(string token)
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(RegistryKey);
                key.SetValue(ApiTokenKey, token);
            }
            catch { }
        }

        public static void ClearApiToken()
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(RegistryKey);
                key.SetValue(ApiTokenKey, "");
            }
            catch { }
        }

        /// <summary>Регистрирует устройство, если ещё не регистрировалось, и возвращает device_code.</summary>
        public static async Task<string> InitializeDeviceAsync()
        {
            string? existingCode = GetDeviceCode();
            if (!string.IsNullOrEmpty(existingCode))
                return existingCode;

            string hostname = Environment.MachineName;
            try
            {
                string code = await AnodBizClient.RegisterDeviceAsync(hostname);
                SaveDeviceCode(code);
                return code;
            }
            catch
            {
                string tempCode = GenerateTempCode();
                SaveDeviceCode(tempCode);
                return tempCode;
            }
        }

        /// <summary>Возвращает true, если за время опроса устройство оказалось привязано и токен сохранён.</summary>
        public static async Task<bool> PollDeviceStatusAsync(string deviceCode)
        {
            try
            {
                var (status, token) = await AnodBizClient.CheckDeviceStatusAsync(deviceCode);
                if (status == "linked" && !string.IsNullOrEmpty(token))
                {
                    SaveApiToken(token);
                    return true;
                }
            }
            catch { }
            return false;
        }

        private static string GenerateTempCode()
        {
            var rnd = new Random();
            return rnd.Next(100000000, 999999999).ToString();
        }

        public static string FormatCode(string code)
        {
            if (string.IsNullOrEmpty(code) || code.Length < 9) return code;
            return code.Substring(0, 3) + "-" + code.Substring(3, 3) + "-" + code.Substring(6, 3);
        }
    }
}
