using System;
using System.Windows;

namespace AbizShell
{
    /// <summary>
    /// Рабочая область экрана для АБИЗ (киоск). Раньше верхняя панель регистрировалась в Windows
    /// как «панель экрана» при каждом входе; если старая регистрация не снималась, Windows
    /// резервировал место ещё раз — экраны «съезжали» вниз всё сильнее. Теперь область задаётся
    /// напрямую и всегда одинаково: весь экран минус ровно одна полоса панели сверху.
    /// </summary>
    public static class ScreenArea
    {
        private static int ScreenW => NativeMethods.GetSystemMetrics(0);
        private static int ScreenH => NativeMethods.GetSystemMetrics(1);

        /// <summary>Оставить сверху полосу под панель АБИЗ (в физических пикселях).</summary>
        public static void ReserveTop(int heightPx)
        {
            var rc = new NativeMethods.RECT { left = 0, top = heightPx, right = ScreenW, bottom = ScreenH };
            try { NativeMethods.SystemParametersInfo(NativeMethods.SPI_SETWORKAREA, 0, ref rc, NativeMethods.SPIF_SENDCHANGE); } catch { }
        }

        /// <summary>Весь экран свободен (экран входа, выход в Windows).</summary>
        public static void Reset()
        {
            var rc = new NativeMethods.RECT { left = 0, top = 0, right = ScreenW, bottom = ScreenH };
            try { NativeMethods.SystemParametersInfo(NativeMethods.SPI_SETWORKAREA, 0, ref rc, NativeMethods.SPIF_SENDCHANGE); } catch { }
        }

        /// <summary>Окно на весь экран без рамки — точно по границам монитора, без отступов.</summary>
        public static void CoverScreen(Window w)
        {
            w.WindowState = WindowState.Normal;
            w.WindowStyle = WindowStyle.None;
            w.ResizeMode = ResizeMode.NoResize;
            w.Left = 0;
            w.Top = 0;
            w.Width = SystemParameters.PrimaryScreenWidth;
            w.Height = SystemParameters.PrimaryScreenHeight;
        }
    }
}
