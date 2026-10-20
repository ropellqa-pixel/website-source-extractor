using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Видеорегистратор склада. Работает на ПК, выбранном на сайте (СКУД → Контроллер → «ПК для записи»).
    ///
    /// Облачный архив камер не годится для коротких отрывков (камера пишет в облако с задержкой
    /// и не всегда), поэтому программа сама непрерывно записывает камеры «Склад» и «Склад-ВН»
    /// на диск ПК кусками по 1 минуте и хранит последние 3 часа. Сервер, разобрав события двери,
    /// выдаёт задания «камера, с … по …» — программа склеивает нужные минуты, обрезает точно
    /// по секундам и загружает готовый MP4 на сайт (частями по 1 МБ).
    ///
    /// Запись — бесплатной программой ffmpeg (ffmpeg.exe рядом с программой или скачивается сама).
    /// Непрерывная запись не перекодируется (ПК почти не нагружается); только готовый отрывок
    /// переводится в H.264 — чтобы он открывался в любом браузере и на телефоне.
    /// </summary>
    public sealed class SkudRecorder
    {
        private const string SkudApiUrl = "https://bizwor.ru/api/skud-api";
        private const string CamerasApiUrl = "https://bizwor.ru/api/cameras-api";

        /// <summary>Подпись в статусе на сайте: «служба» — работает фоновая служба AbizRecorder.</summary>
        public static string StatusPrefix { get; set; } = "";
        private const string FfmpegZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
        private const string FfmpegPartsUrl = "https://cdn.poehali.dev/projects/451dcdd9-845e-4f12-82d1-0501056cd61b/bucket/skud/tools/ffmpeg-9.0.2.zip";
        private const int FfmpegParts = 37;
        private const string FfmpegSha256 = "348378108f679b7484aa2d5eeee5f647efcf949452a520c829fb2c9956a6c641";
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
        private static readonly TimeSpan SegmentLength = TimeSpan.FromSeconds(60);
        /// <summary>На сколько живой поток из облака отстаёт от реального времени.</summary>
        private static readonly TimeSpan StreamDelay = TimeSpan.FromSeconds(4);

        private static SkudRecorder? _instance;
        private static readonly object Gate = new();

        private readonly string _apiToken;
        private readonly CancellationTokenSource _cts = new();
        private readonly ConcurrentDictionary<string, CameraRecording> _recordings = new();
        private string? _ffmpeg;
        private int _keepHours = 72;
        private long _maxDiskBytes = 15L * 1024 * 1024 * 1024;
        private int _partBytes = 1024 * 1024;
        private string _status = "запуск";

        private static string BaseDir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AnodBiz", "SkudVideo");

        private SkudRecorder(string apiToken) => _apiToken = apiToken;

        /// <summary>Запустить регистратор (один на всю программу). Если этот ПК не выбран для записи — просто ждёт.</summary>
        public static void EnsureStarted(string? apiToken)
        {
            if (string.IsNullOrEmpty(apiToken)) return;
            lock (Gate)
            {
                if (_instance != null && _instance._apiToken == apiToken) return;
                _instance?.Stop();
                _instance = new SkudRecorder(apiToken);
                _ = Task.Run(_instance.LoopAsync);
            }
        }

        public static void StopAll()
        {
            lock (Gate)
            {
                _instance?.Stop();
                _instance = null;
            }
        }

        private void Stop()
        {
            _cts.Cancel();
            foreach (var r in _recordings.Values) r.Stop();
            _recordings.Clear();
        }

        // ---------------- основной цикл ----------------

        private async Task LoopAsync()
        {
            var ct = _cts.Token;
            while (!ct.IsCancellationRequested)
            {
                TimeSpan wait = TimeSpan.FromSeconds(10);
                try
                {
                    var poll = await PostAsync(new { action = "rec_poll", status = StatusPrefix + _status }, ct);
                    bool isRecorder = poll.TryGetProperty("recorder", out var rf) && rf.ValueKind == JsonValueKind.True;
                    if (poll.TryGetProperty("error", out var pe) && !poll.TryGetProperty("recorder", out _))
                    {
                        _status = "сервер: " + pe.GetString();
                        wait = TimeSpan.FromSeconds(60);
                    }
                    else if (!isRecorder)
                    {
                        if (!_recordings.IsEmpty)
                        {
                            foreach (var r in _recordings.Values) r.Stop();
                            _recordings.Clear();
                        }
                        _status = "не выбран для записи";
                        wait = TimeSpan.FromSeconds(60);
                    }
                    else
                    {
                        if (poll.TryGetProperty("keep_hours", out var kh) && kh.ValueKind == JsonValueKind.Number) _keepHours = kh.GetInt32();
                        if (poll.TryGetProperty("max_disk_gb", out var md) && md.ValueKind == JsonValueKind.Number) _maxDiskBytes = (long)(md.GetDouble() * 1024 * 1024 * 1024);
                        if (poll.TryGetProperty("part_bytes", out var pb) && pb.ValueKind == JsonValueKind.Number) _partBytes = pb.GetInt32();
                        if (_ffmpeg == null)
                        {
                            _ffmpeg = FindOrStartFfmpeg(ct);
                            if (_ffmpeg != null) KillOrphans(_ffmpeg);
                        }
                        if (_ffmpeg == null)
                        {
                            // Скачивание идёт в фоне, статус («скачивается ffmpeg: 40%») уходит на сайт.
                            wait = TimeSpan.FromSeconds(_ffmpegTask is { IsCompleted: true } ? 60 : 5);
                        }
                        else
                        {
                            SyncCameras(poll);
                            CleanupOld();
                            bool hadJobs = false;
                            if (poll.TryGetProperty("jobs", out var jobs) && jobs.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var j in jobs.EnumerateArray())
                                {
                                    hadJobs = true;
                                    await HandleJobAsync(j, ct);
                                }
                            }
                            _status = BuildStatus();
                            if (hadJobs) wait = TimeSpan.FromSeconds(2);
                        }
                    }
                }
                catch (OperationCanceledException) { return; }
                catch (Exception ex)
                {
                    _status = "ошибка: " + ex.Message;
                }
                try { await Task.Delay(wait, ct); } catch { return; }
            }
        }

        private string BuildStatus()
        {
            if (_recordings.IsEmpty) return "нет камер для записи";
            var parts = _recordings.Values.Select(r => $"{r.Name}: {(r.IsHealthy ? "пишет" : "переподключение")}");
            double gb = _diskUsed / (1024.0 * 1024 * 1024);
            return string.Join("; ", parts) + string.Format(CultureInfo.GetCultureInfo("ru-RU"), " · на диске {0:0.0} из {1} ГБ", gb, _maxDiskBytes / (1024 * 1024 * 1024));
        }

        private void SyncCameras(JsonElement poll)
        {
            var wanted = new Dictionary<string, string>();
            var names = new Dictionary<string, string>();
            if (poll.TryGetProperty("cameras", out var cams) && cams.ValueKind == JsonValueKind.Array)
                foreach (var c in cams.EnumerateArray())
                {
                    string id = c.GetProperty("id").GetString() ?? "";
                    if (id.Length == 0) continue;
                    wanted[id] = c.TryGetProperty("quality", out var q) ? q.GetString() ?? "sd" : "sd";
                    names[id] = c.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() ?? "камера" : "камера";
                }
            foreach (var r in _recordings.Values)
                if (names.TryGetValue(r.CameraId, out var nm)) r.Name = nm;

            foreach (var id in _recordings.Keys.ToList())
                if (!wanted.ContainsKey(id) && _recordings.TryRemove(id, out var old)) old.Stop();

            foreach (var (id, quality) in wanted)
            {
                if (_recordings.TryGetValue(id, out var existing) && existing.Quality == quality) continue;
                if (existing != null && _recordings.TryRemove(id, out var prev)) prev.Stop();
                var rec = new CameraRecording(_apiToken, id, quality, _ffmpeg!, Path.Combine(BaseDir, id))
                {
                    Name = names.TryGetValue(id, out var cn) ? cn : "камера",
                };
                _recordings[id] = rec;
                rec.Start();
            }
        }

        /// <summary>
        /// Запись на диске ПК не больше предела (15 ГБ): при превышении удаляются самые старые куски.
        /// Дополнительно — если на диске осталось меньше 2 ГБ, тоже освобождаем место.
        /// </summary>
        private void CleanupOld()
        {
            try
            {
                if (!Directory.Exists(BaseDir)) return;
                var files = Directory.EnumerateFiles(BaseDir, "*.ts", SearchOption.AllDirectories)
                    .Select(f => (path: f, start: SegmentTime(f), info: new FileInfo(f)))
                    .Where(x => x.start != null)
                    .OrderBy(x => x.start)
                    .ToList();
                long total = files.Sum(x => x.info.Length);
                long free = long.MaxValue;
                try { free = new DriveInfo(Path.GetPathRoot(BaseDir)!).AvailableFreeSpace; } catch { }
                const long minFree = 2L * 1024 * 1024 * 1024;
                var border = DateTime.UtcNow.AddHours(-_keepHours);
                var keepAlways = DateTime.UtcNow.AddMinutes(-3);
                foreach (var x in files)
                {
                    bool over = total > _maxDiskBytes || free < minFree;
                    if (!over && x.start >= border) break;
                    if (x.start > keepAlways) break;
                    long len = x.info.Length;
                    TryDelete(x.path);
                    if (!File.Exists(x.path))
                    {
                        total -= len;
                        if (free != long.MaxValue) free += len;
                    }
                }
                _diskUsed = total;
                foreach (var f in Directory.EnumerateFiles(BaseDir, "clip_*.mp4", SearchOption.AllDirectories))
                    if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddHours(-1)) TryDelete(f);
            }
            catch { }
        }

        private long _diskUsed;

        // ---------------- задания на отрывки ----------------

        private async Task HandleJobAsync(JsonElement job, CancellationToken ct)
        {
            long id = job.GetProperty("id").GetInt64();
            string cameraId = job.GetProperty("camera_id").GetString() ?? "";
            string key = job.GetProperty("key").GetString() ?? "";
            var from = DateTimeOffset.Parse(job.GetProperty("from").GetString()!, CultureInfo.InvariantCulture).UtcDateTime;
            var to = DateTimeOffset.Parse(job.GetProperty("to").GetString()!, CultureInfo.InvariantCulture).UtcDateTime;

            string dir = Path.Combine(BaseDir, cameraId);
            var segments = ListSegments(dir)
                .Where(s => s.start < to && s.start + SegmentLength + TimeSpan.FromSeconds(5) > from)
                .OrderBy(s => s.start)
                .ToList();

            // Последний нужный кусок ещё пишется — дождёмся, пока ffmpeg его закроет.
            if (segments.Count > 0 && segments[^1].start + SegmentLength > DateTime.UtcNow - TimeSpan.FromSeconds(3) && to > segments[^1].start)
            {
                await PostAsync(new { action = "rec_done", id, wait = true }, ct);
                return;
            }
            if (segments.Count == 0)
            {
                var oldest = ListSegments(dir).Select(x => (DateTime?)x.start).Min();
                bool tooOld = oldest != null && from < oldest;
                bool recording = _recordings.ContainsKey(cameraId);
                string reason = !recording ? "Камера не записывалась на ПК (не выбрана или недоступна)"
                    : tooOld ? $"Запись уже удалена с ПК (на диске храним не больше {_maxDiskBytes / (1024 * 1024 * 1024)} ГБ)"
                    : "Нет записи за это время — камера была недоступна";
                await PostAsync(new { action = "rec_done", id, error = reason, missing = true }, ct);
                return;
            }

            string outFile = Path.Combine(dir, $"clip_{id}.mp4");
            string listFile = Path.Combine(dir, $"clip_{id}.txt");
            try
            {
                File.WriteAllLines(listFile, segments.Select(s => $"file '{s.path.Replace("\\", "/").Replace("'", "'\\''")}'"));
                double offset = Math.Max(0, (from - segments[0].start).TotalSeconds);
                double duration = Math.Max(1, (to - from).TotalSeconds);
                string args = $"-hide_banner -loglevel error -y -f concat -safe 0 -i \"{listFile}\" " +
                              $"-ss {offset.ToString("0.###", CultureInfo.InvariantCulture)} -t {duration.ToString("0.###", CultureInfo.InvariantCulture)} " +
                              "-map 0:v:0 -map 0:a:0? -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart " +
                              $"\"{outFile}\"";
                var (code, err) = await RunFfmpegAsync(args, TimeSpan.FromMinutes(8), ct);
                if (code != 0 || !File.Exists(outFile) || new FileInfo(outFile).Length < 1024)
                {
                    // Повтор без копирования звука (у некоторых камер «битый» звук).
                    args = args.Replace("-map 0:a:0? ", "").Replace("-c:a aac -b:a 64k ", "-an ");
                    (code, err) = await RunFfmpegAsync(args, TimeSpan.FromMinutes(8), ct);
                }
                if (code != 0 || !File.Exists(outFile))
                {
                    await PostAsync(new { action = "rec_done", id, error = "Не удалось вырезать отрывок: " + Short(err) }, ct);
                    return;
                }

                byte[] data = await File.ReadAllBytesAsync(outFile, ct);
                int parts = 0;
                for (int pos = 0; pos < data.Length; pos += _partBytes)
                {
                    int len = Math.Min(_partBytes, data.Length - pos);
                    string b64 = Convert.ToBase64String(data, pos, len);
                    JsonElement r = default;
                    for (int attempt = 0; attempt < 3; attempt++)
                    {
                        try
                        {
                            r = await PostAsync(new { action = "rec_part", key, part = parts, data = b64 }, ct);
                            if (r.TryGetProperty("ok", out _)) break;
                        }
                        catch when (attempt < 2) { }
                        await Task.Delay(1500, ct);
                    }
                    if (!r.TryGetProperty("ok", out _))
                    {
                        await PostAsync(new { action = "rec_done", id, error = "Не удалось загрузить отрывок на сайт" }, ct);
                        return;
                    }
                    parts++;
                }
                await PostAsync(new { action = "rec_done", id, key, parts, duration = (int)Math.Round((to - from).TotalSeconds) }, ct);
            }
            finally
            {
                TryDelete(outFile);
                TryDelete(listFile);
            }
        }

        private static List<(string path, DateTime start)> ListSegments(string dir)
        {
            var list = new List<(string, DateTime)>();
            if (!Directory.Exists(dir)) return list;
            foreach (var f in Directory.EnumerateFiles(dir, "*.ts"))
            {
                var t = SegmentTime(f);
                if (t != null && new FileInfo(f).Length > 0) list.Add((f, t.Value));
            }
            return list;
        }

        /// <summary>
        /// Время начала куска по имени файла: seg_20261011T212700.ts (местное время ПК) → UTC.
        /// Видео в куске отстаёт от времени ПК на задержку потока (несколько секунд) — её учитываем.
        /// </summary>
        private static DateTime? SegmentTime(string path)
        {
            string name = Path.GetFileNameWithoutExtension(path);
            if (!name.StartsWith("seg_")) return null;
            return DateTime.TryParseExact(name[4..], "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal | DateTimeStyles.AdjustToUniversal, out var t) ? t - StreamDelay : null;
        }

        // ---------------- ffmpeg ----------------

        private static string FfmpegDir => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AnodBiz", "ffmpeg");

        private Task<string?>? _ffmpegTask;

        /// <summary>
        /// ffmpeg ищется рядом с программой и в C:\ProgramData\AnodBiz\ffmpeg. Если его нет — скачивается
        /// в фоне (сначала с нашего хранилища частями по 1 МБ, при неудаче — с сайта ffmpeg),
        /// а прогресс виден на сайте в статусе регистратора.
        /// </summary>
        private string? FindOrStartFfmpeg(CancellationToken ct)
        {
            string local = Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");
            if (File.Exists(local)) return local;
            string exe = Path.Combine(FfmpegDir, "ffmpeg.exe");
            if (File.Exists(exe) && new FileInfo(exe).Length > 1_000_000) return exe;
            if (_ffmpegTask == null || _ffmpegTask.IsCompleted)
            {
                if (_ffmpegTask is { IsCompletedSuccessfully: true } && _ffmpegTask.Result != null) return _ffmpegTask.Result;
                _ffmpegTask = Task.Run(() => DownloadFfmpegAsync(ct));
            }
            return null;
        }

        private async Task<string?> DownloadFfmpegAsync(CancellationToken ct)
        {
            Directory.CreateDirectory(FfmpegDir);
            string exe = Path.Combine(FfmpegDir, "ffmpeg.exe");
            string zip = Path.Combine(FfmpegDir, "ffmpeg.zip");
            string? lastError = null;
            try
            {
                _status = "скачивается ffmpeg: 0%";
                var data = new byte[FfmpegParts][];
                int done = 0;
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
                await Parallel.ForEachAsync(Enumerable.Range(0, FfmpegParts),
                    new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
                    async (i, token) =>
                    {
                        string url = $"{FfmpegPartsUrl}.part{i:D4}";
                        for (int attempt = 0; ; attempt++)
                        {
                            try
                            {
                                data[i] = await http.GetByteArrayAsync(url, token);
                                break;
                            }
                            catch when (attempt < 4 && !token.IsCancellationRequested)
                            {
                                await Task.Delay(2000 * (attempt + 1), token);
                            }
                        }
                        int n = Interlocked.Increment(ref done);
                        _status = $"скачивается ffmpeg: {n * 100 / FfmpegParts}%";
                    });
                await using (var fs = File.Create(zip))
                    foreach (var part in data) await fs.WriteAsync(part, ct);
                await using (var fs = File.OpenRead(zip))
                {
                    string hash = Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(fs, ct)).ToLowerInvariant();
                    if (hash != FfmpegSha256) throw new InvalidDataException("архив ffmpeg повреждён");
                }
                if (ExtractFfmpeg(zip, exe)) return exe;
                lastError = "в архиве нет ffmpeg.exe";
            }
            catch (OperationCanceledException) { return null; }
            catch (Exception ex) { lastError = ex.Message; }
            finally { TryDelete(zip); }

            try
            {
                _status = "скачивается ffmpeg (запасной сайт)…";
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
                using (var resp = await http.GetAsync(FfmpegZipUrl, HttpCompletionOption.ResponseHeadersRead, ct))
                {
                    resp.EnsureSuccessStatusCode();
                    await using var fs = File.Create(zip);
                    await resp.Content.CopyToAsync(fs, ct);
                }
                if (ExtractFfmpeg(zip, exe)) return exe;
                lastError = "в архиве нет ffmpeg.exe";
            }
            catch (OperationCanceledException) { return null; }
            catch (Exception ex) { lastError = (lastError != null ? lastError + "; " : "") + ex.Message; }
            finally { TryDelete(zip); }

            _status = "не удалось скачать ffmpeg: " + Short(lastError ?? "") + ". Повтор через минуту";
            return null;
        }

        private static bool ExtractFfmpeg(string zip, string exe)
        {
            using var archive = ZipFile.OpenRead(zip);
            var entry = archive.Entries.FirstOrDefault(e =>
                e.FullName.Equals("ffmpeg.exe", StringComparison.OrdinalIgnoreCase) ||
                e.FullName.EndsWith("/ffmpeg.exe", StringComparison.OrdinalIgnoreCase));
            if (entry == null) return false;
            string tmp = exe + ".tmp";
            entry.ExtractToFile(tmp, true);
            File.Move(tmp, exe, true);
            return true;
        }

        /// <summary>
        /// Если программа закрылась аварийно, её записи ffmpeg могли остаться работать —
        /// закрываем их, чтобы две записи не писали в одни и те же файлы.
        /// </summary>
        private static void KillOrphans(string ffmpegPath)
        {
            try
            {
                foreach (var p in Process.GetProcessesByName("ffmpeg"))
                {
                    try
                    {
                        string? path = p.MainModule?.FileName;
                        if (path != null && string.Equals(Path.GetFullPath(path), Path.GetFullPath(ffmpegPath), StringComparison.OrdinalIgnoreCase))
                            p.Kill(true);
                    }
                    catch { }
                    finally { p.Dispose(); }
                }
            }
            catch { }
        }

        private async Task<(int code, string err)> RunFfmpegAsync(string args, TimeSpan timeout, CancellationToken ct)
        {
            var psi = new ProcessStartInfo(_ffmpeg!, args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
            };
            using var p = Process.Start(psi)!;
            var errTask = p.StandardError.ReadToEndAsync();
            _ = p.StandardOutput.ReadToEndAsync();
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);
            try { await p.WaitForExitAsync(cts.Token); }
            catch
            {
                try { p.Kill(true); } catch { }
                return (-1, "превышено время");
            }
            return (p.ExitCode, await errTask);
        }

        // ---------------- связь с сервером ----------------

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

        /// <summary>Ссылка на живое видео камеры (выдаёт сервер камер; логины камер на ПК не попадают).</summary>
        private static async Task<string?> LiveUrlAsync(string token, string cameraId, bool fresh, string quality, CancellationToken ct)
        {
            for (int i = 0; i < 2; i++)
            {
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Post, CamerasApiUrl)
                    {
                        Content = new StringContent(JsonSerializer.Serialize(new { action = "live", id = cameraId, quality, fresh }),
                            Encoding.UTF8, "application/json"),
                    };
                    req.Headers.Add("X-Authorization", token);
                    using var resp = await Http.SendAsync(req, ct);
                    var root = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct)).RootElement;
                    if (root.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(u.GetString()))
                        return u.GetString();
                }
                catch (OperationCanceledException) { throw; }
                catch { }
                await Task.Delay(1200, ct);
            }
            return null;
        }

        private static string Short(string s)
        {
            s = (s ?? "").Trim().Replace("\r", " ").Replace("\n", " ");
            return s.Length > 150 ? s[..150] : s;
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }

        // ---------------- непрерывная запись одной камеры ----------------

        private sealed class CameraRecording
        {
            private readonly string _apiToken;
            private readonly string _ffmpeg;
            private readonly string _dir;
            private readonly CancellationTokenSource _cts = new();
            private Process? _proc;

            public string CameraId { get; }
            public string Quality { get; }
            public string Name { get; set; }
            public bool IsHealthy => _proc is { HasExited: false } &&
                                     Directory.Exists(_dir) &&
                                     Directory.EnumerateFiles(_dir, "*.ts").Any(f => File.GetLastWriteTimeUtc(f) > DateTime.UtcNow.AddSeconds(-30));

            public CameraRecording(string apiToken, string cameraId, string quality, string ffmpeg, string dir)
            {
                _apiToken = apiToken;
                CameraId = cameraId;
                Quality = quality;
                Name = "камера";
                _ffmpeg = ffmpeg;
                _dir = dir;
            }

            public void Start() => _ = Task.Run(RunAsync);

            public void Stop()
            {
                _cts.Cancel();
                try { if (_proc is { HasExited: false }) _proc.Kill(true); } catch { }
            }

            private async Task RunAsync()
            {
                var ct = _cts.Token;
                Directory.CreateDirectory(_dir);
                bool fresh = false;
                while (!ct.IsCancellationRequested)
                {
                    try
                    {
                        var liveUrl = await LiveUrlAsync(_apiToken, CameraId, fresh, Quality, ct);
                        if (string.IsNullOrEmpty(liveUrl))
                        {
                            await Task.Delay(TimeSpan.FromSeconds(15), ct);
                            fresh = true;
                            continue;
                        }
                        string pattern = Path.Combine(_dir, "seg_%Y%m%dT%H%M%S.ts");
                        // Без перекодирования: поток камеры режется на минутные куски, в имени — время ПК начала куска.
                        string args = "-hide_banner -loglevel error " +
                                      $"-i \"{liveUrl}\" -map 0:v:0 -map 0:a:0? -c copy " +
                                      $"-f segment -segment_time {(int)SegmentLength.TotalSeconds} -segment_atclocktime 1 " +
                                      "-reset_timestamps 1 -strftime 1 " +
                                      $"\"{pattern}\"";
                        var psi = new ProcessStartInfo(_ffmpeg, args)
                        {
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            RedirectStandardError = true,
                        };
                        _proc = Process.Start(psi);
                        if (_proc == null) { await Task.Delay(5000, ct); continue; }
                        _ = _proc.StandardError.ReadToEndAsync();
                        var started = DateTime.UtcNow;
                        await _proc.WaitForExitAsync(ct);
                        // Ссылка на поток живёт ограниченное время — если запись оборвалась, берём новую.
                        fresh = DateTime.UtcNow - started < TimeSpan.FromMinutes(2);
                        await Task.Delay(TimeSpan.FromSeconds(fresh ? 5 : 1), ct);
                    }
                    catch (OperationCanceledException) { return; }
                    catch
                    {
                        try { await Task.Delay(TimeSpan.FromSeconds(10), ct); } catch { return; }
                    }
                }
            }
        }
    }
}