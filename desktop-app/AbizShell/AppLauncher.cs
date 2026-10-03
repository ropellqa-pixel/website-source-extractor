using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using Microsoft.Win32;
using System.Windows.Threading;

namespace AbizShell
{
    /// <summary>
    /// Запуск программ Windows (Word, Excel, MAX, RuDesktop...) из меню кнопок.
    /// Раньше окно оболочки было «поверх всех», и запущенная программа открывалась ПОД ним —
    /// казалось, что ничего не запускается. Теперь оболочка обычное окно, а запущенная
    /// программа выводится на передний план.
    /// </summary>
    public static class AppLauncher
    {
        public static void Launch(string target, Window? owner = null)
        {
            target = (target ?? "").Trim().Trim('"');
            if (string.IsNullOrEmpty(target)) return;

            string? path = Resolve(target);
            if (path == null)
            {
                MessageBox.Show(owner ?? Application.Current.MainWindow,
                    $"Программа «{target}» не найдена на этом компьютере.\n\nАдминистратор может указать точный путь к .exe в редакторе кнопок (кнопка «Обзор»).",
                    "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            Process? proc;
            try
            {
                proc = Process.Start(new ProcessStartInfo(path)
                {
                    UseShellExecute = true,
                    WorkingDirectory = File.Exists(path) ? Path.GetDirectoryName(path) ?? "" : "",
                });
            }
            catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
            {
                return;
            }
            catch (Exception ex)
            {
                MessageBox.Show(owner ?? Application.Current.MainWindow,
                    $"Не удалось запустить «{target}»:\n{ex.Message}", "АБИЗ", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            BringUpWhenReady(proc, path);
        }

        /// <summary>Ждёт появления окна программы (до 15 секунд) и выводит его на передний план.</summary>
        private static void BringUpWhenReady(Process? proc, string path)
        {
            string exeName = Path.GetFileNameWithoutExtension(path);
            var before = WindowSwitcher.GetWindows().Select(w => w.Handle).ToHashSet();
            int attempts = 0;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
            timer.Tick += (s, e) =>
            {
                attempts++;
                IntPtr handle = IntPtr.Zero;
                try
                {
                    if (proc is { HasExited: false })
                    {
                        proc.Refresh();
                        handle = proc.MainWindowHandle;
                    }
                }
                catch { }

                if (handle == IntPtr.Zero)
                {
                    var fresh = WindowSwitcher.GetWindows().FirstOrDefault(w =>
                        !before.Contains(w.Handle) || string.Equals(w.ProcessName, exeName, StringComparison.OrdinalIgnoreCase));
                    if (fresh != null) handle = fresh.Handle;
                }

                if (handle != IntPtr.Zero)
                {
                    WindowSwitcher.BringToFront(handle);
                    timer.Stop();
                }
                else if (attempts >= 30)
                {
                    timer.Stop();
                }
            };
            timer.Start();
        }

        /// <summary>Ищет программу: полный путь, папка программы, PATH, «App Paths» в реестре.</summary>
        public static string? Resolve(string target)
        {
            if (target.Contains("://")) return target;
            string expanded = Environment.ExpandEnvironmentVariables(target);
            if (File.Exists(expanded)) return Path.GetFullPath(expanded);
            if (Path.IsPathRooted(expanded)) return null;

            string file = expanded.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || expanded.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)
                ? expanded : expanded + ".exe";

            foreach (var root in new[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                try
                {
                    using var key = root.OpenSubKey($@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{file}");
                    if (key?.GetValue("") is string p)
                    {
                        p = Environment.ExpandEnvironmentVariables(p.Trim('"'));
                        if (File.Exists(p)) return p;
                    }
                }
                catch { }
            }

            var dirs = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries)
                .Append(Environment.SystemDirectory)
                .Append(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
            foreach (var dir in dirs)
            {
                try
                {
                    string candidate = Path.Combine(dir.Trim(), file);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }

            string[] searchRoots =
            {
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
            };
            foreach (var root in searchRoots)
            {
                string? found = FindShallow(root, file, 3);
                if (found != null) return found;
            }
            return null;
        }

        private static string? FindShallow(string dir, string file, int depth)
        {
            if (string.IsNullOrEmpty(dir) || depth < 0 || !Directory.Exists(dir)) return null;
            try
            {
                string candidate = Path.Combine(dir, file);
                if (File.Exists(candidate)) return candidate;
                if (depth == 0) return null;
                foreach (var sub in Directory.EnumerateDirectories(dir))
                {
                    var found = FindShallow(sub, file, depth - 1);
                    if (found != null) return found;
                }
            }
            catch { }
            return null;
        }
    }
}