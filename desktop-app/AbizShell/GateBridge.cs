using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Мост «сайт ⇄ контроллер СКУД Gate-4000/8000-Ethernet» по протоколу GATE (документ Gate_Protocol_02_2024).
    /// Работает на том же ПК, что пишет видео склада (СКУД → Контроллер → «Компьютер, который записывает видео»).
    ///
    /// Что делает:
    ///  • забирает журнал событий из контроллера (вход, отказ, кнопка, взлом, дверь не закрыта…) и отправляет на сайт;
    ///  • записывает в контроллер карты сотрудников с сайта (заблокированные/удалённые — убирает);
    ///  • открывает дверь по кнопке на сайте, держит дверь открытой в режиме «аварийное открытие»;
    ///  • выставляет точное время в часах контроллера;
    ///  • ловит номер новой карты, поднесённой к считывателю (для записи карты сотруднику).
    /// IP-адрес и порт контроллера задаются на сайте; если не заданы — программа ищет в локальной сети
    /// устройство с открытым портом 5000, которое отвечает по протоколу GATE.
    /// </summary>
    public sealed class GateBridge
    {
        private const string SkudApiUrl = "https://bizwor.ru/api/skud-api";
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
        private static GateBridge? _instance;
        private static readonly object Sync = new();

        private readonly string _apiToken;
        private readonly CancellationTokenSource _cts = new();
        private GateClient? _client;
        private string _status = "запуск";
        private string _host = "";
        private int _port = 5000;
        private int _address = 1;
        private bool? _emergencyApplied;
        private bool? _apbApplied;
        private bool _apb;
        private DateTime _emergencyAt = DateTime.MinValue;
        private DateTime _clockAt = DateTime.MinValue;
        private DateTime _scanAt = DateTime.MinValue;
        private DateTime _fullCardsAt = DateTime.MinValue;
        private DateTime _flashAt = DateTime.MinValue;
        private string? _foundHost;
        private int _foundPort;

        private static string DataDir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AnodBiz", "gate");

        private GateBridge(string apiToken) => _apiToken = apiToken;

        public static void EnsureStarted(string? apiToken)
        {
            if (string.IsNullOrEmpty(apiToken)) return;
            lock (Sync)
            {
                if (_instance != null && _instance._apiToken == apiToken) return;
                _instance?.Stop();
                _instance = new GateBridge(apiToken);
                _ = Task.Run(_instance.LoopAsync);
            }
        }

        public static void StopAll()
        {
            lock (Sync)
            {
                _instance?.Stop();
                _instance = null;
            }
        }

        private void Stop()
        {
            _cts.Cancel();
            _client?.Dispose();
            _client = null;
        }

        // ---------------- основной цикл ----------------

        private int _ctrlPollMs = 500, _serverSyncSec = 2, _reconnectSec = 10, _clockHours = 6, _emergencyMin = 5;
        private Dictionary<string, object>? _params;
        private DateTime _slowAt = DateTime.MinValue;
        private bool _wantCards = true;

        /// <summary>
        /// Два темпа: контроллер опрашивается часто (по умолчанию каждые 0,5 с) — новые события сразу уходят на сайт;
        /// сайт опрашивается раз в 1-2 с — команды (открыть дверь, карты, настройки) выполняются почти мгновенно.
        /// </summary>
        private async Task LoopAsync()
        {
            var ct = _cts.Token;
            var nextServer = DateTime.MinValue;
            while (!ct.IsCancellationRequested)
            {
                TimeSpan wait = TimeSpan.FromMilliseconds(_ctrlPollMs);
                try
                {
                    if (DateTime.Now >= nextServer)
                    {
                        var w = await ServerStepAsync(ct);
                        nextServer = DateTime.Now + (w ?? TimeSpan.FromSeconds(_serverSyncSec));
                        if (w != null) wait = w.Value;
                    }
                    if (_client is { Connected: true } c && wait.TotalMilliseconds <= _ctrlPollMs)
                    {
                        if (await PushEventsAsync(c, ct)) nextServer = DateTime.MinValue;
                    }
                }
                catch (OperationCanceledException) { return; }
                catch (GateException ex)
                {
                    _status = "контроллер: " + ex.Message;
                    _client?.Dispose();
                    _client = null;
                    wait = TimeSpan.FromSeconds(_reconnectSec);
                    nextServer = DateTime.MinValue;
                }
                catch (Exception ex)
                {
                    _status = "ошибка: " + ex.Message;
                    wait = TimeSpan.FromSeconds(Math.Max(3, _serverSyncSec * 2));
                    nextServer = DateTime.MinValue;
                }
                try { await Task.Delay(wait, ct); } catch { return; }
            }
        }

        private async Task<bool> PushEventsAsync(GateClient c, CancellationToken ct)
        {
            var events = ReadEvents(c, out ushort newLower);
            if (events.Count == 0) return false;
            var res = await PostAsync(new { action = "rec_gate_push", connected = true, fast = true, events }, ct);
            if (res.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True)
                c.Write(0x00, 0xD0, 0x000A, new[] { (byte)(newLower >> 8), (byte)(newLower & 0xFF) });
            return true;
        }

        private void ApplyTiming(JsonElement gate)
        {
            if (!gate.TryGetProperty("timing", out var t) || t.ValueKind != JsonValueKind.Object) return;
            int Get(string k, int def, int lo, int hi) =>
                t.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? Math.Clamp(v.GetInt32(), lo, hi) : def;
            _ctrlPollMs = Get("ctrl_poll_ms", 500, 200, 5000);
            _serverSyncSec = Get("server_sync_sec", 2, 1, 30);
            _reconnectSec = Get("reconnect_sec", 10, 3, 120);
            _clockHours = Get("clock_sync_hours", 6, 1, 24);
            _emergencyMin = Get("emergency_repeat_min", 5, 1, 60);
        }

        /// <summary>Обмен с сайтом. Возвращает особую паузу (нет связи / ПК не выбран) или null — обычный темп.</summary>
        private async Task<TimeSpan?> ServerStepAsync(CancellationToken ct)
        {
            bool connected = _client is { Connected: true };
            bool slow = DateTime.Now - _slowAt > TimeSpan.FromMinutes(1);
            if (slow) _slowAt = DateTime.Now;
            var body = new Dictionary<string, object?>
            {
                ["action"] = "rec_gate_poll",
                ["status"] = SkudRecorder.StatusPrefix + _status,
                ["connected"] = connected,
                ["fast"] = !slow,
                ["want_cards"] = connected && (_wantCards || DateTime.Now - _fullCardsAt > TimeSpan.FromHours(6)),
                ["found_host"] = _foundHost,
                ["found_port"] = _foundPort,
            };
            if (connected)
            {
                body["model"] = _client!.Model;
                body["fw"] = _client.Firmware;
            }
            if (_params != null) { body["params"] = _params; _params = null; }
            var poll = await PostAsync(body, ct);
            if (!poll.TryGetProperty("gate", out var gate) || gate.ValueKind != JsonValueKind.Object)
            {
                _client?.Dispose();
                _client = null;
                _status = "этот ПК не выбран для контроллера";
                return TimeSpan.FromSeconds(60);
            }
            ApplyConfig(gate);
            ApplyTiming(gate);
            if (_client is not { Connected: true })
            {
                await ConnectAsync(ct);
                if (_client is { Connected: true }) { ReadParams(_client); return TimeSpan.FromMilliseconds(200); }
                return TimeSpan.FromSeconds(Math.Max(_reconnectSec, 10));
            }
            var c = _client!;
            var done = new List<object>();
            bool cardsSynced = false;
            if (poll.TryGetProperty("commands", out var cmds) && cmds.ValueKind == JsonValueKind.Array)
                foreach (var cmd in cmds.EnumerateArray())
                    done.Add(new { id = cmd.GetProperty("id").GetInt64(), result = RunCommand(c, cmd) });
            if (done.Count > 0)
            {
                await PostAsync(new { action = "rec_gate_ack", connected = true, fast = true, done, cards_synced = false, @params = _params }, ct);
                _params = null;
                done.Clear();
            }
            bool apb = gate.TryGetProperty("antipassback", out var ap) && ap.ValueKind == JsonValueKind.True;
            if (_apbApplied != apb)
            {
                c.Write(0x00, 0xD0, 0x0016, new[] { apb ? (byte)0x16 : (byte)0x00 });
                if (apb)
                {
                    var pass = c.Read(0x00, 0xA0, 0x0001, 1);
                    if (pass[0] == 0) { c.Write(0x00, 0xA0, 0x0001, new byte[] { 50 }); c.Write(0x01, 0xA0, 0x0001, new byte[] { 50 }); }
                }
                _apbApplied = apb;
                _apb = apb;
                _wantCards = true;
            }
            if (poll.TryGetProperty("zones", out var zones) && zones.ValueKind == JsonValueKind.Array)
                WriteZones(c, zones);
            if (poll.TryGetProperty("cards", out var cards) && cards.ValueKind == JsonValueKind.Array)
            {
                string r = WriteCards(c, cards);
                cardsSynced = r.StartsWith("ok");
                if (cardsSynced) { _wantCards = false; _fullCardsAt = DateTime.Now; }
                _status = cardsSynced ? "на связи" : r;
            }
            bool emergency = gate.TryGetProperty("emergency", out var em) && em.ValueKind == JsonValueKind.True;
            if (_emergencyApplied != emergency || (emergency && DateTime.Now - _emergencyAt > TimeSpan.FromMinutes(_emergencyMin)))
            {
                c.Write(0x00, 0xD0, 0x0015, new[] { emergency ? (byte)0x73 : (byte)0x00 });
                _emergencyApplied = emergency;
                _emergencyAt = DateTime.Now;
            }
            if (DateTime.Now - _clockAt > TimeSpan.FromHours(_clockHours)) SetClock(c);
            if (DateTime.Now.Hour == 4 && DateTime.Now - _flashAt > TimeSpan.FromHours(20))
            {
                _flashAt = DateTime.Now;
                c.Simple(0x0C);
            }
            if (cardsSynced)
                await PostAsync(new { action = "rec_gate_ack", connected = true, fast = true, done, cards_synced = true }, ct);
            if (!_status.StartsWith("карты")) _status = "на связи";
            return null;
        }

        /// <summary>Параметры двери из банка 0: реле и проход — десятые доли секунды, «дверь не закрыта» и подтверждение — секунды.</summary>
        private void ReadParams(GateClient c)
        {
            try
            {
                var p = c.Read(0x00, 0xA0, 0x0000, 4);
                _params = new Dictionary<string, object>
                {
                    ["relay_tenths"] = (int)p[0], ["pass_tenths"] = (int)p[1], ["hold_sec"] = (int)p[2], ["confirm_sec"] = (int)p[3],
                    ["at"] = DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:sszzz", CultureInfo.InvariantCulture),
                };
            }
            catch (GateException) { }
        }

        private void ApplyConfig(JsonElement gate)
        {
            string host = gate.TryGetProperty("host", out var h) ? h.GetString() ?? "" : "";
            int port = gate.TryGetProperty("port", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : 5000;
            int addr = gate.TryGetProperty("address", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetInt32() : 1;
            if (host != _host || port != _port || addr != _address)
            {
                _client?.Dispose();
                _client = null;
                _host = host; _port = port; _address = addr;
            }
            if (!string.IsNullOrEmpty(host)) _foundHost = null;
        }

        private async Task ConnectAsync(CancellationToken ct)
        {
            var candidates = new List<(string host, int port)>();
            if (!string.IsNullOrEmpty(_host)) candidates.Add((_host, _port));
            else
            {
                if (DateTime.Now - _scanAt > TimeSpan.FromMinutes(5))
                {
                    _scanAt = DateTime.Now;
                    _status = "ищу контроллер в сети…";
                    candidates.AddRange(await ScanAsync(ct));
                }
            }
            foreach (var (host, port) in candidates.Distinct())
            {
                var c = new GateClient(host, port, (byte)_address);
                try
                {
                    c.Open();
                    c.ReadVersion();
                    _client = c;
                    _status = "на связи";
                    if (string.IsNullOrEmpty(_host)) { _foundHost = host; _foundPort = port; }
                    _emergencyApplied = null;
                    _apbApplied = null;
                    SetClock(c);
                    return;
                }
                catch { c.Dispose(); }
            }
            _status = string.IsNullOrEmpty(_host)
                ? "контроллер не найден в сети — укажите его IP на сайте (СКУД → Контроллер)"
                : $"нет связи с {_host}:{_port}";
        }

        /// <summary>Поиск контроллера: все адреса локальных сетей ПК (/24), открытый порт 5000.</summary>
        private static async Task<List<(string, int)>> ScanAsync(CancellationToken ct)
        {
            var nets = new HashSet<string>();
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork)
                    {
                        var b = ua.Address.GetAddressBytes();
                        nets.Add($"{b[0]}.{b[1]}.{b[2]}.");
                    }
            }
            var found = new List<(string, int)>();
            foreach (var net in nets.Take(4))
            {
                var tasks = Enumerable.Range(1, 254).Select(async i =>
                {
                    string ip = net + i;
                    try
                    {
                        using var tcp = new TcpClient();
                        var t = tcp.ConnectAsync(ip, 5000);
                        if (await Task.WhenAny(t, Task.Delay(400, ct)) == t && tcp.Connected) return ip;
                    }
                    catch { }
                    return null;
                });
                foreach (var ip in await Task.WhenAll(tasks))
                    if (ip != null) found.Add((ip, 5000));
            }
            return found;
        }

        // ---------------- команды с сайта ----------------

        private string RunCommand(GateClient c, JsonElement cmd)
        {
            string op = cmd.GetProperty("operation").GetString() ?? "";
            try
            {
                switch (op)
                {
                    case "open_door":
                        c.OpenDoor(0);
                        return "ok";
                    case "set_open_time":
                        int secs = 3;
                        if (cmd.TryGetProperty("payload", out var pl) && pl.ValueKind == JsonValueKind.Object &&
                            pl.TryGetProperty("seconds", out var s) && s.ValueKind == JsonValueKind.Number) secs = s.GetInt32();
                        byte tenths = (byte)Math.Clamp(secs * 10, 1, 255);
                        c.Write(0x00, 0xA0, 0x0000, new[] { tenths });
                        c.Write(0x01, 0xA0, 0x0000, new[] { tenths });
                        return "ok";
                    case "output":
                        int addr = 1, sec = 5; string mode = "pulse";
                        if (cmd.TryGetProperty("payload", out var op2) && op2.ValueKind == JsonValueKind.Object)
                        {
                            if (op2.TryGetProperty("addr", out var ad) && ad.ValueKind == JsonValueKind.Number) addr = ad.GetInt32();
                            if (op2.TryGetProperty("seconds", out var se) && se.ValueKind == JsonValueKind.Number) sec = se.GetInt32();
                            if (op2.TryGetProperty("mode", out var mo)) mode = mo.GetString() ?? "pulse";
                        }
                        // Байт управления: бит 4 — «включить», бит 3 — время в секундах, биты 0-2 — номер выхода.
                        byte ctl = (byte)((mode == "off" ? 0 : 0x10) | 0x08 | (addr & 0x07));
                        c.Request2(0x0E, ctl, mode == "pulse" ? (byte)Math.Clamp(sec, 1, 255) : (byte)0);
                        return "ok";
                    case "set_params":
                        if (cmd.TryGetProperty("payload", out var pp) && pp.ValueKind == JsonValueKind.Object)
                        {
                            var map = new (string key, ushort addr)[] { ("relay_tenths", 0), ("pass_tenths", 1), ("hold_sec", 2), ("confirm_sec", 3) };
                            foreach (var (key, a) in map)
                                if (pp.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number)
                                {
                                    byte b = (byte)Math.Clamp(v.GetInt32(), key == "relay_tenths" ? 1 : 0, 255);
                                    c.Write(0x00, 0xA0, a, new[] { b });
                                    c.Write(0x01, 0xA0, a, new[] { b });
                                }
                        }
                        ReadParams(c);
                        return "ok";
                    case "read_params":
                        ReadParams(c);
                        return _params == null ? "ошибка чтения" : "ok";
                    case "sync_clock":
                        SetClock(c);
                        return "ok";
                    case "gate_info":
                        c.ReadVersion();
                        return $"ok: {c.Model} {c.Firmware}";
                    default:
                        return "неизвестная команда";
                }
            }
            catch (GateException ex) { return "ошибка: " + ex.Message; }
        }

        private void SetClock(GateClient c)
        {
            var n = DateTime.Now;
            byte Bcd(int v) => (byte)(((v / 10) << 4) | (v % 10));
            int dow = n.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)n.DayOfWeek;
            c.Write(0x00, 0xD0, 0x0000, new[]
            {
                Bcd(n.Second), Bcd(n.Minute), Bcd(n.Hour), (byte)dow, Bcd(n.Day), Bcd(n.Month), Bcd(n.Year % 100), (byte)0x10,
            });
            _clockAt = DateTime.Now;
        }

        // ---------------- расписания (временные зоны) ----------------

        private void WriteZones(GateClient c, JsonElement zones)
        {
            byte Bcd(int v) => (byte)(((v / 10) << 4) | (v % 10));
            var data = new byte[56];
            foreach (var z in zones.EnumerateArray())
            {
                int idx = z.GetProperty("zone").GetInt32();
                if (idx < 0 || idx > 6) continue;
                string f = z.GetProperty("from").GetString() ?? "00:00", t = z.GetProperty("to").GetString() ?? "23:59";
                int o = idx * 8;
                data[o] = (byte)(z.GetProperty("days").GetInt32() & 0x7F);
                data[o + 1] = Bcd(int.Parse(f[..2])); data[o + 2] = Bcd(int.Parse(f[3..]));
                data[o + 3] = Bcd(int.Parse(t[..2])); data[o + 4] = Bcd(int.Parse(t[3..]));
            }
            c.Write(0x00, 0xA0, 0x0078, data);
            c.Write(0x01, 0xA0, 0x0078, data);
        }

        // ---------------- карты ----------------

        private Dictionary<string, string> LoadLearned()
        {
            try
            {
                string f = Path.Combine(DataDir, "learned.json");
                if (File.Exists(f)) return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(f)) ?? new();
            }
            catch { }
            return new();
        }

        private void SaveJson(string name, object value)
        {
            try
            {
                Directory.CreateDirectory(DataDir);
                File.WriteAllText(Path.Combine(DataDir, name), JsonSerializer.Serialize(value));
            }
            catch { }
        }

        private List<string> LoadWritten()
        {
            try
            {
                string f = Path.Combine(DataDir, "written.json");
                if (File.Exists(f)) return JsonSerializer.Deserialize<List<string>>(File.ReadAllText(f)) ?? new();
            }
            catch { }
            return new();
        }

        /// <summary>
        /// Карты с сайта («ггг,ннннн») → банк ключей 0 контроллера. Банк 1 очищается (там не должно остаться
        /// старых карт — в однодверном режиме контроллер ищет и в нём). Если на сайте нет ни одной активной
        /// карты — контроллер не трогаем, чтобы случайно не закрыть дверь для всех.
        /// </summary>
        private string WriteCards(GateClient c, JsonElement cards)
        {
            var list = new List<string>();
            var meta = new Dictionary<string, (string pin, byte mask, bool guest)>();
            foreach (var x in cards.EnumerateArray())
            {
                string card = x.TryGetProperty("card", out var cc) ? cc.GetString() ?? "" : "";
                if (!System.Text.RegularExpressions.Regex.IsMatch(card, @"^(\d{3},\d{5}|M[0-9A-F]{8,12})$") || list.Contains(card)) continue;
                list.Add(card);
                string pin = x.TryGetProperty("pin", out var pp) ? pp.GetString() ?? "" : "";
                byte mask = x.TryGetProperty("mask", out var mm) && mm.ValueKind == JsonValueKind.Number ? (byte)mm.GetInt32() : (byte)0x80;
                bool guest = x.TryGetProperty("guest", out var gg) && gg.ValueKind == JsonValueKind.True;
                meta[card] = (pin, mask, guest);
            }
            if (list.Count == 0) return "карты: на сайте нет активных карт — карты в контроллере не трогаю";
            int capacity = (c.KeyAreaEnd - 0xC0) / 8;
            if (list.Count > capacity) list = list.Take(capacity).ToList();
            var learned = LoadLearned();
            var data = new List<byte>(list.Count * 8);
            foreach (var card in list)
                data.AddRange(KeyBlock(card, learned, meta[card], _apb));

            c.SetNetworkMode(true);
            try
            {
                // Один и тот же список — в оба банка: в однодверном режиме это один общий банк,
                // в двухдверном второй банк — считыватель на выход, карты сотрудников нужны и там.
                for (byte bank = 0; bank <= 1; bank++)
                {
                    var old = c.Read(bank, 0xA0, 0x00BE, 2);
                    int oldEnd = (old[0] << 8) | old[1];
                    for (int i = 0; i < data.Count; i += 96)
                    {
                        var chunk = data.Skip(i).Take(96).ToArray();
                        c.Write(bank, 0xA0, (ushort)(0xC0 + i), chunk);
                        c.SetNetworkMode(true);
                    }
                    int newEnd = 0xC0 + data.Count;
                    if (oldEnd > newEnd && oldEnd <= c.KeyAreaEnd)
                        for (int a = newEnd; a < oldEnd; a += 96)
                        {
                            int n = Math.Min(96, oldEnd - a);
                            c.Write(bank, 0xA0, (ushort)a, Enumerable.Repeat((byte)0x55, n).ToArray());
                            c.SetNetworkMode(true);
                        }
                    c.Write(bank, 0xA0, 0x00BE, new[] { (byte)(newEnd >> 8), (byte)(newEnd & 0xFF) });
                }
            }
            finally { c.SetNetworkMode(false); }
            SaveJson("written.json", list);
            return $"ok: записано карт {list.Count}";
        }

        /// <summary>
        /// Блок ключа (8 байт): 1-6 — номер (для Wiegand-26: код 6 цифр BCD, серия, номер), 7 — признаки,
        /// 8 — маска расписаний (80h — всегда). Признаки: бит 7 — запрет повторного прохода, бит 3 — гость,
        /// биты 1-2 — тип карты («карта с кодом» = бит 1).
        /// </summary>
        private static byte[] KeyBlock(string card, Dictionary<string, string> learned, (string pin, byte mask, bool guest) m, bool apb)
        {
            var b = new byte[8];
            bool longNum = card.StartsWith("M");
            if (learned.TryGetValue(card, out var hex) && hex.Length == 12)
                for (int i = 0; i < 6; i++) b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            else if (longNum)
            {
                var raw = Convert.FromHexString(card[1..].PadLeft(12, '0'));
                Array.Copy(raw, 0, b, 0, 6);
            }
            else
            {
                int fac = int.Parse(card[..3], CultureInfo.InvariantCulture);
                int num = int.Parse(card[4..], CultureInfo.InvariantCulture);
                b[3] = (byte)fac; b[4] = (byte)(num >> 8); b[5] = (byte)(num & 0xFF);
            }
            byte flags = 0;
            if (m.pin.Length == 6 && !longNum)
            {
                for (int i = 0; i < 3; i++) b[i] = (byte)(((m.pin[i * 2] - '0') << 4) | (m.pin[i * 2 + 1] - '0'));
                flags |= 0x02;
            }
            if (m.guest) flags |= 0x08;
            if (apb) flags |= 0x80;
            b[6] = flags;
            b[7] = m.mask == 0 ? (byte)0x80 : m.mask;
            return b;
        }

        /// <summary>
        /// Номер карты из регистра «последний ключ». Wiegand-26 (Em-Marine и Mifare на 26 бит) — «ггг,ннннн»;
        /// длинный номер (Mifare Classic по Wiegand-34/42/58) — «M» + HEX, чтобы карты не путались между собой.
        /// </summary>
        private static string CardFromKey(byte[] k, int offset = 0)
        {
            int first = -1;
            for (int i = 0; i < 3; i++) if (k[offset + i] != 0) { first = i; break; }
            if (first < 0) return $"{k[offset + 3]:000},{(k[offset + 4] << 8) | k[offset + 5]:00000}";
            var sb = new StringBuilder("M");
            for (int i = Math.Min(first, 2); i < 6; i++) sb.Append(k[offset + i].ToString("X2"));
            return sb.ToString();
        }

        // ---------------- события ----------------

        private static readonly Dictionary<int, (string kind, string note)> Codes = new()
        {
            [0x00] = ("exit_button", "Нажата кнопка выхода"),
            [0x02] = ("denied", "Карта не найдена в контроллере"),
            [0x04] = ("entry", "Проход по карте"),
            [0x06] = ("denied", "Доступ запрещён по расписанию"),
            [0x08] = ("", "Открыто оператором"),
            [0x0A] = ("denied", "Дверь заблокирована"),
            [0x0C] = ("forced", "Дверь взломана"),
            [0x0E] = ("held_open", "Дверь оставлена открытой"),
            [0x10] = ("", "Проход состоялся"),
            [0x12] = ("other", "Сработал датчик 1"),
            [0x13] = ("other", "Сработал датчик 2"),
            [0x14] = ("power", "Перезагрузка контроллера"),
            [0x16] = ("button_stuck", "Залипание кнопки открывания"),
            [0x1A] = ("denied", "Запрет повторного прохода"),
            [0x28] = ("other", "Проход не был совершён"),
            [0x2A] = ("door_closed", "Дверь закрыта"),
            [0x34] = ("reader_fault", "Неисправность считывателя (DATA0)"),
            [0x36] = ("reader_fault", "Неисправность считывателя (DATA1)"),
            [0x38] = ("entry", "Проход по гостевой карте"),
            [0x20] = ("denied", "Введён неверный код"),
            [0x22] = ("", "Код подтверждён"),
            [0x24] = ("denied", "Неверная карта подтверждения"),
            [0x26] = ("denied", "Не введён код (истекло время)"),
            [0x3A] = ("", "Ожидание кода"),
        };

        private List<object> ReadEvents(GateClient c, out ushort newLower)
        {
            var ptr = c.Read(0x00, 0xD0, 0x0008, 4);
            int upper = (ptr[0] << 8) | ptr[1];
            int lower = (ptr[2] << 8) | ptr[3];
            newLower = (ushort)lower;
            var events = new List<object>();
            if (upper == lower) return events;
            int size = c.EventBufferSize;
            var written = LoadWritten();
            int pos = lower;
            var raws = new List<byte[]>();
            while (pos != upper && raws.Count < 240)
            {
                int toEnd = size - pos;
                int avail = upper > pos ? upper - pos : toEnd;
                int n = Math.Min(Math.Min(96, avail), toEnd);
                n -= n % 8;
                if (n <= 0) break;
                var block = c.Read(0x02, 0xA0, (ushort)pos, (byte)n);
                for (int i = 0; i + 8 <= block.Length; i += 8) raws.Add(block.Skip(i).Take(8).ToArray());
                pos = (pos + n) % size;
            }
            newLower = (ushort)pos;

            string? lastKeyCard = null;
            int lastDeniedIdx = -1;
            for (int i = raws.Count - 1; i >= 0; i--)
                if ((raws[i][0] & 0x7E) == 0x02) { lastDeniedIdx = i; break; }
            if (lastDeniedIdx >= 0)
            {
                try
                {
                    var k = c.Read(0x00, 0xD0, 0x000C, 6);
                    lastKeyCard = CardFromKey(k);
                    var learned = LoadLearned();
                    learned[lastKeyCard] = Convert.ToHexString(k);
                    SaveJson("learned.json", learned);
                }
                catch (GateException) { }
            }

            var now = DateTime.Now;
            for (int i = 0; i < raws.Count; i++)
            {
                var e = raws[i];
                int code = e[0] & 0x7F;
                int door = code & 1;
                int baseCode = code is 0x12 or 0x13 or 0x14 ? code : code & 0x7E;
                if (!Codes.TryGetValue(baseCode, out var meta)) meta = ("other", $"Событие контроллера {code:X2}h");
                if (meta.kind == "") continue;
                string kind = meta.kind;
                if (kind == "entry" && door == 1) kind = "exit";

                int Dec(byte v) => (v >> 4) * 10 + (v & 0x0F);
                int month = Dec(e[3]), day = Dec(e[4]), hour = Dec(e[5]), min = Dec(e[6]), sec = Dec(e[7]);
                DateTime t;
                try
                {
                    int year = month > now.Month + 1 ? now.Year - 1 : now.Year;
                    t = new DateTime(year, month, day, hour, min, sec, DateTimeKind.Local);
                }
                catch { t = now; }

                string? card = null;
                bool hasKey = baseCode is 0x04 or 0x06 or 0x0A or 0x1A or 0x38 or 0x20 or 0x24 or 0x26;
                if (hasKey)
                {
                    int addr = c.ModelNibble == 8 ? (e[1] << 8) | e[2] : ((e[1] & 0x7F) << 8) | e[2];
                    int idx = (addr - 0xC0) / 8;
                    if (addr >= 0xC0 && idx < written.Count) card = written[idx];
                }
                if (baseCode == 0x02 && i == lastDeniedIdx) card = lastKeyCard;

                events.Add(new
                {
                    time = new DateTimeOffset(t).ToString("yyyy-MM-dd HH:mm:sszzz", CultureInfo.InvariantCulture),
                    code = $"{code:X2}",
                    kind,
                    card,
                    granted = kind is "entry" or "exit" or "exit_button",
                    note = meta.note,
                    raw = Convert.ToHexString(e),
                });
            }
            return events;
        }

        private async Task<JsonElement> PostAsync(object body, CancellationToken ct)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, SkudApiUrl)
            {
                Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("X-Authorization", _apiToken);
            using var resp = await Http.SendAsync(req, ct);
            string text = await resp.Content.ReadAsStringAsync(ct);
            try { return JsonDocument.Parse(text).RootElement.Clone(); }
            catch { return JsonDocument.Parse("{}").RootElement.Clone(); }
        }
    }

    public sealed class GateException : Exception
    {
        public GateException(string message) : base(message) { }
    }

    /// <summary>Кадры протокола GATE поверх TCP (контроллер Gate-Ethernet работает TCP-сервером).</summary>
    public sealed class GateClient : IDisposable
    {
        private const byte Start = 0xFA, End = 0xF5, Esc = 0xFF;
        private readonly string _host;
        private readonly int _port;
        private readonly byte _addr;
        private TcpClient? _tcp;
        private NetworkStream? _stream;

        public int ModelNibble { get; private set; } = 4;
        public string Model { get; private set; } = "";
        public string Firmware { get; private set; } = "";
        public int EventBufferSize { get; private set; } = 0x8000;
        public int KeyAreaEnd { get; private set; } = 0x8000;
        public bool Connected => _tcp?.Connected == true;

        public GateClient(string host, int port, byte addr)
        {
            _host = host; _port = port; _addr = addr;
        }

        public void Open()
        {
            _tcp = new TcpClient { NoDelay = true, ReceiveTimeout = 1500, SendTimeout = 1500 };
            var t = _tcp.ConnectAsync(_host, _port);
            if (!t.Wait(3000) || !_tcp.Connected) throw new GateException($"нет связи с {_host}:{_port}");
            _stream = _tcp.GetStream();
        }

        public void Dispose()
        {
            try { _stream?.Dispose(); } catch { }
            try { _tcp?.Dispose(); } catch { }
            _stream = null;
            _tcp = null;
        }

        public void ReadVersion()
        {
            var d = Request(new byte[] { 0x09 });
            if (d.Length < 3) throw new GateException("контроллер не ответил на запрос версии");
            ModelNibble = d[0] >> 4;
            int release = d.Length >= 4 ? d[3] : 0;
            Firmware = $"{d[0]:X2}{d[1]:X2}/{release:000}";
            Model = ModelNibble switch { 8 => "Gate-8000", 4 => "Gate-4000", 1 => "Gate-1000", _ => "Gate" } + "-Ethernet";
            if (ModelNibble == 8)
            {
                EventBufferSize = d[0] >= 0x84 ? 0xFFF8 : 0x10000;
                KeyAreaEnd = 0xFFF8;
            }
            else
            {
                EventBufferSize = 0x8000;
                KeyAreaEnd = 0x8000;
            }
        }

        public byte[] Read(byte bus, byte type, ushort address, byte count)
        {
            var d = Request(new byte[] { 0x04, bus, type, count, (byte)(address >> 8), (byte)(address & 0xFF) });
            if (d.Length != count) throw new GateException("ошибка чтения памяти контроллера");
            return d;
        }

        public void Write(byte bus, byte type, ushort address, byte[] data)
        {
            var body = new List<byte> { 0x05, bus, type, (byte)data.Length, (byte)(address >> 8), (byte)(address & 0xFF) };
            body.AddRange(data);
            Request(body.ToArray());
        }

        public void OpenDoor(byte door) => Request(new byte[] { 0x07, door });

        public void Request2(byte cmd, byte a, byte b) => Request(new[] { cmd, a, b });

        public void Simple(byte cmd) => Request(new[] { cmd });

        public void SetNetworkMode(bool on) => Request(new byte[] { 0x66, on ? (byte)0x73 : (byte)0x00 });

        /// <summary>Запрос → ответ. Для ACK возвращает пустой массив, для данных — данные без кода команды.</summary>
        private byte[] Request(byte[] body)
        {
            if (_stream == null) throw new GateException("нет соединения");
            byte crc = 0;
            foreach (var b in body) crc ^= b;
            var payload = new List<byte> { 0x01, _addr };
            payload.AddRange(body);
            payload.Add(crc);
            var frame = new List<byte> { Start };
            foreach (var b in payload) Stuff(frame, b);
            frame.Add(End);

            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    while (_stream.DataAvailable) _stream.ReadByte();
                    _stream.Write(frame.ToArray(), 0, frame.Count);
                    var resp = ReadFrame();
                    // resp: 7F 00 01 addr ... crc
                    if (resp.Count < 6 || resp[0] != 0x7F || resp[2] != 0x01) continue;
                    byte x = 0;
                    for (int i = 2; i < resp.Count - 1; i++) x ^= resp[i];
                    if (x != resp[^1]) continue;
                    var data = resp.GetRange(4, resp.Count - 5);
                    if (data.Count >= 3 && data[0] == 0x55 && data[2] == body[0])
                    {
                        if (data[1] == 0x55) return Array.Empty<byte>();
                        if (data[1] == 0xAA) { Thread.Sleep(100); continue; }
                    }
                    if (data.Count >= 1 && data[0] == body[0]) return data.GetRange(1, data.Count - 1).ToArray();
                    throw new GateException("ошибка памяти контроллера");
                }
                catch (IOException) { }
            }
            throw new GateException("контроллер не отвечает");
        }

        private static void Stuff(List<byte> frame, byte b)
        {
            if (b == Start) { frame.Add(Esc); frame.Add(0x01); }
            else if (b == End) { frame.Add(Esc); frame.Add(0x02); }
            else if (b == Esc) { frame.Add(Esc); frame.Add(0x03); }
            else frame.Add(b);
        }

        private List<byte> ReadFrame()
        {
            var buf = new List<byte>();
            bool started = false, esc = false;
            var until = DateTime.UtcNow.AddMilliseconds(1500);
            while (DateTime.UtcNow < until)
            {
                int v = _stream!.ReadByte();
                if (v < 0) throw new IOException("соединение закрыто");
                byte b = (byte)v;
                if (b == Start) { started = true; buf.Clear(); esc = false; continue; }
                if (!started) continue;
                if (b == End) return buf;
                if (esc)
                {
                    buf.Add(b switch { 0x01 => Start, 0x02 => End, _ => Esc });
                    esc = false;
                }
                else if (b == Esc) esc = true;
                else buf.Add(b);
            }
            throw new IOException("нет ответа");
        }
    }
}
