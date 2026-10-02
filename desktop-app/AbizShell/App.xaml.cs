using System;
using System.Diagnostics;
using System.Threading;
using System.Windows;
using Microsoft.Win32;

namespace AbizShell
{
    /// <summary>
    /// Точка входа программы. Файл App.xaml НЕ используется — приложение запускается
    /// из метода Main. Если в папке проекта остался старый App.xaml — удали его.
    /// </summary>
    public class App : Application
    {
        private static Mutex? _singleInstanceMutex;

        [STAThread]
        public static void Main()
        {
            _singleInstanceMutex = new Mutex(true, "AbizShell_SingleInstance_8F2A1C", out bool isNew);
            if (!isNew) return;

            var app = new App { ShutdownMode = ShutdownMode.OnLastWindowClose };
            app.Run();
        }

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            RegisterAutoStart();
            new MainWindow().Show();
        }

        private static void RegisterAutoStart()
        {
            try
            {
                string? exePath = Process.GetCurrentProcess().MainModule?.FileName;
                if (string.IsNullOrEmpty(exePath)) return;
                using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
                key?.SetValue("AbizShell", $"\"{exePath}\"");
            }
            catch { }
        }
    }
}
