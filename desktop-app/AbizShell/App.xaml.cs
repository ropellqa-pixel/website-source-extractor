using System;
using System.Threading;
using System.Windows;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Точка входа программы. Файл App.xaml НЕ используется — приложение запускается из Main.
    /// Автозапуск с правами администратора настраивает установщик (задача в Планировщике
    /// заданий Windows «AbizShell»), поэтому сама программа в автозагрузку больше не пишет.
    /// </summary>
    public class App : Application
    {
        private static Mutex? _singleInstanceMutex;

        [STAThread]
        public static void Main()
        {
            _singleInstanceMutex = new Mutex(true, "AbizShell_SingleInstance_8F2A1C", out bool isNew);
            if (!isNew) return;

            var app = new App { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            app.Run();
        }

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // При любой непредвиденной ошибке возвращаем панель задач Windows,
            // чтобы компьютер не остался без неё.
            DispatcherUnhandledException += OnUnhandled;
            AppDomain.CurrentDomain.ProcessExit += (s, a) => TaskbarManager.Restore();

            new MainWindow().Show();
        }

        private void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
        {
            e.Handled = true;
            MessageBox.Show("Произошла ошибка:\n" + e.Exception.Message + "\n\nПрограмма продолжит работу.",
                "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        protected override void OnExit(ExitEventArgs e)
        {
            TaskbarManager.Restore();
            base.OnExit(e);
        }
    }
}
