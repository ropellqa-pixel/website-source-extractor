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

            UpdateClockUi();
            _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _clockTimer.Tick += (s, e) => UpdateClockUi();
            _clockTimer.Start();
            Closed += (s, e) => _clockTimer.Stop();

            if (Edition.Kiosk)
            {
                // Экран входа — точно на весь монитор; заодно сбрасываем область экрана
                // (на случай, если прошлый сеанс оставил отступ).
                ScreenArea.Reset();
                ScreenArea.CoverScreen(this);
                StateChanged += (s, e) =>
                {
                    if (WindowState != WindowState.Normal) ScreenArea.CoverScreen(this);
                };
            }
            else
            {
                // АБИЗ-Админ: обычное окно Windows с рамкой, можно свернуть и закрыть.
                WindowStyle = WindowStyle.SingleBorderWindow;
                ResizeMode = ResizeMode.CanResize;
                WindowState = WindowState.Normal;
                ShowInTaskbar = true;
                Width = 1000;
                Height = 720;
                Title = Edition.Name;
                AppTitleLabel.Text = Edition.Name;
                AppTitleLabel.FontSize = 26;
                VersionLabel.Text = Edition.Name + " v3.2";
                Closing += (s, e) =>
                {
                    if (_openingNext) return;
                    _devicePollTimer?.Stop();
                    _networkTimer?.Stop();
                    _spinnerTimer?.Stop();
                    Application.Current.Shutdown();
                };
            }
        }

        private bool _openingNext;
        private readonly DispatcherTimer _clockTimer;

        private void UpdateClockUi()
        {
            var now = DateTime.Now;
            ClockText.Text = now.ToString("HH:mm");
            DateText.Text = now.ToString("dddd, d MMMM", new System.Globalization.CultureInfo("ru-RU"));
            GreetingLabel.Text = now.Hour < 5 ? "Доброй ночи" : now.Hour < 12 ? "Доброе утро" : now.Hour < 18 ? "Добрый день" : "Добрый вечер";
        }

        private void Keypad_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not System.Windows.Controls.Button b || b.Tag is not string key) return;
            if (key == "back")
            {
                string p = PasswordBox.Password;
                if (p.Length > 0) PasswordBox.Password = p.Substring(0, p.Length - 1);
            }
            else if (key == "ok")
            {
                var source = PresentationSource.FromVisual(PasswordBox);
                if (source == null) return;
                PasswordBox.RaiseEvent(new KeyEventArgs(Keyboard.PrimaryDevice, source, 0, Key.Enter) { RoutedEvent = Keyboard.KeyDownEvent });
            }
            else
            {
                PasswordBox.Password += key;
            }
            PasswordBox.Focus();
        }

        private void CameraHall_Click(object sender, RoutedEventArgs e)
        {
            _devicePollTimer?.Stop();
            _networkTimer?.Stop();
            _spinnerTimer?.Stop();
            StopRemoteAgent();
            try
            {
                var cam = new CameraWindow(_apiToken);
                if (!Edition.Kiosk)
                {
                    cam.Left = Left;
                    cam.Top = Top;
                    cam.WindowStartupLocation = WindowStartupLocation.Manual;
                }
                cam.Show();
                _openingNext = true;
                Close();
            }
            catch (Exception ex)
            {
                _networkTimer?.Start();
                _spinnerTimer?.Start();
                if (!_isLinked) _devicePollTimer?.Start();
                SetStatus("Не удалось открыть камеру", Color.FromRgb(0xDC, 0x26, 0x26));
                MessageBox.Show(this, "Не удалось открыть окно камеры:\n" + ex.Message, Edition.Name,
                    MessageBoxButton.OK, MessageBoxImage.Warning);
            }
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

            StartRemoteAgent();
            RecorderService.Start(_apiToken);

            // Сотрудник вышел, а обновление уже скачано — ставим его сейчас.
            if (Updater.StagedDir != null) ApplyUpdateNow();
        }

        private RemoteAgent? _remoteAgent;

        /// <summary>На экране входа агент сообщает серверу статус "login" (ПК включён, но вход не выполнен)
        /// и принимает удалённые команды зам. директора (блокировка, сообщение, обновление).</summary>
        private void StartRemoteAgent()
        {
            if (_remoteAgent != null || string.IsNullOrEmpty(_apiToken)) return;
            _remoteAgent = new RemoteAgent(_apiToken)
            {
                Presence = "login",
                UserName = "",
                OnReload = () => Dispatcher.Invoke(() => { _apiToken = DeviceManager.GetApiToken(); }),
                // Удалённый вход с сайта (зам. директора): как сотрудник ПК или как администратор.
                OnRemoteLogin = (asAdmin, fullName) => Dispatcher.BeginInvoke(() =>
                {
                    _ = RemoteControlClient.LogAsync(_apiToken ?? "", "signin", asAdmin ? "Удалённый вход: администратор" : "Удалённый вход: " + fullName);
                    OpenShell(asAdmin, asAdmin ? "" : fullName);
                }),
                // На экране входа никто не работает — обновление ставим сразу.
                OnUpdateReady = () => Dispatcher.BeginInvoke(ApplyUpdateNow),
                OnRevoked = () => Dispatcher.Invoke(async () =>
                {
                    DeviceManager.ClearApiToken();
                    _apiToken = null;
                    _isLinked = false;
                    _remoteAgent?.Stop();
                    _remoteAgent = null;
                    _deviceCode = await DeviceManager.ResetDeviceAsync();
                    await EnsureDeviceCodeAsync();
                    UpdateLinkUi();
                    _devicePollTimer?.Start();
                }),
            };
            _remoteAgent.Start();
        }

        private void ApplyUpdateNow()
        {
            if (!Updater.ApplyAndRestart()) return;
            SetStatus("Устанавливается обновление " + Updater.StagedVersion + "...", Color.FromRgb(0x1E, 0x1E, 0x20));
            ExitToWindows();
        }

        private void StopRemoteAgent()
        {
            _remoteAgent?.Stop();
            _remoteAgent = null;
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
                SetStatus("Введите пароль для входа", Color.FromRgb(0x0E, 0x74, 0x90));
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
                        RecorderService.Start(_apiToken);
                        _devicePollTimer?.Stop();
                        UpdateLinkUi();
                        SetStatus("Устройство привязано. Введите пароль", Color.FromRgb(0x16, 0xA3, 0x4A));
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
                    Edition.Name, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
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
            SetStatus("Введите пароль администратора", Color.FromRgb(0x1E, 0x1E, 0x20));
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
                SetStatus("Устройство не привязано — обратитесь к директору", Color.FromRgb(0xDC, 0x26, 0x26));
                PasswordBox.Clear();
                UpdateLinkUi();
                return;
            }

            _busy = true;
            SetStatus("Проверка пароля...", Color.FromRgb(0x1E, 0x1E, 0x20));
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
                    SetStatus("Нет связи с сервером — попробуйте ещё раз", Color.FromRgb(0xDC, 0x26, 0x26));
                    break;
                default:
                    SetStatus("Неверный пароль", Color.FromRgb(0xDC, 0x26, 0x26));
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
            StopRemoteAgent();

            try
            {
                var shell = new ShellWindow
                {
                    IsAdmin = isAdmin,
                    ApiToken = _apiToken ?? "",
                    DeviceCode = _deviceCode,
                    EmployeeName = fullName ?? "",
                };
                if (!string.IsNullOrEmpty(fullName))
                    shell.Title = Edition.Name + " — " + fullName;
                shell.Show();
                _openingNext = true;
                Close();
            }
            catch (Exception ex)
            {
                // Рабочий стол не открылся — остаёмся на экране входа, а не в пустом окне.
                TaskbarManager.Restore();
                _networkTimer?.Start();
                SetStatus("Ошибка запуска рабочего стола", Color.FromRgb(0xDC, 0x26, 0x26));
                MessageBox.Show(this,
                    "Не удалось открыть рабочий стол АБИЗ:\n" + ex.Message +
                    "\n\nЧтобы выйти в Windows, введите exit: и пароль администратора без пробела.",
                    Edition.Name, MessageBoxButton.OK, MessageBoxImage.Error);
                PasswordBox.Clear();
                PasswordBox.Focus();
            }
        }

        private void ExitToWindows_Click(object sender, RoutedEventArgs e)
        {
            string? pwd = InputDialog.Show("Выход в Windows", "Пароль администратора:", "Выйти", "", true);
            if (string.IsNullOrEmpty(pwd)) return;
            if (pwd != AdminPassword)
            {
                SetStatus("Неверный пароль администратора", Color.FromRgb(0xDC, 0x26, 0x26));
                return;
            }
            ExitToWindows();
        }

        private void ExitToWindows()
        {
            _devicePollTimer?.Stop();
            _networkTimer?.Stop();
            _spinnerTimer?.Stop();
            StopRemoteAgent();
            _openingNext = true;
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