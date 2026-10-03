using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Главное окно оболочки: встроенный браузер, меню кнопок, календарь, редактор кнопок.
    /// Все кнопки управления — в верхней панели (TopBarWindow). Окно занимает экран под
    /// панелью и НЕ является «поверх всех», поэтому Word/Excel/MAX и проводник открываются поверх него.
    /// </summary>
    public partial class ShellWindow : Window
    {
        public bool IsAdmin { get; set; }
        public string ApiToken { get; set; } = "";
        public string DeviceCode { get; set; } = "";

        public const string HomePage = "https://anod.saou.ru/";
        private const string RuDesktopAcceptId = "2364029";

        private DispatcherTimer? _networkTimer, _remoteDesktopTimer, _notificationTimer;
        private DateTime _lastSpacePress = DateTime.MinValue;
        private const int DoublePressInterval = 450;
        private KeyboardHook? _keyboardHook;
        private int _codeClickCount;
        private DateTime _lastCodeClick = DateTime.MinValue;
        private readonly Dictionary<string, string> _notes = new();
        private readonly string _notesPath;
        private string _selectedDate = "";
        private AnodBizClient? _client;
        private List<KioskButton> _buttons = new();
        private readonly List<KioskButtonEditRow> _editorRows = new();
        private TopBarWindow? _topBar;
        private ExplorerWindow? _explorer;
        private bool _allowClose;
        private int _networkFailures;
        private bool _networkOverlayDismissed;

        public ShellWindow()
        {
            InitializeComponent();
            Loaded += ShellWindow_Loaded;
            Closing += ShellWindow_Closing;
            _notesPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AbizShell", "notes.json");
            LoadNotes();

            _networkTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            _networkTimer.Tick += async (s, e) => await CheckNetworkAsync();
            _networkTimer.Start();

            _remoteDesktopTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _remoteDesktopTimer.Tick += (s, e) => AutoAcceptRemoteDesktop();
            _remoteDesktopTimer.Start();

            _notificationTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(120) };
            _notificationTimer.Tick += async (s, e) => await CheckNotificationsAsync();
            _notificationTimer.Start();
        }

        public CoreWebView2? Browser => MainBrowser.CoreWebView2;

        private void ShellWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            if (!_allowClose) { e.Cancel = true; return; }
            StopEverything();
        }

        private void StopEverything()
        {
            _networkTimer?.Stop(); _remoteDesktopTimer?.Stop(); _notificationTimer?.Stop();
            _keyboardHook?.Dispose();
            _keyboardHook = null;
            if (_explorer != null) { _explorer.ForceClose(); _explorer = null; }
            if (_topBar != null) { _topBar.ForceClose(); _topBar = null; }
        }

        private async void ShellWindow_Loaded(object sender, RoutedEventArgs e)
        {
            TaskbarManager.Hide();

            _topBar = new TopBarWindow(this, IsAdmin);
            _topBar.WorkAreaChanged += FitToWorkArea;
            _topBar.Show();
            FitToWorkArea();

            if (!string.IsNullOrEmpty(DeviceCode))
                DeviceCodeDisplay.Text = "Код ПК: " + DeviceManager.FormatCode(DeviceCode);
            SideCalendar.SelectedDate = DateTime.Today;

            if (!string.IsNullOrEmpty(ApiToken))
                _client = new AnodBizClient(ApiToken);

            // Горячие клавиши работают только когда активна наша программа — иначе
            // Tab и пробел перестали бы работать в Word, Excel и других программах.
            _keyboardHook = new KeyboardHook { BlockSystemKeys = true };
            _keyboardHook.KeyHandler = (vkCode, isSysKey) =>
            {
                if (!NativeMethods.IsOwnProcessForeground()) return false;

                if (vkCode == KeyboardHook.VK_ESCAPE)
                {
                    bool handled = false;
                    Dispatcher.Invoke(() =>
                    {
                        if (OverlayGrid.Visibility == Visibility.Visible) { OverlayGrid.Visibility = Visibility.Collapsed; handled = true; }
                        else if (SidePanel.Visibility == Visibility.Visible) { SidePanel.Visibility = Visibility.Collapsed; handled = true; }
                    });
                    return handled;
                }

                if (vkCode == KeyboardHook.VK_TAB && !isSysKey && OverlayGrid.Visibility == Visibility.Visible)
                {
                    Dispatcher.Invoke(ToggleMenu);
                    return true;
                }

                if (vkCode == KeyboardHook.VK_SPACE && !isSysKey)
                {
                    var now = DateTime.Now;
                    if ((now - _lastSpacePress).TotalMilliseconds < DoublePressInterval)
                    {
                        _lastSpacePress = DateTime.MinValue;
                        Dispatcher.Invoke(ToggleMenu);
                        return true;
                    }
                    _lastSpacePress = now;
                }
                return false;
            };

            BuildTilesFromDefaults();
            await InitBrowserAsync();

            _ = CheckNotificationsAsync();
            _ = CheckNetworkAsync();
        }

        /// <summary>Окно занимает всю рабочую область — под верхней панелью.</summary>
        public void FitToWorkArea()
        {
            var wa = SystemParameters.WorkArea;
            WindowState = WindowState.Normal;
            Left = wa.Left;
            Top = wa.Top;
            Width = wa.Width;
            Height = wa.Height;
        }

        // --- Браузер ---

        private async Task InitBrowserAsync()
        {
            try
            {
                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "AbizShell", "WebView2");
                Directory.CreateDirectory(dataDir);

                var options = new CoreWebView2EnvironmentOptions { AreBrowserExtensionsEnabled = true };
                var env = await CoreWebView2Environment.CreateAsync(null, dataDir, options);
                await MainBrowser.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(this,
                    "На компьютере не установлен компонент Microsoft Edge WebView2 — без него браузер не работает.\n\n" +
                    "Переустановите АБИЗ из полного установщика.",
                    "АБИЗ — браузер", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Не удалось запустить встроенный браузер:\n" + ex.Message,
                    "АБИЗ — браузер", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            var core = MainBrowser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = IsAdmin;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;

            // Ссылки «в новом окне» открываем в этом же браузере, а не в отдельном окне.
            core.NewWindowRequested += (s, a) =>
            {
                a.Handled = true;
                try { core.Navigate(a.Uri); } catch { }
            };

            try { await ExtensionsService.InstallAllAsync(core.Profile); } catch { }

            try { await LoadButtonsAsync(); } catch { BuildTilesFromDefaults(); }
            await AutoLoginAndNavigateAsync();
        }

        public void NavigateBrowser(string url)
        {
            try
            {
                if (MainBrowser.CoreWebView2 != null)
                    MainBrowser.CoreWebView2.Navigate(url);
                else
                    MainBrowser.Source = new Uri(url);
                Activate();
            }
            catch
            {
                MessageBox.Show(this, "Не удалось открыть: " + url, "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        public void GoHome() => NavigateBrowser(HomePage);
        public void GoBack() { if (Browser?.CanGoBack == true) Browser.GoBack(); }
        public void GoForward() { if (Browser?.CanGoForward == true) Browser.GoForward(); }
        public void ReloadPage() => Browser?.Reload();
        public void PrintPage() { Activate(); PrintService.PrintSystemDialog(Browser); }
        public string CurrentUrl => Browser?.Source ?? HomePage;

        public void OpenCurrentPageInEdge()
        {
            try { Process.Start(new ProcessStartInfo("msedge.exe", CurrentUrl) { UseShellExecute = true }); }
            catch { MessageBox.Show("Microsoft Edge не найден на этом компьютере.", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning); }
        }

        private async Task AutoLoginAndNavigateAsync()
        {
            if (string.IsNullOrEmpty(ApiToken))
            {
                NavigateBrowser(HomePage);
                return;
            }
            string? code = await AnodBizClient.RequestLoginLinkAsync(ApiToken);
            NavigateBrowser(!string.IsNullOrEmpty(code)
                ? $"https://anod.saou.ru/device-login?code={code}"
                : HomePage);
        }

        // --- Меню кнопок ---

        private async Task LoadButtonsAsync()
        {
            _buttons = _client != null ? await KioskButtonsService.LoadAsync(_client) : KioskButtonsService.DefaultButtons();
            BuildTiles();
        }

        private void BuildTilesFromDefaults()
        {
            _buttons = KioskButtonsService.DefaultButtons();
            BuildTiles();
        }

        private static Brush SafeBrush(string color)
        {
            try { return new SolidColorBrush((Color)ColorConverter.ConvertFromString(string.IsNullOrWhiteSpace(color) ? "#125499" : color)); }
            catch { return new SolidColorBrush(Color.FromRgb(0x12, 0x54, 0x99)); }
        }

        private void BuildTiles()
        {
            TilesPanel.Children.Clear();
            foreach (var btn in _buttons)
            {
                var content = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
                content.Children.Add(new TextBlock
                {
                    Text = btn.Action == "app" ? "\U0001F5A5" : "\U0001F310",
                    FontSize = 30, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 8),
                });
                content.Children.Add(new TextBlock
                {
                    Text = btn.Text, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center,
                    MaxWidth = 120, HorizontalAlignment = HorizontalAlignment.Center,
                });
                var tile = new Button
                {
                    Style = (Style)FindResource("AppTile"),
                    Content = content,
                    Background = SafeBrush(btn.Color),
                    Tag = btn,
                    ToolTip = btn.Action == "app" ? "Программа: " + btn.Target : "Сайт: " + btn.Target,
                };
                tile.Click += Tile_Click;
                TilesPanel.Children.Add(tile);
            }
        }

        private void Tile_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not KioskButton k) return;
            OverlayGrid.Visibility = Visibility.Collapsed;
            if (k.Action == "app")
                AppLauncher.Launch(k.Target, this);
            else
                NavigateBrowser(k.Target);
        }

        public void ToggleMenu()
        {
            Activate();
            EditorOverlay.Visibility = Visibility.Collapsed;
            OverlayGrid.Visibility = OverlayGrid.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        }

        private void OverlayBackground_MouseDown(object sender, MouseButtonEventArgs e) =>
            OverlayGrid.Visibility = Visibility.Collapsed;

        // --- Проводник ---

        public void OpenExplorer()
        {
            if (_explorer == null || !_explorer.IsLoaded)
            {
                _explorer = new ExplorerWindow { Owner = this };
                _explorer.Show();
            }
            else
            {
                if (_explorer.WindowState == WindowState.Minimized) _explorer.WindowState = WindowState.Normal;
                _explorer.Show();
                _explorer.Activate();
            }
        }

        public void OpenWindowsExplorer()
        {
            try { Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = true }); } catch { }
        }

        // --- Удалённый доступ RuDesktop ---

        private void AutoAcceptRemoteDesktop()
        {
            try
            {
                foreach (var proc in Process.GetProcessesByName("RuDesktop"))
                {
                    try
                    {
                        string title = proc.MainWindowTitle;
                        if (string.IsNullOrEmpty(title)) continue;
                        if (title.Contains(RuDesktopAcceptId) || title.Contains("вход", StringComparison.OrdinalIgnoreCase))
                        {
                            NativeMethods.PostMessage(proc.MainWindowHandle, 0x0100, (IntPtr)0x0D, IntPtr.Zero);
                            NativeMethods.PostMessage(proc.MainWindowHandle, 0x0101, (IntPtr)0x0D, IntPtr.Zero);
                        }
                    }
                    catch { }
                    finally { proc.Dispose(); }
                }
            }
            catch { }
        }

        // --- Сеть ---

        private async Task CheckNetworkAsync()
        {
            bool online = await AnodBizClient.CheckNetworkAsync();
            _networkFailures = online ? 0 : _networkFailures + 1;
            bool showOffline = _networkFailures >= 2;
            if (online) _networkOverlayDismissed = false;
            ShellNetworkOverlay.Visibility = showOffline && !_networkOverlayDismissed ? Visibility.Visible : Visibility.Collapsed;
            _topBar?.SetOnline(online);
        }

        private async void ShellRetryNetwork_Click(object sender, RoutedEventArgs e)
        {
            _networkFailures = 1;
            await CheckNetworkAsync();
            if (ShellNetworkOverlay.Visibility == Visibility.Collapsed) ReloadPage();
        }

        private void HideNetworkOverlay_Click(object sender, RoutedEventArgs e)
        {
            _networkOverlayDismissed = true;
            ShellNetworkOverlay.Visibility = Visibility.Collapsed;
        }

        // --- Блокировка, выключение, выход ---

        public void LockScreen()
        {
            _allowClose = true;
            new MainWindow().Show();
            Close();
        }

        public void ShutdownPc()
        {
            if (MessageBox.Show("Выключить компьютер?", "АБИЗ", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            StopEverything();
            try { Process.Start(new ProcessStartInfo("shutdown", "/s /t 0") { CreateNoWindow = true, UseShellExecute = false }); } catch { }
        }

        public void ExitToWindows()
        {
            if (MessageBox.Show("Закрыть АБИЗ и выйти в обычный Windows?", "АБИЗ", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            _allowClose = true;
            StopEverything();
            TaskbarManager.Restore();
            Application.Current.Shutdown();
        }

        // --- Календарь и заметки ---

        public void ToggleCalendar()
        {
            Activate();
            SidePanel.Visibility = SidePanel.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        }

        private void CloseSidePanel_Click(object sender, RoutedEventArgs e) => SidePanel.Visibility = Visibility.Collapsed;

        private void Calendar_SelectedDatesChanged(object sender, SelectionChangedEventArgs e)
        {
            if (!SideCalendar.SelectedDate.HasValue) return;
            _selectedDate = SideCalendar.SelectedDate.Value.ToString("yyyy-MM-dd");
            SelectedDateLabel.Text = SideCalendar.SelectedDate.Value.ToString("d MMMM yyyy", new CultureInfo("ru-RU"));
            NotesBox.Text = _notes.TryGetValue(_selectedDate, out var note) ? note : "";
        }

        private void NotesBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (string.IsNullOrEmpty(_selectedDate)) return;
            if (string.IsNullOrWhiteSpace(NotesBox.Text)) _notes.Remove(_selectedDate);
            else _notes[_selectedDate] = NotesBox.Text;
            SaveNotes();
        }

        private void LoadNotes()
        {
            try
            {
                if (!File.Exists(_notesPath)) return;
                var data = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(_notesPath));
                if (data == null) return;
                foreach (var kv in data) _notes[kv.Key] = kv.Value;
            }
            catch { }
        }

        private void SaveNotes()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_notesPath)!);
                File.WriteAllText(_notesPath, JsonSerializer.Serialize(_notes));
            }
            catch { }
        }

        private void QuickAction_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn) return;
            string url = (btn.Tag?.ToString() ?? "") switch
            {
                "schedule" => "https://anod.saou.ru/schedule",
                "salary" => "https://anod.saou.ru/salary",
                "collection" => "https://anod.saou.ru/collection",
                "documents" => "https://anod.saou.ru/documents",
                "chat" => "https://anod.saou.ru/chat",
                _ => HomePage,
            };
            NavigateBrowser(url);
            SidePanel.Visibility = Visibility.Collapsed;
        }

        // --- Уведомления ---

        private async Task CheckNotificationsAsync()
        {
            if (_client == null) return;
            try
            {
                var chatResult = await _client.QueryAsync(new
                {
                    table = "chat_messages",
                    op = "select",
                    filters = new[] { new { col = "read", op = "eq", value = "false" } },
                    limit = 1,
                });
                if (HasRows(chatResult))
                {
                    ShowNotification("\U0001F4AC", "Новые сообщения", "У вас есть непрочитанные сообщения в рабочем чате");
                    return;
                }

                var collResult = await _client.QueryAsync(new
                {
                    table = "collection_data",
                    op = "select",
                    filters = new[] { new { col = "status", op = "eq", value = "pending" } },
                    limit = 1,
                });
                if (HasRows(collResult))
                    ShowNotification("\U0001F4B0", "Инкассация", "Есть незакрытые смены инкассации");
            }
            catch { }
        }

        private static bool HasRows(JsonElement result) =>
            result.ValueKind == JsonValueKind.Object &&
            result.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0;

        private void ShowNotification(string icon, string title, string message)
        {
            NotificationIcon.Text = icon;
            NotificationTitle.Text = title;
            NotificationMessage.Text = message;
            NotificationPanel.Visibility = Visibility.Visible;

            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
            timer.Tick += (s, e) => { timer.Stop(); NotificationPanel.Visibility = Visibility.Collapsed; };
            timer.Start();
        }

        private void CloseNotification_Click(object sender, RoutedEventArgs e) => NotificationPanel.Visibility = Visibility.Collapsed;

        // --- Меню администратора ---

        public void ShowAdminMenu(UIElement target)
        {
            var menu = new ContextMenu { PlacementTarget = target, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom };

            void Add(string header, Action action)
            {
                var item = new MenuItem { Header = header };
                item.Click += (s, a) => action();
                menu.Items.Add(item);
            }

            Add("Изменить кнопки меню", OpenEditor);
            Add("Обновить кнопки с сервера", async () => { try { await LoadButtonsAsync(); } catch { } });
            Add("Поиск сотрудников", async () => await SearchEmployeeAsync());
            Add("Список принтеров", ShowPrinters);
            Add("Проводник Windows", OpenWindowsExplorer);
            Add("Диспетчер задач", () => AppLauncher.Launch("taskmgr.exe", this));
            menu.Items.Add(new Separator());
            Add("Выйти в Windows", ExitToWindows);
            menu.IsOpen = true;
        }

        private void ShowPrinters()
        {
            var printers = PrintService.GetInstalledPrinters();
            string text = printers.Count > 0 ? string.Join("\n", printers) : "Принтеры не найдены";
            MessageBox.Show(this, text, "Установленные принтеры", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        private async Task SearchEmployeeAsync()
        {
            if (_client == null)
            {
                MessageBox.Show(this, "Нет связи с сервером (устройство не привязано).", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            string? query = InputDialog.Show("Поиск сотрудника", "Введите ФИО или часть имени:", "Найти");
            if (string.IsNullOrWhiteSpace(query)) return;

            try
            {
                var result = await _client.SearchEmployeesAsync(query);
                string info = "Ничего не найдено";
                if (result.ValueKind == JsonValueKind.Object && result.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                {
                    var lines = new List<string>();
                    foreach (var item in data.EnumerateArray())
                    {
                        string name = Str(item, "full_name", "???");
                        string role = Str(item, "role", "");
                        string dept = Str(item, "department", "");
                        lines.Add($"{name} | {role} | {dept}");
                    }
                    if (lines.Count > 0) info = string.Join("\n", lines);
                }
                MessageBox.Show(this, info, "Результаты поиска", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Ошибка: " + ex.Message, "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private static string Str(JsonElement el, string prop, string fallback) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? fallback : fallback;

        // --- Код ПК ---

        private async void DeviceCode_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if ((DateTime.Now - _lastCodeClick).TotalSeconds > 2) _codeClickCount = 0;
            _codeClickCount++;
            _lastCodeClick = DateTime.Now;
            if (_codeClickCount < 3) return;
            _codeClickCount = 0;
            if (!IsAdmin)
            {
                MessageBox.Show(this, "Получить новый код может только администратор.", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            try
            {
                string newCode = await AnodBizClient.RegisterDeviceAsync(Environment.MachineName);
                DeviceManager.SaveDeviceCode(newCode);
                DeviceCode = newCode;
                DeviceCodeDisplay.Text = "Код ПК: " + DeviceManager.FormatCode(newCode);
            }
            catch { }
        }

        // --- Редактор кнопок (только админ) ---

        private void OpenEditor()
        {
            OverlayGrid.Visibility = Visibility.Collapsed;
            _editorRows.Clear();
            foreach (var b in _buttons)
                _editorRows.Add(new KioskButtonEditRow(b));
            RenderEditor();
            EditorOverlay.Visibility = Visibility.Visible;
            Activate();
        }

        private TextBox EditorBox(string text, double width, string tip) => new()
        {
            Text = text, Width = width, Margin = new Thickness(0, 0, 8, 0), FontSize = 13, Padding = new Thickness(6, 4, 6, 4),
            Background = new SolidColorBrush(Color.FromRgb(0x0D, 0x0D, 0x14)), Foreground = Brushes.White, CaretBrush = Brushes.White,
            BorderBrush = new SolidColorBrush(Color.FromArgb(0x44, 255, 255, 255)), ToolTip = tip, VerticalContentAlignment = VerticalAlignment.Center,
        };

        private Button EditorButton(string text, string tip, Action onClick, Brush? fg = null)
        {
            var b = new Button
            {
                Content = text, MinWidth = 30, Height = 30, Margin = new Thickness(0, 0, 4, 0), Padding = new Thickness(8, 0, 8, 0),
                ToolTip = tip, Cursor = Cursors.Hand, Foreground = fg ?? Brushes.White,
                Background = new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x44)), BorderThickness = new Thickness(0),
            };
            b.Click += (s, e) => onClick();
            return b;
        }

        private void RenderEditor()
        {
            EditorRowsPanel.Children.Clear();
            for (int i = 0; i < _editorRows.Count; i++)
            {
                var row = _editorRows[i];
                var line = new StackPanel { Orientation = Orientation.Horizontal };

                var swatch = new Border { Width = 14, Height = 30, CornerRadius = new CornerRadius(4), Background = SafeBrush(row.Color), Margin = new Thickness(0, 0, 8, 0) };
                var name = EditorBox(row.Text, 150, "Название кнопки");
                name.TextChanged += (s, e) => row.Text = name.Text;
                var target = EditorBox(row.Target, 300, "Сайт (https://...) или путь к программе (.exe)");
                target.TextChanged += (s, e) => row.Target = target.Text;
                var color = EditorBox(row.Color, 84, "Цвет, например #125499");
                color.TextChanged += (s, e) => { row.Color = color.Text; swatch.Background = SafeBrush(color.Text); };

                var type = new ComboBox { Width = 110, Margin = new Thickness(0, 0, 8, 0), Height = 30 };
                type.Items.Add("Сайт");
                type.Items.Add("Программа");
                type.SelectedIndex = row.Action == "app" ? 1 : 0;
                type.SelectionChanged += (s, e) => row.Action = type.SelectedIndex == 1 ? "app" : "web";

                line.Children.Add(swatch);
                line.Children.Add(name);
                line.Children.Add(target);
                line.Children.Add(EditorButton("Обзор", "Выбрать программу (.exe) на компьютере", () =>
                {
                    var dlg = new OpenFileDialog { Filter = "Программы (*.exe;*.lnk)|*.exe;*.lnk|Все файлы|*.*", Title = "Выберите программу" };
                    if (dlg.ShowDialog(this) == true)
                    {
                        target.Text = dlg.FileName;
                        type.SelectedIndex = 1;
                        if (string.IsNullOrWhiteSpace(name.Text) || name.Text == "Новая кнопка")
                            name.Text = Path.GetFileNameWithoutExtension(dlg.FileName);
                    }
                }));
                line.Children.Add(color);
                line.Children.Add(type);
                int index = i;
                line.Children.Add(EditorButton("↑", "Выше", () => MoveRow(index, -1)));
                line.Children.Add(EditorButton("↓", "Ниже", () => MoveRow(index, 1)));
                line.Children.Add(EditorButton("✕", "Удалить", () => { _editorRows.RemoveAt(index); RenderEditor(); }, Brushes.OrangeRed));

                EditorRowsPanel.Children.Add(new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(0x22, 255, 255, 255)),
                    CornerRadius = new CornerRadius(10), Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(10),
                    Child = line,
                });
            }
        }

        private void MoveRow(int index, int direction)
        {
            int newIndex = index + direction;
            if (newIndex < 0 || newIndex >= _editorRows.Count) return;
            (_editorRows[index], _editorRows[newIndex]) = (_editorRows[newIndex], _editorRows[index]);
            RenderEditor();
        }

        private void AddButton_Click(object sender, RoutedEventArgs e)
        {
            _editorRows.Add(new KioskButtonEditRow(new KioskButton
            {
                Id = Guid.NewGuid().ToString(),
                Text = "Новая кнопка",
                Color = "#4A90D9",
                Action = "web",
                Target = "https://",
            }));
            RenderEditor();
        }

        private async void SaveButtons_Click(object sender, RoutedEventArgs e)
        {
            if (_client == null)
            {
                MessageBox.Show(this, "Компьютер не привязан к личному кабинету — сохранить кнопки на сервере нельзя.", "АБИЗ",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var bad = _editorRows.FirstOrDefault(r => string.IsNullOrWhiteSpace(r.Text) || string.IsNullOrWhiteSpace(r.Target) || r.Target == "https://");
            if (bad != null)
            {
                MessageBox.Show(this, "У каждой кнопки должны быть название и адрес сайта или программа.", "АБИЗ",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var list = _editorRows.Select(r => r.ToButton()).ToList();
            bool ok = await KioskButtonsService.SaveAsync(_client, list);
            if (ok)
            {
                _buttons = list;
                BuildTiles();
                EditorOverlay.Visibility = Visibility.Collapsed;
                MessageBox.Show(this, "Кнопки сохранены — появятся на всех компьютерах при следующем входе.", "АБИЗ",
                    MessageBoxButton.OK, MessageBoxImage.Information);
            }
            else
            {
                MessageBox.Show(this, "Не удалось сохранить — проверьте интернет.", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private void CloseEditor_Click(object sender, RoutedEventArgs e) => EditorOverlay.Visibility = Visibility.Collapsed;
    }

    public class KioskButtonEditRow
    {
        public string Id { get; }
        public string Text { get; set; }
        public string Color { get; set; }
        public string Action { get; set; }
        public string Target { get; set; }

        public KioskButtonEditRow(KioskButton b)
        {
            Id = string.IsNullOrEmpty(b.Id) ? Guid.NewGuid().ToString() : b.Id;
            Text = b.Text;
            Color = b.Color;
            Action = b.Action;
            Target = b.Target;
        }

        public KioskButton ToButton() => new()
        {
            Id = Id,
            Text = Text.Trim(),
            Color = Color.Trim(),
            Action = Action,
            Target = Target.Trim(),
        };
    }
}
