using System;
using System.Windows;
using System.Windows.Controls;

namespace AbizShell
{
    /// <summary>
    /// Плитка одной камеры в разделе «Камеры»: живое видео (без звука), автопереподключение,
    /// клик — развернуть камеру на весь экран.
    /// </summary>
    public partial class CameraTile : UserControl
    {
        private readonly string _apiToken;
        private readonly CamerasClient.CameraInfo _camera;
        private readonly string? _knownUrl;
        private CameraStream? _stream;

        public event Action<CamerasClient.CameraInfo>? Enlarge;
        public CamerasClient.CameraInfo Camera => _camera;
        public string? KnownUrl => _knownUrl;

        public CameraTile(string apiToken, CamerasClient.CameraInfo camera, string? knownUrl)
        {
            InitializeComponent();
            _apiToken = apiToken;
            _camera = camera;
            _knownUrl = knownUrl;
            NameLabel.Text = camera.Name;
            Loaded += async (s, e) =>
            {
                if (_stream != null) return;
                _stream = new CameraStream(_apiToken, _camera.Id, Video, _knownUrl, 960, muted: true);
                _stream.Status += t => Dispatcher.BeginInvoke(() => { StatusLabel.Text = t; StatusBox.Visibility = Visibility.Visible; });
                _stream.Started += () => Dispatcher.BeginInvoke(() => StatusBox.Visibility = Visibility.Collapsed);
                await _stream.StartAsync();
            };
        }

        public void Stop()
        {
            _stream?.Dispose();
            _stream = null;
        }

        private void Tile_Click(object sender, RoutedEventArgs e) => Enlarge?.Invoke(_camera);
    }
}
