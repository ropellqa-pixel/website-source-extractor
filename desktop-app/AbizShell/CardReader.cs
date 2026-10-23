using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Threading;

namespace AbizShell
{
    public sealed class CardReader : IDisposable
    {
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int VK_RETURN = 0x0D;
        private const int VK_OEM_COMMA = 0xBC;
        private const int VK_OEM_PERIOD = 0xBE;
        private const int VK_DECIMAL = 0x6E;
        private const int GapMs = 60;
        private const int MinLength = 6;
        private const int MaxLength = 12;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string? lpModuleName);

        private readonly LowLevelKeyboardProc _proc;
        private readonly Dispatcher _dispatcher;
        private readonly StringBuilder _buffer = new();
        private IntPtr _hookId = IntPtr.Zero;
        private long _lastTick;
        private bool _slow;

        public event Action<string>? CardRead;

        public static long LastCardTick { get; private set; }

        public static bool JustRead(int withinMs = 700) => LastCardTick > 0 && Environment.TickCount64 - LastCardTick < withinMs;

        public bool OnlyWhenOwnProcessForeground { get; set; } = true;

        private static CardReader? _current;

        public static void DisposeCurrent() => _current?.Dispose();

        public CardReader(Dispatcher dispatcher)
        {
            _current?.Dispose();
            _current = this;
            _dispatcher = dispatcher;
            _proc = HookCallback;
            using var curProcess = Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule;
            _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule?.ModuleName), 0);
        }

        private static char? MapKey(int vk)
        {
            if (vk >= 0x30 && vk <= 0x39) return (char)('0' + (vk - 0x30));
            if (vk >= 0x60 && vk <= 0x69) return (char)('0' + (vk - 0x60));
            if (vk >= 0x41 && vk <= 0x46) return (char)('A' + (vk - 0x41));
            if (vk == VK_OEM_COMMA || vk == VK_OEM_PERIOD || vk == VK_DECIMAL) return ',';
            return null;
        }

        private void Reset()
        {
            _buffer.Clear();
            _slow = false;
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
                    HandleKey(Marshal.ReadInt32(lParam));
            }
            catch { }
            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        private void HandleKey(int vk)
        {
            long now = Environment.TickCount64;
            long gap = now - _lastTick;
            _lastTick = now;

            if (vk == VK_RETURN)
            {
                string raw = _buffer.ToString();
                bool ok = !_slow && gap < GapMs && raw.Length >= MinLength && raw.Length <= MaxLength;
                Reset();
                if (!ok) return;
                if (OnlyWhenOwnProcessForeground && !NativeMethods.IsOwnProcessForeground()) return;
                LastCardTick = now;
                _dispatcher.BeginInvoke(new Action(() => CardRead?.Invoke(raw)));
                return;
            }

            char? c = MapKey(vk);
            if (c == null)
            {
                if (vk == 0x10 || vk == 0xA0 || vk == 0xA1) return;
                Reset();
                return;
            }

            if (_buffer.Length == 0 || gap >= GapMs)
            {
                Reset();
                _buffer.Append(c.Value);
                return;
            }

            if (_buffer.Length >= MaxLength + 1) { _slow = true; return; }
            _buffer.Append(c.Value);
        }

        public static bool LooksLikeCard(string raw)
        {
            if (string.IsNullOrEmpty(raw) || raw.Length < MinLength || raw.Length > MaxLength) return false;
            foreach (char ch in raw)
                if (!(char.IsDigit(ch) || (ch >= 'A' && ch <= 'F') || (ch >= 'a' && ch <= 'f') || ch == ','))
                    return false;
            return true;
        }

        public void Dispose()
        {
            CardRead = null;
            if (_hookId != IntPtr.Zero)
                UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
            if (ReferenceEquals(_current, this)) _current = null;
        }
    }
}