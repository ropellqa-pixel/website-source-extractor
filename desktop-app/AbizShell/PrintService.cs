using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;

namespace AbizShell
{
    /// <summary>
    /// Печать: страница встроенного браузера (через системный диалог печати) и файлы из
    /// проводника АБИЗ. Картинки и текст печатаются самой программой, остальные файлы
    /// (PDF, Word, Excel) — через программу, которая их открывает в Windows (команда «Печать»).
    /// </summary>
    public static class PrintService
    {
        public static void PrintSystemDialog(CoreWebView2? browser)
        {
            try
            {
                if (browser == null) throw new InvalidOperationException("браузер ещё загружается");
                browser.ShowPrintUI(CoreWebView2PrintDialogKind.System);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось открыть печать: " + ex.Message, "АБИЗ — печать",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private static List<PrintQueue> GetQueues()
        {
            var result = new List<PrintQueue>();
            try
            {
                var server = new LocalPrintServer();
                result.AddRange(server.GetPrintQueues(new[] { EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections }));
            }
            catch { }
            return result;
        }

        public static List<string> GetInstalledPrinters() => GetQueues().Select(q => q.FullName).ToList();

        public static string? GetDefaultPrinter()
        {
            try { return LocalPrintServer.GetDefaultPrintQueue().FullName; } catch { return null; }
        }

        /// <summary>Окно выбора принтера перед печатью файлов. Возвращает имя или null (отмена).</summary>
        public static string? AskPrinter(Window owner, List<string> printers, int fileCount)
        {
            if (printers.Count == 0)
            {
                MessageBox.Show(owner, "На компьютере не установлен ни один принтер.", "АБИЗ — печать", MessageBoxButton.OK, MessageBoxImage.Warning);
                return null;
            }

            var win = new Window
            {
                Title = "Печать", Width = 440, SizeToContent = SizeToContent.Height, Owner = owner,
                WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize,
                ShowInTaskbar = false, Background = new SolidColorBrush(Color.FromRgb(30, 30, 46)),
            };
            var panel = new StackPanel { Margin = new Thickness(20) };
            panel.Children.Add(new TextBlock { Text = $"Файлов к печати: {fileCount}", Foreground = Brushes.White, FontSize = 15, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 0, 0, 12) });
            panel.Children.Add(new TextBlock { Text = "Принтер:", Foreground = Brushes.White, FontSize = 13, Margin = new Thickness(0, 0, 0, 6) });
            var combo = new ComboBox { FontSize = 14, Height = 32, ItemsSource = printers };
            string? def = GetDefaultPrinter();
            combo.SelectedItem = def != null && printers.Contains(def) ? def : printers[0];
            panel.Children.Add(combo);

            string? result = null;
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
            var ok = new Button { Content = "Печать", Width = 100, Height = 34, Margin = new Thickness(0, 0, 8, 0), IsDefault = true,
                                  Background = new SolidColorBrush(Color.FromRgb(74, 144, 217)), Foreground = Brushes.White, BorderThickness = new Thickness(0) };
            var cancel = new Button { Content = "Отмена", Width = 90, Height = 34, IsCancel = true,
                                      Background = new SolidColorBrush(Color.FromRgb(51, 51, 68)), Foreground = Brushes.White, BorderThickness = new Thickness(0) };
            ok.Click += (s, e) => { result = combo.SelectedItem as string; win.Close(); };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            panel.Children.Add(buttons);
            win.Content = panel;
            win.ShowDialog();
            return result;
        }

        private static readonly string[] ImageExt = { ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff" };
        private static readonly string[] TextExt = { ".txt", ".log", ".csv", ".xml", ".json", ".ini" };

        /// <summary>Печатает файлы на выбранный принтер. Возвращает число успешных и список неудачных.</summary>
        public static (int ok, List<string> failed) PrintFiles(IEnumerable<string> files, string printer)
        {
            int ok = 0;
            var failed = new List<string>();
            foreach (var file in files)
            {
                string ext = Path.GetExtension(file).ToLowerInvariant();
                try
                {
                    if (ImageExt.Contains(ext)) PrintImage(file, printer);
                    else if (TextExt.Contains(ext)) PrintText(file, printer);
                    else PrintViaShell(file, printer);
                    ok++;
                }
                catch
                {
                    failed.Add(file);
                }
            }
            return (ok, failed);
        }

        private static PrintDialog DialogFor(string printer)
        {
            var dlg = new PrintDialog();
            var queue = GetQueues().FirstOrDefault(q => q.FullName == printer || q.Name == printer);
            if (queue != null) dlg.PrintQueue = queue;
            return dlg;
        }

        private static void PrintImage(string file, string printer)
        {
            var dlg = DialogFor(printer);
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.UriSource = new Uri(file);
            bmp.EndInit();

            double pw = dlg.PrintableAreaWidth, ph = dlg.PrintableAreaHeight;
            const double margin = 30;
            double scale = Math.Min((pw - margin * 2) / bmp.Width, (ph - margin * 2) / bmp.Height);
            var visual = new DrawingVisual();
            using (var dc = visual.RenderOpen())
            {
                double w = bmp.Width * scale, h = bmp.Height * scale;
                dc.DrawImage(bmp, new Rect((pw - w) / 2, (ph - h) / 2, w, h));
            }
            dlg.PrintVisual(visual, Path.GetFileName(file));
        }

        private static void PrintText(string file, string printer)
        {
            var dlg = DialogFor(printer);
            var doc = new System.Windows.Documents.FlowDocument(
                new System.Windows.Documents.Paragraph(new System.Windows.Documents.Run(File.ReadAllText(file))))
            {
                FontFamily = new FontFamily("Consolas"),
                FontSize = 11,
                PagePadding = new Thickness(50),
                PageWidth = dlg.PrintableAreaWidth,
                PageHeight = dlg.PrintableAreaHeight,
                ColumnWidth = double.PositiveInfinity,
            };
            dlg.PrintDocument(((System.Windows.Documents.IDocumentPaginatorSource)doc).DocumentPaginator, Path.GetFileName(file));
        }

        /// <summary>PDF, Word, Excel и т.п. — команда Windows «Печать на...» (printto) или «Печать».</summary>
        private static void PrintViaShell(string file, string printer)
        {
            var info = new ProcessStartInfo(file) { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Minimized };
            var verbs = info.Verbs.Select(v => v.ToLowerInvariant()).ToList();
            if (verbs.Contains("printto"))
            {
                info.Verb = "printto";
                info.Arguments = $"\"{printer}\"";
            }
            else if (verbs.Contains("print"))
            {
                info.Verb = "print";
            }
            else
            {
                throw new InvalidOperationException("нет программы для печати");
            }
            Process.Start(info);
        }
    }
}
