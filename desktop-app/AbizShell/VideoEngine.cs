using System;
using LibVLCSharp.Shared;

namespace AbizShell
{
    /// <summary>
    /// Встроенный видеодекодер (VLC). Один на всю программу: загружается при первом показе камеры.
    /// Декодирует H.265 сам — платное «Расширение для видео HEVC» из Microsoft Store не нужно.
    /// Если в компьютере есть видеокарта с поддержкой H.265, декодирование идёт на ней (меньше нагрузка).
    /// </summary>
    public static class VideoEngine
    {
        private static LibVLC? _libVlc;
        private static readonly object Lock = new();

        public static LibVLC Instance
        {
            get
            {
                lock (Lock)
                {
                    if (_libVlc != null) return _libVlc;
                    Core.Initialize();
                    _libVlc = new LibVLC(
                        "--no-video-title-show",
                        "--no-snapshot-preview",
                        "--no-osd",
                        "--no-stats",
                        "--avcodec-hw=any",
                        "--network-caching=1500",
                        "--live-caching=1500",
                        "--adaptive-logic=highest",
                        "--quiet");
                    return _libVlc;
                }
            }
        }

        public static MediaPlayer CreatePlayer()
        {
            return new MediaPlayer(Instance) { EnableHardwareDecoding = true, Mute = false };
        }

        public static Media CreateMedia(string url)
        {
            var media = new Media(Instance, new Uri(url));
            media.AddOption(":network-caching=1500");
            return media;
        }
    }
}
