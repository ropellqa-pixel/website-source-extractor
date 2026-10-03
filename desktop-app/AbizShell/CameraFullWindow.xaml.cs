using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using LibVLCSharp.Shared;

namespace AbizShell
{
    /// <summary>Одна камера на весь экран (со звуком). Открывается кликом из сетки «Камеры».</summary>
    public partial class CameraFullWindow : Window
    {
        private readonly string _apiToken;
        private readonly CamerasClient.CameraInfo _camera;
        private MediaPlayer? _player;
        private readonly DispatcherTimer _watchdog;
        private DateTime _lastPlaying = DateTime.MinValue;
        private bool _connecting;
        private bool _closing;
        private bool _muted;

        public CameraFullWindow(string apiToken, CamerasClient.CameraInfo camera)
        {
            InitializeComponent();
            _apiToken = apiToken;
            _camera = camera;
            NameLabel.Text = camera.Name;

            if (Edition.Kiosk)
            {
                WindowStyle = WindowStyle.None;
                WindowState = WindowState.Maximized;
                ShowInTaskbar = false;
            }
            else
            {
                Width = 1100;
                Height = 720;
                WindowStartupLocation = WindowStartupLocation.CenterOwner;
            }

            _watchdog = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _watchdog.Tick += async (s, e) =>
            {
                if (_closing || _connecting) return;
                if (_player?.IsPlaying == true) { _lastPlaying = DateTime.Now; return; }
                if ((DateTime.Now - _lastPlaying).TotalSeconds > 20) await ConnectAsync();
            };

            Loaded += async (s, e) =>
            {
                _player = VideoEngine.CreatePlayer();
                _player.Mute = _muted;
                _player.Playing += (o, a) => Dispatcher.BeginInvoke(() =>
                {
                    _lastPlaying = DateTime.Now;
                    StatusBox.Visibility = Visibility.Collapsed;
                });
                Video.MediaPlayer = _player;
                await ConnectAsync();
                _watchdog.Start();
            };
            Closing += (s, e) => Cleanup();
            KeyDown += (s, e) => { if (e.Key == Key.Escape) Close(); };
        }

        private void ShowStatus(string text)
        {
            StatusLabel.Text = text;
            StatusBox.Visibility = Visibility.Visible;
        }

        private async Task ConnectAsync()
        {
            if (_closing || _player == null || _connecting) return;
            _connecting = true;
            try
            {
                ShowStatus("Подключение к камере...");
                var r = await CamerasClient.LiveAsync(_apiToken, _camera.Id);
                if (_closing) return;
                if (string.IsNullOrEmpty(r.Url))
                {
                    ShowStatus(r.Error ?? "Камера недоступна");
                    _lastPlaying = DateTime.Now;
                    return;
                }
                await Task.Delay(2500);
                if (_closing) return;
                using var media = VideoEngine.CreateMedia(r.Url);
                _player.Play(media);
                _lastPlaying = DateTime.Now;
            }
            finally { _connecting = false; }
        }

        private void Mute_Click(object sender, RoutedEventArgs e)
        {
            _muted = !_muted;
            if (_player != null) _player.Mute = _muted;
            MuteButton.Content = _muted ? "\U0001F507" : "\U0001F50A";
        }

        private void Cleanup()
        {
            if (_closing) return;
            _closing = true;
            _watchdog.Stop();
            var p = _player;
            _player = null;
            Video.MediaPlayer = null;
            if (p != null) Task.Run(() => { try { p.Stop(); p.Dispose(); } catch { } });
        }

        private void Close_Click(object sender, RoutedEventArgs e) => Close();
    }
}
