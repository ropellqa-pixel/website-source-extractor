using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace AbizShell
{
    /// <summary>Открытое окно другой программы (Word, Excel, MAX...) для переключателя окон.</summary>
    public record OpenWindow(IntPtr Handle, string Title, int ProcessId, string ProcessName);

    /// <summary>
    /// Переключатель окон вместо Alt+Tab (он заблокирован). Перечисляет обычные окна
    /// других программ и выводит выбранное на передний план.
    /// </summary>
    public static class WindowSwitcher
    {
        private static readonly HashSet<string> IgnoredClasses = new(StringComparer.OrdinalIgnoreCase)
        {
            "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
        };

        public static List<OpenWindow> GetWindows()
        {
            var result = new List<OpenWindow>();
            int ownPid = Environment.ProcessId;
            NativeMethods.EnumWindows((h, _) =>
            {
                try
                {
                    if (!NativeMethods.IsWindowVisible(h)) return true;
                    if (NativeMethods.GetWindow(h, NativeMethods.GW_OWNER) != IntPtr.Zero) return true;
                    long ex = NativeMethods.GetWindowLongPtr(h, NativeMethods.GWL_EXSTYLE).ToInt64();
                    if ((ex & NativeMethods.WS_EX_TOOLWINDOW) != 0) return true;
                    if (NativeMethods.DwmGetWindowAttribute(h, NativeMethods.DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
                    if (IgnoredClasses.Contains(NativeMethods.GetClass(h))) return true;
                    string title = NativeMethods.GetText(h);
                    if (string.IsNullOrWhiteSpace(title)) return true;
                    NativeMethods.GetWindowThreadProcessId(h, out uint pid);
                    if (pid == ownPid) return true;
                    string name = "";
                    try { using var p = Process.GetProcessById((int)pid); name = p.ProcessName; } catch { }
                    result.Add(new OpenWindow(h, title, (int)pid, name));
                }
                catch { }
                return true;
            }, IntPtr.Zero);
            return result;
        }

        public static void BringToFront(IntPtr handle)
        {
            if (handle == IntPtr.Zero) return;
            if (NativeMethods.IsIconic(handle))
                NativeMethods.ShowWindow(handle, NativeMethods.SW_RESTORE);
            else
                NativeMethods.ShowWindow(handle, NativeMethods.SW_SHOW);
            NativeMethods.BringWindowToTop(handle);
            NativeMethods.SetForegroundWindow(handle);
        }

        public static void Close(IntPtr handle) =>
            NativeMethods.PostMessage(handle, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }
}
