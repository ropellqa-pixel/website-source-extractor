using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace AbizShell
{
    /// <summary>Простое модальное окно "введите текст" в светлом стиле программы.</summary>
    public static class InputDialog
    {
        public static string? Show(string title, string prompt, string okLabel = "Готово", string initial = "", bool isPassword = false)
        {
            var win = new Window
            {
                Title = title,
                Width = 440,
                SizeToContent = SizeToContent.Height,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Topmost = true,
                Owner = Application.Current?.Windows.OfType<Window>().FirstOrDefault(w => w.IsActive),
                ShowInTaskbar = false,
                Background = new SolidColorBrush(Color.FromRgb(0xF3, 0xF3, 0xF6)),
                ResizeMode = ResizeMode.NoResize,
                FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI"),
                UseLayoutRounding = true,
            };

            var panel = new StackPanel { Margin = new Thickness(24, 20, 24, 20) };

            var heading = new TextBlock
            {
                Text = title,
                Foreground = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x20)),
                FontSize = 17,
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(0, 0, 0, 6),
            };

            var label = new TextBlock
            {
                Text = prompt,
                Foreground = new SolidColorBrush(Color.FromRgb(0x6E, 0x6E, 0x73)),
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 12),
            };

            // Для пароля — скрытый ввод (точки вместо символов).
            Control input = isPassword ? new PasswordBox
            {
                FontSize = 16,
                Padding = new Thickness(10, 8, 10, 8),
                MinHeight = 42,
            } : new TextBox
            {
                FontSize = 16,
                Padding = new Thickness(10, 8, 10, 8),
                MinHeight = 42,
                Text = initial,
            };

            var btnPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 18, 0, 0),
            };

            var okBtn = new Button
            {
                Content = okLabel,
                MinWidth = 110,
                Margin = new Thickness(0, 0, 8, 0),
            };
            okBtn.SetResourceReference(FrameworkElement.StyleProperty, "PrimaryButton");

            var cancelBtn = new Button
            {
                Content = "Отмена",
                MinWidth = 96,
            };
            cancelBtn.SetResourceReference(FrameworkElement.StyleProperty, "SecondaryButton");

            string? result = null;
            string Value() => input is PasswordBox pb ? pb.Password : ((TextBox)input).Text;

            okBtn.Click += (s, e) => { result = Value(); win.Close(); };
            cancelBtn.Click += (s, e) => win.Close();

            input.KeyDown += (s, e) =>
            {
                if (e.Key == Key.Enter) { result = Value(); win.Close(); }
                if (e.Key == Key.Escape) win.Close();
            };

            btnPanel.Children.Add(okBtn);
            btnPanel.Children.Add(cancelBtn);

            panel.Children.Add(heading);
            panel.Children.Add(label);
            panel.Children.Add(input);
            panel.Children.Add(btnPanel);
            win.Content = panel;

            win.Loaded += (s, e) => { input.Focus(); (input as TextBox)?.SelectAll(); };
            win.ShowDialog();

            return result;
        }
    }
}
