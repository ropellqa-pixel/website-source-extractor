using System;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Живое видео одной камеры: получает ссылку (сначала из готового списка, потом с сервера),
    /// играет через VlcSurface и сам переподключается при обрыве. Всегда ОДИН плеер на камеру —
    /// повторный запуск сначала гасит предыдущий поток.
    /// </summary>
    public sealed class CameraStream : IDisposable
    {
        private readonly string _apiToken;
        private readonly string _cameraId;
        private readonly VlcSurface _surface;
        private readonly DispatcherTimer _watchdog;
        private DateTime _lastAlive = DateTime.Now;
        private bool _connecting;
        private bool _disposed;
        private bool _playing;
        private string? _knownUrl;

        public event Action<string>? Status;
        public event Action? Started;

        public CameraStream(string apiToken, string cameraId, Image target, string? knownUrl, int maxWidth, bool muted)
        {
            _apiToken = apiToken;
            _cameraId = cameraId;
            _knownUrl = knownUrl;
            _surface = new VlcSurface(target, maxWidth);
            _surface.Player.Mute = muted;
            _surface.FirstFrame += () => { _playing = true; _lastAlive = DateTime.Now; Started?.Invoke(); };
            _surface.Player.EncounteredError += (s, e) => _playing = false;
            _surface.Player.EndReached += (s, e) => _playing = false;

            _watchdog = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
            _watchdog.Tick += async (s, e) =>
            {
                if (_disposed || _connecting) return;
                if (_surface.Player.IsPlaying && _playing) { _lastAlive = DateTime.Now; return; }
                if ((DateTime.Now - _lastAlive).TotalSeconds > 15)
                {
                    _knownUrl = null; // ссылка «протухла» — берём новую
                    await ConnectAsync(fresh: true);
                }
            };
        }

        public bool Muted { set => _surface.Player.Mute = value; }

        public async Task StartAsync()
        {
            _watchdog.Start();
            await ConnectAsync(fresh: false);
        }

        private async Task ConnectAsync(bool fresh)
        {
            if (_disposed || _connecting) return;
            _connecting = true;
            _playing = false;
            try
            {
                Status?.Invoke("Подключение...");
                string? url = _knownUrl;
                if (string.IsNullOrEmpty(url))
                {
                    var r = await CamerasClient.LiveAsync(_apiToken, _cameraId, fresh);
                    if (_disposed) return;
                    url = r.Url;
                    if (string.IsNullOrEmpty(url))
                    {
                        Status?.Invoke(r.Error ?? "Камера недоступна. Повтор...");
                        _lastAlive = DateTime.Now;
                        return;
                    }
                }
                _knownUrl = url;
                try { _surface.Player.Stop(); } catch { }
                _surface.Play(url);
                _lastAlive = DateTime.Now;
            }
            finally { _connecting = false; }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _watchdog.Stop();
            _surface.Dispose();
        }
    }
}
