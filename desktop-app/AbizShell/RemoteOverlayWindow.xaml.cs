using System.Windows;

namespace AbizShell
{
    /// <summary>
    /// Полноэкранное окно для удалённых команд зам. директора:
    /// сообщение (можно закрыть) или блокировка (закрыть нельзя, снимается только с сайта).
    /// </summary>
    public partial class RemoteOverlayWindow : Window
    {
        private bool _isLock;
        private bool _allowClose;

        public RemoteOverlayWindow()
        {
            InitializeComponent();
            ScreenArea.CoverScreen(this);
            StateChanged += (s, e) => { if (WindowState != WindowState.Normal) ScreenArea.CoverScreen(this); };
            Closing += (s, e) => { if (_isLock && !_allowClose) e.Cancel = true; };
        }

        /// <summary>Показать сообщение на весь экран (сотрудник закрывает сам).</summary>
        public void ShowMessage(string text)
        {
            _isLock = false;
            IconLabel.Text = "\uE8BD";
            TitleLabel.Text = "Сообщение от руководства";
            MessageLabel.Text = text;
            CloseButton.Visibility = Visibility.Visible;
            LockHint.Visibility = Visibility.Collapsed;
        }

        /// <summary>Показать блокировку ПК (закрыть нельзя).</summary>
        public void ShowLock(string? text)
        {
            _isLock = true;
            IconLabel.Text = "\uE72E";
            TitleLabel.Text = "Доступ временно заблокирован";
            MessageLabel.Text = string.IsNullOrWhiteSpace(text)
                ? "Компьютер заблокирован заместителем директора."
                : text;
            CloseButton.Visibility = Visibility.Collapsed;
            LockHint.Visibility = Visibility.Visible;
        }

        /// <summary>Снять блокировку и закрыть окно (команда «Разблокировать» с сайта).</summary>
        public void Release()
        {
            _allowClose = true;
            Close();
        }

        private void Close_Click(object sender, RoutedEventArgs e)
        {
            if (_isLock) return;
            _allowClose = true;
            Close();
        }
    }
}
