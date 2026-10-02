namespace AbizShell
{
    /// <summary>
    /// Одна кнопка на главном экране киоска. Поле Action: "web" — открыть ссылку
    /// во встроенном браузере, "app" — запустить .exe (окно поверх браузера).
    /// Соответствует таблице kiosk_buttons на сервере (см. API.md, раздел про kiosk_buttons).
    /// </summary>
    public class KioskButton
    {
        public string Id { get; set; } = "";
        public string Text { get; set; } = "";
        public string Color { get; set; } = "#125499";
        public string Action { get; set; } = "web"; // "web" | "app"
        public string Target { get; set; } = "";
        public int OrderIndex { get; set; }
    }
}
