using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using LibVLCSharp.Shared;

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
        private readonly DispatcherTimer _watchdog;
        private MediaPlayer? _player;
        private bool _closing;
        private bool _connecting;
        private DateTime _lastPlaying = DateTime.MinValue;

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

            // Сторож: если видео не идёт 20 секунд — переподключаемся.
            _watchdog = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _watchdog.Tick += async (s, e) =>
            {
                if (_closing || _connecting) return;
                bool playing = _player?.IsPlaying == true;
                if (playing) { _lastPlaying = DateTime.Now; return; }
                if ((DateTime.Now - _lastPlaying).TotalSeconds > 20) await ConnectAsync();
            };

            Loaded += async (s, e) =>
            {
                try
                {
                    _player = VideoEngine.CreatePlayer();
                    _player.Playing += (o, a) => Dispatcher.BeginInvoke(() =>
                    {
                        _lastPlaying = DateTime.Now;
                        StatusBox.Visibility = Visibility.Collapsed;
                    });
                    _player.EncounteredError += (o, a) => Dispatcher.BeginInvoke(() => ShowStatus("Связь с камерой прервалась. Переподключение..."));
                    _player.EndReached += (o, a) => Dispatcher.BeginInvoke(() => ShowStatus("Связь с камерой прервалась. Переподключение..."));
                    Video.MediaPlayer = _player;
                }
                catch (Exception ex)
                {
                    ShowStatus("Не удалось запустить видеоплеер: " + ex.Message);
                    return;
                }
                await ConnectAsync();
                _watchdog.Start();
            };

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

        private async Task ConnectAsync()
        {
            if (_closing || _player == null || _connecting) return;
            _connecting = true;
            try
            {
                ShowStatus("Подключение к камере...");
                var result = await CamerasClient.LiveByNameAsync(_apiToken, CameraNamePrefix);
                if (_closing) return;
                if (!string.IsNullOrEmpty(result.Name)) CameraNameLabel.Text = result.Name;

                if (string.IsNullOrEmpty(result.Url))
                {
                    ShowStatus(result.Error ?? "Камера недоступна. Повтор через несколько секунд...");
                    _lastPlaying = DateTime.Now;
                    return;
                }

                // Облако готовит поток 2–4 секунды после выдачи ссылки.
                await Task.Delay(2500);
                if (_closing) return;
                using var media = VideoEngine.CreateMedia(result.Url);
                _player.Play(media);
                _lastPlaying = DateTime.Now;
            }
            finally
            {
                _connecting = false;
            }
        }

        private void Cleanup()
        {
            if (_closing) return;
            _closing = true;
            _clock.Stop();
            _watchdog.Stop();
            var p = _player;
            _player = null;
            if (p != null)
            {
                // Остановка VLC может занять секунду — делаем её в фоне, чтобы окно закрылось сразу.
                Video.MediaPlayer = null;
                Task.Run(() => { try { p.Stop(); p.Dispose(); } catch { } });
            }
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