using System;
using Microsoft.Win32;

namespace AbizShell
{
    /// <summary>
    /// Запрет выхода из АБИЗ без администратора (только редакция-киоск).
    /// Пока работает сотрудник, для его учётной записи Windows выключены: Диспетчер задач
    /// (в т.ч. через Ctrl+Alt+Del и Ctrl+Shift+Esc), окно «Выполнить», клавиши Win, редактор реестра
    /// и командная строка. Всё снимается, когда входит администратор (пароль на экране входа) или
    /// администратор выходит в Windows. Если программу закрыть насильно — запреты остаются.
    /// </summary>
    public static class KioskLock
    {
        private const string SysKey = @"Software\Microsoft\Windows\CurrentVersion\Policies\System";
        private const string ExpKey = @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";
        private const string CmdKey = @"Software\Policies\Microsoft\Windows\System";

        public static bool Applied { get; private set; }

        public static void Apply()
        {
            if (!Edition.Kiosk) return;
            Set(SysKey, "DisableTaskMgr", 1);
            Set(SysKey, "DisableRegistryTools", 1);
            Set(ExpKey, "NoRun", 1);
            Set(ExpKey, "NoWinKeys", 1);
            Set(CmdKey, "DisableCMD", 2);
            KeyboardHook.KioskAdmin = false;
            Applied = true;
        }

        public static void Release()
        {
            Del(SysKey, "DisableTaskMgr");
            Del(SysKey, "DisableRegistryTools");
            Del(ExpKey, "NoRun");
            Del(ExpKey, "NoWinKeys");
            Del(CmdKey, "DisableCMD");
            KeyboardHook.KioskAdmin = true;
            Applied = false;
        }

        private static void Set(string key, string name, int value)
        {
            try
            {
                using var k = Registry.CurrentUser.CreateSubKey(key, true);
                k?.SetValue(name, value, RegistryValueKind.DWord);
            }
            catch { }
        }

        private static void Del(string key, string name)
        {
            try
            {
                using var k = Registry.CurrentUser.OpenSubKey(key, true);
                k?.DeleteValue(name, false);
            }
            catch { }
        }
    }
}
