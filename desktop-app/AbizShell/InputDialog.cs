using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace AbizShell
{
    /// <summary>Простое модальное окно "введите текст" в тёмном стиле программы.</summary>
    public static class InputDialog
    {
        public static string? Show(string title, string prompt, string okLabel = "Готово")
        {
            var win = new Window
            {
                Title = title,
                Width = 420,
                Height = 190,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Topmost = true,
                ShowInTaskbar = false,
                Background = new SolidColorBrush(Color.FromRgb(30, 30, 46)),
                ResizeMode = ResizeMode.NoResize,
            };

            var panel = new StackPanel { Margin = new Thickness(20) };

            var label = new TextBlock
            {
                Text = prompt,
                Foreground = Brushes.White,
                FontSize = 14,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 12),
            };

            var input = new TextBox
            {
                FontSize = 16,
                Padding = new Thickness(8),
                Background = new SolidColorBrush(Color.FromRgb(50, 52, 70)),
                Foreground = Brushes.White,
                BorderBrush = new SolidColorBrush(Color.FromRgb(58, 58, 92)),
                BorderThickness = new Thickness(1),
            };

            var btnPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 12, 0, 0),
            };

            var okBtn = new Button
            {
                Content = okLabel,
                FontSize = 14,
                Width = 90,
                Height = 32,
                Margin = new Thickness(0, 0, 8, 0),
                Background = new SolidColorBrush(Color.FromRgb(74, 111, 165)),
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0),
            };

            var cancelBtn = new Button
            {
                Content = "Отмена",
                FontSize = 14,
                Width = 80,
                Height = 32,
                Background = new SolidColorBrush(Color.FromRgb(51, 51, 68)),
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0),
            };

            string? result = null;

            okBtn.Click += (s, e) => { result = input.Text; win.Close(); };
            cancelBtn.Click += (s, e) => win.Close();

            input.KeyDown += (s, e) =>
            {
                if (e.Key == Key.Enter) { result = input.Text; win.Close(); }
                if (e.Key == Key.Escape) win.Close();
            };

            btnPanel.Children.Add(okBtn);
            btnPanel.Children.Add(cancelBtn);

            panel.Children.Add(label);
            panel.Children.Add(input);
            panel.Children.Add(btnPanel);
            win.Content = panel;

            win.Loaded += (s, e) => input.Focus();
            win.ShowDialog();

            return result;
        }
    }
}
