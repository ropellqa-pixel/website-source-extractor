using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace AbizShell
{
    /// <summary>Строка списка файлов в проводнике.</summary>
    public class FileEntry
    {
        public string FullPath { get; init; } = "";
        public string Name { get; init; } = "";
        public bool IsFolder { get; init; }
        public string Icon { get; init; } = "";
        public string Kind { get; init; } = "";
        public string Modified { get; init; } = "";
        public string SizeText { get; init; } = "";
    }

    /// <summary>
    /// Собственный проводник АБИЗ: папки пользователя, диски и флешки, открытие файлов,
    /// создание/переименование/удаление и печать выбранных файлов. Работает внутри
    /// оболочки — сотруднику не нужен доступ к рабочему столу Windows.
    /// </summary>
    public partial class ExplorerWindow : Window
    {
        private string _current = "";
        private readonly Stack<string> _history = new();
        private bool _allowClose;

        public ExplorerWindow()
        {
            InitializeComponent();
            Loaded += (s, e) =>
            {
                BuildPlaces();
                Navigate(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), false);
            };
            // Закрытие окна просто прячет его: так оно быстро открывается снова.
            Closing += (s, e) =>
            {
                if (_allowClose) return;
                e.Cancel = true;
                Hide();
            };
        }

        public void ForceClose()
        {
            _allowClose = true;
            Close();
        }

        // --- Слева: быстрый доступ и диски ---

        private void BuildPlaces()
        {
            PlacesPanel.Children.Clear();
            string downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            AddPlace("\U0001F4C4", "Документы", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
            AddPlace("\u2B07", "Загрузки", downloads);
            AddPlace("\U0001F5A5", "Рабочий стол", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
            AddPlace("\U0001F5BC", "Изображения", Environment.GetFolderPath(Environment.SpecialFolder.MyPictures));

            PlacesPanel.Children.Add(new TextBlock { Text = "ДИСКИ", Foreground = new SolidColorBrush(Color.FromRgb(0x9A, 0x9A, 0xA2)), FontSize = 11, FontWeight = FontWeights.SemiBold, Margin = new Thickness(12, 14, 0, 6) });
            foreach (var d in DriveInfo.GetDrives())
            {
                try
                {
                    if (!d.IsReady) continue;
                    string label = string.IsNullOrWhiteSpace(d.VolumeLabel) ? (d.DriveType == DriveType.Removable ? "Флешка" : "Диск") : d.VolumeLabel;
                    string icon = d.DriveType switch { DriveType.Removable => "\U0001F4BE", DriveType.Network => "\U0001F310", DriveType.CDRom => "\U0001F4BF", _ => "\U0001F5B4" };
                    AddPlace(icon, $"{label} ({d.Name.TrimEnd('\\')})", d.RootDirectory.FullName);
                }
                catch { }
            }
        }

        private void AddPlace(string icon, string title, string path)
        {
            if (!Directory.Exists(path)) return;
            var btn = new Button
            {
                Style = (Style)FindResource("PlaceBtn"),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Margin = new Thickness(0, 0, 0, 2),
                Content = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Children =
                    {
                        new TextBlock { Text = icon, Margin = new Thickness(0, 0, 8, 0) },
                        new TextBlock { Text = title, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 160 },
                    },
                },
            };
            btn.Click += (s, e) => Navigate(path);
            PlacesPanel.Children.Add(btn);
        }

        // --- Навигация ---

        private void Navigate(string path, bool remember = true)
        {
            try
            {
                var dir = new DirectoryInfo(path);
                if (!dir.Exists) { Status("Папка не найдена: " + path); return; }

                var items = new List<FileEntry>();
                foreach (var d in dir.EnumerateDirectories().OrderBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase))
                {
                    if ((d.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue;
                    items.Add(new FileEntry { FullPath = d.FullName, Name = d.Name, IsFolder = true, Icon = "\U0001F4C1", Kind = "Папка", Modified = d.LastWriteTime.ToString("dd.MM.yyyy HH:mm") });
                }
                foreach (var f in dir.EnumerateFiles().OrderBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase))
                {
                    if ((f.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue;
                    items.Add(new FileEntry
                    {
                        FullPath = f.FullName, Name = f.Name, Icon = IconFor(f.Extension), Kind = KindFor(f.Extension),
                        Modified = f.LastWriteTime.ToString("dd.MM.yyyy HH:mm"), SizeText = FormatSize(f.Length),
                    });
                }

                if (remember && !string.IsNullOrEmpty(_current) && _current != dir.FullName) _history.Push(_current);
                _current = dir.FullName;
                PathBox.Text = _current;
                FilesList.ItemsSource = items;
                Status($"{items.Count(i => i.IsFolder)} папок, {items.Count(i => !i.IsFolder)} файлов");
                UpdateButtons();
            }
            catch (UnauthorizedAccessException)
            {
                Status("Нет доступа к папке: " + path);
            }
            catch (Exception ex)
            {
                Status("Ошибка: " + ex.Message);
            }
        }

        private void Back_Click(object sender, RoutedEventArgs e)
        {
            if (_history.Count > 0) Navigate(_history.Pop(), false);
        }

        private void Up_Click(object sender, RoutedEventArgs e)
        {
            var parent = Directory.GetParent(_current);
            if (parent != null) Navigate(parent.FullName);
        }

        private void Refresh_Click(object sender, RoutedEventArgs e)
        {
            BuildPlaces();
            Navigate(_current, false);
        }

        private void PathBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) Navigate(Environment.ExpandEnvironmentVariables(PathBox.Text.Trim()));
        }

        // --- Работа с файлами ---

        private List<FileEntry> Selected => FilesList.SelectedItems.Cast<FileEntry>().ToList();

        private void FilesList_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateButtons();

        private void UpdateButtons()
        {
            var sel = Selected;
            OpenBtn.IsEnabled = sel.Count == 1;
            PrintBtn.IsEnabled = sel.Count > 0 && sel.All(x => !x.IsFolder);
            RenameBtn.IsEnabled = sel.Count == 1;
            DeleteBtn.IsEnabled = sel.Count > 0;
        }

        private void FilesList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
        {
            if (FilesList.SelectedItem is FileEntry entry) OpenEntry(entry);
        }

        private void FilesList_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && FilesList.SelectedItem is FileEntry entry) OpenEntry(entry);
            else if (e.Key == Key.Back) Up_Click(sender, e);
            else if (e.Key == Key.Delete) Delete_Click(sender, e);
            else if (e.Key == Key.F5) Refresh_Click(sender, e);
            else if (e.Key == Key.P && Keyboard.Modifiers == ModifierKeys.Control) Print_Click(sender, e);
        }

        private void Open_Click(object sender, RoutedEventArgs e)
        {
            if (FilesList.SelectedItem is FileEntry entry) OpenEntry(entry);
        }

        private void OpenEntry(FileEntry entry)
        {
            if (entry.IsFolder) { Navigate(entry.FullPath); return; }
            AppLauncher.Launch(entry.FullPath, this);
        }

        private void Print_Click(object sender, RoutedEventArgs e)
        {
            var files = Selected.Where(x => !x.IsFolder).Select(x => x.FullPath).ToList();
            if (files.Count == 0) { Status("Выберите файлы для печати"); return; }

            var printers = PrintService.GetInstalledPrinters();
            string? printer = PrintService.AskPrinter(this, printers, files.Count);
            if (printer == null) return;

            var (ok, failed) = PrintService.PrintFiles(files, printer);
            Status(failed.Count == 0
                ? $"Отправлено на печать: {ok} файл(ов) → {printer}"
                : $"Отправлено: {ok}. Не удалось: {string.Join(", ", failed.Select(Path.GetFileName))}");
            if (failed.Count > 0)
                MessageBox.Show(this,
                    "Эти файлы не удалось отправить на печать:\n" + string.Join("\n", failed.Select(Path.GetFileName)) +
                    "\n\nДля файлов такого типа на компьютере нет программы, умеющей печатать. Откройте файл и напечатайте из программы.",
                    "АБИЗ — печать", MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        private void NewFolder_Click(object sender, RoutedEventArgs e)
        {
            string? name = InputDialog.Show("Новая папка", "Название папки:", "Создать");
            if (string.IsNullOrWhiteSpace(name)) return;
            try
            {
                Directory.CreateDirectory(Path.Combine(_current, name.Trim()));
                Navigate(_current, false);
            }
            catch (Exception ex) { Status("Не удалось создать папку: " + ex.Message); }
        }

        private void Rename_Click(object sender, RoutedEventArgs e)
        {
            if (FilesList.SelectedItem is not FileEntry entry) return;
            string? name = InputDialog.Show("Переименовать", "Новое имя:", "Готово", entry.Name);
            if (string.IsNullOrWhiteSpace(name) || name == entry.Name) return;
            try
            {
                string target = Path.Combine(_current, name.Trim());
                if (entry.IsFolder) Directory.Move(entry.FullPath, target);
                else File.Move(entry.FullPath, target);
                Navigate(_current, false);
            }
            catch (Exception ex) { Status("Не удалось переименовать: " + ex.Message); }
        }

        private void Delete_Click(object sender, RoutedEventArgs e)
        {
            var sel = Selected;
            if (sel.Count == 0) return;
            if (MessageBox.Show(this, $"Удалить в корзину: {sel.Count} шт.?", "АБИЗ", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            foreach (var item in sel)
            {
                try
                {
                    if (item.IsFolder)
                        Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(item.FullPath,
                            Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                    else
                        Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(item.FullPath,
                            Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                }
                catch (Exception ex) { Status("Не удалось удалить " + item.Name + ": " + ex.Message); }
            }
            Navigate(_current, false);
        }

        private void Status(string text) => StatusText.Text = text;

        // --- Оформление ---

        private static string FormatSize(long bytes)
        {
            if (bytes < 1024) return bytes + " Б";
            if (bytes < 1024 * 1024) return (bytes / 1024.0).ToString("0.#") + " КБ";
            if (bytes < 1024L * 1024 * 1024) return (bytes / 1024.0 / 1024).ToString("0.#") + " МБ";
            return (bytes / 1024.0 / 1024 / 1024).ToString("0.##") + " ГБ";
        }

        private static string IconFor(string ext) => ext.ToLowerInvariant() switch
        {
            ".pdf" => "\U0001F4D5",
            ".doc" or ".docx" or ".rtf" or ".odt" => "\U0001F4DD",
            ".xls" or ".xlsx" or ".csv" or ".ods" => "\U0001F4CA",
            ".jpg" or ".jpeg" or ".png" or ".gif" or ".bmp" or ".webp" or ".tif" or ".tiff" => "\U0001F5BC",
            ".txt" or ".log" => "\U0001F4C4",
            ".zip" or ".rar" or ".7z" => "\U0001F5DC",
            ".exe" or ".lnk" => "\u2699",
            ".xml" or ".sig" or ".p7s" => "\U0001F50F",
            _ => "\U0001F4C4",
        };

        private static string KindFor(string ext) => ext.ToLowerInvariant() switch
        {
            ".pdf" => "PDF",
            ".doc" or ".docx" or ".rtf" or ".odt" => "Документ",
            ".xls" or ".xlsx" or ".csv" or ".ods" => "Таблица",
            ".jpg" or ".jpeg" or ".png" or ".gif" or ".bmp" or ".webp" or ".tif" or ".tiff" => "Изображение",
            ".txt" or ".log" => "Текст",
            ".zip" or ".rar" or ".7z" => "Архив",
            ".exe" or ".lnk" => "Программа",
            _ => string.IsNullOrEmpty(ext) ? "Файл" : ext.TrimStart('.').ToUpperInvariant(),
        };
    }
}
