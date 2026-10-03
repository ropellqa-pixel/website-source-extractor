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

        public TopBarWindow(ShellWindow shell, bool isAdmin)
        {
            InitializeComponent();
            _shell = shell;
            _isAdmin = isAdmin;
            AdminBtn.Visibility = isAdmin ? Visibility.Visible : Visibility.Collapsed;

            Width = SystemParameters.PrimaryScreenWidth;

            _clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _clock.Tick += (s, e) => UpdateClock();
            _clock.Start();
            UpdateClock();

            SourceInitialized += (s, e) => RegisterAppBar();
            Closing += (s, e) =>
            {
                if (!_allowClose) { e.Cancel = true; return; }
                _clock.Stop();
                UnregisterAppBar();
            };
        }

        public void ForceClose()
        {
            _allowClose = true;
            Close();
        }

        // --- Регистрация панели в Windows ---

        private IntPtr Handle => new WindowInteropHelper(this).Handle;

        private void RegisterAppBar()
        {
            try
            {
                var src = HwndSource.FromHwnd(Handle);
                src?.AddHook(WndProc);
                _appBarMessage = NativeMethods.RegisterWindowMessage("AbizShellAppBar");
                var data = NewData();
                data.uCallbackMessage = _appBarMessage;
                NativeMethods.SHAppBarMessage(NativeMethods.ABM_NEW, ref data);
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

            var data = NewData();
            data.uEdge = NativeMethods.ABE_TOP;
            data.rc.left = 0;
            data.rc.right = widthPx;
            data.rc.top = 0;
            data.rc.bottom = heightPx;
            NativeMethods.SHAppBarMessage(NativeMethods.ABM_QUERYPOS, ref data);
            data.rc.bottom = data.rc.top + heightPx;
            NativeMethods.SHAppBarMessage(NativeMethods.ABM_SETPOS, ref data);
            NativeMethods.MoveWindow(Handle, data.rc.left, data.rc.top, data.rc.right - data.rc.left, heightPx, true);

            Dispatcher.BeginInvoke(new Action(() => WorkAreaChanged?.Invoke()), DispatcherPriority.Background);
        }

        private void UnregisterAppBar()
        {
            if (!_appBarRegistered) return;
            try
            {
                var data = NewData();
                NativeMethods.SHAppBarMessage(NativeMethods.ABM_REMOVE, ref data);
            }
            catch { }
            _appBarRegistered = false;
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
            if (_appBarRegistered && msg == (int)_appBarMessage && wParam.ToInt32() == NativeMethods.ABN_POSCHANGED)
                SetPosition();
            return IntPtr.Zero;
        }

        // --- Состояние ---

        private void UpdateClock()
        {
            ClockLabel.Text = DateTime.Now.ToString("HH:mm");
            DateLabel.Text = DateTime.Now.ToString("d MMMM, dddd", new CultureInfo("ru-RU"));
            int count = WindowSwitcher.GetWindows().Count;
            WindowsBtnText.Text = count > 0 ? $"Окна ({count})" : "Окна";
        }

        public void SetOnline(bool online)
        {
            StatusDot.Fill = new SolidColorBrush(online ? Color.FromRgb(0x28, 0xC8, 0x40) : Color.FromRgb(0xFF, 0x6B, 0x6B));
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
        private void Admin_Click(object sender, RoutedEventArgs e) => _shell.ShowAdminMenu(AdminBtn);
        private void Lock_Click(object sender, RoutedEventArgs e) => _shell.LockScreen();
        private void Shutdown_Click(object sender, RoutedEventArgs e) => _shell.ShutdownPc();
        private void OpenInEdge_Click(object sender, RoutedEventArgs e) { ExtensionsPopup.IsOpen = false; _shell.OpenCurrentPageInEdge(); }

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
                    Foreground = new SolidColorBrush(Color.FromArgb(0x88, 255, 255, 255)), FontSize = 12,
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
                Style = (Style)FindResource("LabeledBtn"),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Height = 40,
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
                var x = new Button { Style = (Style)FindResource("BarBtn"), Content = "✕", FontSize = 13, Height = 40, Margin = new Thickness(4, 0, 0, 0), ToolTip = "Закрыть программу" };
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
                text.Children.Add(new TextBlock { Text = item.Title, Foreground = Brushes.White, FontSize = 13, FontWeight = FontWeights.SemiBold });
                string sub = !item.Installed
                    ? "Не удалось подключить: " + (string.IsNullOrEmpty(item.Error) ? "браузер ещё загружается" : item.Error)
                    : item.Hint;
                text.Children.Add(new TextBlock { Text = sub, Foreground = new SolidColorBrush(Color.FromArgb(0x88, 255, 255, 255)), FontSize = 11, TextWrapping = TextWrapping.Wrap, MaxWidth = 340 });

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

                var row = new DockPanel { Margin = new Thickness(0, 0, 0, 10) };
                row.Children.Add(box);
                row.Children.Add(text);
                ExtensionsList.Children.Add(row);
            }
            ExtensionsPopup.IsOpen = true;
        }
    }
}
