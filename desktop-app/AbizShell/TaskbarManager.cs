using System;

namespace AbizShell
{
    /// <summary>
    /// Прячет панель задач Windows, пока работает оболочка АБИЗ (вместо неё — наша
    /// верхняя панель), и возвращает её при выходе. Панель переводится в режим
    /// автоскрытия, чтобы окна Word/Excel разворачивались на весь экран без пустой полосы снизу.
    /// </summary>
    public static class TaskbarManager
    {
        private static bool _hidden;
        private static int _originalState = -1;

        public static void Hide()
        {
            if (_hidden) return;
            try
            {
                var data = NewData();
                _originalState = (int)NativeMethods.SHAppBarMessage(NativeMethods.ABM_GETSTATE, ref data).ToUInt32();
                data.lParam = (IntPtr)NativeMethods.ABS_AUTOHIDE;
                NativeMethods.SHAppBarMessage(NativeMethods.ABM_SETSTATE, ref data);
                SetTrayVisible(false);
                _hidden = true;
            }
            catch { }
        }

        public static void Restore()
        {
            if (!_hidden) return;
            try
            {
                SetTrayVisible(true);
                var data = NewData();
                data.lParam = (IntPtr)(_originalState < 0 ? NativeMethods.ABS_ALWAYSONTOP : _originalState);
                NativeMethods.SHAppBarMessage(NativeMethods.ABM_SETSTATE, ref data);
            }
            catch { }
            _hidden = false;
        }

        private static NativeMethods.APPBARDATA NewData()
        {
            var data = new NativeMethods.APPBARDATA();
            data.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(data);
            data.hWnd = NativeMethods.FindWindow("Shell_TrayWnd", null);
            return data;
        }

        private static void SetTrayVisible(bool visible)
        {
            int cmd = visible ? NativeMethods.SW_SHOW : NativeMethods.SW_HIDE;
            var tray = NativeMethods.FindWindow("Shell_TrayWnd", null);
            if (tray != IntPtr.Zero) NativeMethods.ShowWindow(tray, cmd);
            var start = NativeMethods.FindWindow("Button", "Start");
            if (start != IntPtr.Zero) NativeMethods.ShowWindow(start, cmd);
            IntPtr second = IntPtr.Zero;
            while ((second = FindNext(second, "Shell_SecondaryTrayWnd")) != IntPtr.Zero)
                NativeMethods.ShowWindow(second, cmd);
        }

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string? title);

        private static IntPtr FindNext(IntPtr after, string cls) => FindWindowEx(IntPtr.Zero, after, cls, null);
    }
}
