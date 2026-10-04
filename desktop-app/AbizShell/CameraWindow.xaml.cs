using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Окно «Камера Зал» — прямая трансляция камеры «Зал-Касса» с экрана входа.
    /// Ничего, кроме живого видео: ни архива, ни переключения камер, ни настроек.
    /// Если поток оборвался — переподключается сам. Кнопка внизу возвращает к вводу пароля.
    /// В АБИЗ окно на весь экран без рамки, в АБИЗ-Админ — обычное окно.
    /// </summary>
    public partial class CameraWindow : Window
    {
        private const string CameraNamePrefix = "Зал";

        private readonly string? _apiToken;
        private readonly DispatcherTimer _clock;
        private CameraStream? _stream;
        private bool _closing;

        public CameraWindow(string? apiToken)
        {
            InitializeComponent();
            _apiToken = apiToken;

            if (Edition.Kiosk)
            {
                WindowStyle = WindowStyle.None;
                ResizeMode = ResizeMode.NoResize;
                WindowState = WindowState.Maximized;
                ShowInTaskbar = false;
                StateChanged += (s, e) => { if (WindowState == WindowState.Minimized) WindowState = WindowState.Maximized; };
            }
            else
            {
                Width = 1100;
                Height = 760;
                Title = Edition.Name + " — Камера Зал";
            }

            _clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _clock.Tick += (s, e) => ClockLabel.Text = DateTime.Now.ToString("HH:mm:ss");
            _clock.Start();
            ClockLabel.Text = DateTime.Now.ToString("HH:mm:ss");

            Loaded += async (s, e) => await StartAsync();

            Closing += (s, e) =>
            {
                // АБИЗ: окно закрывается только кнопкой «ВХОД» (Alt+F4 не сработает).
                if (Edition.Kiosk && !_goingToLogin && !_forceClose) { e.Cancel = true; return; }
                bool byButton = _goingToLogin;
                Cleanup();
                // АБИЗ-Админ: закрыли окно крестиком — закрываем программу.
                if (!byButton && !Edition.Kiosk) Application.Current.Shutdown();
            };
        }

        private void ShowStatus(string text)
        {
            StatusLabel.Text = text;
            StatusBox.Visibility = Visibility.Visible;
        }

        private async Task StartAsync()
        {
            ShowStatus("Подключение к камере...");
            var (cameras, error) = await CamerasClient.ListAsync(_apiToken);
            if (_closing) return;
            if (cameras.Count == 0)
            {
                ShowStatus(error ?? "Камеры не найдены");
                await Task.Delay(5000);
                if (!_closing) await StartAsync();
                return;
            }
            var cam = cameras.Find(c => c.Name.StartsWith(CameraNamePrefix, StringComparison.OrdinalIgnoreCase))
                      ?? cameras.Find(c => c.IsDefault) ?? cameras[0];
            CameraNameLabel.Text = cam.Name;
            _stream = new CameraStream(_apiToken ?? "", cam.Id, Video, null, 1920, muted: true);
            _stream.Status += t => Dispatcher.BeginInvoke(() => ShowStatus(t));
            _stream.Started += () => Dispatcher.BeginInvoke(() => StatusBox.Visibility = Visibility.Collapsed);
            await _stream.StartAsync();
        }

        private void Cleanup()
        {
            if (_closing) return;
            _closing = true;
            _clock.Stop();
            _stream?.Dispose();
            _stream = null;
        }

        private bool _goingToLogin;
        private bool _forceClose;

        /// <summary>Закрыть окно при выходе из программы (в том числе в АБИЗ).</summary>
        public void ForceClose()
        {
            _forceClose = true;
            Close();
        }

        private void Login_Click(object sender, RoutedEventArgs e)
        {
            _goingToLogin = true;
            Cleanup();
            var login = new MainWindow();
            if (!Edition.Kiosk)
            {
                login.WindowStartupLocation = WindowStartupLocation.Manual;
                login.Left = Left;
                login.Top = Top;
            }
            login.Show();
            Close();
        }
    }
}