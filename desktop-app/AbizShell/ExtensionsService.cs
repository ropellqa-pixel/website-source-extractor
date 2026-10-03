using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace AbizShell
{
    /// <summary>Встроенное расширение браузера и его состояние.</summary>
    public class BrowserExtensionInfo
    {
        public string Folder { get; init; } = "";
        public string Id { get; init; } = "";
        public string Title { get; init; } = "";
        public string Hint { get; init; } = "";
        public bool Enabled { get; set; } = true;
        public bool Installed { get; set; }
        public string Error { get; set; } = "";
    }

    /// <summary>
    /// Расширения встроенного браузера: КриптоПро ЭЦП, СБИС (SYTools), Рутокен Плагин,
    /// Рутокен Коннект. Лежат в папке Extensions рядом с программой и ставятся в браузер
    /// при каждом запуске. Их ID совпадают с ID из магазина Chrome — поэтому системные
    /// программы (КриптоПро ЭЦП Browser plug-in, Рутокен Плагин, СБИС Плагин),
    /// установленные на ПК, их узнают. Включение/выключение запоминается на этом ПК.
    /// </summary>
    public static class ExtensionsService
    {
        public static readonly List<BrowserExtensionInfo> Known = new()
        {
            new() { Folder = "CryptoProCades", Id = "pfhgbfnnjiafkhfdkmpiflachepdcjod", Title = "КриптоПро ЭЦП (CAdES Browser Plugin)",
                    Hint = "Нужна программа «КриптоПро ЭЦП Browser plug-in»" },
            new() { Folder = "SYTools", Id = "pbcgcpeifkdjijdjambaakmhhpkfgoec", Title = "SYTools (Saby / СБИС Плагин)",
                    Hint = "Нужна программа «СБИС Плагин»" },
            new() { Folder = "RutokenPlugin", Id = "ohedcglhbbfdgaogjhcclacoccbagkjg", Title = "Адаптер Рутокен Плагин",
                    Hint = "Нужна программа «Рутокен Плагин»" },
            new() { Folder = "RutokenConnect", Id = "acbchkahfmndkenefkcklofjmipghjjp", Title = "Адаптер Рутокен Коннект",
                    Hint = "Нужна программа «Рутокен Коннект»" },
        };

        private static readonly string StatePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AbizShell", "extensions.json");

        public static string ExtensionsDir => Path.Combine(AppContext.BaseDirectory, "Extensions");

        private static Dictionary<string, bool> LoadState()
        {
            try
            {
                if (File.Exists(StatePath))
                    return JsonSerializer.Deserialize<Dictionary<string, bool>>(File.ReadAllText(StatePath)) ?? new();
            }
            catch { }
            return new();
        }

        private static void SaveState()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(StatePath)!);
                File.WriteAllText(StatePath, JsonSerializer.Serialize(Known.ToDictionary(e => e.Id, e => e.Enabled)));
            }
            catch { }
        }

        /// <summary>Ставит все встроенные расширения в профиль браузера и применяет вкл/выкл.</summary>
        public static async Task InstallAllAsync(CoreWebView2Profile profile)
        {
            var state = LoadState();
            IReadOnlyList<CoreWebView2BrowserExtension> existing;
            try { existing = await profile.GetBrowserExtensionsAsync(); }
            catch { existing = Array.Empty<CoreWebView2BrowserExtension>(); }

            foreach (var ext in Known)
            {
                ext.Enabled = !state.TryGetValue(ext.Id, out bool en) || en;
                ext.Error = "";
                try
                {
                    var installed = existing.FirstOrDefault(x => x.Id == ext.Id);
                    if (installed == null)
                    {
                        string path = Path.Combine(ExtensionsDir, ext.Folder);
                        if (!Directory.Exists(path))
                        {
                            ext.Error = "Файлы расширения не найдены";
                            continue;
                        }
                        installed = await profile.AddBrowserExtensionAsync(path);
                    }
                    ext.Installed = true;
                    if (installed.IsEnabled != ext.Enabled)
                        await installed.EnableAsync(ext.Enabled);
                }
                catch (Exception e)
                {
                    ext.Installed = false;
                    ext.Error = e.Message;
                }
            }
        }

        public static async Task<bool> SetEnabledAsync(CoreWebView2Profile profile, string id, bool enabled)
        {
            var ext = Known.FirstOrDefault(x => x.Id == id);
            if (ext == null) return false;
            try
            {
                var list = await profile.GetBrowserExtensionsAsync();
                var installed = list.FirstOrDefault(x => x.Id == id);
                if (installed == null) return false;
                await installed.EnableAsync(enabled);
                ext.Enabled = enabled;
                SaveState();
                return true;
            }
            catch (Exception e)
            {
                ext.Error = e.Message;
                return false;
            }
        }
    }
}
