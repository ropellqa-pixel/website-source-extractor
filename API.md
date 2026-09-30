# АнодБИЗ — памятка по API для десктоп-приложения (C#)

Этот документ — всё, что нужно, чтобы твоя программа на C#/WPF читала и писала данные
компании напрямую на сервер `anod.saou.ru`, без браузера.

## 1. Базовые адреса

| Функция | Назначение | URL |
|---|---|---|
| `auth-api` | Вход, токены, устройства | `https://functions.poehali.dev/0cc75331-123f-465b-a6da-01ba5f142bfa` |
| `data-api` | Все данные (CRUD) | `https://functions.poehali.dev/e40aca0d-1c72-49c0-84a1-cf57b44984ec` |
| `file-upload` | Загрузка файлов | `https://functions.poehali.dev/5250ef3b-f3ae-4031-9d3c-2ca46f38a8bc` |

Все запросы — `POST`, `Content-Type: application/json`. Ответ всегда JSON.

## 2. Авторизация

У каждого сотрудника есть **постоянный API-токен** (не истекает, пока не отозван).
Взять его: **Настройки → Безопасность → «Доступ для десктоп-приложения»** на сайте.

Токен передаётся в заголовке `X-Authorization` при обращении к `data-api` и `file-upload`:

```csharp
using var http = new HttpClient();
http.DefaultRequestHeaders.Add("X-Authorization", apiToken);
```

Права по токену = права сотрудника на сайте. Токен директора видит всё, токен обычного
сотрудника — только то, что видно ему в интерфейсе (ограничений на уровне API пока нет,
разграничение сделано на уровне того, что показывает сама программа).

⚠️ Без действующего токена `data-api` и `file-upload` отвечают `401 Unauthorized`.

## 3. Универсальный способ работать с данными: `data-api`

Один и тот же эндпоинт обслуживает ВСЕ таблицы. Тело запроса:

```json
{
  "table": "имя_таблицы",
  "op": "select | insert | update | delete",
  "filters": [ {"col": "поле", "op": "eq", "value": "значение"} ],
  "order": {"col": "поле", "ascending": true},
  "limit": 50,
  "single_mode": "single | maybe",
  "payload": { }
}
```

### Операторы фильтров (`filters[].op`)

| op | Смысл | Пример |
|---|---|---|
| `eq` | равно | `{"col":"id","op":"eq","value":"123"}` |
| `neq` | не равно | |
| `in` | входит в список | `{"col":"role","op":"in","value":["director","deputy_director"]}` |
| `is` | IS NULL / IS значение | `{"col":"profile_id","op":"is","value":null}` |
| `gt` / `gte` / `lt` / `lte` | больше / больше-равно / меньше / меньше-равно | для чисел и дат |
| `ilike` | частичное совпадение, регистр не важен | `{"col":"full_name","op":"ilike","value":"%иванов%"}` |

### Ответ

```json
{ "data": [...] или {...} или null, "error": null или {"message": "..."} }
```

## 4. C# — базовый клиент

```csharp
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

public class AnodBizClient
{
    private readonly HttpClient _http;
    private const string DataApiUrl = "https://functions.poehali.dev/e40aca0d-1c72-49c0-84a1-cf57b44984ec";

    public AnodBizClient(string apiToken)
    {
        _http = new HttpClient();
        _http.DefaultRequestHeaders.Add("X-Authorization", apiToken);
    }

    public async Task<JsonElement> QueryAsync(object body)
    {
        var response = await _http.PostAsJsonAsync(DataApiUrl, body);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json;
    }

    // Пример: найти сотрудников по имени
    public async Task<JsonElement> SearchEmployeesAsync(string query)
    {
        return await QueryAsync(new
        {
            table = "profiles",
            op = "select",
            filters = new[] { new { col = "full_name", op = "ilike", value = $"%{query}%" } }
        });
    }

    // Пример: создать документ
    public async Task<JsonElement> CreateDocumentAsync(string title, string content, string author)
    {
        return await QueryAsync(new
        {
            table = "documents",
            op = "insert",
            payload = new { title, content, author }
        });
    }
}
```

## 5. Полный список таблиц

### `companies` — компания (одна запись `id='main'`)
| Поле | Тип | Описание |
|---|---|---|
| id | text | всегда `'main'` |
| name | text | название компании |
| inn | text | ИНН |
| ogrn | text | ОГРН |
| type | text | `ООО` / `ИП` |
| created_at | timestamptz | |

### `profiles` — сотрудники ★ главная таблица для поиска людей
| Поле | Тип | Описание |
|---|---|---|
| id | text | ID профиля (PRIMARY KEY) |
| user_id | text | ссылка на `auth_users.id`, может быть NULL (ещё нет входа) |
| full_name | text | ФИО |
| email | text | почта |
| role | text | `director` / `deputy_director` / `senior_employee` / `employee` |
| department | text | отдел |
| status | text | `active` / `inactive` |
| has_system_access | boolean | есть ли доступ ко входу |
| vk_id, vk_link | text | привязка VK |
| created_at | timestamptz | |

**Поиск сотрудника по имени:**
```csharp
var result = await client.QueryAsync(new {
    table = "profiles", op = "select",
    filters = new[] { new { col = "full_name", op = "ilike", value = "%петров%" } }
});
```

**Поиск по отделу и роли одновременно:**
```json
{"table":"profiles","op":"select","filters":[
  {"col":"department","op":"eq","value":"IT"},
  {"col":"role","op":"in","value":["senior_employee","employee"]}
]}
```

### `auth_users` — учётные записи (НЕ в белом списке data-api, доступ только через auth-api)

### `pin_codes` — PIN-коды быстрого входа
| Поле | Тип | Описание |
|---|---|---|
| id | text | |
| user_id | text | |
| pin | varchar(4) | 4 цифры |
| email | text | |
| shortcut_code | text | |
| adpod_slug | text | адресный поддомен входа |

### `devices` — устройства (ПК с программой) — см. раздел 7

### `schedule_data` — табель, смены по месяцам
| Поле | Тип | Описание |
|---|---|---|
| id, month_year, profile_id | text | |
| shifts | jsonb | массив смен `["Д","Н","",...]` по дням месяца |
| user_id | text | |

### `schedule_config` — настройки графика сотрудника (переносимые каждый месяц)
Поля: `profile_id`, `no_day`, `no_night`, `break_days`, `priority`, `status`, `preferences`,
`excluded`, `st_no_day/night`, `ml_no_day/night`, `delays`, `unavailable`.

### `employee_schedule_settings` — разовые ограничения на конкретный месяц
Поля: `profile_id`, `month_year`, `delay`, `unavailable`.

### `schedule_settings` — глобальные настройки табеля (ответственный, блокировка)
Поля: `month_year` (NULL = глобальные), `is_locked`, `responsible_profile_id`.

### `salary_data` — зарплата по месяцам
Поля: `profile_id`, `hours_worked`, `revenue`, `days_in_month`, `vacation_pay`,
`non_cash`, `overtime`, `tax`, `underpayment`, `month_year`, `responsible_user_id`, `user_id`.

### `salary_settings` — глобальные настройки зарплаты
Поля: `month_year`, `percent`, `is_locked`, `responsible_profile_id`, `revenue`, `days_in_month`.

### `manager_data` / `manager_settings` — зарплата управляющих (аналогично salary_*)
Поля `manager_data`: `profile_id`, `osn_hours`, `dop_hours`, `doplaty`, `vacation_pay`,
`non_cash`, `underpayment`, `hourly_rate`, `month_year`, `user_id`.
Поля `manager_settings`: `month_year`, `manager_percent`, `is_locked`, `responsible_profile_id`.

### `employee_rotation` — ротация сотрудников по точкам
Поля: `profile_id`, `position`, `store_name`, `active`.

### `collection_data` — инкассация
Поля: `shift_date`, `shift_type`, `sbis_value`, `fact_value`, `status`,
`responsible_person`, `month_year`, `locked`.

### `documents` — документы
Поля: `id`, `title`, `content`, `author`, `tags` (jsonb-массив), `created_at`, `updated_at`.

### `folders` — папки базы документов
Поля: `id`, `name`, `parent_id` (для вложенности).

### `base_files` — файлы в базе документов
Поля: `id`, `name`, `type`, `size`, `folder_id`, `uploaded_by`, `uploaded_at`,
`is_protected`, `url` (ссылка CDN, получена через `file-upload`).

### `dto_categories` / `dto_templates` — шаблоны договоров
`dto_templates`: `id`, `name`, `category_id`, `content`, `description`, `usage_count`.

### `chat_rooms` / `chat_messages` — общий чат «РАБОЧИЙ»
`chat_messages`: `id`, `room_id`, `sender_id`, `sender_name`, `content`, `read`, `created_at`.

## 6. Загрузка файлов (`file-upload`)

```csharp
var fileBytes = File.ReadAllBytes("отчёт.pdf");
var base64 = Convert.ToBase64String(fileBytes);

var body = new {
    file_base64 = base64,
    file_name = "отчёт.pdf",
    content_type = "application/pdf",
    folder = "documents"
};
var request = new HttpRequestMessage(HttpMethod.Post, fileUploadUrl);
request.Headers.Add("X-Authorization", apiToken);
request.Content = JsonContent.Create(body);
var response = await http.SendAsync(request);
// ответ: { "url": "https://cdn.poehali.dev/..." }
```

Загруженную ссылку затем сохраняешь в `base_files.url` через обычный `insert` в `data-api`.

## 7. Устройства (9-значный код ПК) — привязка программы к сотруднику

Логика: программа при первой установке на новом компьютере сама регистрируется на
сервере и получает уникальный **9-значный код**. Директор в личном кабинете сайта
(**Сотрудники → Устройства**) вводит этот код и привязывает его к конкретному сотруднику —
при необходимости сразу задавая ему пароль для входа, если учётной записи ещё нет.
После привязки сервер выдаёт **отдельный постоянный токен именно для этого ПК** — можно
отозвать доступ одному компьютеру, не трогая остальные.

Все действия — через `auth-api` (не `data-api`!), `action` в теле запроса.

### 7.1. Регистрация нового устройства (один раз при первом запуске программы)

```json
POST auth-api
{ "action": "register_device", "hostname": "BUHGALTERIA-PC-01" }
```
Ответ: `{ "device_code": "483920175" }`

Сохрани `device_code` локально (реестр Windows или файл настроек) и покажи его
в углу окна программы — например: `Код устройства: 483-920-175`.

### 7.2. Периодический опрос: привязали ли уже код? (пока не привязан)

```json
POST auth-api
{ "action": "device_status", "device_code": "483920175" }
```
Ответ пока не привязан: `{ "status": "pending" }`
Ответ после привязки: `{ "status": "linked", "api_token": "anod_xxxxxxxx..." }`

C# — пример опроса раз в 5 секунд до получения токена:

```csharp
public async Task<string> WaitForLinkAsync(string deviceCode)
{
    while (true)
    {
        var resp = await http.PostAsJsonAsync(authApiUrl, new {
            action = "device_status", device_code = deviceCode
        });
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        if (json.GetProperty("status").GetString() == "linked")
            return json.GetProperty("api_token").GetString();
        await Task.Delay(5000);
    }
}
```

Как только получен `api_token` — сохрани его (например, в Windows Credential Manager
или зашифрованный файл) и используй как обычный `X-Authorization` для всех дальнейших
запросов к `data-api` / `file-upload`.

### 7.3. Привязка устройства (делает директор через сайт, НЕ через программу)

Это происходит на сайте (**Сотрудники → Устройства → Привязать**), но для справки —
как выглядит запрос:
```json
POST auth-api  (требует сессии директора)
{ "action": "link_device", "device_code": "483920175", "profile_id": "...", "password": "необязательно" }
```
`password` обязателен только если у сотрудника ещё нет учётной записи для входа.

### 7.4. Список устройств и отзыв доступа (тоже действия сайта, для справки)

```json
{ "action": "list_devices" }               // требует сессии
{ "action": "revoke_device", "device_code": "483920175" }  // требует сессии
```

## 8. Если нужна новая таблица

Список разрешённых таблиц — фиксированный белый список на сервере (защита от ошибок
и случайной порчи данных). Если для твоей программы нужно хранить что-то новое —
просто скажи какие поля нужны, и таблицу добавят в API за несколько минут.

## 9. Коды ошибок

| Код | Значение |
|---|---|
| 200 | успех (даже если `data: null` — смотри `error`) |
| 401 | нет токена или токен недействителен/отозван |
| 400 | некорректный запрос (не хватает обязательного поля) |
| 404 | не найдено (например, `device_status` для несуществующего кода) |
| 500 | внутренняя ошибка сервера |
