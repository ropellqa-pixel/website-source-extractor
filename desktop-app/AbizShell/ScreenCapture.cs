using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows;

namespace AbizShell
{
    /// <summary>
    /// Снимок всего экрана в JPEG (base64) — для команды «снимок экрана» с сайта.
    /// Экран уменьшается до ширины 1280 px, чтобы снимок был лёгким для передачи.
    /// </summary>
    public static class ScreenCapture
    {
        public static string? CaptureJpegBase64()
        {
            try
            {
                int w = (int)SystemParameters.PrimaryScreenWidth;
                int h = (int)SystemParameters.PrimaryScreenHeight;
                if (w <= 0 || h <= 0) return null;

                using var full = new Bitmap(w, h);
                using (var g = Graphics.FromImage(full))
                    g.CopyFromScreen(0, 0, 0, 0, new System.Drawing.Size(w, h));

                int targetW = Math.Min(1280, w);
                int targetH = (int)((long)h * targetW / w);
                using var scaled = new Bitmap(targetW, targetH);
                using (var g = Graphics.FromImage(scaled))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.DrawImage(full, 0, 0, targetW, targetH);
                }

                var codec = GetJpegCodec();
                using var ms = new MemoryStream();
                if (codec != null)
                {
                    using var p = new EncoderParameters(1);
                    p.Param[0] = new EncoderParameter(Encoder.Quality, 55L);
                    scaled.Save(ms, codec, p);
                }
                else
                {
                    scaled.Save(ms, ImageFormat.Jpeg);
                }
                return "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
            }
            catch
            {
                return null;
            }
        }

        private static ImageCodecInfo? GetJpegCodec()
        {
            foreach (var c in ImageCodecInfo.GetImageEncoders())
                if (c.FormatID == ImageFormat.Jpeg.Guid) return c;
            return null;
        }
    }
}
