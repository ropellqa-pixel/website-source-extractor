namespace AbizShell
{
    /// <summary>
    /// Адреса сервера. Сайт — saou.ru, функции сервера — напрямую на poehali.dev
    /// (на время технических работ на bizwor.ru / Beget).
    /// </summary>
    public static class ServerConfig
    {
        public const string Site = "https://saou.ru";
        public const string HomePage = Site + "/";

        public const string DataApi = "https://functions.poehali.dev/e40aca0d-1c72-49c0-84a1-cf57b44984ec";
        public const string AuthApi = "https://functions.poehali.dev/0cc75331-123f-465b-a6da-01ba5f142bfa";
        public const string DeviceControlApi = "https://functions.poehali.dev/f01f3da3-3368-428a-919d-fe5933bc5ab8";
        public const string SkudApi = "https://functions.poehali.dev/150e30dd-bd2d-45c5-8db8-a4055bf55fd9";
        public const string CamerasApi = "https://functions.poehali.dev/246cb9d5-b997-40d1-8f46-082cafe7879e";
    }
}
