using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace AbizShell
{
    /// <summary>
    /// Загружает/сохраняет список кнопок киоска через data-api, таблица kiosk_buttons.
    /// Админ двигает кнопки в UI → нажимает «Сохранить порядок» → весь список целиком
    /// перезаписывается на сервере (сперва delete, потом insert), чтобы все ПК
    /// синхронно подтянули одинаковый порядок при следующей загрузке.
    /// </summary>
    public static class KioskButtonsService
    {
        /// <summary>Кнопки по умолчанию — показываются, пока сервер недоступен или таблица пуста.</summary>
        public static List<KioskButton> DefaultButtons() => new()
        {
            new KioskButton { Id = "b1",  Text = "Word",          Color = "#2B579A", Action = "app", Target = "winword.exe",                                            OrderIndex = 0 },
            new KioskButton { Id = "b2",  Text = "Excel",         Color = "#217346", Action = "app", Target = "excel.exe",                                              OrderIndex = 1 },
            new KioskButton { Id = "b3",  Text = "Престо:СБИС",   Color = "#4A6FA5", Action = "web", Target = "https://rest.saby.ru/",                                   OrderIndex = 2 },
            new KioskButton { Id = "b4",  Text = "Документы:СБИС",Color = "#4A6FA5", Action = "web", Target = "https://docs.saby.ru/",                                   OrderIndex = 3 },
            new KioskButton { Id = "b5",  Text = "СберБизнес",    Color = "#21A038", Action = "web", Target = "https://sbi.sberbank.ru/ic/ufs/login.html",               OrderIndex = 4 },
            new KioskButton { Id = "b6",  Text = "ДобрыйМаркет",  Color = "#FF6B35", Action = "web", Target = "https://xn--80aaagvebf1a2abbnndigx3d.xn--p1ai/catalog?point=9512300", OrderIndex = 5 },
            new KioskButton { Id = "b7",  Text = "Почта.Я",       Color = "#FFCC00", Action = "web", Target = "https://mail.yandex.ru/?uid=2230782010#/tabs/relevant",   OrderIndex = 6 },
            new KioskButton { Id = "b8",  Text = "MAX",           Color = "#8B5CF6", Action = "app", Target = "MAX.exe",                                                 OrderIndex = 7 },
            new KioskButton { Id = "b9",  Text = "RuDesktop",     Color = "#3B82F6", Action = "app", Target = "RuDesktop.exe",                                           OrderIndex = 8 },
            new KioskButton { Id = "b10", Text = "SabyPlugin",    Color = "#EC4899", Action = "app", Target = "SabyPlugin.exe",                                          OrderIndex = 9 },
            new KioskButton { Id = "b11", Text = "Отзывы",        Color = "#F59E0B", Action = "web", Target = "https://yandex.ru/maps/org/dorozhny/61274005529/reviews/?ll=42.389023%2C61.563074&z=15", OrderIndex = 10 },
        };

        public static async Task<List<KioskButton>> LoadAsync(AnodBizClient client)
        {
            try
            {
                var result = await client.QueryAsync(new
                {
                    table = "kiosk_buttons",
                    op = "select",
                    order = new { col = "order_index", ascending = true }
                });

                if (!result.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() == 0)
                    return DefaultButtons();

                var list = new List<KioskButton>();
                foreach (var item in data.EnumerateArray())
                {
                    list.Add(new KioskButton
                    {
                        Id = GetStr(item, "id"),
                        Text = GetStr(item, "text"),
                        Color = GetStr(item, "color"),
                        Action = GetStr(item, "action"),
                        Target = GetStr(item, "target"),
                        OrderIndex = GetInt(item, "order_index"),
                    });
                }
                return list;
            }
            catch
            {
                return DefaultButtons();
            }
        }

        /// <summary>Полностью перезаписывает список кнопок на сервере новым порядком.</summary>
        public static async Task<bool> SaveAsync(AnodBizClient client, List<KioskButton> buttons)
        {
            try
            {
                await client.QueryAsync(new
                {
                    table = "kiosk_buttons",
                    op = "delete",
                    filters = new[] { new { col = "order_index", op = "gte", value = 0 } }
                });

                var payload = buttons.Select((b, i) => new
                {
                    id = b.Id,
                    text = b.Text,
                    color = b.Color,
                    action = b.Action,
                    target = b.Target,
                    order_index = i,
                }).ToList();

                await client.QueryAsync(new { table = "kiosk_buttons", op = "insert", payload });
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string GetStr(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

        private static int GetInt(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.TryGetInt32(out var i) ? i : 0;
    }
}
