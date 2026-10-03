namespace AbizShell
{
    /// <summary>
    /// Какая программа собрана из этого кода.
    /// АБИЗ — киоск: на весь экран, автозапуск, скрытая панель задач, блокировка системных клавиш.
    /// АБИЗ-Админ — обычная программа Windows: окно с рамкой, без автозапуска и без блокировок.
    /// Выбирается конфигурацией сборки (Release / ReleaseAdmin), см. AbizShell.csproj.
    /// </summary>
    public static class Edition
    {
#if ABIZ_ADMIN
        public static readonly bool Admin = true;
        public static readonly string Name = "АБИЗ-Админ";
        public static readonly string MutexName = "AbizAdmin_SingleInstance_5C1D9E";
#else
        public static readonly bool Admin = false;
        public static readonly string Name = "АБИЗ";
        public static readonly string MutexName = "AbizShell_SingleInstance_8F2A1C";
#endif
        public static bool Kiosk => !Admin;
    }
}
