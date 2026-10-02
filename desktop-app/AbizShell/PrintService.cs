using System;
using System.Collections.Generic;
using System.Printing;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AbizShell
{
    /// <summary>
    /// Печать содержимого встроенного браузера (WebView2). WebView2 имеет собственный
    /// полнофункциональный диалог печати (выбор принтера, число копий, ориентация,
    /// диапазон страниц, масштаб, печать в PDF) — это тот же движок, что в Chrome/Edge,
    /// поэтому переиспользуем его напрямую, а не рисуем печать "вручную" через FixedDocument
    /// (это не позволило бы распечатать реальную страницу сайта или открытый PDF).
    /// </summary>
    public static class PrintService
    {
        /// <summary>Открыть системный диалог печати Windows (с выбором принтера и всеми настройками) для текущей страницы.</summary>
        public static void PrintSystemDialog(WebView2 browser)
        {
            try
            {
                browser.CoreWebView2?.ShowPrintUI(CoreWebView2PrintDialogKind.System);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось открыть печать: " + ex.Message, "АБИЗ — печать",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        /// <summary>Встроенный (браузерный) диалог печати WebView2 — быстрее открывается, тоже с полными настройками.</summary>
        public static void PrintBrowserDialog(WebView2 browser)
        {
            try
            {
                browser.CoreWebView2?.ShowPrintUI(CoreWebView2PrintDialogKind.Browser);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось открыть печать: " + ex.Message, "АБИЗ — печать",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        /// <summary>Список установленных в Windows принтеров — показывается в собственном меню печати программы.</summary>
        public static List<string> GetInstalledPrinters()
        {
            var result = new List<string>();
            try
            {
                using var server = new PrintServer();
                foreach (var q in server.GetPrintQueues())
                    result.Add(q.Name);
            }
            catch { }
            return result;
        }
    }
}
