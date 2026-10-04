using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using LibVLCSharp.Shared;
using MediaPlayer = LibVLCSharp.Shared.MediaPlayer;

namespace AbizShell
{
    /// <summary>
    /// Вывод видео VLC прямо в картинку WPF (без отдельного системного окна).
    /// Раньше VLC рисовал в собственное окно и при переподключении или скрытой плитке
    /// создавал новые окна — отсюда «сотни окон камер». Теперь кадры копируются в Image,
    /// лишних окон не бывает в принципе. Декодирование H.265 по-прежнему аппаратное, если есть.
    /// </summary>
    public sealed class VlcSurface : IDisposable
    {
        private readonly Image _target;
        private readonly int _maxWidth;
        private readonly Dispatcher _dispatcher;
        private readonly object _sync = new();

        private readonly MediaPlayer.LibVLCVideoFormatCb _formatCb;
        private readonly MediaPlayer.LibVLCVideoCleanupCb _cleanupCb;
        private readonly MediaPlayer.LibVLCVideoLockCb _lockCb;
        private readonly MediaPlayer.LibVLCVideoUnlockCb _unlockCb;
        private readonly MediaPlayer.LibVLCVideoDisplayCb _displayCb;

        private IntPtr _buffer = IntPtr.Zero;
        private byte[]? _frame;
        private int _width, _height, _pitch;
        private WriteableBitmap? _bitmap;
        private bool _framePending;
        private bool _disposed;

        public MediaPlayer Player { get; }
        public event Action? FirstFrame;
        private bool _gotFrame;

        public VlcSurface(Image target, int maxWidth = 1920)
        {
            _target = target;
            _maxWidth = maxWidth;
            _dispatcher = target.Dispatcher;
            Player = VideoEngine.CreatePlayer();

            _formatCb = OnFormat;
            _cleanupCb = OnCleanup;
            _lockCb = OnLock;
            _unlockCb = OnUnlock;
            _displayCb = OnDisplay;
            Player.SetVideoFormatCallbacks(_formatCb, _cleanupCb);
            Player.SetVideoCallbacks(_lockCb, _unlockCb, _displayCb);
        }

        public void Play(string url)
        {
            if (_disposed) return;
            _gotFrame = false;
            using var media = VideoEngine.CreateMedia(url);
            Player.Play(media);
        }

        private uint OnFormat(ref IntPtr opaque, IntPtr chroma, ref uint width, ref uint height, ref uint pitches, ref uint lines)
        {
            Marshal.Copy(new byte[] { (byte)'R', (byte)'V', (byte)'3', (byte)'2' }, 0, chroma, 4);
            if (width > _maxWidth)
            {
                height = (uint)Math.Max(2, (long)height * _maxWidth / width) & ~1u;
                width = (uint)_maxWidth;
            }
            int w = (int)width, h = (int)height, pitch = w * 4;
            pitches = (uint)pitch;
            lines = (uint)h;

            lock (_sync)
            {
                if (_buffer != IntPtr.Zero) Marshal.FreeHGlobal(_buffer);
                _buffer = Marshal.AllocHGlobal(pitch * h);
                _frame = new byte[pitch * h];
                _width = w; _height = h; _pitch = pitch;
            }
            _dispatcher.BeginInvoke(() =>
            {
                if (_disposed) return;
                _bitmap = new WriteableBitmap(w, h, 96, 96, PixelFormats.Bgr32, null);
                _target.Source = _bitmap;
            });
            return 1;
        }

        private void OnCleanup(ref IntPtr opaque) { }

        private IntPtr OnLock(IntPtr opaque, IntPtr planes)
        {
            Marshal.WriteIntPtr(planes, _buffer);
            return IntPtr.Zero;
        }

        private void OnUnlock(IntPtr opaque, IntPtr picture, IntPtr planes) { }

        private void OnDisplay(IntPtr opaque, IntPtr picture)
        {
            lock (_sync)
            {
                if (_disposed || _frame == null || _buffer == IntPtr.Zero) return;
                Marshal.Copy(_buffer, _frame, 0, _frame.Length);
                if (_framePending) return;
                _framePending = true;
            }
            _dispatcher.BeginInvoke(DispatcherPriority.Render, new Action(DrawFrame));
        }

        private void DrawFrame()
        {
            lock (_sync)
            {
                _framePending = false;
                if (_disposed || _bitmap == null || _frame == null) return;
                if (_bitmap.PixelWidth != _width || _bitmap.PixelHeight != _height) return;
                _bitmap.WritePixels(new Int32Rect(0, 0, _width, _height), _frame, _pitch, 0);
            }
            if (!_gotFrame) { _gotFrame = true; FirstFrame?.Invoke(); }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            var player = Player;
            Task.Run(() =>
            {
                try { player.Stop(); } catch { }
                try { player.Dispose(); } catch { }
                lock (_sync)
                {
                    if (_buffer != IntPtr.Zero) { Marshal.FreeHGlobal(_buffer); _buffer = IntPtr.Zero; }
                    _frame = null;
                }
            });
        }
    }
}
