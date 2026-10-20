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
        private bool _closing;

        public CameraWindow(string? apiToken)
        {
            InitializeComponent();
            _apiToken = apiToken;

            if (Edition.Kiosk)
            {
                ShowInTaskbar = false;
                ScreenArea.Reset();
                ScreenArea.CoverScreen(this);
                StateChanged += (s, e) => { if (WindowState != WindowState.Normal) ScreenArea.CoverScreen(this); };
            }
            else
            {
                Width = 1100;
                Height = 760;
                Title = Edition.Name + " — Камера Зал";
            }

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
            try
            {
                string dataDir = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AbizShell", "WebView2Cam");
                var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, dataDir);
                await Web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                ShowStatus("Не удалось запустить просмотр: " + ex.Message);
                return;
            }
            if (_closing) return;
            var core = Web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.UserAgent = core.Settings.UserAgent + " ABIZ/" + RemoteControlClient.AppVersion;
            core.NewWindowRequested += (s, a) => a.Handled = true;
            core.NavigationCompleted += (s, a) =>
            {
                if (a.IsSuccess) StatusBox.Visibility = Visibility.Collapsed;
                else ShowStatus("Нет связи с сервером. Повтор через 5 секунд...");
                if (!a.IsSuccess) _ = RetryAsync();
            };
            Open();
        }

        private void Open()
        {
            if (_closing || Web.CoreWebView2 == null) return;
            string token = Uri.EscapeDataString(_apiToken ?? "");
            Web.CoreWebView2.Navigate($"https://bizwor.ru/cam-view?name={Uri.EscapeDataString(CameraNamePrefix)}#t={token}");
        }

        private async Task RetryAsync()
        {
            await Task.Delay(5000);
            Open();
        }

        private void Cleanup()
        {
            if (_closing) return;
            _closing = true;
            try { Web.Dispose(); } catch { }
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