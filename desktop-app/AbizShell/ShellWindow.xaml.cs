using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace AbizShell
{
    public partial class ShellWindow : Window
    {
        public bool IsAdmin { get; set; }
        public string ApiToken { get; set; } = "";
        public string DeviceCode { get; set; } = "";

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr LoadKeyboardLayout(string pwszKLID, uint Flags);
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        private static readonly IntPtr HWND_TOPMOST = new(-1);
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private const int SW_RESTORE = 9;
        private const uint KLF_ACTIVATE = 0x00000001;
        private const string RU_LAYOUT = "00000419";
        private const string EN_LAYOUT = "00000409";
        private const string HomePage = "https://anod.saou.ru/";
        private const string RuDesktopAcceptId = "2364029";

        private bool _isRussian = true;
        private DispatcherTimer? _clockTimer, _networkTimer, _remoteDesktopTimer, _notificationTimer;
        private DateTime _lastSpacePress = DateTime.MinValue;
        private DateTime _lastEnterPress = DateTime.MinValue;
        private const int DoublePressInterval = 450;
        private KeyboardHook? _keyboardHook;
        private int _codeClickCount;
        private DateTime _lastCodeClick = DateTime.MinValue;
        private readonly Dictionary<string, string> _notes = new();
        private readonly string _notesPath;
        private string _selectedDate = "";
        private AnodBizClient? _client;
        private List<KioskButton> _buttons = new();
        private readonly ObservableCollection<KioskButtonEditRow> _editorRows = new();

        public ShellWindow()
        {
            InitializeComponent();
            Loaded += ShellWindow_Loaded;
            Closing += ShellWindow_Closing;
            _notesPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AbizShell", "notes.json");
            LoadNotes();

            _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _clockTimer.Tick += (s, e) => UpdateClock();
            _clockTimer.Start();
            UpdateClock();

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

        // Администратор может закрыть окно (например, через системное меню) — обычный
        // пользователь не может, окно без этого было бы неубиваемым даже для директора.
        private void ShellWindow_Closing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (!IsAdmin) { e.Cancel = true; return; }
            _keyboardHook?.Dispose();
            _keyboardHook = null;
        }

        private async void ShellWindow_Loaded(object sender, RoutedEventArgs e)
        {
            AdminBtn.Visibility = IsAdmin ? Visibility.Visible : Visibility.Collapsed;
            if (!string.IsNullOrEmpty(DeviceCode))
                DeviceCodeDisplay.Text = "Код ПК: " + DeviceManager.FormatCode(DeviceCode);
            SideCalendar.SelectedDate = DateTime.Today;

            if (!string.IsNullOrEmpty(ApiToken))
                _client = new AnodBizClient(ApiToken);

            // Перехват системных клавиш и реакция на Tab/2×Space для открытия меню кнопок.
            _keyboardHook = new KeyboardHook { BlockSystemKeys = true };
            _keyboardHook.KeyHandler = (vkCode, isSysKey) =>
            {
                if (vkCode == KeyboardHook.VK_TAB && !isSysKey)
                {
                    Dispatcher.Invoke(ToggleOverlay);
                    return true;
                }

                if (vkCode == KeyboardHook.VK_SPACE && !isSysKey)
                {
                    var now = DateTime.Now;
                    if ((now - _lastSpacePress).TotalMilliseconds < DoublePressInterval)
                    {
                        Dispatcher.Invoke(ToggleOverlay);
                        _lastSpacePress = DateTime.MinValue;
                        return true;
                    }
                    _lastSpacePress = now;
                    return false;
                }

                if (vkCode == KeyboardHook.VK_ESCAPE && OverlayGrid.Visibility == Visibility.Visible)
                {
                    Dispatcher.Invoke(() => OverlayGrid.Visibility = Visibility.Collapsed);
                    return true;
                }

                return false;
            };

            try
            {
                await MainBrowser.EnsureCoreWebView2Async(null);
                ConfigureBrowserSettings();
                MainBrowser.CoreWebView2.KeyboardAccelerators.Clear();
                await LoadButtonsAsync();
                await AutoLoginAndNavigateAsync();
            }
            catch
            {
                try { MainBrowser.Source = new Uri(HomePage); } catch { }
            }

            _ = CheckNotificationsAsync();
            _ = CheckNetworkAsync();
        }

        /// <summary>
        /// Отключает поисковую строку и адресную строку WebView2 — своя программа работает
        /// только как показ заданных сайтов, без свободной навигации пользователем.
        /// </summary>
        private void ConfigureBrowserSettings()
        {
            var settings = MainBrowser.CoreWebView2.Settings;
            settings.AreDefaultContextMenusEnabled = IsAdmin;
            settings.AreDevToolsEnabled = IsAdmin;
            settings.IsZoomControlEnabled = true;
            settings.IsStatusBarEnabled = false;
        }

        // --- Загрузка/сохранение кнопок киоска ---

        private async Task LoadButtonsAsync()
        {
            _buttons = _client != null ? await KioskButtonsService.LoadAsync(_client) : KioskButtonsService.DefaultButtons();
            BuildTiles();
        }

        private void BuildTiles()
        {
            TilesPanel.Children.Clear();
            foreach (var btn in _buttons)
            {
                var tile = new Button
                {
                    Style = (Style)FindResource("AppTile"),
                    Content = btn.Text,
                    Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(
                        string.IsNullOrWhiteSpace(btn.Color) ? "#125499" : btn.Color)),
                    Tag = btn,
                    ToolTip = btn.Action == "app" ? "Запустить: " + btn.Target : "Открыть: " + btn.Target,
                };
                tile.Click += Tile_Click;
                TilesPanel.Children.Add(tile);
            }
        }

        private void Tile_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not KioskButton k) return;

            if (k.Action == "app")
                LaunchAppOnTop(k.Target);
            else
                NavigateBrowser(k.Target);

            OverlayGrid.Visibility = Visibility.Collapsed;
        }

        // --- Меню кнопок (Launchpad): показ/скрытие без мигания панелей ---

        private void ToggleOverlay()
        {
            // Браузер и панели НИКОГДА не скрываются и не меняют Margin — переключаем
            // только видимость полупрозрачного оверлея поверх них. Это убирает мигание,
            // которое было при Collapsed/Visible у самого MainBrowser.
            OverlayGrid.Visibility = OverlayGrid.Visibility == Visibility.Visible
                ? Visibility.Collapsed
                : Visibility.Visible;
        }

        // --- Навигация и запуск приложений ---

        private void NavigateBrowser(string url)
        {
            try
            {
                if (MainBrowser.CoreWebView2 != null)
                    MainBrowser.Source = new Uri(url);
            }
            catch
            {
                MessageBox.Show("Не удалось открыть: " + url, "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private void BringWindowOnTop(IntPtr handle)
        {
            if (handle == IntPtr.Zero) return;
            ShowWindow(handle, SW_RESTORE);
            SetWindowPos(handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            SetForegroundWindow(handle);
        }

        /// <summary>Запускает внешнее приложение (Word, Excel, MAX, RuDesktop...) и держит его окно поверх, но не выходя за пределы системы.</summary>
        private void LaunchAppOnTop(string exeName)
        {
            try
            {
                var proc = Process.Start(new ProcessStartInfo(exeName) { UseShellExecute = true });
                int attempts = 0;
                var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
                timer.Tick += (s, e) =>
                {
                    attempts++;
                    try
                    {
                        if (proc is { HasExited: false })
                        {
                            proc.Refresh();
                            if (proc.MainWindowHandle != IntPtr.Zero)
                                BringWindowOnTop(proc.MainWindowHandle);
                        }
                    }
                    catch { }
                    if (attempts >= 10) timer.Stop();
                };
                timer.Start();
            }
            catch
            {
                MessageBox.Show("Не удалось запустить: " + exeName + "\nПроверьте, что программа установлена.",
                    "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        /// <summary>Автоматически принимает запрос на подключение от заданного ID RuDesktop (не требует участия сотрудника).</summary>
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
                            PostMessage(proc.MainWindowHandle, 0x0100, (IntPtr)0x0D, IntPtr.Zero);
                            PostMessage(proc.MainWindowHandle, 0x0101, (IntPtr)0x0D, IntPtr.Zero);
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        // --- Автовход в личный кабинет через одноразовый код (см. API.md, раздел 7.5) ---

        private async Task AutoLoginAndNavigateAsync()
        {
            if (string.IsNullOrEmpty(ApiToken))
            {
                NavigateBrowser(HomePage);
                return;
            }
            try
            {
                string? code = await AnodBizClient.RequestLoginLinkAsync(ApiToken);
                NavigateBrowser(!string.IsNullOrEmpty(code)
                    ? $"https://anod.saou.ru/device-login?code={code}"
                    : HomePage);
            }
            catch
            {
                NavigateBrowser(HomePage);
            }
        }

        private void UpdateClock()
        {
            ClockLabel.Text = DateTime.Now.ToString("HH:mm");
            DateLabel.Text = DateTime.Now.ToString("d MMM", new CultureInfo("ru-RU"));
        }

        private async Task CheckNetworkAsync()
        {
            bool online = await AnodBizClient.CheckNetworkAsync();
            Dispatcher.Invoke(() =>
            {
                ShellNetworkOverlay.Visibility = online ? Visibility.Collapsed : Visibility.Visible;
                StatusDot.Fill = new SolidColorBrush(online
                    ? Color.FromRgb(0x28, 0xC8, 0x40)
                    : Color.FromRgb(0xFF, 0x6B, 0x6B));
                StatusDotBorder.ToolTip = online ? "Статус сети: подключено" : "Статус сети: нет соединения";
            });
        }

        // --- Верхняя/нижняя панель: обработчики ---

        private void Home_Click(object sender, RoutedEventArgs e) => NavigateBrowser(HomePage);

        private void Print_Click(object sender, RoutedEventArgs e) => PrintService.PrintSystemDialog(MainBrowser);

        // Проводник и выход в Windows доступны только администратору — обычный
        // сотрудник не должен иметь возможность обойти систему киоска.
        private void Explorer_Click(object sender, RoutedEventArgs e)
        {
            if (!IsAdmin)
            {
                MessageBox.Show("Доступно только администратору.", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            try { Process.Start("explorer.exe"); } catch { }
        }

        private void Lock_Click(object sender, RoutedEventArgs e)
        {
            _clockTimer?.Stop(); _networkTimer?.Stop(); _remoteDesktopTimer?.Stop(); _notificationTimer?.Stop();
            _keyboardHook?.Dispose();
            _keyboardHook = null;
            IsAdmin = true; // разрешаем Closing себя закрыть
            new MainWindow().Show();
            Close();
        }

        private void ShutdownBtn_Click(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Выключить компьютер?", "АБИЗ", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;

            _clockTimer?.Stop(); _networkTimer?.Stop(); _remoteDesktopTimer?.Stop(); _notificationTimer?.Stop();
            _keyboardHook?.Dispose();
            _keyboardHook = null;
            Process.Start("shutdown", "/s /t 0");
        }

        private void Lang_Click(object sender, RoutedEventArgs e)
        {
            if (_isRussian) { LoadKeyboardLayout(EN_LAYOUT, KLF_ACTIVATE); LangBtn.Content = "EN"; _isRussian = false; }
            else { LoadKeyboardLayout(RU_LAYOUT, KLF_ACTIVATE); LangBtn.Content = "RU"; _isRussian = true; }
        }

        private void ToggleSidePanel_Click(object sender, RoutedEventArgs e)
        {
            SidePanel.Visibility = SidePanel.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        }

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
                var json = File.ReadAllText(_notesPath);
                var data = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
                if (data == null) return;
                foreach (var kv in data) _notes[kv.Key] = kv.Value;
            }
            catch { }
        }

        private void SaveNotes()
        {
            try
            {
                var dir = Path.GetDirectoryName(_notesPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
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

        // --- Уведомления (чат / инкассация) ---

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
            result.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0;

        private void ShowNotification(string icon, string title, string message)
        {
            Dispatcher.Invoke(() =>
            {
                NotificationIcon.Text = icon;
                NotificationTitle.Text = title;
                NotificationMessage.Text = message;
                NotificationPanel.Visibility = Visibility.Visible;

                var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
                timer.Tick += (s, e) => { timer.Stop(); NotificationPanel.Visibility = Visibility.Collapsed; };
                timer.Start();
            });
        }

        private void CloseNotification_Click(object sender, RoutedEventArgs e) => NotificationPanel.Visibility = Visibility.Collapsed;

        // --- Админ-меню ---

        private void AdminBtn_Click(object sender, RoutedEventArgs e)
        {
            var menu = new ContextMenu
            {
                Background = new SolidColorBrush(Color.FromArgb(0xCC, 42, 42, 60)),
                Foreground = Brushes.White,
                BorderBrush = Brushes.Transparent,
                Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom,
                PlacementTarget = AdminBtn,
            };

            var editButtonsItem = new MenuItem { Header = "Изменить кнопки киоска", Foreground = Brushes.White };
            editButtonsItem.Click += (s, a) => OpenEditor();

            var exitItem = new MenuItem { Header = "Выйти в Windows", Foreground = Brushes.White };
            exitItem.Click += (s, a) => ExitToWindows();

            var searchItem = new MenuItem { Header = "Поиск сотрудников", Foreground = Brushes.White };
            searchItem.Click += async (s, a) => await SearchEmployeeAsync();

            var printersItem = new MenuItem { Header = "Список принтеров", Foreground = Brushes.White };
            printersItem.Click += (s, a) => ShowPrinters();

            var shutdownItem = new MenuItem { Header = "Выключить компьютер", Foreground = Brushes.White };
            shutdownItem.Click += ShutdownBtn_Click;

            menu.Items.Add(editButtonsItem);
            menu.Items.Add(exitItem);
            menu.Items.Add(searchItem);
            menu.Items.Add(printersItem);
            menu.Items.Add(shutdownItem);
            menu.IsOpen = true;
        }

        private void ShowPrinters()
        {
            var printers = PrintService.GetInstalledPrinters();
            string text = printers.Count > 0 ? string.Join("\n", printers) : "Принтеры не найдены";
            MessageBox.Show(text, "Установленные принтеры", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        private async Task SearchEmployeeAsync()
        {
            if (_client == null)
            {
                MessageBox.Show("Нет связи с сервером (устройство не привязано).", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            string? query = InputDialog.Show("Поиск сотрудника", "Введите ФИО или часть имени:", "Найти");
            if (string.IsNullOrWhiteSpace(query)) return;

            try
            {
                var result = await _client.SearchEmployeesAsync(query);
                string info = "Ничего не найдено";
                if (result.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                {
                    var lines = new List<string>();
                    foreach (var item in data.EnumerateArray())
                    {
                        string name = item.TryGetProperty("full_name", out var n) ? n.GetString() ?? "???" : "???";
                        string role = item.TryGetProperty("role", out var r) ? r.GetString() ?? "" : "";
                        string dept = item.TryGetProperty("department", out var d) ? d.GetString() ?? "" : "";
                        lines.Add($"{name} | {role} | {dept}");
                    }
                    if (lines.Count > 0) info = string.Join("\n", lines);
                }
                MessageBox.Show(info, "Результаты поиска", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Ошибка: " + ex.Message, "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void ExitToWindows()
        {
            _keyboardHook?.Dispose();
            _keyboardHook = null;
            try { Process.Start("explorer.exe"); } catch { }
            IsAdmin = true;
            Application.Current.Shutdown();
        }

        private async void ShellRetryNetwork_Click(object sender, RoutedEventArgs e) => await CheckNetworkAsync();

        private void ShellCallAdmin_Click(object sender, RoutedEventArgs e) => Lock_Click(sender, e);

        private async void DeviceCode_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if ((DateTime.Now - _lastCodeClick).TotalSeconds > 2) _codeClickCount = 0;
            _codeClickCount++;
            _lastCodeClick = DateTime.Now;
            if (_codeClickCount >= 3) { _codeClickCount = 0; await RegenerateDeviceCodeAsync(); }
        }

        private async Task RegenerateDeviceCodeAsync()
        {
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
            _editorRows.Clear();
            foreach (var b in _buttons)
                _editorRows.Add(new KioskButtonEditRow(b));

            EditorItemsControl.ItemsSource = _editorRows;
            EditorItemsControl.ItemTemplate = BuildEditorItemTemplate();

            EditorOverlay.Visibility = Visibility.Visible;
        }

        private DataTemplate BuildEditorItemTemplate()
        {
            // Строим шаблон строки редактора кодом (текст, цвет, тип, цель, порядок, удалить).
            var template = new DataTemplate(typeof(KioskButtonEditRow));
            var factory = new FrameworkElementFactory(typeof(Border));
            factory.SetValue(Border.BackgroundProperty, new SolidColorBrush(Color.FromArgb(0x22, 255, 255, 255)));
            factory.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
            factory.SetValue(Border.MarginProperty, new Thickness(0, 0, 0, 8));
            factory.SetValue(Border.PaddingProperty, new Thickness(12));

            var stack = new FrameworkElementFactory(typeof(StackPanel));
            stack.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);

            var textBox = new FrameworkElementFactory(typeof(TextBox));
            textBox.SetBinding(TextBox.TextProperty, new System.Windows.Data.Binding(nameof(KioskButtonEditRow.Text)) { Mode = System.Windows.Data.BindingMode.TwoWay });
            textBox.SetValue(TextBox.WidthProperty, 140.0);
            textBox.SetValue(TextBox.MarginProperty, new Thickness(0, 0, 8, 0));

            var targetBox = new FrameworkElementFactory(typeof(TextBox));
            targetBox.SetBinding(TextBox.TextProperty, new System.Windows.Data.Binding(nameof(KioskButtonEditRow.Target)) { Mode = System.Windows.Data.BindingMode.TwoWay });
            targetBox.SetValue(TextBox.WidthProperty, 280.0);
            targetBox.SetValue(TextBox.MarginProperty, new Thickness(0, 0, 8, 0));
            targetBox.SetValue(ToolTipService.ToolTipProperty, "Ссылка (https://...) или имя .exe файла");

            var colorBox = new FrameworkElementFactory(typeof(TextBox));
            colorBox.SetBinding(TextBox.TextProperty, new System.Windows.Data.Binding(nameof(KioskButtonEditRow.Color)) { Mode = System.Windows.Data.BindingMode.TwoWay });
            colorBox.SetValue(TextBox.WidthProperty, 90.0);
            colorBox.SetValue(TextBox.MarginProperty, new Thickness(0, 0, 8, 0));
            colorBox.SetValue(ToolTipService.ToolTipProperty, "Цвет HEX, например #125499");

            var actionCombo = new FrameworkElementFactory(typeof(ComboBox));
            actionCombo.SetValue(ComboBox.ItemsSourceProperty, new[] { "web", "app" });
            actionCombo.SetBinding(ComboBox.SelectedItemProperty, new System.Windows.Data.Binding(nameof(KioskButtonEditRow.Action)) { Mode = System.Windows.Data.BindingMode.TwoWay });
            actionCombo.SetValue(ComboBox.WidthProperty, 70.0);
            actionCombo.SetValue(ComboBox.MarginProperty, new Thickness(0, 0, 8, 0));

            var upBtn = new FrameworkElementFactory(typeof(Button));
            upBtn.SetValue(Button.ContentProperty, "↑");
            upBtn.SetValue(Button.WidthProperty, 28.0);
            upBtn.SetValue(Button.MarginProperty, new Thickness(0, 0, 4, 0));
            upBtn.AddHandler(Button.ClickEvent, (RoutedEventHandler)((s, e) => MoveRow(((FrameworkElement)s).DataContext as KioskButtonEditRow, -1)));

            var downBtn = new FrameworkElementFactory(typeof(Button));
            downBtn.SetValue(Button.ContentProperty, "↓");
            downBtn.SetValue(Button.WidthProperty, 28.0);
            downBtn.SetValue(Button.MarginProperty, new Thickness(0, 0, 4, 0));
            downBtn.AddHandler(Button.ClickEvent, (RoutedEventHandler)((s, e) => MoveRow(((FrameworkElement)s).DataContext as KioskButtonEditRow, 1)));

            var delBtn = new FrameworkElementFactory(typeof(Button));
            delBtn.SetValue(Button.ContentProperty, "✕");
            delBtn.SetValue(Button.WidthProperty, 28.0);
            delBtn.SetValue(Button.ForegroundProperty, Brushes.OrangeRed);
            delBtn.AddHandler(Button.ClickEvent, (RoutedEventHandler)((s, e) => DeleteRow(((FrameworkElement)s).DataContext as KioskButtonEditRow)));

            stack.AppendChild(textBox);
            stack.AppendChild(targetBox);
            stack.AppendChild(colorBox);
            stack.AppendChild(actionCombo);
            stack.AppendChild(upBtn);
            stack.AppendChild(downBtn);
            stack.AppendChild(delBtn);
            factory.AppendChild(stack);
            template.VisualTree = factory;
            return template;
        }

        private void MoveRow(KioskButtonEditRow? row, int direction)
        {
            if (row == null) return;
            int index = _editorRows.IndexOf(row);
            int newIndex = index + direction;
            if (newIndex < 0 || newIndex >= _editorRows.Count) return;
            _editorRows.Move(index, newIndex);
        }

        private void DeleteRow(KioskButtonEditRow? row)
        {
            if (row == null) return;
            _editorRows.Remove(row);
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
        }

        private async void SaveButtons_Click(object sender, RoutedEventArgs e)
        {
            if (_client == null)
            {
                MessageBox.Show("Нет связи с сервером — сохранение недоступно.", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            _buttons = new List<KioskButton>();
            foreach (var row in _editorRows)
                _buttons.Add(row.ToButton());

            bool ok = await KioskButtonsService.SaveAsync(_client, _buttons);
            if (ok)
            {
                BuildTiles();
                EditorOverlay.Visibility = Visibility.Collapsed;
                MessageBox.Show("Порядок кнопок сохранён — подхватится на всех устройствах.", "АБИЗ",
                    MessageBoxButton.OK, MessageBoxImage.Information);
            }
            else
            {
                MessageBox.Show("Не удалось сохранить — проверьте сеть.", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private void CloseEditor_Click(object sender, RoutedEventArgs e) => EditorOverlay.Visibility = Visibility.Collapsed;
    }

    /// <summary>Редактируемая обёртка над KioskButton для биндинга в WPF (реализует INotifyPropertyChanged не нужен для простого списка с явной записью).</summary>
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
            Text = Text,
            Color = Color,
            Action = Action,
            Target = Target,
        };
    }
}