using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using LibVLCSharp.Shared;

namespace AbizShell
{
    /// <summary>
    /// Плитка одной камеры в разделе «Камеры»: живое видео через встроенный VLC,
    /// переподключение при обрыве, клик — развернуть на весь экран.
    /// </summary>
    public partial class CameraTile : UserControl
    {
        private readonly string _apiToken;
        private readonly CamerasClient.CameraInfo _camera;
        private MediaPlayer? _player;
        private readonly DispatcherTimerLite _watchdog;
        private DateTime _lastPlaying = DateTime.MinValue;
        private bool _connecting;
        private bool _stopped;

        public event Action<CamerasClient.CameraInfo>? Enlarge;

        public CamerasClient.CameraInfo Camera => _camera;

        public CameraTile(string apiToken, CamerasClient.CameraInfo camera)
        {
            InitializeComponent();
            _apiToken = apiToken;
            _camera = camera;
            NameLabel.Text = camera.Name;

            Loaded += async (s, e) =>
            {
                if (_player != null) return;
                _player = VideoEngine.CreatePlayer();
                _player.Mute = true; // в сетке звук выключен, чтобы 6 камер не шумели вместе
                _player.Playing += (o, a) => Dispatcher.BeginInvoke(() =>
                {
                    _lastPlaying = DateTime.Now;
                    StatusBox.Visibility = Visibility.Collapsed;
                });
                Video.MediaPlayer = _player;
                await ConnectAsync();
            };
            Unloaded += (s, e) => Stop();

            _watchdog = new DispatcherTimerLite(TimeSpan.FromSeconds(6), async () =>
            {
                if (_stopped || _connecting) return;
                if (_player?.IsPlaying == true) { _lastPlaying = DateTime.Now; return; }
                if ((DateTime.Now - _lastPlaying).TotalSeconds > 22) await ConnectAsync();
            });
            _watchdog.Start();
        }

        private void ShowStatus(string text)
        {
            StatusLabel.Text = text;
            StatusBox.Visibility = Visibility.Visible;
        }

        private async Task ConnectAsync()
        {
            if (_stopped || _player == null || _connecting) return;
            _connecting = true;
            try
            {
                ShowStatus("Подключение...");
                var r = await CamerasClient.LiveAsync(_apiToken, _camera.Id);
                if (_stopped) return;
                if (string.IsNullOrEmpty(r.Url))
                {
                    ShowStatus(r.Error ?? "Камера недоступна");
                    _lastPlaying = DateTime.Now;
                    return;
                }
                await Task.Delay(2500);
                if (_stopped) return;
                using var media = VideoEngine.CreateMedia(r.Url);
                _player.Play(media);
                _lastPlaying = DateTime.Now;
            }
            finally { _connecting = false; }
        }

        public void Stop()
        {
            if (_stopped) return;
            _stopped = true;
            _watchdog.Stop();
            var p = _player;
            _player = null;
            Video.MediaPlayer = null;
            if (p != null) Task.Run(() => { try { p.Stop(); p.Dispose(); } catch { } });
        }

        private void Tile_Click(object sender, RoutedEventArgs e) => Enlarge?.Invoke(_camera);
    }

    /// <summary>Лёгкий таймер на диспетчере — чтобы не тянуть лишние using в плитку.</summary>
    internal sealed class DispatcherTimerLite
    {
        private readonly System.Windows.Threading.DispatcherTimer _timer;
        public DispatcherTimerLite(TimeSpan interval, Func<Task> tick)
        {
            _timer = new System.Windows.Threading.DispatcherTimer { Interval = interval };
            _timer.Tick += async (s, e) => await tick();
        }
        public void Start() => _timer.Start();
        public void Stop() => _timer.Stop();
    }
}
