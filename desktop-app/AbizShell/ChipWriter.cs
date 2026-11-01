using Microsoft.Web.WebView2.Core;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace AbizShell
{
    /// <summary>
    /// Запись данных на карту Mifare Classic 1K через USB-считыватель 13,56 МГц (PC/SC, например ACR122U).
    /// UID карты заводской и не меняется — по нему карту узнаёт дверь. Программа записывает в память карты
    /// метку АБИЗ (номер карты в системе, дата записи) и имя сотрудника, затем читает обратно для проверки.
    /// Блоки 4-6 (сектор 1): «ABIZ1|id|ггММдд». Блоки 8-10 (сектор 2): ФИО в UTF-8. Ключ A — заводской FFFFFFFFFFFF.
    /// Сайт вызывает: chrome.webview.postMessage({abizChip:'write', req, data:{id, name}}) или {abizChip:'read', req}.
    /// </summary>
    public static class ChipWriter
    {
        private static readonly byte[] DefaultKey = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
        private static int _busy;

        public static void Attach(CoreWebView2 core)
        {
            core.WebMessageReceived += (s, e) =>
            {
                string op, req;
                string id = "", name = "";
                try
                {
                    using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                    var root = doc.RootElement;
                    if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("abizChip", out var k)) return;
                    op = k.GetString() ?? "";
                    req = root.TryGetProperty("req", out var r) ? r.ToString() : "";
                    if (root.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
                    {
                        id = d.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";
                        name = d.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                    }
                }
                catch { return; }
                if (op == "ping") { Reply(core, req, new { ok = true, ready = true }); return; }
                if (Interlocked.Exchange(ref _busy, 1) == 1) { Reply(core, req, new { ok = false, error = "Уже идёт запись другой карты" }); return; }
                _ = Task.Run(() =>
                {
                    object res;
                    try { res = op == "read" ? Read() : Write(id, name); }
                    catch (Exception ex) { res = new { ok = false, error = ex.Message }; }
                    finally { Interlocked.Exchange(ref _busy, 0); }
                    Application.Current.Dispatcher.BeginInvoke(new Action(() => Reply(core, req, res)));
                });
            };
        }

        private static void Reply(CoreWebView2 core, string req, object res)
        {
            try
            {
                var json = JsonSerializer.SerializeToElement(res);
                var dict = new Dictionary<string, object?> { ["abizChipResult"] = true, ["req"] = req };
                foreach (var p in json.EnumerateObject()) dict[p.Name] = p.Value;
                core.PostWebMessageAsJson(JsonSerializer.Serialize(dict));
            }
            catch { }
        }

        private static object Write(string id, string name)
        {
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, error = "Нет номера карты в системе" };
            using var card = PcscCard.WaitForCard(TimeSpan.FromSeconds(20));
            string uid = card.Uid();
            var head = Encoding.ASCII.GetBytes($"ABIZ1|{id}|{DateTime.Now:yyMMdd}");
            var nameBytes = Encoding.UTF8.GetBytes(name ?? "");
            if (nameBytes.Length > 48) nameBytes = nameBytes.Take(48).ToArray();
            WriteSector(card, 4, head);
            WriteSector(card, 8, nameBytes);
            var back = card.ReadBlocks(4, 3);
            if (!back.Take(head.Length).SequenceEqual(head)) throw new Exception("Проверка после записи не прошла — приложите карту ещё раз и не убирайте до сигнала");
            return new { ok = true, uid };
        }

        private static object Read()
        {
            using var card = PcscCard.WaitForCard(TimeSpan.FromSeconds(20));
            string uid = card.Uid();
            string head = "", name = "";
            try
            {
                card.Auth(4);
                head = Encoding.ASCII.GetString(card.ReadBlocks(4, 3)).TrimEnd('\0');
                card.Auth(8);
                name = Encoding.UTF8.GetString(card.ReadBlocks(8, 3)).TrimEnd('\0');
            }
            catch { }
            var parts = head.Split('|');
            return new { ok = true, uid, abiz = parts.Length == 3 && parts[0] == "ABIZ1", id = parts.Length == 3 ? parts[1] : "", date = parts.Length == 3 ? parts[2] : "", name };
        }

        private static void WriteSector(PcscCard card, int firstBlock, byte[] data)
        {
            var buf = new byte[48];
            Array.Copy(data, buf, Math.Min(48, data.Length));
            card.Auth(firstBlock);
            for (int i = 0; i < 3; i++) card.WriteBlock(firstBlock + i, buf.Skip(i * 16).Take(16).ToArray());
        }

        /// <summary>Минимальный клиент PC/SC (winscard.dll) для карт Mifare Classic.</summary>
        private sealed class PcscCard : IDisposable
        {
            private IntPtr _ctx, _card;
            private int _proto;
            private bool _keyLoaded;

            public static PcscCard WaitForCard(TimeSpan timeout)
            {
                var c = new PcscCard();
                try { c.Connect(timeout); return c; }
                catch { c.Dispose(); throw; }
            }

            private void Connect(TimeSpan timeout)
            {
                Check(SCardEstablishContext(2, IntPtr.Zero, IntPtr.Zero, out _ctx), "служба смарт-карт Windows недоступна");
                var readers = ListReaders();
                if (readers.Count == 0)
                    throw new Exception("Не найден USB-считыватель для записи карт Mifare (13,56 МГц). Подключите его к этому ПК");
                var until = DateTime.Now + timeout;
                while (DateTime.Now < until)
                {
                    foreach (var r in readers)
                    {
                        int rc = SCardConnect(_ctx, r, 2, 3, out _card, out _proto);
                        if (rc == 0) return;
                    }
                    Thread.Sleep(300);
                }
                throw new Exception("Карта не приложена к считывателю (ждали 20 секунд)");
            }

            private List<string> ListReaders()
            {
                int len = 0;
                if (SCardListReaders(_ctx, null, null, ref len) != 0 || len <= 2) return new();
                var buf = new char[len];
                if (SCardListReaders(_ctx, null, buf, ref len) != 0) return new();
                return new string(buf).Split('\0', StringSplitOptions.RemoveEmptyEntries).ToList();
            }

            public string Uid()
            {
                var r = Apdu(new byte[] { 0xFF, 0xCA, 0x00, 0x00, 0x00 }, "не удалось прочитать UID");
                return Convert.ToHexString(r);
            }

            public void Auth(int block)
            {
                if (!_keyLoaded)
                {
                    Apdu(new byte[] { 0xFF, 0x82, 0x00, 0x00, 0x06 }.Concat(DefaultKey).ToArray(), "считыватель не принял ключ");
                    _keyLoaded = true;
                }
                Apdu(new byte[] { 0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, (byte)block, 0x60, 0x00 },
                    "карта защищена другим ключом — её память уже кем-то закрыта, записать нельзя");
            }

            public void WriteBlock(int block, byte[] data)
            {
                if (block % 4 == 3) throw new Exception("служебный блок");
                Apdu(new byte[] { 0xFF, 0xD6, 0x00, (byte)block, 0x10 }.Concat(data).ToArray(), "ошибка записи — не убирайте карту");
            }

            public byte[] ReadBlocks(int first, int count)
            {
                var all = new List<byte>();
                for (int i = 0; i < count; i++)
                    all.AddRange(Apdu(new byte[] { 0xFF, 0xB0, 0x00, (byte)(first + i), 0x10 }, "ошибка чтения"));
                return all.ToArray();
            }

            private byte[] Apdu(byte[] cmd, string error)
            {
                var recv = new byte[258];
                int rlen = recv.Length;
                var pci = new SCARD_IO_REQUEST { dwProtocol = _proto, cbPciLength = 8 };
                int rc = SCardTransmit(_card, ref pci, cmd, cmd.Length, IntPtr.Zero, recv, ref rlen);
                if (rc != 0 || rlen < 2 || recv[rlen - 2] != 0x90 || recv[rlen - 1] != 0x00)
                    throw new Exception(char.ToUpper(error[0]) + error[1..]);
                return recv.Take(rlen - 2).ToArray();
            }

            private static void Check(int rc, string error)
            {
                if (rc != 0) throw new Exception(char.ToUpper(error[0]) + error[1..]);
            }

            public void Dispose()
            {
                if (_card != IntPtr.Zero) { SCardDisconnect(_card, 0); _card = IntPtr.Zero; }
                if (_ctx != IntPtr.Zero) { SCardReleaseContext(_ctx); _ctx = IntPtr.Zero; }
            }

            [StructLayout(LayoutKind.Sequential)]
            private struct SCARD_IO_REQUEST { public int dwProtocol; public int cbPciLength; }

            [DllImport("winscard.dll")] private static extern int SCardEstablishContext(int scope, IntPtr r1, IntPtr r2, out IntPtr ctx);
            [DllImport("winscard.dll")] private static extern int SCardReleaseContext(IntPtr ctx);
            [DllImport("winscard.dll", CharSet = CharSet.Unicode, EntryPoint = "SCardListReadersW")]
            private static extern int SCardListReaders(IntPtr ctx, string? groups, char[]? readers, ref int len);
            [DllImport("winscard.dll", CharSet = CharSet.Unicode, EntryPoint = "SCardConnectW")]
            private static extern int SCardConnect(IntPtr ctx, string reader, int share, int proto, out IntPtr card, out int active);
            [DllImport("winscard.dll")] private static extern int SCardDisconnect(IntPtr card, int disp);
            [DllImport("winscard.dll")]
            private static extern int SCardTransmit(IntPtr card, ref SCARD_IO_REQUEST send, byte[] cmd, int cmdLen, IntPtr recvPci, byte[] recv, ref int recvLen);
        }
    }
}
