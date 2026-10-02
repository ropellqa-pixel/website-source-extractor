using System;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Экран пароля (поверх всего, без рамки). Пароль пользователя открывает обычный
    /// киоск, пароль администратора — тот же киоск, но с админ-инструментами (кнопка
    /// шестерёнки, выход в Windows, смена кнопок и т.д.) — см. ShellWindow.
    /// </summary>
    public partial class MainWindow : Window
    {
        private const string UserPassword = "243063";
        private const string AdminPassword = "832605633";

        private string _deviceCode = "";
        private string? _apiToken;
        private DispatcherTimer? _devicePollTimer;
        private DispatcherTimer? _networkTimer;
        private DispatcherTimer? _spinnerTimer;
        private bool _isOnline = true;
        private bool _isLinked;
        private double _spinnerAngle;

        private int _codeClickCount;
        private DateTime _lastCodeClick = DateTime.MinValue;

        public MainWindow()
        {
            InitializeComponent();
            Loaded += MainWindow_Loaded;
            StateChanged += (s, e) =>
            {
                // Защита от сворачивания окна системой — всегда возвращаем на весь экран.
                if (WindowState == WindowState.Minimized)
                    WindowState = WindowState.Maximized;
            };
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            PasswordBox.Focus();

            try { _deviceCode = await DeviceManager.InitializeDeviceAsync(); }
            catch { _deviceCode = "000000000"; }

            DeviceCodeLabel.Text = "Код устройства: " + DeviceManager.FormatCode(_deviceCode);

            _apiToken = DeviceManager.GetApiToken();
            if (!string.IsNullOrEmpty(_apiToken))
            {
                _isLinked = true;
                EmployeeInfoLabel.Text = "Устройство привязано";
                StatusLabel.Text = "Введите пароль для входа";
                StatusLabel.Foreground = new SolidColorBrush(Color.FromRgb(0x4A, 0x90, 0xD9));
            }
            else
            {
                _isLinked = false;
                ShowBindingScreen();
            }

            _spinnerTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
            _spinnerTimer.Tick += (s, a) =>
            {
                _spinnerAngle = (_spinnerAngle + 15) % 360;
                SpinnerRot.Angle = _spinnerAngle;
            };
            _spinnerTimer.Start();

            await CheckNetworkAsync();

            _devicePollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _devicePollTimer.Tick += async (s, a) => await PollDeviceAsync();
            _devicePollTimer.Start();

            _networkTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _networkTimer.Tick += async (s, a) => await CheckNetworkAsync();
            _networkTimer.Start();

            await PollDeviceAsync();
        }

        private void ShowBindingScreen()
        {
            BindingOverlay.Visibility = Visibility.Visible;
            BindingCodeLabel.Text = DeviceManager.FormatCode(_deviceCode);
            BindingPcName.Text = "ПК: " + Environment.MachineName;
        }

        private void HideBindingScreen()
        {
            BindingOverlay.Visibility = Visibility.Collapsed;
            EmployeeInfoLabel.Text = "Устройство привязано. Токен получен.";
            StatusLabel.Text = "Введите пароль для входа";
            StatusLabel.Foreground = new SolidColorBrush(Color.FromRgb(0x4A, 0x90, 0xD9));
        }

        private async System.Threading.Tasks.Task PollDeviceAsync()
        {
            if (!_isOnline || _isLinked) return;

            bool linked = await DeviceManager.PollDeviceStatusAsync(_deviceCode);
            if (linked)
            {
                _isLinked = true;
                _apiToken = DeviceManager.GetApiToken();
                HideBindingScreen();
                _devicePollTimer?.Stop();
            }
            else
            {
                BindingStatusLabel.Text = "Ожидание привязки... (код " + DeviceManager.FormatCode(_deviceCode) + ")";
            }
        }

        private async System.Threading.Tasks.Task CheckNetworkAsync()
        {
            bool online = await AnodBizClient.CheckNetworkAsync();
            if (online == _isOnline) return;

            _isOnline = online;
            if (online)
            {
                NetworkOverlay.Visibility = Visibility.Collapsed;
                if (!_isLinked) BindingOverlay.Visibility = Visibility.Visible;
                else PasswordBox.Focus();
            }
            else
            {
                NetworkOverlay.Visibility = Visibility.Visible;
                BindingOverlay.Visibility = Visibility.Collapsed;
            }
        }

        private void PasswordBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter) return;

            string pwd = PasswordBox.Password;
            if (pwd == AdminPassword)
                TryLogin(true);
            else if (pwd == UserPassword)
                TryLogin(false);
            else
            {
                StatusLabel.Text = "Неверный пароль";
                StatusLabel.Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0x6B, 0x6B));
                PasswordBox.Clear();
                PasswordBox.Focus();
            }
        }

        private void TryLogin(bool isAdmin)
        {
            // Без привязки устройства (нет api_token) пускаем только администратора —
            // ему нужно попасть в систему, чтобы, например, ввести код в другом месте
            // или временно выйти в Windows. Обычного сотрудника без токена не пускаем.
            if (!_isLinked && !isAdmin)
            {
                StatusLabel.Text = "Устройство ещё не привязано — обратитесь к директору";
                StatusLabel.Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0x6B, 0x6B));
                PasswordBox.Clear();
                return;
            }

            _devicePollTimer?.Stop();
            _networkTimer?.Stop();
            _spinnerTimer?.Stop();

            StatusLabel.Text = "Вход выполнен!";
            StatusLabel.Foreground = new SolidColorBrush(Colors.Green);

            var shell = new ShellWindow
            {
                IsAdmin = isAdmin,
                ApiToken = _apiToken ?? "",
                DeviceCode = _deviceCode,
            };
            shell.Show();
            Close();
        }

        private async void RetryNetwork_Click(object sender, RoutedEventArgs e)
        {
            NetworkOverlay.Visibility = Visibility.Collapsed;
            await CheckNetworkAsync();
        }

        private void CallAdmin_Click(object sender, RoutedEventArgs e)
        {
            NetworkOverlay.Visibility = Visibility.Collapsed;
            PasswordBox.Focus();
            StatusLabel.Text = "Введите пароль администратора";
            StatusLabel.Foreground = Brushes.White;
        }

        /// <summary>Три быстрых клика по коду устройства — перегенерировать его (например, после сброса на сайте).</summary>
        private async void DeviceCode_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if ((DateTime.Now - _lastCodeClick).TotalSeconds > 2)
                _codeClickCount = 0;

            _codeClickCount++;
            _lastCodeClick = DateTime.Now;

            if (_codeClickCount >= 3)
            {
                _codeClickCount = 0;
                await RegenerateDeviceCodeAsync();
            }
        }

        private async System.Threading.Tasks.Task RegenerateDeviceCodeAsync()
        {
            try
            {
                string newCode = await AnodBizClient.RegisterDeviceAsync(Environment.MachineName);
                DeviceManager.SaveDeviceCode(newCode);
                DeviceManager.ClearApiToken();

                _deviceCode = newCode;
                _isLinked = false;
                _apiToken = null;

                DeviceCodeLabel.Text = "Код устройства: " + DeviceManager.FormatCode(newCode);
                ShowBindingScreen();

                _devicePollTimer?.Stop();
                _devicePollTimer?.Start();
                await PollDeviceAsync();
            }
            catch { }
        }
    }
}
