using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace AbizShell
{
    /// <summary>
    /// Хранилище паролей для сайтов внутри АБИЗ.
    /// Пароли загружаются из файла, выгруженного из Яндекс Браузера (CSV: url, username, password),
    /// хранятся на этом ПК в зашифрованном виде (Windows DPAPI — расшифровать может только эта
    /// учётная запись Windows) и сами вставляются в поля входа на сайтах.
    /// </summary>
    public static class PasswordVault
    {
        public record Entry(string Host, string Url, string Username, string Password);

        private static readonly string VaultPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AbizShell", "vault.bin");
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("AnodBiz-ABIZ-vault-v1");
        private static List<Entry>? _cache;

        public static List<Entry> All()
        {
            if (_cache != null) return _cache;
            _cache = new List<Entry>();
            try
            {
                if (File.Exists(VaultPath))
                {
                    var plain = ProtectedData.Unprotect(File.ReadAllBytes(VaultPath), Entropy, DataProtectionScope.CurrentUser);
                    _cache = JsonSerializer.Deserialize<List<Entry>>(plain) ?? new List<Entry>();
                }
            }
            catch { _cache = new List<Entry>(); }
            return _cache;
        }

        private static void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
            var plain = JsonSerializer.SerializeToUtf8Bytes(All());
            File.WriteAllBytes(VaultPath, ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser));
        }

        public static void Clear()
        {
            _cache = new List<Entry>();
            try { if (File.Exists(VaultPath)) File.Delete(VaultPath); } catch { }
        }

        public static string HostOf(string url)
        {
            if (!url.Contains("://")) url = "https://" + url;
            if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return "";
            var h = u.Host.ToLowerInvariant();
            return h.StartsWith("www.") ? h.Substring(4) : h;
        }

        /// <summary>
        /// Импорт CSV из Яндекс Браузера (Настройки → Пароли → ⋯ → Экспортировать пароли)
        /// или из Chrome/Edge — у всех один формат. Возвращает (добавлено, обновлено).
        /// </summary>
        public static (int added, int updated) ImportCsv(string path)
        {
            var rows = ParseCsv(File.ReadAllText(path, Encoding.UTF8));
            if (rows.Count == 0) throw new InvalidDataException("Файл пустой");
            var header = rows[0].Select(h => h.Trim().ToLowerInvariant()).ToList();
            int iUrl = header.FindIndex(h => h is "url" or "origin" or "website" or "адрес" or "сайт");
            int iUser = header.FindIndex(h => h is "username" or "login" or "логин" or "имя пользователя");
            int iPass = header.FindIndex(h => h is "password" or "пароль");
            if (iUrl < 0 || iUser < 0 || iPass < 0)
                throw new InvalidDataException("Это не файл паролей браузера: нет колонок url, username, password.");

            var list = All();
            int added = 0, updated = 0;
            foreach (var r in rows.Skip(1))
            {
                if (r.Count <= Math.Max(iUrl, Math.Max(iUser, iPass))) continue;
                string url = r[iUrl].Trim(), user = r[iUser], pass = r[iPass];
                string host = HostOf(url);
                if (host.Length == 0 || pass.Length == 0) continue;
                int idx = list.FindIndex(e => e.Host == host && e.Username == user);
                var entry = new Entry(host, url, user, pass);
                if (idx >= 0) { if (list[idx].Password != pass) { list[idx] = entry; updated++; } }
                else { list.Add(entry); added++; }
            }
            Save();
            return (added, updated);
        }

        private static List<List<string>> ParseCsv(string text)
        {
            var rows = new List<List<string>>();
            var row = new List<string>();
            var cell = new StringBuilder();
            bool quoted = false;
            if (text.Length > 0 && text[0] == '\uFEFF') text = text.Substring(1);
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (quoted)
                {
                    if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; }
                    else if (c == '"') quoted = false;
                    else cell.Append(c);
                    continue;
                }
                if (c == '"') quoted = true;
                else if (c == ',' || c == ';') { row.Add(cell.ToString()); cell.Clear(); }
                else if (c == '\n' || c == '\r')
                {
                    if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                    row.Add(cell.ToString()); cell.Clear();
                    if (row.Any(x => x.Length > 0)) rows.Add(row);
                    row = new List<string>();
                }
                else cell.Append(c);
            }
            row.Add(cell.ToString());
            if (row.Any(x => x.Length > 0)) rows.Add(row);
            return rows;
        }

        private static List<Entry> ForHost(string host)
        {
            host = host.StartsWith("www.") ? host.Substring(4) : host;
            return All().Where(e => e.Host == host || host.EndsWith("." + e.Host) || e.Host.EndsWith("." + host)).ToList();
        }

        /// <summary>Подключить автоподстановку к браузеру: скрипт ищет поля входа и просит у программы логин/пароль.</summary>
        public static async Task AttachAsync(CoreWebView2 core)
        {
            core.WebMessageReceived += (s, e) =>
            {
                try
                {
                    using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                    var root = doc.RootElement;
                    if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("abizVault", out var kind)) return;
                    if (kind.GetString() != "need") return;
                    var host = HostOf(e.Source);
                    var creds = ForHost(host);
                    if (creds.Count == 0) return;
                    var reply = JsonSerializer.Serialize(new
                    {
                        abizVaultFill = true,
                        items = creds.Select(c => new { u = c.Username, p = c.Password }).ToArray(),
                    });
                    core.PostWebMessageAsJson(reply);
                }
                catch { }
            };
            try { await core.AddScriptToExecuteOnDocumentCreatedAsync(FillScript); } catch { }
        }

        // Ищет поле пароля, запрашивает данные у программы, вставляет логин/пароль так, чтобы
        // сайт (в т.ч. на React/Vue) «увидел» ввод. Если сохранено несколько логинов — показывает выбор.
        private const string FillScript = @"
(function(){
  if (window.__abizVault) return; window.__abizVault = true;
  if (!window.chrome || !chrome.webview) return;
  var items = null, asked = false, done = new WeakSet();
  function setVal(el, v){
    var proto = Object.getPrototypeOf(el);
    var d = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function userFieldFor(pw){
    var form = pw.form || document;
    var list = Array.prototype.slice.call(form.querySelectorAll('input'));
    var idx = list.indexOf(pw), cand = null;
    for (var i = idx - 1; i >= 0; i--){
      var t = (list[i].type||'text').toLowerCase();
      if ((t==='text'||t==='email'||t==='tel') && list[i].offsetParent !== null){ cand = list[i]; break; }
    }
    return cand;
  }
  function fill(pw, it){
    var u = userFieldFor(pw);
    if (u && it.u) setVal(u, it.u);
    setVal(pw, it.p);
    done.add(pw);
  }
  function picker(pw){
    var box = document.createElement('div');
    box.style.cssText='position:absolute;z-index:2147483647;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.2);font:14px Segoe UI,Arial;color:#222;min-width:220px;overflow:hidden';
    var r = pw.getBoundingClientRect();
    box.style.left=(r.left+window.scrollX)+'px'; box.style.top=(r.bottom+window.scrollY+4)+'px';
    var h=document.createElement('div'); h.textContent='АБИЗ — сохранённые входы'; h.style.cssText='padding:6px 10px;font-size:12px;color:#777;background:#f5f5f5';
    box.appendChild(h);
    items.forEach(function(it){
      var b=document.createElement('div'); b.textContent=it.u||'(без логина)';
      b.style.cssText='padding:8px 10px;cursor:pointer';
      b.onmouseenter=function(){b.style.background='#eef4ff'}; b.onmouseleave=function(){b.style.background=''};
      b.onmousedown=function(e){e.preventDefault(); fill(pw,it); box.remove();};
      box.appendChild(b);
    });
    document.body.appendChild(box);
    setTimeout(function(){ document.addEventListener('mousedown', function f(){ box.remove(); document.removeEventListener('mousedown', f); }); }, 0);
  }
  function scan(){
    var pws = document.querySelectorAll('input[type=password]');
    if (!pws.length) return;
    if (!items){ if (!asked){ asked = true; chrome.webview.postMessage({abizVault:'need'}); } return; }
    pws.forEach(function(pw){
      if (done.has(pw) || pw.offsetParent === null) return;
      if (items.length === 1){ if (!pw.value) fill(pw, items[0]); }
      else if (!pw.__abizPick){ pw.__abizPick = true; pw.addEventListener('focus', function(){ if(!pw.value) picker(pw); }); }
    });
  }
  chrome.webview.addEventListener('message', function(e){
    var d = e.data; if (!d || !d.abizVaultFill) return;
    items = d.items || []; scan();
  });
  var mo = new MutationObserver(function(){ scan(); });
  function start(){ scan(); mo.observe(document.documentElement, {childList:true, subtree:true}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();";
    }
}
