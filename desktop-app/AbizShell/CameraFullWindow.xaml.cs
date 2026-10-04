using System.Windows;
using System.Windows.Input;

namespace AbizShell
{
    /// <summary>Одна камера на весь экран (со звуком). Открывается кликом из сетки «Камеры».</summary>
    public partial class CameraFullWindow : Window
    {
        private CameraStream? _stream;
        private bool _muted;

        public CameraFullWindow(string apiToken, CamerasClient.CameraInfo camera, string? knownUrl)
        {
            InitializeComponent();
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
            }

            Loaded += async (s, e) =>
            {
                _stream = new CameraStream(apiToken, camera.Id, Video, knownUrl, 1920, muted: _muted);
                _stream.Status += t => Dispatcher.BeginInvoke(() => { StatusLabel.Text = t; StatusBox.Visibility = Visibility.Visible; });
                _stream.Started += () => Dispatcher.BeginInvoke(() => StatusBox.Visibility = Visibility.Collapsed);
                await _stream.StartAsync();
            };
            Closing += (s, e) => { _stream?.Dispose(); _stream = null; };
            KeyDown += (s, e) => { if (e.Key == Key.Escape) Close(); };
        }

        private void Mute_Click(object sender, RoutedEventArgs e)
        {
            _muted = !_muted;
            if (_stream != null) _stream.Muted = _muted;
            MuteButton.Content = _muted ? "\U0001F507" : "\U0001F50A";
        }

        private void Close_Click(object sender, RoutedEventArgs e) => Close();
    }
}
