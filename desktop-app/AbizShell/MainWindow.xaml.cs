using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Экран входа. Пароль сотрудника проверяется на сервере (тот, что директор задал
    /// в личном кабинете), поэтому смена пароля действует сразу. Пароль администратора
    /// проверяется локально и работает даже без интернета и без привязки.
    /// </summary>
    public partial class MainWindow : Window
    {
        private const string AdminPassword = "832605633";

        private string _deviceCode = "";
        private string? _apiToken;
        private DispatcherTimer? _devicePollTimer;
        private DispatcherTimer? _networkTimer;
        private DispatcherTimer? _spinnerTimer;
        private bool _isOnline = true;
        private bool _isLinked;
        private bool _busy;
        private int _networkFailures;
        private double _spinnerAngle;

        public MainWindow()
        {
            InitializeComponent();
            Loaded += MainWindow_Loaded;
            StateChanged += (s, e) =>
            {
                if (WindowState == WindowState.Minimized)
                    WindowState = WindowState.Maximized;
            };
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            PasswordBox.Focus();

            _spinnerTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
            _spinnerTimer.Tick += (s, a) =>
            {
                _spinnerAngle = (_spinnerAngle + 15) % 360;
                SpinnerRot.Angle = _spinnerAngle;
            };
            _spinnerTimer.Start();

            _apiToken = DeviceManager.GetApiToken();
            _isLinked = !string.IsNullOrEmpty(_apiToken);

            await EnsureDeviceCodeAsync();
            UpdateLinkUi();

            _devicePollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _devicePollTimer.Tick += async (s, a) => await PollDeviceAsync();
            if (!_isLinked) _devicePollTimer.Start();

            _networkTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _networkTimer.Tick += async (s, a) => await CheckNetworkAsync();
            _networkTimer.Start();

            await CheckNetworkAsync();
            if (!_isLinked) await PollDeviceAsync();
        }

        private async Task EnsureDeviceCodeAsync()
        {
            _deviceCode = await DeviceManager.InitializeDeviceAsync();
            DeviceCodeLabel.Text = string.IsNullOrEmpty(_deviceCode)
                ? "Код устройства: нет связи с сервером"
                : "Код устройства: " + DeviceManager.FormatCode(_deviceCode);
            BindingCodeLabel.Text = string.IsNullOrEmpty(_deviceCode) ? "---" : DeviceManager.FormatCode(_deviceCode);
            BindingPcName.Text = "ПК: " + Environment.MachineName;
        }

        private void UpdateLinkUi()
        {
            if (_isLinked)
            {
                BindingOverlay.Visibility = Visibility.Collapsed;
                EmployeeInfoLabel.Text = "Устройство привязано";
                SetStatus("Введите пароль для входа", Color.FromRgb(0x4A, 0x90, 0xD9));
                PasswordBox.Focus();
            }
            else
            {
                BindingOverlay.Visibility = Visibility.Visible;
                EmployeeInfoLabel.Text = "Ожидание привязки устройства...";
            }
        }

        private void SetStatus(string text, Color color)
        {
            StatusLabel.Text = text;
            StatusLabel.Foreground = new SolidColorBrush(color);
        }

        // --- Привязка устройства ---

        private async Task PollDeviceAsync()
        {
            if (_isLinked || _busy) return;
            _busy = true;
            try
            {
                if (string.IsNullOrEmpty(_deviceCode))
                {
                    await EnsureDeviceCodeAsync();
                    if (string.IsNullOrEmpty(_deviceCode))
                    {
                        BindingStatusLabel.Text = "Нет связи с сервером, пробуем снова...";
                        return;
                    }
                }

                string result = await DeviceManager.PollDeviceStatusAsync(_deviceCode);
                switch (result)
                {
                    case "linked":
                        _isLinked = true;
                        _apiToken = DeviceManager.GetApiToken();
                        _devicePollTimer?.Stop();
                        UpdateLinkUi();
                        SetStatus("Устройство привязано. Введите пароль", Colors.LightGreen);
                        break;
                    case "reset":
                        // Сервер не знает этот код (например, его выдумала старая версия
                        // программы без интернета) или его отозвали — получаем новый.
                        _deviceCode = await DeviceManager.ResetDeviceAsync();
                        await EnsureDeviceCodeAsync();
                        BindingStatusLabel.Text = "Выдан новый код — передайте его директору";
                        break;
                    case "error":
                        BindingStatusLabel.Text = "Нет связи с сервером, пробуем снова...";
                        break;
                    default:
                        BindingStatusLabel.Text = "Ожидание привязки... (проверка каждые 3 сек)";
                        break;
                }
            }
            finally
            {
                _busy = false;
            }
        }

        private async void CheckBindingNow_Click(object sender, RoutedEventArgs e)
        {
            BindingStatusLabel.Text = "Проверяем...";
            await PollDeviceAsync();
        }

        private async void NewCode_Click(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Получить новый код устройства? Старый код перестанет действовать.",
                    "АБИЗ", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            _deviceCode = await DeviceManager.ResetDeviceAsync();
            await EnsureDeviceCodeAsync();
            BindingStatusLabel.Text = string.IsNullOrEmpty(_deviceCode)
                ? "Нет связи с сервером"
                : "Новый код получен — передайте его директору";
        }

        private void BindingAdminPassword_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter) return;
            if (BindingAdminPassword.Password == AdminPassword)
                OpenShell(true, "");
            else
            {
                BindingAdminPassword.Clear();
                BindingStatusLabel.Text = "Неверный пароль администратора";
            }
        }

        // --- Проверка сети ---

        private async Task CheckNetworkAsync()
        {
            bool online = await AnodBizClient.CheckNetworkAsync();

            // Предупреждение показываем только после 2 неудачных проверок подряд,
            // чтобы короткий сбой не перекрывал экран.
            _networkFailures = online ? 0 : _networkFailures + 1;
            bool showOffline = _networkFailures >= 2;

            if (showOffline == !_isOnline) return;
            _isOnline = !showOffline;
            NetworkOverlay.Visibility = showOffline ? Visibility.Visible : Visibility.Collapsed;
            if (_isOnline && !_isLinked) await PollDeviceAsync();
        }

        private async void RetryNetwork_Click(object sender, RoutedEventArgs e)
        {
            _networkFailures = 0;
            bool online = await AnodBizClient.CheckNetworkAsync();
            _isOnline = online;
            NetworkOverlay.Visibility = online ? Visibility.Collapsed : Visibility.Visible;
            if (online && !_isLinked) await PollDeviceAsync();
        }

        private void CallAdmin_Click(object sender, RoutedEventArgs e)
        {
            NetworkOverlay.Visibility = Visibility.Collapsed;
            BindingOverlay.Visibility = Visibility.Collapsed;
            PasswordBox.Focus();
            SetStatus("Введите пароль администратора", Colors.White);
        }

        // --- Вход ---

        private async void PasswordBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter || _busy) return;
            string pwd = PasswordBox.Password;
            if (string.IsNullOrEmpty(pwd)) return;

            if (pwd == AdminPassword)
            {
                OpenShell(true, "");
                return;
            }

            // Аварийный выход в Windows прямо с экрана входа: "exit:" + пароль администратора.
            if (pwd == "exit:" + AdminPassword)
            {
                ExitToWindows();
                return;
            }

            if (!_isLinked || string.IsNullOrEmpty(_apiToken))
            {
                SetStatus("Устройство не привязано — обратитесь к директору", Color.FromRgb(0xFF, 0x6B, 0x6B));
                PasswordBox.Clear();
                UpdateLinkUi();
                return;
            }

            _busy = true;
            SetStatus("Проверка пароля...", Colors.White);
            var (result, fullName) = await AnodBizClient.DeviceSignInAsync(_apiToken, pwd);
            _busy = false;

            switch (result)
            {
                case AnodBizClient.SignInResult.Ok:
                    OpenShell(false, fullName);
                    return;
                case AnodBizClient.SignInResult.DeviceRevoked:
                    DeviceManager.ClearApiToken();
                    _apiToken = null;
                    _isLinked = false;
                    _deviceCode = await DeviceManager.ResetDeviceAsync();
                    await EnsureDeviceCodeAsync();
                    UpdateLinkUi();
                    _devicePollTimer?.Start();
                    BindingStatusLabel.Text = "Устройство отвязано в личном кабинете. Выдан новый код.";
                    break;
                case AnodBizClient.SignInResult.NoNetwork:
                    SetStatus("Нет связи с сервером — попробуйте ещё раз", Color.FromRgb(0xFF, 0x6B, 0x6B));
                    break;
                default:
                    SetStatus("Неверный пароль", Color.FromRgb(0xFF, 0x6B, 0x6B));
                    break;
            }
            PasswordBox.Clear();
            PasswordBox.Focus();
        }

        private void OpenShell(bool isAdmin, string fullName)
        {
            _devicePollTimer?.Stop();
            _networkTimer?.Stop();
            _spinnerTimer?.Stop();

            try
            {
                var shell = new ShellWindow
                {
                    IsAdmin = isAdmin,
                    ApiToken = _apiToken ?? "",
                    DeviceCode = _deviceCode,
                };
                if (!string.IsNullOrEmpty(fullName))
                    shell.Title = "АБИЗ — " + fullName;
                shell.Show();
                Close();
            }
            catch (Exception ex)
            {
                // Рабочий стол не открылся — остаёмся на экране входа, а не в пустом окне.
                TaskbarManager.Restore();
                _networkTimer?.Start();
                SetStatus("Ошибка запуска рабочего стола", Color.FromRgb(0xFF, 0x6B, 0x6B));
                MessageBox.Show(this,
                    "Не удалось открыть рабочий стол АБИЗ:\n" + ex.Message +
                    "\n\nЧтобы выйти в Windows, введите exit: и пароль администратора без пробела.",
                    "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Error);
                PasswordBox.Clear();
                PasswordBox.Focus();
            }
        }

        private void ExitToWindows()
        {
            _devicePollTimer?.Stop();
            _networkTimer?.Stop();
            _spinnerTimer?.Stop();
            TaskbarManager.Restore();
            foreach (Window w in Application.Current.Windows)
                if (w is ShellWindow sw) sw.ForceCloseForExit();
            Application.Current.Shutdown();
        }

        private void DeviceCode_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
        }
    }
}