using System;
using System.Diagnostics;
using System.Threading;
using System.Windows;
using Microsoft.Win32;

namespace AbizShell
{
    public partial class App : Application
    {
        // Mutex не даёт запустить вторую копию программы — иначе пользователь мог бы
        // открыть ещё один экземпляр и запутать систему блокировки экрана.
        private static Mutex? _singleInstanceMutex;

        protected override void OnStartup(StartupEventArgs e)
        {
            _singleInstanceMutex = new Mutex(true, "AbizShell_SingleInstance_8F2A1C", out bool isNew);
            if (!isNew)
            {
                Shutdown();
                return;
            }

            RegisterAutoStart();
            base.OnStartup(e);

            var login = new MainWindow();
            login.Show();
        }

        /// <summary>
        /// Автозапуск через реестр HKCU\...\Run — срабатывает при каждом входе в Windows.
        /// Это резервный способ на случай переустановки/сброса; основной автозапуск
        /// прописывается инсталлятором (см. installer/Product.wxs — создаёт тот же
        /// ключ реестра от имени системы, HKLM, что нельзя удалить без прав администратора).
        /// </summary>
        private void RegisterAutoStart()
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
