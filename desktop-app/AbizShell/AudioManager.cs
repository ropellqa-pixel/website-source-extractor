using System;
using System.Runtime.InteropServices;

namespace AbizShell
{
    /// <summary>
    /// Громкость и звук Windows (основное устройство вывода) через стандартный Core Audio API.
    /// Без сторонних библиотек. Если звуковой карты нет — методы просто ничего не делают.
    /// </summary>
    public static class AudioManager
    {
        public static bool IsAvailable => GetEndpoint() != null;

        /// <summary>Громкость 0..100 или -1, если устройство недоступно.</summary>
        public static int GetVolume()
        {
            var ep = GetEndpoint();
            if (ep == null) return -1;
            try { ep.GetMasterVolumeLevelScalar(out float v); return (int)Math.Round(v * 100); }
            catch { return -1; }
            finally { Marshal.ReleaseComObject(ep); }
        }

        public static void SetVolume(int percent)
        {
            var ep = GetEndpoint();
            if (ep == null) return;
            try
            {
                var ctx = Guid.Empty;
                ep.SetMasterVolumeLevelScalar(Math.Clamp(percent, 0, 100) / 100f, ref ctx);
                if (percent > 0) ep.SetMute(false, ref ctx);
            }
            catch { }
            finally { Marshal.ReleaseComObject(ep); }
        }

        public static bool GetMute()
        {
            var ep = GetEndpoint();
            if (ep == null) return false;
            try { ep.GetMute(out bool m); return m; }
            catch { return false; }
            finally { Marshal.ReleaseComObject(ep); }
        }

        public static void SetMute(bool mute)
        {
            var ep = GetEndpoint();
            if (ep == null) return;
            try { var ctx = Guid.Empty; ep.SetMute(mute, ref ctx); }
            catch { }
            finally { Marshal.ReleaseComObject(ep); }
        }

        private static IAudioEndpointVolume? GetEndpoint()
        {
            try
            {
                var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
                try
                {
                    if (enumerator.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out var device) != 0 || device == null)
                        return null;
                    try
                    {
                        var iid = typeof(IAudioEndpointVolume).GUID;
                        if (device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out object o) != 0) return null;
                        return o as IAudioEndpointVolume;
                    }
                    finally { Marshal.ReleaseComObject(device); }
                }
                finally { Marshal.ReleaseComObject(enumerator); }
            }
            catch { return null; }
        }

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        private class MMDeviceEnumeratorCom { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object anInterface);
        }

        [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioEndpointVolume
        {
            [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int GetChannelCount(out uint count);
            [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
            [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
            [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
            [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
            [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
            [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
            [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
            [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
            [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
            [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        }
    }
}
