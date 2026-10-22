using System;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Верхняя панель АБИЗ. Отдельное окно «поверх всех», зарегистрированное в Windows как
    /// панель экрана (как панель задач): Windows резервирует под неё полосу сверху, поэтому
    /// развёрнутые Word/Excel/проводник не залезают под неё, а панель всегда доступна.
    /// </summary>
    public partial class TopBarWindow : Window
    {
        private readonly ShellWindow _shell;
        private readonly bool _isAdmin;
        private readonly DispatcherTimer _clock;
        private bool _allowClose;
        private bool _appBarRegistered;
        private uint _appBarMessage;
        private bool _isRussian = true;

        public event Action? WorkAreaChanged;

        public const double BarHeight = 60;

        public TopBarWindow(ShellWindow shell, bool isAdmin)
        {
            InitializeComponent();
            _shell = shell;
            _isAdmin = isAdmin;
            AdminBtn.Visibility = isAdmin ? Visibility.Visible : Visibility.Collapsed;
            string userName = !string.IsNullOrWhiteSpace(shell.EmployeeName) ? shell.EmployeeName : isAdmin ? "Администратор" : "";
            UserChipText.Text = userName;
            UserChip.Visibility = string.IsNullOrEmpty(userName) ? Visibility.Collapsed : Visibility.Visible;

            Width = SystemParameters.PrimaryScreenWidth;
            if (!Edition.Kiosk)
            {
                // АБИЗ-Админ: панель — часть окна программы, не «поверх всех» и не панель экрана.
                Topmost = false;
                ShowActivated = false;
            }

            _clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _clock.Tick += (s, e) => UpdateClock();
            _clock.Start();
            UpdateClock();

            SourceInitialized += (s, e) => { if (Edition.Kiosk) RegisterAppBar(); };
            Closing += (s, e) =>
            {
                if (!_allowClose) { e.Cancel = true; return; }
                _clock.Stop();
                UnregisterAppBar();
            };
        }

        /// <summary>АБИЗ-Админ: ставит панель в заданное место (верх окна программы).</summary>
        public void PlaceInside(double left, double top, double width)
        {
            Left = left;
            Top = top;
            Width = Math.Max(width, 200);
            Height = BarHeight;
        }

        public void ForceClose()
        {
            _allowClose = true;
            Close();
        }

        // --- Регистрация панели в Windows ---

        private IntPtr Handle => new WindowInteropHelper(this).Handle;

        // Панель всегда одна и всегда в самом верху экрана: место под неё задаётся напрямую
        // (см. ScreenArea), без регистрации «панели экрана» — так отступы не накапливаются.
        private void RegisterAppBar()
        {
            try
            {
                HwndSource.FromHwnd(Handle)?.AddHook(WndProc);
                _appBarRegistered = true;
                SetPosition();
            }
            catch { }
        }

        private void SetPosition()
        {
            if (!_appBarRegistered) return;
            var dpi = VisualTreeHelper.GetDpi(this);
            int widthPx = NativeMethods.GetSystemMetrics(0);
            int heightPx = (int)Math.Ceiling(Height * dpi.DpiScaleY);
            NativeMethods.MoveWindow(Handle, 0, 0, widthPx, heightPx, true);
            ScreenArea.ReserveTop(heightPx);
            Dispatcher.BeginInvoke(new Action(() => WorkAreaChanged?.Invoke()), DispatcherPriority.Background);
        }

        private void UnregisterAppBar()
        {
            if (!_appBarRegistered) return;
            _appBarRegistered = false;
            ScreenArea.Reset();
        }

        private NativeMethods.APPBARDATA NewData()
        {
            var data = new NativeMethods.APPBARDATA();
            data.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(data);
            data.hWnd = Handle;
            return data;
        }

        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            // Сменилось разрешение или подключили монитор — заново ставим панель и область.
            const int WM_DISPLAYCHANGE = 0x007E;
            if (_appBarRegistered && msg == WM_DISPLAYCHANGE)
                Dispatcher.BeginInvoke(new Action(SetPosition), DispatcherPriority.Background);
            return IntPtr.Zero;
        }

        // --- Состояние ---

        private void UpdateClock()
        {
            ClockLabel.Text = DateTime.Now.ToString("HH:mm");
            if (DateTime.Now.Second % 5 == 0) RefreshVolumeIcon();
            DateLabel.Text = DateTime.Now.ToString("d MMMM, dddd", new CultureInfo("ru-RU"));
            int count = WindowSwitcher.GetWindows().Count;
            WindowsBtnText.Text = count > 0 ? $"Окна ({count})" : "Окна";
        }

        public void SetOnline(bool online)
        {
            StatusDot.Fill = new SolidColorBrush(online ? Color.FromRgb(0x16, 0xA3, 0x4A) : Color.FromRgb(0xDC, 0x26, 0x26));
            NetworkBtnIcon.Text = online ? "\uE701" : "\uEB55";
            StatusDot.ToolTip = online ? "Сеть: подключено" : "Сеть: нет соединения";
        }

        // --- Кнопки ---

        private void Menu_Click(object sender, RoutedEventArgs e) => _shell.ToggleMenu();
        private void Home_Click(object sender, RoutedEventArgs e) => _shell.GoHome();
        private void Back_Click(object sender, RoutedEventArgs e) { _shell.Activate(); _shell.GoBack(); }
        private void Forward_Click(object sender, RoutedEventArgs e) { _shell.Activate(); _shell.GoForward(); }
        private void Reload_Click(object sender, RoutedEventArgs e) { _shell.Activate(); _shell.ReloadPage(); }
        private void Print_Click(object sender, RoutedEventArgs e) => _shell.PrintPage();
        private void Explorer_Click(object sender, RoutedEventArgs e) => _shell.OpenExplorer();
        private void Calendar_Click(object sender, RoutedEventArgs e) => _shell.ToggleCalendar();
        private void Cameras_Click(object sender, RoutedEventArgs e) => _shell.OpenCamerasSection();
        private void Admin_Click(object sender, RoutedEventArgs e) => _shell.ShowAdminMenu(AdminBtn);
        private void Lock_Click(object sender, RoutedEventArgs e) => _shell.LockScreen();
        private void Shutdown_Click(object sender, RoutedEventArgs e) => _shell.ShutdownPc();
        private void OpenInEdge_Click(object sender, RoutedEventArgs e) { ExtensionsPopup.IsOpen = false; _shell.OpenCurrentPageInEdge(); }

        // --- Громкость ---

        private bool _volumeUpdating;

        private static string VolumeIcon(int v, bool muted) =>
            muted || v == 0 ? "\uE74F" : v < 34 ? "\uE993" : v < 67 ? "\uE994" : "\uE995";

        private void RefreshVolumeIcon()
        {
            int v = AudioManager.GetVolume();
            bool muted = AudioManager.GetMute();
            VolumeBtnIcon.Text = v < 0 ? "\uE74F" : VolumeIcon(v, muted);
            VolumeBtn.ToolTip = v < 0 ? "Звуковое устройство не найдено" : muted ? "Звук выключен" : $"Громкость: {v}%";
        }

        private void Volume_Click(object sender, RoutedEventArgs e)
        {
            int v = AudioManager.GetVolume();
            _volumeUpdating = true;
            if (v < 0)
            {
                VolumeSlider.IsEnabled = false;
                MuteBtn.IsEnabled = false;
                VolumeValueLabel.Text = "—";
                VolumeHint.Text = "Звуковое устройство не найдено. Подключите колонки или наушники.";
            }
            else
            {
                VolumeSlider.IsEnabled = true;
                MuteBtn.IsEnabled = true;
                VolumeSlider.Value = v;
                VolumeValueLabel.Text = v + "%";
                VolumeHint.Text = "";
            }
            _volumeUpdating = false;
            MuteBtnIcon.Text = VolumeIcon(Math.Max(v, 0), AudioManager.GetMute());
            VolumePopup.IsOpen = true;
        }

        private void VolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (_volumeUpdating) return;
            int v = (int)Math.Round(e.NewValue);
            AudioManager.SetVolume(v);
            VolumeValueLabel.Text = v + "%";
            MuteBtnIcon.Text = VolumeIcon(v, AudioManager.GetMute());
            RefreshVolumeIcon();
        }

        private void VolumePreset_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button b && int.TryParse(b.Tag?.ToString(), out int v))
            {
                AudioManager.SetVolume(v);
                if (v == 0) AudioManager.SetMute(true);
                _volumeUpdating = true;
                VolumeSlider.Value = v;
                _volumeUpdating = false;
                VolumeValueLabel.Text = v + "%";
                MuteBtnIcon.Text = VolumeIcon(v, AudioManager.GetMute());
                RefreshVolumeIcon();
            }
        }

        private void Mute_Click(object sender, RoutedEventArgs e)
        {
            bool muted = !AudioManager.GetMute();
            AudioManager.SetMute(muted);
            MuteBtnIcon.Text = VolumeIcon(AudioManager.GetVolume(), muted);
            RefreshVolumeIcon();
        }

        // --- Сеть ---

        private void Network_Click(object sender, RoutedEventArgs e)
        {
            FillNetworkInfo();
            NetAdaptersBtn.Visibility = _isAdmin ? Visibility.Visible : Visibility.Collapsed;
            NetworkPopup.IsOpen = true;
            _ = CheckInternetAsync();
        }

        private void FillNetworkInfo()
        {
            NetAdaptersList.Children.Clear();
            var gray = new SolidColorBrush(Color.FromRgb(0x6E, 0x6E, 0x73));
            try
            {
                var adapters = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
                    .Where(n => n.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up
                                && n.NetworkInterfaceType != System.Net.NetworkInformation.NetworkInterfaceType.Loopback
                                && n.NetworkInterfaceType != System.Net.NetworkInformation.NetworkInterfaceType.Tunnel)
                    .ToList();
                if (adapters.Count == 0)
                {
                    NetAdaptersList.Children.Add(new TextBlock { Text = "Нет активных подключений", Foreground = gray, FontSize = 12 });
                    return;
                }
                foreach (var a in adapters)
                {
                    bool wifi = a.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Wireless80211;
                    string ip = a.GetIPProperties().UnicastAddresses
                        .FirstOrDefault(x => x.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)?.Address.ToString() ?? "нет адреса";
                    string speed = a.Speed > 0 ? $"{a.Speed / 1_000_000} Мбит/с" : "";
                    NetAdaptersList.Children.Add(new TextBlock
                    {
                        Text = $"{(wifi ? "\U0001F4F6 Wi‑Fi" : "\U0001F50C Кабель")}: {a.Name} · {ip} {speed}",
                        Foreground = gray, FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 2),
                    });
                }
            }
            catch
            {
                NetAdaptersList.Children.Add(new TextBlock { Text = "Не удалось получить список подключений", Foreground = gray, FontSize = 12 });
            }
        }

        private async System.Threading.Tasks.Task CheckInternetAsync()
        {
            NetStateLabel.Text = "Проверяю связь с сервером...";
            NetStateDot.Fill = new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B));
            bool online = await AnodBizClient.CheckNetworkAsync();
            NetStateLabel.Text = online ? "Интернет есть, сервер АБИЗ доступен" : "Нет связи с сервером АБИЗ";
            NetStateDot.Fill = new SolidColorBrush(online ? Color.FromRgb(0x16, 0xA3, 0x4A) : Color.FromRgb(0xDC, 0x26, 0x26));
            SetOnline(online);
        }

        private void NetCheck_Click(object sender, RoutedEventArgs e)
        {
            FillNetworkInfo();
            _ = CheckInternetAsync();
        }

        private void NetWifi_Click(object sender, RoutedEventArgs e)
        {
            NetworkPopup.IsOpen = false;
            OpenSettings("ms-availablenetworks:", "ms-settings:network-wifi");
        }

        private void NetSettings_Click(object sender, RoutedEventArgs e)
        {
            NetworkPopup.IsOpen = false;
            OpenSettings("ms-settings:network-status", "ms-settings:network");
        }

        private void NetAdapters_Click(object sender, RoutedEventArgs e)
        {
            NetworkPopup.IsOpen = false;
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ncpa.cpl") { UseShellExecute = true }); }
            catch { OpenSettings("ms-settings:network"); }
        }

        private static void OpenSettings(params string[] uris)
        {
            foreach (var uri in uris)
            {
                try
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri) { UseShellExecute = true });
                    return;
                }
                catch { }
            }
            MessageBox.Show("Не удалось открыть настройки Windows.", Edition.Name, MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        private void Lang_Click(object sender, RoutedEventArgs e)
        {
            _isRussian = !_isRussian;
            string layout = _isRussian ? "00000419" : "00000409";
            var hkl = NativeMethods.LoadKeyboardLayout(layout, 1);
            NativeMethods.PostMessage(NativeMethods.HWND_BROADCAST, NativeMethods.WM_INPUTLANGCHANGEREQUEST, IntPtr.Zero, hkl);
            LangBtn.Content = _isRussian ? "RU" : "EN";
        }

        // --- Переключатель окон ---

        private void Windows_Click(object sender, RoutedEventArgs e)
        {
            WindowsList.Children.Clear();

            WindowsList.Children.Add(MakeWindowRow("\U0001F310", "АБИЗ — браузер", () => { _shell.Activate(); }, null));

            foreach (var w in WindowSwitcher.GetWindows())
            {
                var win = w;
                string icon = win.ProcessName.ToLowerInvariant() switch
                {
                    "winword" => "\U0001F4DD",
                    "excel" => "\U0001F4CA",
                    "explorer" => "\U0001F4C1",
                    _ => "\U0001F5D4",
                };
                WindowsList.Children.Add(MakeWindowRow(icon, win.Title,
                    () => WindowSwitcher.BringToFront(win.Handle),
                    () => { WindowSwitcher.Close(win.Handle); Dispatcher.BeginInvoke(new Action(() => Windows_Click(sender, e)), DispatcherPriority.Background); }));
            }

            if (WindowsList.Children.Count == 1)
                WindowsList.Children.Add(new TextBlock
                {
                    Text = "Других открытых программ нет. Откройте их через «Меню».",
                    Foreground = new SolidColorBrush(Color.FromRgb(0x6E, 0x6E, 0x73)), FontSize = 12,
                    TextWrapping = TextWrapping.Wrap, Margin = new Thickness(4, 8, 4, 0),
                });

            WindowsPopup.IsOpen = true;
        }

        private UIElement MakeWindowRow(string icon, string title, Action activate, Action? close)
        {
            var grid = new Grid { Margin = new Thickness(0, 0, 0, 4) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var open = new Button
            {
                Style = (Style)FindResource("WindowRowBtn"),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Height = 44,
                Margin = new Thickness(0),
                Content = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Children =
                    {
                        new TextBlock { Text = icon, FontSize = 16, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center },
                        new TextBlock { Text = title, FontSize = 13, MaxWidth = 300, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center },
                    },
                },
            };
            open.Click += (s, e) => { WindowsPopup.IsOpen = false; activate(); };
            grid.Children.Add(open);

            if (close != null)
            {
                var x = new Button { Style = (Style)FindResource("IconBarBtn"), Content = "\uE711", FontSize = 11, Height = 40, Margin = new Thickness(4, 0, 0, 0), ToolTip = "Закрыть программу", Foreground = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26)) };
                x.Click += (s, e) => close();
                Grid.SetColumn(x, 1);
                grid.Children.Add(x);
            }
            return grid;
        }

        // --- Расширения ---

        private void Extensions_Click(object sender, RoutedEventArgs e)
        {
            ExtensionsList.Children.Clear();
            var profile = _shell.Browser?.Profile;

            foreach (var ext in ExtensionsService.Known)
            {
                var item = ext;
                var box = new CheckBox
                {
                    IsChecked = item.Enabled,
                    IsEnabled = item.Installed && profile != null,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 10, 0),
                    LayoutTransform = new ScaleTransform(1.3, 1.3),
                };
                var text = new StackPanel();
                text.Children.Add(new TextBlock { Text = item.Title, Foreground = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x20)), FontSize = 13, FontWeight = FontWeights.SemiBold });
                string sub = !item.Installed
                    ? "Не удалось подключить: " + (string.IsNullOrEmpty(item.Error) ? "браузер ещё загружается" : item.Error)
                    : item.Hint;
                text.Children.Add(new TextBlock { Text = sub, Foreground = new SolidColorBrush(Color.FromRgb(0x6E, 0x6E, 0x73)), FontSize = 11, TextWrapping = TextWrapping.Wrap, MaxWidth = 340 });

                box.Click += async (s, a) =>
                {
                    if (profile == null) return;
                    bool want = box.IsChecked == true;
                    box.IsEnabled = false;
                    bool ok = await ExtensionsService.SetEnabledAsync(profile, item.Id, want);
                    if (!ok) box.IsChecked = !want;
                    box.IsEnabled = true;
                    if (ok) _shell.ReloadPage();
                };

                var row = new DockPanel();
                row.Children.Add(box);
                row.Children.Add(text);
                ExtensionsList.Children.Add(new Border
                {
                    Child = row,
                    Background = new SolidColorBrush(Color.FromRgb(0xF7, 0xF7, 0xFA)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xE4, 0xE4, 0xEA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(10),
                    Padding = new Thickness(12, 10, 12, 10),
                    Margin = new Thickness(0, 0, 0, 8),
                });
            }
            ExtensionsPopup.IsOpen = true;
        }
    }
}