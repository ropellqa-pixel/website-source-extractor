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
            Set(SysKey, "DisableLockWorkstation", 1);
            Set(SysKey, "DisableChangePassword", 1);
            Set(ExpKey, "NoLogoff", 1);
            Set(ExpKey, "NoClose", 1);
            Set(ExpKey, "NoControlPanel", 1);
            Set(ExpKey, "DisallowRun", 1);
            try
            {
                using var k = Registry.CurrentUser.CreateSubKey(ExpKey + @"\DisallowRun", true);
                string[] deny = { "cmd.exe", "powershell.exe", "pwsh.exe", "powershell_ise.exe", "regedit.exe", "taskmgr.exe", "mmc.exe", "wscript.exe", "cscript.exe", "mshta.exe", "control.exe" };
                for (int i = 0; i < deny.Length; i++) k?.SetValue((i + 1).ToString(), deny[i], RegistryValueKind.String);
            }
            catch { }
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
            Del(SysKey, "DisableLockWorkstation");
            Del(SysKey, "DisableChangePassword");
            Del(ExpKey, "NoLogoff");
            Del(ExpKey, "NoClose");
            Del(ExpKey, "NoControlPanel");
            Del(ExpKey, "DisallowRun");
            try { Registry.CurrentUser.DeleteSubKeyTree(ExpKey + @"\DisallowRun", false); } catch { }
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
