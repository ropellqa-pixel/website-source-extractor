using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace AbizShell
{
    /// <summary>
    /// Низкоуровневый глобальный перехватчик клавиатуры (WH_KEYBOARD_LL). Работает на
    /// уровне ОС ДО того, как клавиша попадёт в любое окно (включая WebView2), поэтому
    /// Tab/Space ловятся надёжно независимо от того, какой элемент в фокусе.
    /// Раньше использовался KeyInterop.KeyFromVirtualKey — на некоторых раскладках/
    /// локалях это могло давать несовпадающий Key, из-за чего Tab/Space не распознавались.
    /// Теперь сравниваем "сырые" virtual-key коды напрямую — надёжнее.
    /// </summary>
    public class KeyboardHook : IDisposable
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;

        public const int VK_TAB = 0x09;
        public const int VK_SPACE = 0x20;
        public const int VK_ESCAPE = 0x1B;
        public const int VK_LWIN = 0x5B;
        public const int VK_RWIN = 0x5C;
        public const int VK_F4 = 0x73;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string? lpModuleName);

        private IntPtr _hookID = IntPtr.Zero;
        private readonly LowLevelKeyboardProc _proc;

        /// <summary>Вызывается на каждое нажатие (vkCode, это Alt/системная комбинация). Вернуть true — проглотить нажатие.</summary>
        public Func<int, bool, bool>? KeyHandler;
        public bool BlockSystemKeys { get; set; } = true;

        public KeyboardHook()
        {
            _proc = HookCallback;
            _hookID = SetHook(_proc);
        }

        private IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using var curProcess = Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule;
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule?.ModuleName), 0);
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                bool isKeyDown = wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN;
                bool isSysKey = wParam == (IntPtr)WM_SYSKEYDOWN;

                if (isKeyDown && BlockSystemKeys)
                {
                    // Win, Alt+Tab, Alt+F4 — блокируем всегда, чтобы нельзя было свернуться в Windows.
                    if (vkCode == VK_LWIN || vkCode == VK_RWIN) return (IntPtr)1;
                    if (vkCode == VK_TAB && isSysKey) return (IntPtr)1;
                    if (vkCode == VK_F4 && isSysKey) return (IntPtr)1;
                }

                if (isKeyDown && KeyHandler != null && KeyHandler(vkCode, isSysKey))
                    return (IntPtr)1;
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        public void Dispose()
        {
            if (_hookID != IntPtr.Zero)
                UnhookWindowsHookEx(_hookID);
            _hookID = IntPtr.Zero;
            GC.SuppressFinalize(this);
        }
    }
}
