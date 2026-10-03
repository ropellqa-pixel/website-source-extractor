using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Фоновый агент удалённого управления. Запускается и на экране входа, и в рабочем столе.
    /// Каждые 4 секунды шлёт серверу heartbeat (программа онлайн + где она) и выполняет команды
    /// зам. директора: блокировка/разблокировка, сообщение на весь экран, снимок экрана,
    /// запуск RuDesktop, обновление страницы, выход сотрудника.
    /// </summary>
    public class RemoteAgent
    {
        private readonly DispatcherTimer _timer;
        private readonly string _apiToken;
        private RemoteOverlayWindow? _lockWindow;
        private RemoteOverlayWindow? _messageWindow;
        private bool _busy;
        private bool _disposed;

        /// <summary>"login" (экран пароля) или "working" (сотрудник в системе).</summary>
        public string Presence { get; set; } = "login";
        public string UserName { get; set; } = "";

        /// <summary>Вызывается при команде «Обновить» — перезагрузить страницу/программу.</summary>
        public Action? OnReload { get; set; }
        /// <summary>Вызывается при команде «Выход» — вернуть на экран входа.</summary>
        public Action? OnLogout { get; set; }
        /// <summary>Вызывается, если сервер сообщил, что устройство отвязано.</summary>
        public Action? OnRevoked { get; set; }

        public RemoteAgent(string apiToken)
        {
            _apiToken = apiToken ?? "";
            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
            _timer.Tick += async (s, e) => await TickAsync();
        }

        public void Start()
        {
            if (string.IsNullOrEmpty(_apiToken)) return;
            _timer.Start();
            _ = TickAsync();
        }

        public void Stop()
        {
            _disposed = true;
            _timer.Stop();
            CloseLock();
            _messageWindow?.Release();
            _messageWindow = null;
        }

        private async System.Threading.Tasks.Task TickAsync()
        {
            if (_busy || _disposed) return;
            _busy = true;
            try
            {
                var hb = await RemoteControlClient.HeartbeatAsync(_apiToken, Presence, UserName);
                if (_disposed) return;

                if (hb.Revoked) { OnRevoked?.Invoke(); return; }

                // Блокировка — стойкое состояние: держим окно, пока сервер его не снимет.
                if (hb.RemoteLock) ShowLock(hb.LockMessage);
                else CloseLock();

                foreach (var cmd in hb.Commands)
                    await HandleCommandAsync(cmd);
            }
            finally
            {
                _busy = false;
            }
        }

        private async System.Threading.Tasks.Task HandleCommandAsync(RemoteControlClient.Command cmd)
        {
            string result = "ok";
            string? screenshot = null;
            try
            {
                switch (cmd.Name)
                {
                    case "message":
                        ShowMessage(cmd.PayloadString("message") ?? "Сообщение от руководства");
                        break;
                    case "screenshot":
                        screenshot = ScreenCapture.CaptureJpegBase64();
                        result = screenshot != null ? "снимок сделан" : "не удалось сделать снимок";
                        break;
                    case "rudesktop":
                        result = LaunchRuDesktop();
                        break;
                    case "reload":
                        OnReload?.Invoke();
                        break;
                    case "logout":
                        OnLogout?.Invoke();
                        break;
                    case "lock":
                    case "unlock":
                        // Фактическое состояние блокировки приходит в RemoteLock — здесь ничего не делаем.
                        break;
                }
            }
            catch (Exception ex) { result = "ошибка: " + ex.Message; }
            await RemoteControlClient.ReportResultAsync(_apiToken, cmd.Id, result, screenshot);
        }

        private static string LaunchRuDesktop()
        {
            string[] candidates =
            {
                @"C:\Program Files\RuDesktop\RuDesktop.exe",
                @"C:\Program Files (x86)\RuDesktop\RuDesktop.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RuDesktop", "RuDesktop.exe"),
            };
            foreach (var path in candidates)
            {
                if (File.Exists(path))
                {
                    try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); return "RuDesktop запущен"; }
                    catch (Exception ex) { return "RuDesktop не запустился: " + ex.Message; }
                }
            }
            try { Process.Start(new ProcessStartInfo("RuDesktop.exe") { UseShellExecute = true }); return "RuDesktop запущен"; }
            catch { return "RuDesktop не установлен на этом ПК"; }
        }

        private void ShowLock(string? text)
        {
            if (_lockWindow != null) return;
            _lockWindow = new RemoteOverlayWindow();
            _lockWindow.ShowLock(text);
            _lockWindow.Show();
            _lockWindow.Activate();
        }

        private void CloseLock()
        {
            _lockWindow?.Release();
            _lockWindow = null;
        }

        private void ShowMessage(string text)
        {
            // Одно окно сообщения за раз — обновляем текст, если уже открыто.
            if (_messageWindow != null)
            {
                _messageWindow.ShowMessage(text);
                _messageWindow.Activate();
                return;
            }
            _messageWindow = new RemoteOverlayWindow();
            _messageWindow.ShowMessage(text);
            _messageWindow.Closed += (s, e) => _messageWindow = null;
            _messageWindow.Show();
            _messageWindow.Activate();
        }
    }
}
