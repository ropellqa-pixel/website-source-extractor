# АнодБИЗ — полный справочник разработчика: как работает каждая функция

Версия 1.0 · 18.10.2026. Дополнение к основному ТЗ (`docs/TZ-AnodBIZ.md`).

Документ составлен по исходному коду и описывает, **как система работает сейчас**: для каждой команды каждой серверной функции — кто может вызвать, входные данные, проверки и тексты ошибок, логика по шагам, таблицы, ответ и побочные эффекты; для каждой страницы — пошаговое поведение интерфейса; для программы Windows — классы, потоки и команды. Номера строк (`файл:строка`) указаны на дату составления.

Пароли, PIN-коды и ключи, найденные в коде, в документе заменены на `<…>` — смотрите их в исходниках.

## Содержание

0. Сводка проблем безопасности (приоритет исправления)
1. Вход, данные, файлы, ВКонтакте (auth-api, data-api, file-upload, vk-api, vk-webhook)
2. Бухгалтерия (accounting-api)
3. СберБизнес (sber-api)
4. Админ-панель, камеры, управление ПК (admin-api, cameras-api, device-control)
5. СКУД, мост Gate, видеорегистратор (skud-api, GateBridge)
6. Страницы: Табель, Зарплата, Инкассация, Главная
7. Остальные страницы и оболочка сайта
8. Программа для Windows (АБИЗ, АБИЗ-Админ, AbizRecorder)

---

# 0. Сводка проблем безопасности

Критичные — исправить в первую очередь:

1. **vk-api без авторизации:** `broadcast`, `generate_code`, `unbind`, `bindings_list`, `status` работают без входа — можно рассылать сообщения от имени сообщества и привязать свой ВК к чужому профилю (получать чужие зарплату и табель). Webhook не проверяет `secret`/`group_id`.
2. **data-api без проверки ролей и строк:** любой вошедший может читать и менять все 22 таблицы белого списка — в т. ч. сам себе поставить роль `deputy_director` в `profiles.role`, прочитать все PIN-коды, менять зарплаты, снимать блокировки месяцев.
3. **auth-api:** `set_employee_password`, `link_device`, `list_devices`, `revoke_device` проверяют только факт входа — сотрудник может сменить пароль директору; `device_status`/`list_devices` отдают бессрочные токены устройств. Нет ограничения попыток для PIN и паролей.
4. **Коды и пароли в коде:** код разблокировки таблиц (Зарплата, Инкассация, процент) и PIN директора — в коде сайта и проверяются в браузере; пароль администратора программы АБИЗ — один на все ПК, в коде и в README.
5. **sber-api:** проверка пароля перед оплатой не вызывается (лимит попыток не работает); открытый редирект в OAuth (`origin` не проверяется); ключ шифрования хранилища по умолчанию берётся из ключа S3.
6. **Программа Windows:** токен устройства в реестре открытым текстом; папка программы с правами записи для всех пользователей, а служба рекордера работает от SYSTEM (повышение прав); обновление без подписи; ключ рекордера через `rec_gate_*` даёт управление дверью.
7. **Камеры:** пароли камер в БД открытым текстом; живое видео и архив доступны любому вошедшему вне зависимости от прав.

Существенные ошибки корректности:

- Инкассация: каждое «Обновить/Сохранить» заново прибавляет недостачи к удержаниям следующего месяца.
- Табель: сохранение удаляет строки месяца и вставляет заново без транзакции; XSS при печати (ФИО без экранирования).
- Бухгалтерия: нет транзакций; закрытый месяц можно изменить через `entry_delete`, `payment_*`, `bank_import`; просмотр отчётов сам пишет начисления.
- Добавление сотрудника на странице «Сотрудники» подменяет сессию директора сессией нового сотрудника.
- СКУД: дубли событий без карты не отсекаются (NULL в уникальном ключе); на Gate-4000-Ethernet не работают анти-passback и доп. выходы.
- Версии программы расходятся (3.10 / 3.8 / 3.6) — риск бесконечного цикла обновлений.

Полные списки замечаний с номерами строк — в конце каждого раздела ниже.

---

# 1. Вход, данные, файлы, ВКонтакте (auth-api, data-api, file-upload, vk-api, vk-webhook)

Документ описывает пять серверных функций (Python 3, обработчик `handler(event, context)`) так, как они реально написаны в коде на дату составления. Номера строк указаны по текущим версиям файлов:

| Функция | Файл | Ключ в `backend/func2url.json` | URL |
|---|---|---|---|
| auth-api | `backend/auth-api/index.py` (574 строки) | `auth-api` | `https://functions.poehali.dev/0cc75331-123f-465b-a6da-01ba5f142bfa` |
| data-api | `backend/data-api/index.py` (290 строк) | `data-api` | `https://functions.poehali.dev/e40aca0d-1c72-49c0-84a1-cf57b44984ec` |
| file-upload | `backend/file-upload/index.py` (109 строк) | `file-upload` | `https://functions.poehali.dev/5250ef3b-f3ae-4031-9d3c-2ca46f38a8bc` |
| vk-api | `backend/vk-api/index.py` (217 строк) | `vk-api` | `https://functions.poehali.dev/8052b0a3-f890-4e4c-a096-d88bf48724e0` |
| vk-webhook | `backend/vk-webhook/index.py` (104 строки) | `vk-webhook` | `https://functions.poehali.dev/ac301249-d3c3-47ba-bf45-516a862afcb6` |

Клиентский код, который их вызывает:
- `src/lib/sdk.ts` — `db` (data-api), `auth` (auth-api), `storage` (file-upload);
- `src/lib/devices.ts` — `list_devices`, `link_device`, `revoke_device`, `set_employee_password` (auth-api);
- `src/lib/vkBinding.ts` — `generate_code`, `status`, `bindings_list`, `unbind` (vk-api);
- `src/pages/Schedule.tsx:503`, `src/pages/Salary.tsx:581` — `broadcast` (vk-api).

Все функции используют схему БД из переменной `MAIN_DB_SCHEMA` (по умолчанию `public`), имя схемы подставляется в SQL через f-строку; значения — через параметры psycopg2 (`%s`).

Используемые таблицы (по миграциям `db_migrations/`):

| Таблица | Ключевые колонки | Миграция |
|---|---|---|
| `auth_users` | `id text PK`, `email text UNIQUE`, `password_hash text`, `is_admin bool`, `created_at` | V0002 |
| `auth_sessions` | `id text PK`, `user_id`, `token text UNIQUE`, `created_at`, `expires_at` | V0002 |
| `api_tokens` | `id text PK`, `user_id`, `token text UNIQUE`, `label`, `created_at`, `last_used_at`, `revoked_at`, `device_code` | V0007, V0010 |
| `devices` | `id text PK`, `device_code varchar(9) UNIQUE`, `hostname`, `profile_id`, `status` (`pending`/`linked`/`revoked`), `created_at`, `linked_at`, `last_seen_at` | V0010 |
| `login_links` | `id text PK`, `code text UNIQUE`, `user_id`, `created_at`, `expires_at`, `used_at` | V0011 |
| `pin_codes` | `id`, `user_id`, `pin varchar(4)`, `email`, `shortcut_code`, `adpod_slug` | V0002, V0004 |
| `profiles` | `id`, `user_id`, `full_name`, `email`, `role` (default `employee`), `vk_id`, `vk_link`, `has_system_access`, … | V0002 |
| `vk_bind_codes` | `id bigserial`, `profile_id text`, `code varchar(6)`, `status` (`pending`/`confirmed`), `created_at` | V0001 |
| `vk_bindings` | `id bigserial`, `profile_id text UNIQUE`, `vk_user_id bigint`, `vk_link`, `status`, `message`, `created_at`, `updated_at` | V0001 |

---

## 1. auth-api

### 1.1. Общие сведения

**Назначение.** Сервер аутентификации: регистрация и вход по email+паролю, вход по 4-значному PIN-коду, проверка сессии, выход, роли пользователя; постоянные API-токены для десктоп-приложения; регистрация и привязка ПК по 9-значному коду; одноразовые ссылки автовхода в браузер; смена пароля сотрудника директором.

**URL key:** `auth-api`.

**HTTP-методы.**
- `OPTIONS` — CORS preflight, ответ `200`, пустое тело (строки 122–123).
- `POST` — основной режим; тело JSON парсится (строка 126). Ошибка парсинга → `400 {"error": "Некорректный JSON"}`.
- Любой другой метод (`GET`, …) — тело **не парсится** (`body = {}`), `action` берётся из query-string `?action=...` (строка 130). Таким образом, любое действие технически можно вызвать GET-запросом, но все поля, кроме `action`, будут пустыми (например, `GET ?action=ping` → 200, `GET ?action=register_device` → регистрирует устройство с пустым `hostname`).

**CORS** (строки 15–20): `Access-Control-Allow-Origin: *`, методы `GET, POST, OPTIONS`, заголовки `Content-Type, X-Authorization`, `Max-Age: 86400`. Все JSON-ответы — `Content-Type: application/json`, сериализация `ensure_ascii=False, default=str` (даты отдаются строками).

**Маршрутизация.** `action = body.action || query.action`. `ping` обрабатывается **до** открытия соединения с БД. Для остальных действий открывается одно соединение `psycopg2.connect(DATABASE_URL)`, закрывается в `finally`. Исключения (ошибки БД и т.п.) **не перехватываются** — платформа вернёт 5xx. Неизвестный или отсутствующий `action` → `400 {"error": "Неизвестное действие: <action>"}` (для отсутствующего — `"Неизвестное действие: None"`), строка 573.

**Чтение токена.** В функции три разных способа:
1. `require_session_user` (строки 105–109) — используется в `list_devices`, `link_device`, `revoke_device`, `set_employee_password`: `body.token`, иначе заголовок `X-Authorization` (**только точный регистр**, `x-authorization` не читается); префикс `Bearer ` срезается. Проверяется **только сессия** (`auth_sessions`), API-токены не принимаются.
2. Тот же алгоритм вручную — в `session`, `get_api_token`, `revoke_api_token`.
3. Только `body.token` (заголовок игнорируется) — в `signout`, `get_roles`.
4. Поле `body.api_token` — в `request_login_link`, `device_signin`, `api_verify` (проверяется по таблице `api_tokens`).

Фронтенд (`src/lib/sdk.ts:120-131`, `src/lib/devices.ts:25-35`) **всегда** передаёт сессионный токен в теле (`token`), заголовок `X-Authorization` в auth-api не отправляет.

### 1.2. Общие хелперы

| Хелпер | Строки | Что делает |
|---|---|---|
| `hash_password(password)` | 35–38 | Соль: `secrets.token_hex(16)` (16 случайных байт → 32 hex-символа). Хеш: `hashlib.pbkdf2_hmac('sha256', password.utf8, bytes.fromhex(salt), 150000)`. **Формат хранения:** `"<salt_hex>$<hash_hex>"` (32 + 1 + 64 символа) в `auth_users.password_hash`. |
| `verify_password(password, stored)` | 41–47 | `stored.split('$')` → соль и хеш; пересчёт PBKDF2-SHA256 с 150 000 итераций; сравнение `secrets.compare_digest` (постоянное время). Любое исключение (неверный формат, например `disabled-…` у отключённого демо-аккаунта) → `False`. |
| `PBKDF2_ITERATIONS` | 13 | `150000`. |
| `create_session(cur, user_id)` | 50–57 | Токен `secrets.token_urlsafe(32)` (~43 символа base64url). `expires_at = now(UTC) + 30 дней` (`SESSION_TTL_DAYS = 30`, строка 12). `INSERT INTO auth_sessions (id uuid4, user_id, token, expires_at)`. Коммит делает вызывающий код. Сессии не продлеваются и не чистятся. |
| `get_user_by_token(cur, token)` | 60–70 | `SELECT u.id, u.email, u.is_admin FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token = %s AND s.expires_at > now()` → `{id, email, is_admin}` или `None`. Только сессии. |
| `get_or_create_api_token(cur, user_id, label='Десктоп-приложение')` | 73–90 | Ищет последний неотозванный токен пользователя: `SELECT token FROM api_tokens WHERE user_id=%s AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`. Если есть — возвращает его (**в том числе токен конкретного устройства** с `device_code`, т.к. фильтра по `device_code IS NULL` нет). Иначе создаёт `'anod_' + secrets.token_urlsafe(40)` и `INSERT INTO api_tokens (id, user_id, token, label)`. Не истекает. |
| `create_device_token(cur, user_id, device_code)` | 93–102 | Всегда новый `'anod_' + token_urlsafe(40)`; `INSERT INTO api_tokens (id, user_id, token, label='Устройство <code>', device_code)`. |
| `require_session_user(cur, event, body)` | 105–109 | См. п. 1.1. |
| `_resp(status, payload)` | 23–28 | JSON-ответ с CORS. |

**Типы токенов:**
- Сессия сайта: `token_urlsafe(32)`, срок 30 дней, таблица `auth_sessions`.
- Постоянный API-токен: префикс `anod_`, `token_urlsafe(40)`, без срока, отзыв через `revoked_at`, таблица `api_tokens`.
- Код устройства: 9 цифр, `secrets.randbelow(1_000_000_000)`, таблица `devices`.
- Код автовхода: `token_urlsafe(24)`, 2 минуты, одноразовый, таблица `login_links`.

### 1.3. Переменные окружения, зависимости, тесты

- **Env:** `DATABASE_URL` (обязательно, иначе `KeyError`), `MAIN_DB_SCHEMA` (опционально, `public`).
- **requirements.txt:** `psycopg2-binary`.
- **tests.json** (15 тестов):
  1. `OPTIONS preflight` → 200.
  2. `Unknown action` (`action: unknown`) → 400.
  3. `Signin wrong password` (`nobody@example.com`/`wrong`) → 401.
  4. `Register device returns 9-digit code` (`hostname: TEST-PC-CI`) → 200, `{device_code: string}` (partial). **Побочный эффект:** при каждом прогоне в `devices` создаётся запись `pending`.
  5. `Device status unknown code` (`000000000`) → 404.
  6. `List devices without session rejected` → 401.
  7. `Link device without session rejected` → 401.
  8. `Request login link without api_token rejected` → 400.
  9. `Request login link with bad api_token rejected` → 401.
  10. `Redeem unknown login code` → 404.
  11. `Ping without auth` → 200 `{ok: true}`.
  12. `Device signin with bad token rejected` → 403.
  13. `Device signin without password rejected` → 400.
  14. `Set employee password without session rejected` → 401.
  15. `Removed demo account cannot sign in` (`director@anodbiz.ru`/`anodbiz`) → 401.

### 1.4. Действия

Всего 20 действий + ветка «неизвестное действие».

#### `ping`

- **Назначение:** проверка связи для десктоп-программы; БД не открывается.
- **Кто может вызвать:** без входа.
- **Вход:** только `action`.
- **Проверки и ошибки:** нет.
- **Логика по шагам:** 1. Сразу возвращает ответ (строки 132–134).
- **Таблицы:** нет.
- **Ответ:** `200 {"ok": true}`
- **Побочные эффекты:** нет.

#### `signup`

- **Назначение:** регистрация нового пользователя по email и паролю.
- **Кто может вызвать:** без входа (открытая регистрация).
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `email` | string | да | Обрезается `strip()`, приводится к нижнему регистру. |
| `password` | string | да | Не короче 6 символов. |

- **Проверки и ошибки:**
  - пустой email или нет `@` → `400 {"error": "Введите корректный email"}`;
  - `len(password) < 6` → `400 {"error": "Пароль должен содержать не менее 6 символов"}`;
  - email уже есть в `auth_users` → `409 {"error": "Пользователь с таким email уже существует"}`.
- **Логика по шагам:**
  1. `SELECT id FROM auth_users WHERE email = %s` — проверка уникальности.
  2. `SELECT count(*) FROM auth_users` — если 0, новый пользователь станет администратором (`is_first`).
  3. `INSERT INTO auth_users (id uuid4, email, password_hash=hash_password(password), is_admin=is_first)`.
  4. `create_session` → `INSERT INTO auth_sessions`.
  5. `COMMIT`.
- **Таблицы:** чтение `auth_users`; запись `auth_users`, `auth_sessions`.
- **Ответ:** `200 {"user": {"id": "uuid", "email": "a@b.ru"}, "token": "<session>", "is_admin": false}`
- **Побочные эффекты:** создаётся пользователь и сессия на 30 дней. Профиль (`profiles`) **не создаётся**. Первый зарегистрированный пользователь в пустой БД получает `is_admin = true`. API-токен не выдаётся. Фронтенд (`sdk.ts:183-187`) сохраняет `token` в `localStorage['anod_session_token']`.

#### `signin`

- **Назначение:** вход по email и паролю; дополнительно выдаёт постоянный API-токен.
- **Кто может вызвать:** без входа.
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `email` | string | да | `strip().lower()` |
| `password` | string | да | |

- **Проверки и ошибки:** пользователь не найден или пароль не совпал → `401 {"error": "Неверный email или пароль"}`. Ограничения числа попыток нет.
- **Логика по шагам:**
  1. `SELECT id, password_hash, is_admin FROM auth_users WHERE email = %s`.
  2. `verify_password`.
  3. `create_session` → `INSERT INTO auth_sessions`.
  4. `get_or_create_api_token(user_id)` — `SELECT` из `api_tokens`, при отсутствии `INSERT`.
  5. `COMMIT`.
- **Таблицы:** чтение `auth_users`, `api_tokens`; запись `auth_sessions`, `api_tokens` (если токена не было).
- **Ответ:** `200 {"user": {"id": "...", "email": "..."}, "token": "<session>", "is_admin": true, "api_token": "anod_..."}`
- **Побочные эффекты:** новая сессия (30 дней) при каждом входе; при первом входе — постоянный API-токен. Если у пользователя есть более свежий токен устройства, в `api_token` вернётся именно он (см. `get_or_create_api_token`). Фронтенд (`sdk.ts:155-159`) сохраняет `token`, а `api_token` возвращает вызывающему коду.

#### `pin_lookup`

- **Назначение:** первый шаг входа по PIN: найти email и ФИО по 4-значному PIN.
- **Кто может вызвать:** без входа.
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `pin` | string | да | Ровно 4 цифры. |
| `adpod_slug` | string | нет | Адресный поддомен (АдПод); если передан и у PIN задан свой slug — они должны совпасть. |

- **Проверки и ошибки:**
  - `len(pin) != 4` или не цифры → `400 {"error": "Пин-код должен содержать 4 цифры"}`;
  - PIN не найден → `404 {"error": "Неверный пин-код"}`;
  - `adpod_slug` передан, у PIN есть `adpod_slug` и они различаются → `403 {"error": "Этот пин-код привязан к другому адресу входа"}`.
- **Логика по шагам:**
  1. `SELECT email, adpod_slug FROM pin_codes WHERE pin = %s LIMIT 1` (при дублях PIN берётся произвольная строка).
  2. Проверка slug (только если оба непусты).
  3. `SELECT full_name FROM profiles WHERE lower(email) = lower(%s) LIMIT 1`.
- **Таблицы:** чтение `pin_codes`, `profiles`.
- **Ответ:** `200 {"email": "ivanov@company.ru", "full_name": "Иванов Иван"}` (если профиля нет — `"full_name": "Сотрудник"`).
- **Побочные эффекты:** нет. Сессия не создаётся — второй шаг фронтенд делает обычным `signin` по email+паролю либо `pin_signin`.

#### `pin_signin`

- **Назначение:** прямой вход только по PIN (без пароля), допускается только на адресных поддоменах.
- **Кто может вызвать:** без входа.
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `pin` | string | да | 4 цифры. |
| `adpod_slug` | string | да | Должен точно совпадать с `pin_codes.adpod_slug`. |

- **Проверки и ошибки:**
  - PIN не из 4 цифр → `400 {"error": "Пин-код должен содержать 4 цифры"}`;
  - пустой `adpod_slug` → `400 {"error": "Не указан адресный поддомен"}`;
  - PIN не найден → `404 {"error": "Неверный пин-код"}`;
  - `pin_codes.adpod_slug != adpod_slug` (в т.ч. если у PIN slug `NULL`) → `403 {"error": "Этот пин-код привязан к другому адресу входа"}`;
  - не найден пользователь → `404 {"error": "У сотрудника нет учётной записи для входа. Обратитесь к руководителю."}`.
- **Логика по шагам:**
  1. `SELECT email, adpod_slug FROM pin_codes WHERE pin = %s LIMIT 1`.
  2. Сравнение slug.
  3. `SELECT id, is_admin, email FROM auth_users WHERE lower(email) = lower(%s) LIMIT 1`.
  4. Если не найден — `SELECT a.id, a.is_admin, a.email FROM profiles p JOIN auth_users a ON a.id::text = p.user_id::text WHERE lower(p.email) = lower(%s) LIMIT 1`.
  5. `create_session` → `INSERT INTO auth_sessions`; `COMMIT`.
- **Таблицы:** чтение `pin_codes`, `auth_users`, `profiles`; запись `auth_sessions`.
- **Ответ:** `200 {"user": {"id": "...", "email": "..."}, "token": "<session>", "is_admin": false}`
- **Побочные эффекты:** полноценная сессия на 30 дней без пароля. Ограничения попыток нет (пространство PIN — 10 000 значений).

#### `session`

- **Назначение:** проверить сессионный токен и вернуть текущего пользователя.
- **Кто может вызвать:** без входа (при невалидном токене возвращается `user: null`).
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `token` | string | нет | Сессионный токен; иначе заголовок `X-Authorization` (с/без `Bearer `). |

- **Проверки и ошибки:** нет ошибочных кодов; пустой токен → `200 {"user": null}`.
- **Логика по шагам:** 1. Извлечь токен. 2. `get_user_by_token` (JOIN `auth_sessions`/`auth_users`, `expires_at > now()`).
- **Таблицы:** чтение `auth_sessions`, `auth_users`.
- **Ответ:** `200 {"user": {"id": "...", "email": "...", "is_admin": false}}` или `200 {"user": null}`.
- **Побочные эффекты:** нет. Фронтенд (`sdk.ts:134-144`) при `user: null` удаляет токен из `localStorage`.

#### `signout`

- **Назначение:** выход — удаление сессии.
- **Кто может вызвать:** без входа (знание токена = право его удалить).
- **Вход:** `token` (string, нет) — **только из тела**, заголовок не читается.
- **Проверки и ошибки:** нет.
- **Логика по шагам:** 1. Если `token` непуст — `DELETE FROM auth_sessions WHERE token = %s`; `COMMIT`.
- **Таблицы:** запись (удаление) `auth_sessions`.
- **Ответ:** `200 {"ok": true}` всегда.
- **Побочные эффекты:** сессия удаляется. API-токены не отзываются.

#### `get_roles`

- **Назначение:** список ролей текущего пользователя для клиентской проверки прав.
- **Кто может вызвать:** без входа (без валидного токена — пустой список).
- **Вход:** `token` (string, нет) — только из тела.
- **Проверки и ошибки:** нет; невалидный/пустой токен → `200 {"roles": []}`.
- **Логика по шагам:**
  1. `get_user_by_token`.
  2. `roles = ['admin']`, если `auth_users.is_admin`, иначе `[]`.
  3. `SELECT role FROM profiles WHERE user_id = %s OR lower(email) = lower(%s) ORDER BY (user_id = %s) DESC LIMIT 1` — приоритет профилю, привязанному по `user_id`, иначе — профилю с тем же email.
  4. Если `role` непуст — добавить в список.
- **Таблицы:** чтение `auth_sessions`, `auth_users`, `profiles`.
- **Ответ:** `200 {"roles": ["admin", "deputy_director"]}`
- **Побочные эффекты:** нет. Роль берётся из `profiles.role`, который можно изменить через data-api (см. «Замечания по безопасности»).

#### `get_api_token`

- **Назначение:** показать вошедшему пользователю его постоянный API-токен для настройки десктоп-приложения.
- **Кто может вызвать:** любой вошедший (действующая сессия; API-токен не принимается).
- **Вход:** `token` (string) из тела или заголовок `X-Authorization`.
- **Проверки и ошибки:** нет сессии → `401 {"error": "Требуется вход в систему"}`.
- **Логика по шагам:** 1. `get_user_by_token`. 2. `get_or_create_api_token` (SELECT / при отсутствии INSERT в `api_tokens`). 3. `COMMIT`.
- **Таблицы:** чтение `auth_sessions`, `auth_users`, `api_tokens`; запись `api_tokens` (если не было).
- **Ответ:** `200 {"api_token": "anod_..."}`
- **Побочные эффекты:** возможно создание постоянного токена.

#### `revoke_api_token`

- **Назначение:** отозвать скомпрометированный API-токен и выдать новый.
- **Кто может вызвать:** любой вошедший (сессия).
- **Вход:** `token` из тела или `X-Authorization`.
- **Проверки и ошибки:** нет сессии → `401 {"error": "Требуется вход в систему"}`.
- **Логика по шагам:**
  1. `get_user_by_token`.
  2. `UPDATE api_tokens SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL` — отзываются **все** токены пользователя, включая токены устройств (`device_code IS NOT NULL`).
  3. `get_or_create_api_token` → новый `INSERT`.
  4. `COMMIT`.
- **Таблицы:** чтение `auth_sessions`, `auth_users`, `api_tokens`; запись `api_tokens`.
- **Ответ:** `200 {"api_token": "anod_<новый>"}`
- **Побочные эффекты:** все ПК, привязанные к этому пользователю, теряют доступ (их `device_status` вернёт `api_token: null`, `device_signin` — 403), при этом `devices.status` остаётся `linked`.

#### `register_device`

- **Назначение:** десктоп-программа при первом запуске получает 9-значный код устройства.
- **Кто может вызвать:** без входа.
- **Вход:** `hostname` (string, нет) — имя компьютера, обрезается до 200 символов.
- **Проверки и ошибки:** за 50 попыток не найден свободный код → `500 {"error": "Не удалось сгенерировать код устройства"}`.
- **Логика по шагам:**
  1. До 50 раз: `candidate = f'{secrets.randbelow(1_000_000_000):09d}'`; `SELECT 1 FROM devices WHERE device_code = %s`.
  2. `INSERT INTO devices (id uuid4, device_code, hostname, status='pending')`.
  3. `COMMIT`.
- **Таблицы:** чтение/запись `devices`.
- **Ответ:** `200 {"device_code": "042913775"}`
- **Побочные эффекты:** новая запись в `devices` при каждом вызове (ограничений частоты нет).

#### `device_status`

- **Назначение:** программа опрашивает, привязан ли её код; после привязки получает токен устройства.
- **Кто может вызвать:** без входа (достаточно знать `device_code`).
- **Вход:** `device_code` (string, да).
- **Проверки и ошибки:** пустой → `400 {"error": "device_code обязателен"}`; не найден → `404 {"error": "Устройство не найдено"}`.
- **Логика по шагам:**
  1. `SELECT status, profile_id FROM devices WHERE device_code = %s`.
  2. Если `status != 'linked'` → вернуть `{status}` (`pending` или `revoked`).
  3. `SELECT token FROM api_tokens WHERE device_code = %s AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`.
  4. `UPDATE devices SET last_seen_at = now() WHERE device_code = %s`; `COMMIT`.
- **Таблицы:** чтение `devices`, `api_tokens`; запись `devices.last_seen_at`.
- **Ответ:** `200 {"status": "pending"}` / `200 {"status": "revoked"}` / `200 {"status": "linked", "api_token": "anod_..." | null}`
- **Побочные эффекты:** обновляется `last_seen_at`. Токен выдаётся **многократно** — каждому, кто знает код.

#### `list_devices`

- **Назначение:** список всех ПК для личного кабинета.
- **Кто может вызвать:** любой вошедший (сессия); роль не проверяется.
- **Вход:** `token` в теле или `X-Authorization`.
- **Проверки и ошибки:** нет сессии → `401 {"error": "Требуется вход в систему"}`.
- **Логика по шагам:**
  1. `require_session_user`.
  2. `SELECT d.id, d.device_code, d.hostname, d.status, d.created_at, d.linked_at, d.last_seen_at, d.profile_id, p.full_name FROM devices d LEFT JOIN profiles p ON p.id = d.profile_id ORDER BY d.created_at DESC` — **все** устройства, без фильтра по компании/пользователю.
- **Таблицы:** чтение `auth_sessions`, `auth_users`, `devices`, `profiles`.
- **Ответ:**
```json
{"devices": [{"id": "...", "device_code": "123456789", "hostname": "PC-1", "status": "linked",
  "created_at": "2026-10-01 10:00:00+00:00", "linked_at": "...", "last_seen_at": "...",
  "profile_id": "...", "profile_name": "Иванов Иван"}]}
```
- **Побочные эффекты:** нет.

#### `link_device`

- **Назначение:** директор привязывает код ПК к профилю сотрудника; при необходимости создаёт сотруднику учётную запись или меняет пароль.
- **Кто может вызвать:** любой вошедший (сессия); **роль/is_admin не проверяется**.
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `token` | string | да* | Сессия (или заголовок `X-Authorization`). |
| `device_code` | string | да | Ровно 9 цифр. |
| `profile_id` | string | да | ID профиля сотрудника. |
| `password` | string | условно | Обязателен (≥6), если у профиля нет `user_id`; если `user_id` есть и пароль непуст — пароль учётки **перезаписывается**. |

- **Проверки и ошибки (по порядку):**
  - нет сессии → `401 {"error": "Требуется вход в систему"}`;
  - код не 9 цифр → `400 {"error": "Код устройства должен содержать 9 цифр"}`;
  - пустой `profile_id` → `400 {"error": "Не выбран сотрудник"}`;
  - устройства нет → `404 {"error": "Устройство с таким кодом не найдено"}`;
  - профиля нет → `404 {"error": "Сотрудник не найден"}`;
  - у профиля нет `user_id` и `len(password) < 6` → `400 {"error": "Укажите пароль (не менее 6 символов) для нового сотрудника"}`;
  - у профиля нет `user_id` и пустой email → `400 {"error": "У сотрудника не указан email — заполните его в профиле"}`.
- **Логика по шагам:**
  1. `require_session_user`.
  2. `SELECT status FROM devices WHERE device_code = %s` (статус не анализируется — можно перепривязать `linked` или `revoked` устройство).
  3. `SELECT user_id, email, full_name FROM profiles WHERE id = %s`.
  4. Если `user_id` пуст:
     a. `SELECT id FROM auth_users WHERE email = %s` (email профиля без приведения к нижнему регистру);
     b. если найден — используется существующий `auth_users.id` (пароль при этом **не** меняется);
     c. иначе `INSERT INTO auth_users (id uuid4, email, password_hash, is_admin=false)`;
     d. `UPDATE profiles SET user_id = %s, has_system_access = true WHERE id = %s`.
  5. Иначе, если `password` непуст: `UPDATE auth_users SET password_hash = %s WHERE id = %s`.
  6. `create_device_token` → `INSERT INTO api_tokens (..., device_code)`.
  7. `UPDATE devices SET status='linked', profile_id=%s, linked_at=now() WHERE device_code=%s`.
  8. `COMMIT`.
- **Таблицы:** чтение `auth_sessions`, `auth_users`, `devices`, `profiles`; запись `auth_users`, `profiles`, `api_tokens`, `devices`.
- **Ответ:** `200 {"ok": true, "profile_name": "Иванов Иван", "api_token": "anod_..."}`
- **Побочные эффекты:** новый токен устройства; возможно создание учётной записи или смена пароля сотрудника. Старые токены этого `device_code` (если был перепривязан) не отзываются.

#### `revoke_device`

- **Назначение:** отозвать доступ одному ПК.
- **Кто может вызвать:** любой вошедший (сессия); роль не проверяется.
- **Вход:** `token`, `device_code` (string, да).
- **Проверки и ошибки:** нет сессии → `401 {"error": "Требуется вход в систему"}`; пустой код → `400 {"error": "device_code обязателен"}`. Существование устройства не проверяется.
- **Логика по шагам:**
  1. `UPDATE api_tokens SET revoked_at = now() WHERE device_code = %s AND revoked_at IS NULL`.
  2. `UPDATE devices SET status = 'revoked' WHERE device_code = %s`.
  3. `COMMIT`.
- **Таблицы:** запись `api_tokens`, `devices`.
- **Ответ:** `200 {"ok": true}` (даже для несуществующего кода).
- **Побочные эффекты:** токен(ы) устройства отозваны, `devices.status = revoked`.

#### `request_login_link`

- **Назначение:** программа по своему токену получает одноразовый код для автовхода браузера (`/device-login?code=...`).
- **Кто может вызвать:** владелец любого неотозванного API-токена (`api_tokens`, не обязательно токена устройства).
- **Вход:** `api_token` (string, да).
- **Проверки и ошибки:** пустой → `400 {"error": "api_token обязателен"}`; не найден/отозван → `401 {"error": "Недействительный токен устройства"}`.
- **Логика по шагам:**
  1. `SELECT user_id FROM api_tokens WHERE token = %s AND revoked_at IS NULL`.
  2. `code = secrets.token_urlsafe(24)`, `expires_at = now(UTC) + 2 минуты`.
  3. `INSERT INTO login_links (id uuid4, code, user_id, expires_at)`; `COMMIT`.
- **Таблицы:** чтение `api_tokens`; запись `login_links`.
- **Ответ:** `200 {"code": "..."}`
- **Побочные эффекты:** запись в `login_links`. `last_used_at` токена не обновляется.

#### `redeem_login_link`

- **Назначение:** браузер обменивает одноразовый код на сессию.
- **Кто может вызвать:** без входа (знание кода).
- **Вход:** `code` (string, да).
- **Проверки и ошибки:**
  - пустой → `400 {"error": "code обязателен"}`;
  - не найден → `404 {"error": "Ссылка недействительна"}`;
  - `used_at` заполнен → `410 {"error": "Эта ссылка уже была использована"}`;
  - `expires_at < now()` → `410 {"error": "Ссылка истекла, запросите новую в программе"}`;
  - пользователь не найден → `404 {"error": "Пользователь не найден"}` (в этом случае отметка `used_at` не коммитится — соединение закрывается без `COMMIT`).
- **Логика по шагам:**
  1. `SELECT id, user_id, expires_at, used_at FROM login_links WHERE code = %s`.
  2. Проверки использования/срока.
  3. `UPDATE login_links SET used_at = now() WHERE id = %s`.
  4. `SELECT id, email, is_admin FROM auth_users WHERE id = %s`.
  5. `create_session`; `COMMIT`.
- **Таблицы:** чтение `login_links`, `auth_users`; запись `login_links`, `auth_sessions`.
- **Ответ:** `200 {"user": {"id": "...", "email": "..."}, "token": "<session>", "is_admin": false}`
- **Побочные эффекты:** код помечается использованным; создаётся сессия на 30 дней. Фронтенд — `sdk.ts:213-217`.

#### `set_employee_password`

- **Назначение:** директор задаёт/меняет пароль сотрудника.
- **Кто может вызвать:** любой вошедший (сессия); **роль не проверяется**.
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `token` | string | да* | Сессия (или заголовок). |
| `profile_id` | string | да | Профиль сотрудника. |
| `password` | string | да | ≥ 6 символов. |

- **Проверки и ошибки:**
  - нет сессии → `401 {"error": "Требуется вход в систему"}`;
  - пустой `profile_id` → `400 {"error": "Не указан сотрудник"}`;
  - пароль < 6 → `400 {"error": "Пароль должен содержать не менее 6 символов"}`;
  - профиля нет → `404 {"error": "Сотрудник не найден"}`;
  - нет `user_id` и нет email → `400 {"error": "У сотрудника не указан email"}`.
- **Логика по шагам:**
  1. `SELECT user_id, email FROM profiles WHERE id = %s`.
  2. Если `user_id` пуст: `INSERT INTO auth_users (id uuid4, email, password_hash, is_admin=false)` (без проверки, что email уже занят — при совпадении будет нарушение UNIQUE и необработанная ошибка 5xx); `UPDATE profiles SET user_id, has_system_access = true`.
  3. Иначе: `UPDATE auth_users SET password_hash = %s WHERE id = %s`.
  4. `COMMIT`.
- **Таблицы:** чтение `auth_sessions`, `auth_users`, `profiles`; запись `auth_users`, `profiles`.
- **Ответ:** `200 {"ok": true}`
- **Побочные эффекты:** смена пароля/создание учётки. Существующие сессии и токены пользователя не аннулируются.

#### `device_signin`

- **Назначение:** вход сотрудника в десктоп-программе: токен устройства + пароль сотрудника.
- **Кто может вызвать:** держатель API-токена (любого неотозванного) + знание пароля пользователя-владельца токена.
- **Вход:** `api_token` (string, да), `password` (string, да).
- **Проверки и ошибки:**
  - любое поле пусто → `400 {"error": "api_token и password обязательны"}`;
  - токен не найден или отозван → `403 {"error": "Устройство отвязано", "revoked": true}`;
  - пароль неверен / пользователя нет → `401 {"error": "Неверный пароль"}`.
- **Логика по шагам:**
  1. `SELECT t.user_id, t.revoked_at FROM api_tokens t WHERE t.token = %s`.
  2. `SELECT password_hash FROM auth_users WHERE id = %s`; `verify_password`.
  3. `SELECT full_name FROM profiles WHERE user_id = %s LIMIT 1`.
  4. `UPDATE api_tokens SET last_used_at = now() WHERE token = %s`; `COMMIT`.
- **Таблицы:** чтение `api_tokens`, `auth_users`, `profiles`; запись `api_tokens.last_used_at`.
- **Ответ:** `200 {"ok": true, "full_name": "Иванов Иван"}`
- **Побочные эффекты:** сессия не создаётся; обновляется `last_used_at`.

#### `api_verify`

- **Назначение:** проверка постоянного API-токена (в комментарии указано, что для data-api/file-upload, но они проверяют токен самостоятельно; вызовов `api_verify` в репозитории, кроме самого auth-api, нет).
- **Кто может вызвать:** без входа.
- **Вход:** `api_token` (string, нет).
- **Проверки и ошибки:** нет; пустой/невалидный → `200 {"user": null}`.
- **Логика по шагам:**
  1. `SELECT u.id, u.email, u.is_admin FROM api_tokens t JOIN auth_users u ON u.id = t.user_id WHERE t.token = %s AND t.revoked_at IS NULL`.
  2. `UPDATE api_tokens SET last_used_at = now()`; `COMMIT`.
- **Таблицы:** чтение `api_tokens`, `auth_users`; запись `api_tokens.last_used_at`.
- **Ответ:** `200 {"user": {"id": "...", "email": "...", "is_admin": true}}` или `200 {"user": null}`.
- **Побочные эффекты:** `last_used_at`.

#### Неизвестное действие (ветка `else`)

- `400 {"error": "Неизвестное действие: <action>"}` (строка 573).

---

## 2. data-api

### 2.1. Общие сведения

**Назначение.** Универсальный CRUD-шлюз к таблицам PostgreSQL в стиле Supabase-клиента: фронтенд (`db.from(table)...` в `src/lib/sdk.ts`) формирует JSON-описание запроса, функция строит SQL.

**URL key:** `data-api`.

**HTTP-методы.** `OPTIONS` → 200 (CORS); любой метод, кроме `POST`, → `405 {"error": "Используйте POST с телом {table, op, ...}"}`. CORS: `Allow-Origin: *`, методы `GET, POST, PUT, DELETE, OPTIONS`, заголовки `Content-Type, X-Authorization, X-Session-Id`.

**Чтение токена** (`_extract_token`, строки 123–129): заголовок `X-Authorization`, затем `x-authorization`, затем `body.token`; префикс `Bearer ` срезается; `strip()`.

**Аутентификация** (`_authenticate`, строки 132–157):
1. `SELECT u.id, u.email, u.is_admin FROM auth_sessions s JOIN auth_users u ... WHERE s.token = %s AND s.expires_at > now()` — сессия сайта.
2. Если нет — `SELECT ... FROM api_tokens t JOIN auth_users u ... WHERE t.token = %s AND t.revoked_at IS NULL`; при успехе `UPDATE api_tokens SET last_used_at = now()`.
3. Иначе `None` → `401 {"data": null, "error": {"message": "Не авторизован: нужен действующий токен входа"}}`.

Результат аутентификации (`user`, в т.ч. `is_admin`) **дальше нигде не используется**: ни ролей, ни проверки владельца строки, ни фильтра по компании нет. Любой валидный токен (сессия любого пользователя или любой API-токен, включая токен устройства) даёт полный доступ на чтение и запись ко всем таблицам белого списка.

**Сериализация** (`_json_default`): `Decimal` → `int`/`float`; прочие нестандартные типы (даты, UUID) → `str`.

**Обработка ошибок.** Любое исключение внутри основного блока (ошибка SQL, невалидный идентификатор, неизвестный оператор, `int(limit)` и т.д.) → `200 {"data": null, "error": {"message": "<текст исключения>"}}` (строки 290–291). Текст ошибки PostgreSQL возвращается клиенту как есть. Соединение явно не закрывается.

**Env:** `DATABASE_URL`, `MAIN_DB_SCHEMA`. **requirements.txt:** `psycopg2-binary`.

**tests.json** (3 теста): `OPTIONS preflight` → 200; `GET not allowed` → 405; `No token is rejected` (`table: companies, op: select` без токена) → 401. Тестовый токен `anod_test_static_token_for_ci_only` (миграция V0008) отозван миграцией V0017, позитивных тестов нет.

### 2.2. Формат запроса

```json
{
  "table": "profiles",
  "op": "select",
  "filters": [{"col": "role", "op": "eq", "value": "employee"}],
  "order": {"col": "full_name", "ascending": true},
  "limit": 50,
  "single_mode": "maybe",
  "payload": {"full_name": "..."},
  "token": "<опционально, если не в заголовке>"
}
```

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `table` | string | да | Должна входить в `ALLOWED_TABLES`. |
| `op` | string | нет | `select` (по умолчанию), `insert`, `update`, `delete`. `upsert` в SDK превращается в `insert` (`sdk.ts:59`) — `ON CONFLICT` не используется. |
| `filters` | array | нет (обяз. для update/delete) | Список `{col, op, value}`; объединяются через `AND`. |
| `order` | object | нет | `{col, ascending}`; только одна колонка; `ascending` по умолчанию `true`. Только для `select`. |
| `limit` | number | нет | `LIMIT int(limit)`; `0`/пусто — без лимита. Только для `select`. |
| `single_mode` | string | нет | `'single'` / `'maybe'` / отсутствует. |
| `payload` | object или array | для insert/update | Значения-объекты/массивы сериализуются `json.dumps` (для jsonb-колонок). |
| `returning` | — | — | Отдельного параметра нет: insert/update/delete **всегда** выполняются с `RETURNING *` и возвращают все колонки. Выбор колонок в `select` тоже не поддерживается (`SELECT *`; аргумент `select(cols)` в SDK игнорируется). |

**Белый список таблиц** (строки 15–21): `companies`, `profiles`, `pin_codes`, `schedule_config`, `employee_schedule_settings`, `schedule_data`, `schedule_settings`, `salary_data`, `salary_settings`, `manager_data`, `manager_settings`, `employee_rotation`, `collection_data`, `documents`, `folders`, `base_files`, `dto_categories`, `dto_templates`, `chat_rooms`, `chat_messages`, `devices`, `kiosk_buttons`. Таблица вне списка → `200 {"data": null, "error": {"message": "Недопустимая или отсутствующая таблица: <table>"}}` — эта проверка выполняется **до** аутентификации. Таблицы `auth_users`, `auth_sessions`, `api_tokens`, `login_links`, `vk_*` недоступны.

**Валидация идентификаторов** (`_check_ident`, строка 30): регулярное выражение `^[a-zA-Z_][a-zA-Z0-9_]*$`; применяется к `filters[].col`, `order.col`, ключам `payload`. Нарушение → исключение `Недопустимое имя: <name>` → `200 {data: null, error: {message}}`. Идентификаторы дополнительно берутся в двойные кавычки, таблица — `"schema"."table"`.

**Операторы фильтров** (`_build_where`, строки 60–116):

| `op` | SQL | Особенности |
|---|---|---|
| `eq` | `"col" = %s` | `value: null` → `"col" IS NULL` |
| `neq` | `"col" != %s` | `null` → `IS NOT NULL` |
| `is` | `"col" IS %s` | `null` → `IS NULL` (для `true/false`) |
| `in` | `"col" IN (%s, …)` | скаляр оборачивается в список; пустой список → `FALSE` |
| `not_eq` | `("col" IS NULL OR "col" != %s)` | из SDK `.not(col,'eq',v)` |
| `not_is` | `"col" IS NOT %s` | `null` → `IS NOT NULL` |
| `gt` / `gte` / `lt` / `lte` | `>` / `>=` / `<` / `<=` | |
| `ilike` | `"col" ILIKE %s` | шаблон передаётся как есть |
| иное | исключение `Неизвестный оператор: <op>` | например, `not_in`, `not_neq` из SDK `.not()` не поддерживаются |

Отсутствие ключа `col` или `op` в фильтре → `KeyError` → `error.message` = `'col'`/`'op'`.

**Скрытые фильтры для демо-аккаунта (только `select`):**
- `profiles` — добавляется `id <> 'demo-director-profile'`;
- `schedule_config`, `employee_schedule_settings`, `salary_data` — `profile_id IS DISTINCT FROM 'demo-director-profile'`.

**Row-level проверки:** отсутствуют. Нет ни фильтрации по `company_id`, ни проверки `user_id`/владельца, ни ролей для записи.

### 2.3. Операции

#### `select`

- **Назначение:** чтение строк.
- **Кто может вызвать:** любой валидный токен (сессия или API-токен).
- **Вход:** `table`, `filters`, `order`, `limit`, `single_mode`.
- **Проверки и ошибки:** таблица вне списка → 200 + error; нет токена → 401; ошибки идентификаторов/операторов/SQL → 200 + error; `single_mode='single'` и нет строк → `200 {"data": null, "error": {"message": "Запись не найдена", "code": "PGRST116"}}`.
- **Логика по шагам:**
  1. Аутентификация.
  2. `_build_where(filters)` + демо-фильтры.
  3. `ORDER BY "col" ASC|DESC`, `LIMIT n`.
  4. `SELECT * FROM "schema"."table" [WHERE ...] [ORDER BY ...] [LIMIT n]`; `COMMIT`.
  5. `single_mode`: если строк нет — `maybe` → `data: null, error: null`, `single` → ошибка PGRST116; если есть — возвращается **первая** строка (несколько строк ошибкой не считаются).
- **Таблицы:** чтение указанной таблицы; при API-токене — запись `api_tokens.last_used_at`.
- **Ответ:** `200 {"data": [{...}, ...], "error": null}` или `200 {"data": {...}, "error": null}` для single/maybe.
- **Побочные эффекты:** нет.

#### `insert`

- **Назначение:** вставка одной или нескольких строк.
- **Кто может вызвать:** любой валидный токен.
- **Вход:** `table`, `payload` (объект или массив объектов), `single_mode` (учитывается только `'single'`).
- **Проверки и ошибки:** как выше; недопустимое имя колонки → 200 + error; ошибки ограничений БД (дубли ключей и т.п.) → 200 + error.
- **Логика по шагам:**
  1. `items = payload` (если массив) иначе `[payload]`; `None` → `{}`.
  2. Для каждой строки: если нет `id` или он пустой — `id = uuid4()` (строкой).
  3. Проверка всех ключей `_check_ident`.
  4. `INSERT INTO "schema"."table" ("c1", ...) VALUES (%s, ...) RETURNING *` — по одному запросу на строку; dict/list → `json.dumps`.
  5. После всех — `COMMIT` (одна транзакция: при ошибке на N-й строке ничего не сохраняется).
- **Таблицы:** запись указанной таблицы.
- **Ответ:** `200 {"data": [{...}], "error": null}`; при `single_mode='single'` — `{"data": {...}}`.
- **Побочные эффекты:** новые строки. Локальная переменная `now` вычисляется, но не используется.

#### `update`

- **Назначение:** обновление строк по фильтрам.
- **Кто может вызвать:** любой валидный токен.
- **Вход:** `table`, `filters` (обязательно), `payload` (объект).
- **Проверки и ошибки:** пустые `filters` → `400 {"error": "update требует хотя бы один фильтр"}` (обратите внимание: `error` — строка, а не объект, в отличие от остальных ответов); пустой `payload` → синтаксическая ошибка SQL → 200 + error.
- **Логика по шагам:**
  1. `_build_where(filters)`.
  2. `_check_ident` для ключей `payload`.
  3. `UPDATE "schema"."table" SET "c1" = %s, ... WHERE ... RETURNING *`; `COMMIT`.
- **Таблицы:** запись указанной таблицы.
- **Ответ:** `200 {"data": [<обновлённые строки>], "error": null}`.
- **Побочные эффекты:** изменение строк. Демо-фильтры к update не применяются. Фильтр вида `{"col":"id","op":"neq","value":"x"}` позволяет обновить почти всю таблицу.

#### `delete`

- **Назначение:** удаление строк по фильтрам.
- **Кто может вызвать:** любой валидный токен.
- **Вход:** `table`, `filters` (обязательно).
- **Проверки и ошибки:** пустые `filters` → `400 {"error": "delete требует хотя бы один фильтр"}`.
- **Логика по шагам:** 1. `_build_where`. 2. `DELETE FROM "schema"."table" WHERE ... RETURNING *`; `COMMIT`.
- **Таблицы:** запись указанной таблицы.
- **Ответ:** `200 {"data": [<удалённые строки>], "error": null}`.
- **Побочные эффекты:** удаление строк.

#### Неизвестная операция

- `400 {"error": "Неизвестная операция: <op>"}` (строка 288).

### 2.4. Как вызывает фронтенд

`src/lib/sdk.ts:28-45`: `fetch(DATA_API_URL, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Authorization': <token из localStorage>}})`. Если токена нет — заголовок не передаётся (получится 401). Ошибки сети превращаются в `{data: null, error: {message}}`. HTTP-статус ответа не анализируется — возвращается тело как есть.

---

## 3. file-upload

### 3.1. Общие сведения

- **Назначение:** загрузка файла (base64) в S3-совместимое хранилище и выдача публичной CDN-ссылки.
- **URL key:** `file-upload`.
- **HTTP-методы:** `OPTIONS` → 200; не-`POST` → `405 {"error": "Используйте POST"}`. CORS: `*`, `POST, OPTIONS`, заголовки `Content-Type, X-Authorization`.
- **Токен:** `_extract_token` (строки 30–35) — `X-Authorization` / `x-authorization` / `body.token`, срез `Bearer `.
- **Аутентификация** (`_authenticate`, строки 38–64): отдельное соединение; `SELECT user_id FROM auth_sessions WHERE token=%s AND expires_at > now()`; иначе `SELECT user_id FROM api_tokens WHERE token=%s AND revoked_at IS NULL` + `UPDATE api_tokens SET last_used_at = now()` + `COMMIT`. Возвращает `user_id` или `None`. Ролей нет.
- **Env:** `DATABASE_URL`, `MAIN_DB_SCHEMA`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- **Константы:** `BUCKET = 'files'`, endpoint `https://bucket.poehali.dev`.
- **requirements.txt:** `boto3`, `psycopg2-binary`.
- **tests.json** (3 теста): `OPTIONS preflight` → 200; `GET not allowed` → 405; `No token is rejected` (файл `test.txt`) → 401.

### 3.2. Операции

У функции одна операция (без поля `action`).

#### `upload` (POST без action)

- **Назначение:** сохранить файл в S3 и вернуть URL.
- **Кто может вызвать:** любой валидный токен (сессия сайта или API-токен).
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `file_base64` | string | фактически да | Base64 или data-URL (`data:...;base64,` срезается по первой запятой). По умолчанию `''` → пустой файл. |
| `file_name` | string | нет | По умолчанию `file`; используется только для расширения (часть после последней точки). |
| `content_type` | string | нет | По умолчанию `application/octet-stream`; передаётся в S3 как есть. |
| `folder` | string | нет | Префикс ключа, по умолчанию `documents`; не валидируется. Фронтенд передаёт сюда имя «bucket» из `storage.upload(bucket, file)`. |
| `token` | string | нет | Альтернатива заголовку. |

- **Проверки и ошибки:**
  - нет/невалидный токен → `401 {"error": "Не авторизован: нужен действующий токен входа"}`;
  - любое исключение (невалидный JSON, невалидный base64, ошибка S3/БД, отсутствие env) → `500 {"error": "<текст исключения>"}`.
- **Логика по шагам:**
  1. Парсинг JSON, извлечение токена, `_authenticate`.
  2. Срез data-URL префикса, `base64.b64decode`.
  3. `ext = '.' + file_name.rsplit('.',1)[-1]`, если в имени есть точка.
  4. `key = f'{folder}/{uuid4()}{ext}'`.
  5. `s3.put_object(Bucket='files', Key=key, Body=bytes, ContentType=content_type)`.
  6. URL: `https://cdn.poehali.dev/projects/<AWS_ACCESS_KEY_ID>/bucket/<key>`.
- **Таблицы:** чтение `auth_sessions`, `api_tokens`; запись `api_tokens.last_used_at` (только при API-токене).
- **Ответ:** `200 {"url": "https://cdn.poehali.dev/projects/<key_id>/bucket/documents/3f2c...e1.pdf"}`
- **Побочные эффекты:** объект в бакете `files` с ключом `<folder>/<uuid4><ext>`; публично доступен по CDN. В БД запись о файле не создаётся (это делает фронтенд через data-api, например в `documents`/`base_files`). Удаления файлов нет. Размер не ограничивается (кроме лимитов платформы).

---

## 4. vk-api

### 4.1. Общие сведения

- **Назначение:** привязка сотрудника к VK по 6-значному коду (генерация, статус, отвязка, список привязок) и рассылка табеля/зарплаты сообщениями от имени сообщества VK.
- **URL key:** `vk-api`.
- **HTTP-методы:** `OPTIONS` → 200; `GET` — действия `status`, `bindings_list` (параметры из query-string); `POST` — `generate_code`, `unbind`, `broadcast` (JSON-тело); прочие методы → `405 {"error": "Метод не поддерживается"}`.
- **CORS:** `*`, `GET, POST, OPTIONS`, заголовки `Content-Type, X-User-Id, X-Auth-Token, X-Session-Id` (заголовок `X-Authorization` отсутствует в списке).
- **Токен/заголовки:** **не читаются вообще.** Ни одно действие не проверяет сессию, API-токен или роль. Заголовки `X-User-Id`, `X-Auth-Token`, `X-Session-Id` разрешены в CORS, но в коде не используются.
- **Обработка ошибок:** весь обработчик в `try`; любое исключение (включая невалидный JSON в POST, ошибки VK API, БД) → `500 {"error": "<текст>"}`.
- **Хелперы:**
  - `vk_call(method, params)` (33–41): `requests.post('https://api.vk.com/method/<method>', data={..., access_token=VK_GROUP_TOKEN, v='5.199'}, timeout=15)`; при `error` в ответе — `RuntimeError(error_msg)`.
  - `generate_code`, `get_status`, `get_all_bindings`, `unbind`, `upload_photo_attachment`, `send_broadcast` — описаны в действиях.
- **Env:** `DATABASE_URL`, `MAIN_DB_SCHEMA`, `VK_GROUP_TOKEN` (токен сообщества с правом сообщений и фото).
- **requirements.txt:** `psycopg2-binary`, `requests`.
- **tests.json** (5 тестов): `OPTIONS preflight` → 200; `GET status without profile_id fails` → 400; `POST unknown action fails` → 400; `Generate code for test profile` (`profile_id: test-profile-tests-json`) → 200 `{code: string}` — **реально пишет в `vk_bind_codes`**; `Status returns generated pending code` → 200 `{code: string}`.

### 4.2. Действия

#### `status` (GET)

- **Назначение:** текущий pending-код профиля и состояние подтверждённой привязки.
- **Кто может вызвать:** **без входа** (любой, знающий `profile_id`).
- **Вход (query):** `action=status`, `profile_id` (string, да).
- **Проверки и ошибки:** нет `profile_id` → `400 {"error": "profile_id обязателен"}`.
- **Логика по шагам:**
  1. `SELECT code FROM vk_bind_codes WHERE profile_id = %s AND status = 'pending' ORDER BY created_at DESC LIMIT 1`.
  2. `SELECT vk_user_id, vk_link, status, message FROM vk_bindings WHERE profile_id = %s`.
- **Таблицы:** чтение `vk_bind_codes`, `vk_bindings`.
- **Ответ:**
```json
{"code": "482913", "binding": {"vk_user_id": 123456, "vk_link": null, "status": "confirmed", "message": "Подтверждено ботом VK"}}
```
(`code`/`binding` могут быть `null`).
- **Побочные эффекты:** нет. Фронтенд: `vkBinding.ts:34-44` (`getVkBindCode`), `:47-56` (`getVkStatus`) — без токена.

#### `bindings_list` (GET)

- **Назначение:** все подтверждённые привязки (для рассылок).
- **Кто может вызвать:** **без входа**.
- **Вход (query):** `action=bindings_list`.
- **Проверки и ошибки:** нет.
- **Логика по шагам:** `SELECT profile_id, vk_user_id FROM vk_bindings WHERE status = 'confirmed' AND vk_user_id IS NOT NULL`.
- **Таблицы:** чтение `vk_bindings`.
- **Ответ:** `200 {"bindings": [{"profile_id": "...", "vk_user_id": 123456}]}`
- **Побочные эффекты:** нет. Фронтенд: `vkBinding.ts:59-73` — без токена.

#### Неизвестное GET-действие

- `400 {"error": "Неизвестное действие"}` (строка 187).

#### `generate_code` (POST)

- **Назначение:** создать новый 6-значный код привязки VK для профиля.
- **Кто может вызвать:** **без входа**; существование `profile_id` не проверяется.
- **Вход:** `action`, `profile_id` (string, да).
- **Проверки и ошибки:** нет `profile_id` → `400 {"error": "profile_id обязателен"}`; за 50 попыток нет свободного кода → `RuntimeError` → `500 {"error": "Не удалось сгенерировать код привязки"}`.
- **Логика по шагам:**
  1. `DELETE FROM vk_bind_codes WHERE profile_id = %s AND status = 'pending'`.
  2. До 50 раз: `candidate = f'{random.randint(0, 999999):06d}'` (модуль `random`, не криптостойкий); `SELECT 1 FROM vk_bind_codes WHERE code = %s` (проверка по всем статусам, включая `confirmed`).
  3. `INSERT INTO vk_bind_codes (profile_id, code, status) VALUES (%s, %s, 'pending')`; `COMMIT`.
- **Таблицы:** чтение/запись `vk_bind_codes`.
- **Ответ:** `200 {"code": "482913"}`
- **Побочные эффекты:** старые pending-коды профиля удаляются. Срока действия у кода нет (`created_at` нигде не проверяется). Фронтенд: `vkBinding.ts:17-31` — без токена.

#### `unbind` (POST)

- **Назначение:** отвязать VK от профиля.
- **Кто может вызвать:** **без входа**.
- **Вход:** `action`, `profile_id` (string, да).
- **Проверки и ошибки:** нет `profile_id` → `400 {"error": "profile_id обязателен"}`.
- **Логика по шагам:**
  1. `DELETE FROM vk_bindings WHERE profile_id = %s`.
  2. `DELETE FROM vk_bind_codes WHERE profile_id = %s` (все статусы).
  3. `COMMIT`.
- **Таблицы:** запись `vk_bindings`, `vk_bind_codes`.
- **Ответ:** `200 {"ok": true}`
- **Побочные эффекты:** удаление привязки и кодов. Поля `profiles.vk_link`/`vk_id` очищает уже фронтенд через data-api (`vkBinding.ts:76-83`).

#### `broadcast` (POST)

- **Назначение:** отправить сообщения (табель/расчёт зарплаты) пользователям VK от имени сообщества, опционально с одним фото-вложением на всех.
- **Кто может вызвать:** **без входа и без роли.** В `handler` (строки 207–212) и `send_broadcast` (139–162) нет никакой проверки токена, сессии или роли. Ограничение `can('salary.broadcast')` существует только в UI (`src/pages/Salary.tsx:774`); запросы фронтенда идут без токена (`Schedule.tsx:503-507`, `Salary.tsx:581-585`).
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `items` | array | да | Непустой список `{vk_user_id, message}`. `vk_user_id` — любой числовой ID VK (не проверяется по `vk_bindings`). |
| `items[].vk_user_id` | number/string | да | Приводится `int()`; ошибка → элемент считается неудачным. |
| `items[].message` | string | нет | По умолчанию `''`. |
| `photo_base64` | string | нет | PNG в base64/data-URL (берётся часть после последней запятой). |

- **Проверки и ошибки:** `items` не список или пуст → `400 {"error": "items обязателен и не должен быть пустым"}`. Ошибки отправки отдельным получателям не прерывают рассылку. Лимита на количество элементов нет.
- **Логика по шагам:**
  1. Если есть `photo_base64` — `upload_photo_attachment`:
     a. `vk_call('photos.getMessagesUploadServer')` → `upload_url`;
     b. `requests.post(upload_url, files={'photo': ('tabel.png', bytes, 'image/png')}, timeout=20)`;
     c. `vk_call('photos.saveMessagesPhoto', {photo, server, hash})` → `attachment = "photo<owner_id>_<id>"`.
     Любая ошибка → вложение просто не прикрепляется.
  2. Для каждого элемента: `vk_call('messages.send', {user_id, message, random_id = randint(1, 2^31-1), [attachment]})`; успех → `sent += 1`, исключение → `failed += 1`.
- **Таблицы:** нет.
- **Ответ:** `200 {"sent": 12, "failed": 1}`
- **Побочные эффекты:** реальные сообщения в VK от имени сообщества; загрузка фото на серверы VK.

#### Неизвестное POST-действие

- `400 {"error": "Неизвестное действие"}` (строка 214).

---

## 5. vk-webhook

### 5.1. Общие сведения

- **Назначение:** приёмник Callback API сообщества VK: подтверждение адреса сервера и обработка входящих сообщений с 6-значным кодом привязки.
- **URL key:** `vk-webhook` (этот URL указывается в настройках Callback API сообщества).
- **HTTP-методы:** `OPTIONS` → 200 (CORS: `*`, `POST, OPTIONS`, `Content-Type`). Метод остальных запросов не проверяется — любой метод обрабатывается как событие (тело парсится; ошибка парсинга → `{}`).
- **Токен/заголовки:** не проверяются. Поле `secret` Callback API и `group_id` **не проверяются**.
- **Ответы:** `Content-Type: text/plain`; для `confirmation` — строка подтверждения, для всего остального — `ok` (VK требует именно `ok`).
- **Хелперы:**
  - `vk_call` (20–28): `urllib.request` POST на `https://api.vk.com/method/<method>` с `access_token=VK_GROUP_TOKEN`, `v=5.199`, `timeout=10`; ошибки VK (поле `error`) **не** превращаются в исключение — возвращается `None`.
  - `reply(user_id, text)` (31–39): `messages.send` со случайным `random_id`; любые исключения глушатся.
  - `CODE_RE = ^\d{6}$`.
- **Env:** `DATABASE_URL`, `MAIN_DB_SCHEMA`, `VK_GROUP_TOKEN`, `VK_CALLBACK_CONFIRMATION`.
- **requirements.txt:** `psycopg2-binary` (HTTP — стандартный `urllib`).
- **tests.json** (2 теста): `OPTIONS preflight` → 200; `Unknown event type returns ok` (`type: unknown_event`) → 200, тело `ok`.

### 5.2. Обрабатываемые события

#### `confirmation`

- **Назначение:** подтверждение адреса сервера при настройке Callback API.
- **Кто может вызвать:** без входа.
- **Вход:** `{"type": "confirmation", "group_id": ...}` — `group_id` не проверяется.
- **Проверки и ошибки:** нет.
- **Логика:** вернуть значение `VK_CALLBACK_CONFIRMATION` (пустую строку, если переменная не задана).
- **Таблицы:** нет.
- **Ответ:** `200`, `text/plain`, тело — строка подтверждения (например `a1b2c3d4`).
- **Побочные эффекты:** нет.

#### `message_new`

- **Назначение:** обработать входящее сообщение сообществу; если это код привязки — подтвердить привязку.
- **Кто может вызвать:** без входа (подпись/secret не проверяется — любой, кто знает URL).
- **Вход:**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `type` | string | да | `message_new` |
| `object.message.text` | string | нет | Текст, обрезается `strip()`. |
| `object.message.from_id` | number | да (для действий) | ID отправителя VK. |

- **Проверки и ошибки:** HTTP-ошибок нет; при ошибке БД — необработанное исключение (5xx, VK будет повторять доставку).
- **Логика по шагам (привязка по коду):**
  1. Если `from_id` пуст — ничего не делать, ответ `ok`.
  2. Если `text` соответствует `^\d{6}$`:
     a. `SELECT profile_id FROM vk_bind_codes WHERE code = %s AND status = 'pending' ORDER BY created_at DESC LIMIT 1`.
     b. Если найден:
        - `UPDATE vk_bind_codes SET status = 'confirmed' WHERE code = %s` (все строки с этим кодом);
        - `INSERT INTO vk_bindings (profile_id, vk_user_id, status, message) VALUES (%s, %s, 'confirmed', 'Подтверждено ботом VK') ON CONFLICT (profile_id) DO UPDATE SET vk_user_id = EXCLUDED.vk_user_id, status = 'confirmed', message = EXCLUDED.message, updated_at = now()`;
        - `COMMIT`;
        - ответ пользователю: «✅ Готово! Ваш профиль в АнодБИЗ привязан к VK. Сюда будут приходить табель и расчёт зарплаты.»
     c. Если не найден — ответ: «⚠️ Код не найден или уже использован. Получите новый код в личном кабинете и отправьте его сюда ещё раз.»
  3. Иначе (любое другое сообщение) — ответ: «Здравствуйте! Чтобы привязать аккаунт, отправьте сюда 6-значный код из личного кабинета АнодБИЗ (раздел «Сотрудники» → «Привязка VK»).»
- **Таблицы:** чтение/запись `vk_bind_codes`, запись `vk_bindings`.
- **Ответ:** `200`, `text/plain`, `ok`.
- **Побочные эффекты:** сообщение-ответ в VK; привязка `profile_id → vk_user_id`. Поля `vk_bindings.vk_link` и `profiles.vk_id`/`vk_link` не заполняются. Дедупликации по `event_id` нет — при повторной доставке события пользователь может получить второй ответ («Код не найден…»).

#### Прочие события

- Любой другой `type` (или его отсутствие) → `200 ok`, никаких действий.

### 5.3. Полный сценарий привязки VK

1. Сотрудник/директор в ЛК вызывает `vk-api` `generate_code` (`vkBinding.ts:createVkBindCode`) → в `vk_bind_codes` создаётся `pending`-код.
2. Пользователь пишет код сообществу VK.
3. VK присылает `message_new` в `vk-webhook` → код помечается `confirmed`, создаётся/обновляется `vk_bindings` (`confirmed`, `vk_user_id = from_id`), бот отвечает «✅ Готово!…».
4. ЛК опрашивает `vk-api` `status` и видит `binding.status = confirmed`.
5. При рассылке ЛК берёт `bindings_list` и отправляет `broadcast` с `vk_user_id` получателей.
6. Отвязка: `vk-api` `unbind` + очистка `profiles.vk_link/vk_id` через data-api.

---

### Замечания по безопасности

1. **vk-api `broadcast` не требует ни аутентификации, ни роли** — `backend/vk-api/index.py:207-212` (и `send_broadcast`, `:139-162`): нет чтения какого-либо токена. Любой, кто знает публичный URL функции, может рассылать произвольный текст и картинки от имени сообщества любым пользователям VK, разрешившим сообщения сообществу (`vk_user_id` не сверяется с `vk_bindings`, лимита на число `items` нет). Ограничение `can('salary.broadcast')` есть только в UI (`src/pages/Salary.tsx:774`); запросы уходят без токена (`src/pages/Schedule.tsx:503-507`, `src/pages/Salary.tsx:581-585`).
2. **vk-api: все остальные действия тоже без аутентификации** — `backend/vk-api/index.py:174-205`. `bindings_list` раскрывает соответствие `profile_id → vk_user_id` всех сотрудников; `unbind` позволяет отвязать любого; `generate_code` создаёт код для произвольного `profile_id` без проверки существования. Фронтенд вызывает их без токена (`src/lib/vkBinding.ts:19-23, 36, 49, 61, 77-81`). CORS (`:16`) даже не разрешает `X-Authorization`.
3. **Перехват рассылки зарплаты через привязку VK.** `status` (`backend/vk-api/index.py:179-182`, `:76-78`) без входа отдаёт текущий pending-код любого профиля, а `generate_code` позволяет злоумышленнику самому создать код для чужого `profile_id`. Отправив этот код сообществу со своего аккаунта, злоумышленник привяжет свой VK к чужому профилю (`backend/vk-webhook/index.py:78-95`) и будет получать табель/расчёт зарплаты жертвы.
4. **vk-webhook не проверяет `secret` и `group_id` Callback API** — `backend/vk-webhook/index.py:64-74`. Любой может отправить поддельный `message_new` с произвольным `from_id` и кодом и подтвердить привязку. Коды 6-значные, генерируются некриптостойким `random` (`backend/vk-api/index.py:54`), не имеют срока действия (`created_at` не проверяется) — перебор 10^6 значений без ограничения частоты реален.
5. **data-api без row-level проверок и ролей** — `backend/data-api/index.py:196-288`: после `_authenticate` переменная `user` не используется. Любой вошедший (в т.ч. рядовой сотрудник или любой токен устройства) может читать/изменять/удалять любые строки во всех 22 таблицах белого списка (`:15-21`), включая зарплаты, документы, чужие сообщения чата, `devices`. Нет изоляции по компании.
6. **Эскалация привилегий через `profiles.role`.** `get_roles` (`backend/auth-api/index.py:248-255`) берёт роль из `profiles.role`, а эту колонку может переписать любой вошедший через data-api (`update` в `profiles`, `backend/data-api/index.py:257-273`), например выставив себе `deputy_director`. Дополнительно запрос подбирает профиль по `lower(email)`, если по `user_id` не найден, — можно создать профиль с чужим email.
7. **Утечка PIN-кодов через data-api + вход без пароля.** Таблица `pin_codes` в белом списке (`backend/data-api/index.py:16`): любой вошедший получает все PIN, email и `adpod_slug`, после чего `pin_signin` (`backend/auth-api/index.py:194-222`) даёт сессию любого сотрудника без пароля.
8. **auth-api: управление устройствами и паролями без проверки роли.** `list_devices` (`:339-357`), `link_device` (`:359-420`), `revoke_device` (`:422-436`), `set_employee_password` (`:490-525`) проверяют только наличие сессии (`require_session_user`, `:105-109`), а не `is_admin`/роль. Любой сотрудник может сменить пароль любого профиля (`:519-523`) или через `link_device` с непустым `password` перезаписать `password_hash` существующей учётки (`:406-411`), в т.ч. директора, — захват аккаунта.
9. **Получение токенов чужих устройств.** `list_devices` отдаёт любому вошедшему `device_code` всех ПК (`backend/auth-api/index.py:345-356`); `device_status` без входа (`:312-337`) многократно возвращает постоянный `api_token` для любого привязанного кода. Также `devices` доступна через data-api. Итог: любой вошедший получает бессрочные токены других сотрудников.
10. **Перебор PIN без ограничений.** `pin_lookup` (`backend/auth-api/index.py:177-192`) без входа и без rate-limit раскрывает email и ФИО по PIN (10 000 вариантов; при пустом `adpod_slug` проверка slug пропускается, `:188`); `pin_signin` (`:194-222`) при известном slug выдаёт сессию перебором 10 000 значений.
11. **Нет ограничения попыток** для `signin` (`:163-175`), `device_signin` (`:527-551`), `device_status` (9-значные коды, `:312`); `api_verify` (`:553-570`) — открытый оракул проверки API-токенов, возвращает email и `is_admin`.
12. **Открытая регистрация; первый пользователь — администратор** — `backend/auth-api/index.py:139-161`, `:151-152`. Регистрация никак не ограничена (любой может создать учётку и сразу получить доступ к data-api со всеми данными — см. п. 5).
13. **`register_device` без входа и без лимитов** (`backend/auth-api/index.py:288-310`) — возможность засорить таблицу `devices`; ветка доступна даже по GET (`:126-130`).
14. **`revoke_api_token` отзывает и токены устройств** (`backend/auth-api/index.py:280-283`), а `get_or_create_api_token` может вернуть токен устройства как «общий» (`:77-84`, нет фильтра `device_code IS NULL`) — путаница типов токенов; смена пароля (`set_employee_password`, `link_device`) не аннулирует существующие сессии и токены.
15. **`signin` возвращает постоянный API-токен в каждом ответе** (`backend/auth-api/index.py:173-175`) — бессрочный секрет попадает в браузер при каждом входе.
16. **file-upload: произвольный `folder` и `content_type`** — `backend/file-upload/index.py:86-87, 96, 104`. Префикс ключа не валидируется, а `content_type` (например, `text/html`) сохраняется как есть и отдаётся публичным CDN — возможен хостинг произвольного контента/HTML. Ограничения размера нет, ссылки публичные и бессрочные; текст исключений отдаётся клиенту (`:108-109`).
17. **Раскрытие внутренних ошибок.** data-api возвращает текст исключений PostgreSQL в `error.message` (`backend/data-api/index.py:290-291`), vk-api — `str(e)` (`backend/vk-api/index.py:217-218`). Проверка белого списка таблиц в data-api выполняется до аутентификации (`:178-180`).
18. **Тестовые побочные эффекты в проде.** `tests.json` auth-api создаёт реальное устройство (`register_device`), vk-api — реальный код для `test-profile-tests-json`. Статический CI-токен `anod_test_static_token_for_ci_only` (миграция `V0008`) отозван миграцией `V0017`.

---

# 2. Бухгалтерия (accounting-api)

Исходники: `/app/webapp/backend/accounting-api/`
- `index.py` (897 строк) — обработчик, все actions, синхронизация месяцев, отчёты.
- `access.py` — права по должностям (файл идентичен в `admin-api`).
- `formulas.py` — формулы зарплаты и безопасный калькулятор (идентичен в `admin-api`).
- `bank.py` — разбор выписки СберБизнес (1С `.txt` и Excel).
- `salary_weekly.py` — автоматические еженедельные выплаты (идентичен в `sber-api`).
- `tests.json` — 4 smoke-теста; `requirements.txt` — `psycopg2-binary`, `openpyxl`.
- Клиент: `/app/webapp/src/lib/accountingApi.ts` (`accCall`), компоненты `src/components/accounting/*`.

### Содержание

1. Назначение и общий протокол
2. Авторизация и права (`access.py`)
3. Журнал `acc_log`
4. Формулы (`formulas.py`)
5. Банковская выписка (`bank.py`)
6. Еженедельные выплаты (`salary_weekly.py`)
7. Синхронизация месяца, закрытие/открытие, snapshot
8. Справочник actions
9. Замечания по безопасности и корректности

---

### 1. Назначение и общий протокол

Бухгалтерия «как в 1С»: доходы/расходы по статьям, автоматический перенос в учёт ИТОГО к выдаче из раздела «Зарплата» и фактической инкассации, закрытие месяца, прибыль, отчёт ДДС, план-факт бюджет, контрагенты и взаиморасчёты, зарплата с долгами и расчётными листками, импорт банковской выписки.

**Транспорт.** Один URL (`func2url.json['accounting-api']`), только `POST` с JSON-телом `{"action": "...", ...}`.

| Шаг `handler` (index.py:793–897) | Результат |
|---|---|
| `OPTIONS` | `200`, пустое тело, CORS-заголовки |
| метод не `POST` | `405 {"error": "Метод не поддерживается"}` |
| `json.loads(body)` | при невалидном JSON — необработанное исключение (500) |
| подключение к БД `DATABASE_URL`, `autocommit = True` | каждая SQL-команда фиксируется сразу, транзакций нет |
| `current_user()` вернул `None` | `401 {"error": "Нужно войти в систему"}` |
| в `user.sections` нет `/accounting` | `403 {"error": "Нет доступа к бухгалтерии"}` |
| разбор общих параметров | `date_from`/`date_to` → `_range()` (по умолчанию `2000-01-01`…`2100-12-31`); `period` (`YYYY-MM`, иначе текущий месяц) |
| чтение (`me`, `settings_save`, `periods`, `entries`, `profit`, `dds`, `budget`, `counterparties`, `cp_history`, `salary_due`, `salary`, `payslip`) | обрабатываются прямо в `handler` |
| всё остальное | `_edit()` (index.py:508) |

CORS: `Access-Control-Allow-Origin: *`, методы `POST, OPTIONS`, заголовки `Content-Type, X-Authorization`, `Max-Age 86400`.

Формат ответа: `_resp()` сериализует через `json.dumps(..., default=str)` — даты и `Decimal` уходят строками/числами через `str`. Ошибка — `{"error": "текст"}` (`_err`, по умолчанию 400).

Клиент (`accCall`): берёт токен из `localStorage['anod_session_token']`, шлёт в `X-Authorization`; при сетевой ошибке возвращает `{error: 'Нет связи с сервером'}`, при не-2xx без `error` — `{error: 'Ошибка сервера'}`.

**Вспомогательные валидаторы (index.py):**

| Функция | Строки | Поведение |
|---|---|---|
| `_money(v, allow_zero=False)` | 40–47 | убирает пробелы, `,`→`.`, `Decimal` с округлением до 0.01; `None`, если не число, `< 0`, `== 0` (без `allow_zero`) или `> 999 999 999 999` |
| `_date(v)` | 50–54 | первые 10 символов как ISO `YYYY-MM-DD`, иначе `None` |
| `PERIOD_RE` | 24 | `^\d{4}-(0[1-9]|1[0-2])$` |
| `_my(period)` | 65 | `YYYY-MM` → `MM.YYYY` (формат таблиц «Зарплаты»/«Инкассации») |
| `_last_day(period)` | 69 | последний день месяца ISO |
| `_cat_id(kind, name)` | 84–90 | ищет статью без учёта регистра, **создаёт, если нет** |
| `_setting(key, default)` | 93 | чтение `app_settings.value` (JSON) |
| `_start()` | 101 | `app_settings['accounting'].start_period`, иначе `2000-01` — месяц начала учёта |
| `_closed()` / `_is_closed(period)` | 106–115 | состояние `acc_periods` |
| `_guard_period(d)` | 502–505 | если месяц даты `d` закрыт → 400 `Месяц MM.YYYY закрыт — изменения запрещены. Откройте месяц, если нужно поправить.` |

Константы: `KINDS = {income, expense}`, `PAY_TYPES = {salary, percent, hourly, tabel}`, статьи `CAT_EMP = 'Зарплата сотрудников'`, `CAT_MGR = 'Зарплата руководителей'`, `CAT_COL = 'Инкассация'`, `CP_KINDS = {supplier: Поставщик, customer: Покупатель, landlord: Арендодатель, other: Прочее}`.

#### Используемые таблицы

| Таблица | Роль |
|---|---|
| `acc_entries` | операции доход/расход (`kind, entry_date, amount, category_id, comment, counterparty_id, period, source, source_key, payment_id, bank_purpose, void, created_by, updated_at`); уникальность `(source, source_key) WHERE source IS NOT NULL` |
| `acc_categories` | статьи (`kind, name, archived`) |
| `acc_counterparties` | контрагенты (`name, kind, inn, phone, comment, archived, account, default_category_id`) |
| `acc_cp_docs` | документы контрагентов (`counterparty_id, direction in/out, doc_date, amount, comment, created_by`) |
| `acc_budget` | план (`period, category_id, amount`), уникальность `(period, category_id)` |
| `acc_staff` | сотрудники зарплатного учёта (`name, profile_id, position, pay_type, rate, active`) |
| `acc_accruals` | начисления (`staff_id, period, pay_type, rate, base, bonus, amount, comment, created_by, source_key, details, void`), уникальность `source_key WHERE NOT NULL` |
| `acc_payments` | выплаты (`staff_id, pay_date, amount, period, comment, created_by, source_key`) |
| `acc_periods` | месяцы (`period, closed, closed_at, closed_by, synced_at, snapshot, fingerprint`) |
| `acc_bank_imports` | журнал загрузок выписок |
| `acc_log` | журнал действий |
| `app_settings` | ключи `accounting`, `formulas`, `fields` |
| `salary_settings`, `salary_data`, `manager_settings`, `manager_data`, `collection_data` | исходные данные разделов «Зарплата» и «Инкассация» (только чтение) |
| `profiles`, `positions`, `auth_sessions`, `auth_users`, `api_tokens` | авторизация |

---

### 2. Авторизация и права (`access.py`)

#### `current_user(cur, schema, event)` (access.py:71–116)

1. Токен: заголовок `X-Authorization` (или `x-authorization`), префикс `Bearer ` удаляется. Пусто → `None` (401).
2. Поиск сессии: `auth_sessions` JOIN `auth_users` по `token` и `expires_at > now()`.
3. Если не найдено — `api_tokens` (не отозванные, `revoked_at IS NULL`, без срока действия).
4. Профиль: `profiles` LEFT JOIN `positions` по `p.user_id = u.id` **или** `lower(p.email) = lower(u.email)`, приоритет — совпадение по `user_id`.
5. Роль: `profiles.role`; если профиля нет — `director` при `is_admin`, иначе `employee`. `is_admin` при роли не `director`/`deputy_director` повышает до `director`.
6. Разделы и действия:
   - `deputy_director` — все `SECTIONS` + `/devices`, `/admin`; все `ALL_ACTIONS`.
   - есть должность (`position_id` и найдено `positions.name`) — `positions.sections` (без `/admin`) и `positions.actions` (только известные ключи).
   - иначе — `ROLE_SECTIONS[role]` / `ROLE_ACTIONS[role]` (неизвестная роль → как `employee`).
7. Специальные добавки (поверх должности):
   - `senior_employee`: + `sber.view`, `sber.request`; + разделы `/sber`, `/skud`.
   - `director`: + `sber.view`, `sber.request`, `sber.pay`, `sber.sync`; + раздел `/sber`.
   - всем: `/dashboard` в начало, если отсутствует.
8. Возвращает `{id, profile_id, role, name, position_id, position, sections, actions:set, is_deputy}`. `name` = `full_name` или email — пишется в `created_by`/`acc_log`.

#### SECTIONS (access.py:7–22)

| path | label |
|---|---|
| `/dashboard` | Главная |
| `/documents` | Документация |
| `/base` | База документов |
| `/dto` | ДТО |
| `/chat` | Чат |
| `/cameras` | Камеры |
| `/skud` | СКУД |
| `/schedule` | Табель |
| `/salary` | Зарплата |
| `/collection` | Инкассация |
| `/accounting` | Бухгалтерия |
| `/sber` | СБЕР (оплаты) |
| `/employees` | Сотрудники |
| `/settings` | Настройки |

#### ACTIONS (access.py:24–49)

| key | группа | label |
|---|---|---|
| `accounting.view_entries` | Бухгалтерия | Видеть доходы и расходы |
| `accounting.edit_entries` | Бухгалтерия | Добавлять и изменять операции |
| `accounting.delete_entries` | Бухгалтерия | Удалять операции |
| `accounting.view_reports` | Бухгалтерия | Видеть прибыль и отчёт ДДС |
| `accounting.view_budget` | Бухгалтерия | Видеть план-факт бюджет |
| `accounting.edit_budget` | Бухгалтерия | Составлять план бюджета |
| `accounting.view_counterparties` | Бухгалтерия | Видеть контрагентов и долги |
| `accounting.edit_counterparties` | Бухгалтерия | Вести контрагентов и документы |
| `accounting.view_salary` | Бухгалтерия | Видеть зарплату, долги и листки |
| `accounting.edit_salary` | Бухгалтерия | Начислять и выплачивать зарплату |
| `accounting.close_month` | Бухгалтерия | Закрывать / открывать месяц |
| `sber.view` | СБЕР | Видеть заявки на оплату и выписку |
| `sber.request` | СБЕР | Создавать заявки и отправлять директору |
| `sber.pay` | СБЕР | Оплачивать заявки через СберБизнес |
| `sber.edit_requisites` | СБЕР | Менять реквизиты контрагентов |
| `sber.sync` | СБЕР | Обновлять выписку из банка |
| `salary.view_full` | Зарплата | Видеть полную таблицу |
| `salary.edit` | Зарплата | Вносить часы, выручку, удержания |
| `salary.manage_rows` | Зарплата | Добавлять и удалять сотрудников |
| `salary.lock` | Зарплата | Сохранять, блокировать, разблокировать |
| `salary.broadcast` | Зарплата | Рассылать расчёт в ВК |
| `collection.edit` | Инкассация | Вносить факт и статусы |
| `collection.import` | Инкассация | Загружать файл СБИС |
| `collection.unlock` | Инкассация | Разблокировать закрытый месяц |

`VIEW_ACTIONS` — все ключи, содержащие `.view` (`accounting.view_*` ×5, `sber.view`, `salary.view_full`).

#### ROLE_SECTIONS / ROLE_ACTIONS (без должности)

| Роль | Разделы | Действия |
|---|---|---|
| `director` | все `SECTIONS` | `VIEW_ACTIONS` + `collection.edit`, `collection.import`, `collection.unlock`, `sber.pay`, `sber.sync` (+ добавки `sber.*`) |
| `senior_employee` | dashboard, documents, base, dto, chat, cameras, schedule, salary, collection, settings, sber, skud | `sber.view`, `sber.request` |
| `employee` | dashboard, documents, base, dto, chat, cameras, schedule, salary, collection, settings | — |
| `deputy_director` | все + `/devices`, `/admin` | все |

Следствие: без должности в бухгалтерию попадают только `director` (только просмотр, никаких `edit_*`/`close_month`) и `deputy_director` (всё). Остальным раздел и права выдаются должностью в админ-панели.

---

### 3. Журнал `acc_log`

`_log(cur, user, action, details)` (index.py:79–81): `INSERT INTO acc_log (user_name, action, details)`, `details` обрезается до 500 символов. Пишут только изменяющие actions:

| action в журнале | Кто пишет | details |
|---|---|---|
| `Начало учёта` | `settings_save` | `YYYY-MM` |
| `Добавлена операция` / `Изменена операция` | `entry_save` | `#id: kind amount от date` |
| `Удалена операция` | `entry_delete` | `#id: kind amount от date` |
| `Статья` | `category_save` | название |
| `Месяц открыт` | `period_open` | период |
| `Месяц закрыт` | `period_close` | `период: {JSON результата sync}` |
| `Выписка банка` | `bank_import` | `файл: добавлено N, пропущено M` |
| `План бюджета` | `budget_save` | период |
| `Контрагент` | `counterparty_save` | название |
| `Документ контрагента` / `Удалён документ контрагента` | `cp_doc_save` / `cp_doc_delete` | `#cp: direction amount от date` / `#id` |
| `Сотрудник (зарплата)` | `staff_save` | `ФИО: pay_type rate` |
| `Начисление` / `Удалено начисление` | `accrual_save` / `accrual_delete` | `ФИО за период: сумма` / `#id` |
| `Выплата` / `Удалена выплата` | `payment_save` / `payment_delete` | `ФИО сумма от date за period` / `#id` |

`period_sync`, автосинхронизация и автоплатежи `salary_weekly` в журнал не пишутся. Чтения журнала в этой функции нет.

---

### 4. Формулы (`formulas.py`)

#### DEFAULT_FORMULAS и FORMULA_ORDER

`FORMULA_ORDER = ['rate', 'total', 'week', 'manager_rate', 'manager_total', 'manager_week']`

| Ключ | Формула по умолчанию | Смысл |
|---|---|---|
| `rate` | `revenue / (days * 24) * percent / 100` | ставка сотрудника, ₽/час |
| `total` | `(rate * hours + vacation) - non_cash - overtime - tax + underpayment` | ИТОГО к выдаче сотруднику |
| `week` | `total / 4` | недельная выплата сотруднику |
| `manager_rate` | `rate * (1 + manager_percent / 100)` | ставка руководителя |
| `manager_total` | `((osn_hours * manager_rate) + vacation) - non_cash + doplaty + dop_hours * rate + underpayment` | ИТОГО руководителю |
| `manager_week` | `manager_total / 4` | недельная выплата руководителю |

Глобальные переменные (`GLOBAL_VARS`): `revenue`, `days`, `percent`, `manager_percent`; кроме них в окружении доступны вычисленные `rate`, `manager_rate`, а при расчёте `week` — значение `total`/`manager_total`.

#### DEFAULT_FIELDS

Каждое поле: `key` (колонка таблицы или ключ в `extra`), `var` (имя переменной в формуле), `label`, `visible`, `builtin` (`True` — колонка таблицы, `False` — значение из JSON `extra`), `kind` (`accrual`/`deduction`/`number`).

**salary** (таблица `salary_data`):

| key | var | label | kind |
|---|---|---|---|
| `hours_worked` | `hours` | ЧАСЫ | accrual |
| `vacation_pay` | `vacation` | ОТПУСК | accrual |
| `non_cash` | `non_cash` | БЕЗНАЛ | deduction |
| `overtime` | `overtime` | ПЕРЕБОР | deduction |
| `tax` | `tax` | НАЛОГ | deduction |
| `underpayment` | `underpayment` | НЕДОПЛАТА | accrual |

**manager** (таблица `manager_data`):

| key | var | label | kind |
|---|---|---|---|
| `osn_hours` | `osn_hours` | ОСН. ЧАСЫ | accrual |
| `dop_hours` | `dop_hours` | ДОП. ЧАСЫ | accrual |
| `doplaty` | `doplaty` | ДОПЛАТЫ | accrual |
| `vacation_pay` | `vacation` | ОТПУСК | accrual |
| `non_cash` | `non_cash` | БЕЗНАЛ | deduction |
| `underpayment` | `underpayment` | НЕДОПЛАТА | accrual |

**collection** (таблица `collection_data`):

| key | var | label | kind |
|---|---|---|---|
| `sbis_value` | `sbis` | Сбис ₽ | number |
| `fact_value` | `fact` | Факт ₽ | number |

Все поля по умолчанию `visible: True`, `builtin: True`. `VAR_RE = ^[a-z_][a-z0-9_]{0,40}$` объявлен, но в этом модуле не используется (валидация имён — на стороне `admin-api`).

#### Безопасный калькулятор

`evaluate(expr, env)` (formulas.py:78–83):
1. Пустая формула → `'0'`; `,` заменяется на `.`, `;` — на `,` (разделитель аргументов функций в русской записи).
2. `ast.parse(..., mode='eval')`; `SyntaxError` → `FormulaError('Ошибка в записи формулы')`.
3. Рекурсивный обход `_eval_node` (formulas.py:52–75). Разрешены только:

| Узел | Ограничение |
|---|---|
| `ast.Expression` | корень |
| `ast.Constant` | только `int`/`float` (`bool` — подкласс `int`, тоже проходит) |
| `ast.Name` | имя должно быть в `env`, иначе `Неизвестная переменная «x»`; значение `float(env[x] or 0)` |
| `ast.UnaryOp` | `+`, `-` |
| `ast.BinOp` | `+`, `-`, `*`, `/`; **деление на 0 даёт 0.0** |
| `ast.Call` | функция — `Name` из `FUNCS`, без именованных аргументов |

`FUNCS`: `round(x, n=0)`, `min`, `max`, `abs`, `floor`, `ceil`. Всё прочее (`**`, `%`, `//`, атрибуты, индексы, сравнения, лямбды) → `FormulaError('Разрешены только числа, переменные, + − × ÷, скобки и round/min/max/abs/floor/ceil')`.

`safe_eval` — то же, но любые `FormulaError/TypeError/ValueError/OverflowError` превращаются в `0.0` (ошибочная формула молча даёт ноль).

#### `load_config(cur, schema)` (formulas.py:93–98)

Читает `app_settings` с ключами `formulas` и `fields`.
- `formulas` = `DEFAULT_FORMULAS`, поверх — сохранённые значения **только для известных ключей**.
- `fields[k]` = сохранённый список для `salary`/`manager`/`collection`, если он непустой, иначе дефолт.

#### `global_params(cur, schema)` (formulas.py:101–108)

- `percent` = `salary_settings.percent` из строки с `month_year IS NULL`, по умолчанию `2.5`.
- `manager_percent` = `manager_settings.manager_percent` из строки с `month_year IS NULL`, по умолчанию `5.0`.

Процент глобальный, а не помесячный: его изменение пересчитывает все незакрытые месяцы (через fingerprint).

#### `compute_period(cur, schema, my, cfg, params)` (formulas.py:125–153)

Вход: `my` — месяц `MM.YYYY`.
1. `salary_settings` за месяц: `revenue` (0, если строки нет) и `days_in_month` (30 по умолчанию; 0/NULL → 30).
2. `base = {revenue, days, percent, manager_percent}`; `base.rate = safe_eval(formulas.rate)`, `base.manager_rate = safe_eval(formulas.manager_rate)`.
3. Для двух наборов — (`salary_data`, `emp`, поля `salary`, формула `total`) и (`manager_data`, `mgr`, поля `manager`, формула `manager_total`):
   1. колонки = отсортированные `key` builtin-полей; SQL собирается из этих имён (`'d.' + c`).
   2. `SELECT profile_id, full_name, extra, <колонки>` с LEFT JOIN `profiles`, `WHERE month_year = my`.
   3. `env = base + _row_env(row, fields)`: для каждого поля `var = float(значение или 0)`; builtin — из колонки, иначе из `extra` (JSON).
   4. `raw = safe_eval(формула total, env)`.
   5. `week = safe_eval(формула week, env + {total: raw})` (запасной вариант `total / 4`).
   6. Человек: `{profile_id, name, kind, total: round(raw,2), raw, week: round(week,2), rate: round(rate|manager_rate, 4), values: {key: значение}}`.
4. Возвращает `{base, people}`.

Отрицательный `total` допускается: в сумму расхода попадает `raw`, а начисление создаётся для любого ненулевого `total` (см. раздел 7).

---

### 5. Банковская выписка (`bank.py`)

#### Определение формата — `parse_file(name, data_b64)` (bank.py:155–163)

1. `base64.b64decode` от части после первой запятой (поддерживает data-URL `data:...;base64,`).
2. Имя оканчивается на `.xlsx`/`.xlsm` **или** первые байты `PK` (zip) → `parse_xlsx`.
3. Иначе `_decode`: пробует `utf-8-sig`, затем `cp1251`; UTF-8 принимается только если в тексте есть `1CClientBankExchange` или `СекцияДокумент`; в крайнем случае `cp1251` с заменой ошибок.
4. Нет `СекцияДокумент` → `ValueError('Файл не похож на выписку. В СберБизнес: Выписки → Экспорт → формат «1С» (.txt) или Excel.')`.
5. Иначе `parse_1c`.

Результат обоих парсеров: `{account, date_from, date_to, ops: [{date, kind, amount, number, name, inn, purpose, other_account, doc_type}]}`.

#### Формат 1С `kl_to_1c.txt` — `parse_1c` (bank.py:49–94)

- Строки без `=` пропускаются (кроме `КонецДокумента`).
- `СекцияДокумент=<тип>` открывает документ, `КонецДокумента` закрывает. Пары `Ключ=Значение` вне документа — заголовок (первое значение побеждает, `setdefault`).
- Счёт выписки — `РасчСчет` из заголовка; период — `ДатаНачала`/`ДатаКонца`.
- Направление:
  1. есть `ДатаСписано` → расход, дата = `ДатаСписано`;
  2. есть `ДатаПоступило` → доход, дата = `ДатаПоступило`;
  3. `ПлательщикСчет` (или `ПлательщикРасчСчет`) = счёт выписки → расход, дата = `Дата`;
  4. иначе доход, дата = `Дата`.
- Контрагент: для расхода `Получатель1`/`Получатель`, `ПолучательИНН`; для дохода `Плательщик1`/`Плательщик`, `ПлательщикИНН`. Префикс `ИНН 1234… ` из имени удаляется; из ИНН остаются цифры.
- `amount = round(_num(Сумма), 2)`, `number = Номер`, `purpose = НазначениеПлатежа`, `other_account` = счёт второй стороны, `doc_type` = тип секции.

#### Excel — `parse_xlsx` (bank.py:109–152)

1. `openpyxl` (`read_only`, `data_only`), первый лист.
2. В первых 40 строках ищется строка заголовков: ячейка (в нижнем регистре) равна или начинается с одного из вариантов `HEADERS`; один столбец — одному ключу. Строка принимается, если найдена `date` и хотя бы одна из `debit`/`credit`/`amount`.

| Ключ | Варианты заголовка |
|---|---|
| `date` | дата проводки, дата операции, дата |
| `debit` | сумма по дебету, дебет, списание, расход, сумма списания |
| `credit` | сумма по кредиту, кредит, поступление, приход, сумма поступления |
| `amount` | сумма |
| `name` | контрагент, наименование контрагента, корреспондент, плательщик/получатель, наименование |
| `inn` | инн контрагента, инн |
| `purpose` | назначение платежа, назначение, основание |
| `number` | № документа, номер документа, № док, номер |

   Не нашли → `ValueError('Не нашёл в файле колонки «Дата» и «Сумма». Выгрузите выписку из СберБизнес в формате 1С (.txt) или Excel.')`.
3. Для каждой строки ниже: дата не распознана — пропуск; дебет → расход, кредит → доход; если оба пусты и есть `amount` — знак суммы определяет направление (минус → расход); иначе пропуск.
4. ИНН — первое 10- или 12-значное число в `name + inn`; из имени вырезается `ИНН…`, берётся первая строка, обрезаются `, ;`.
5. `date_from`/`date_to` = min/max дат операций; `account = ''`.

Примечание: заголовок `дата` совпадёт и с «Дата валютирования» и т. п. (используется `startswith`) — берётся первый подходящий столбец слева.

#### Парсинг чисел — `_num` (bank.py:9–21)

Удаляет всё, кроме цифр, `,`, `.`, `-`; `,`→`.`; если точек больше одной — все, кроме последней, считаются разделителями тысяч. Пустое/`-`/`.`/ошибка → `0.0`. Пример: `"1 234,56"` → `1234.56`, `"1.234.567,89"` → `1234567.89`. Знак минус внутри строки (`"12-34"`) даёт `ValueError` → `0.0`.

#### Парсинг дат — `_date` (bank.py:24–35)

Объекты с `strftime` (datetime из Excel) — напрямую. Строка — первые 10 символов в форматах `%d.%m.%Y`, `%Y-%m-%d`, `%d/%m/%Y`, `%d.%m.%y`; иначе `None`.

#### Подбор статьи — `guess_category(op)` (bank.py:166–198)

Текст для поиска: `purpose + ' ' + name` в нижнем регистре; правила, начинающиеся с `^`, проверяются **только по назначению**. Правило применяется, если совпадает `kind` операции. Перебор сверху вниз, первое совпадение побеждает.

| # | Шаблон (regex) | Тип | Статья |
|---|---|---|---|
| 1 | `эквайр\|торгов\w* уступ\|возмещени\w* по операциям\|\bpos\b` | income | Эквайринг (оплата картой) |
| 2 | `^\s*(частичн\w* )?отмен\w* покупк\|^\s*возврат` | income | Возврат по карте |
| 3 | `^\s*покупк` | expense | Покупка по карте |
| 4 | `инкасс\|взнос наличн\|сдача выручки` | income | Инкассация |
| 5 | `ростелеком\|мтс\|мегафон\|билайн\|вымпелком\|теле2\|т2 мобайл\|телеком\|интернет\|услуг\w* связи` | expense | Связь и интернет |
| 6 | `ростелеком\|телеком` | income | Связь и интернет |
| 7 | `теплоресурс\|теплосе\|теплоэнерг\|отоплени\|тепловой энерг\|горяч\w* вод` | expense | Коммунальные услуги (Отопление) |
| 8 | `энергосбыт\|тгк\|электроэнерг\|электрическ\w* энерг\|россети\|мрск\|энергокомп` | expense | Коммунальные услуги (Электроэнергия) |
| 9 | `водоканал\|водоснаб\|водоотвед\|вывоз\|тко\|мусор\|экоинтегратор\|регоператор` | expense | Коммунальные услуги (Вода и вывоз мусора) |
| 10 | `тензор\|сбис\|контур\|1с[- ]\|эдо\|электронн\w* документооборот\|лицензи\w* на по\|программ\w* обеспеч` | expense | Программы и электронный документооборот |
| 11 | `комисси\|плата за обслуж\|плата за пакет\|пакет услуг\|тариф\|ведение сч` | expense | Банковские комиссии |
| 12 | `налог\|ндфл\|страхов\w* взнос\|енп\|единый налог\|казначейств\|ифнс\|сфр\|пфр\|фсс` | expense | Налоги и взносы |
| 13 | `аренд` | expense | Аренда |
| 14 | `заработн\|зарплат\|зп за\|аванс за\|отпускн\|реестр\|денежное вознагражд` | expense | Зарплата сотрудников |
| 15 | `топлив\|азс\|бензин\|дизел\|гсм\|транспортн` | expense | Транспорт |

Запасные варианты: расход с непустым `name` без слова «банк» → `Закупка товара`; доход с таким же условием → `Прочие доходы`; иначе `None`.

Возвращается **название**; в `_bank` оно сопоставляется с существующей неархивной статьёй того же типа без учёта регистра. Если такой статьи нет — `category_id = null` (статья не создаётся).

Замечание: короткие подстроки без границ слов дают ложные срабатывания: `мтс` (напр., «МТС-Банк» → «Связь»), `тко`, `тгк`, `енп`, `сфр`, `тариф`, `реестр` (любой реестр платежей → «Зарплата»), `вывоз` и т. п.

#### Месяц платежа — `period_from_text(text, op_date)` (bank.py:205–218)

1. `за MM.YYYY` или `за M/YYYY` (месяц 1–12) → `YYYY-MM`.
2. `за <название месяца> [YYYY]` (январ…, ма[йя]…, …). Номер — по самому длинному совпавшему префиксу из `MONTHS_RU`. Год: указанный; иначе год операции, а если месяц больше `месяц_операции + 1` — предыдущий год (например, «за декабрь» в январской операции → прошлый год).
3. Иначе — месяц даты операции.

Вариант «за 9 месяц» из docstring не поддерживается — сработает п. 3.

#### Дубликаты

Ключ строки (index.py:455): `date|kind|amount(2 знака)|number|inn или первые 40 символов name`. Строка считается дублем, если в `acc_entries` есть запись `source='bank'` с таким `source_key` (включая **аннулированные** `void=true` — удалённая банковская операция повторно не загрузится). Вставка дополнительно защищена `ON CONFLICT (source, source_key) DO NOTHING`. Внутри одного файла две одинаковые строки (одинаковые дата/сумма/номер/контрагент) дадут один ключ — вторая будет тихо проигнорирована, но учтена в `added`.

---

### 6. Еженедельные выплаты (`salary_weekly.py`)

`run(cur, schema, today=None)` вызывается при каждом `salary` и `payslip` (index.py:890). Идея: каждое воскресенье каждому сотруднику автоматически добавляется выплата в размере столбца «НЕДЕЛЯ», а в последний день месяца — остаток до ИТОГО.

Алгоритм:
1. `start` = `app_settings['accounting'].start_period` (только если `value` уже dict; иначе `2000-01`), `cfg`, `params`.
2. Месяцы: предыдущий и текущий (относительно `today`).
3. Для каждого месяца `period`:
   1. пропуск, если `period < start` или месяц закрыт (`acc_periods.closed`).
   2. `sundays` — все воскресенья месяца; `due` — те, что `<= today`; `final = today >= последний день`.
   3. нет `due` и не `final` → пропуск.
   4. `compute_period`; `people` — у кого `round(total,2) > 0`.
   5. `sid_of` — `acc_staff.id` по `profile_id` (при нескольких — с наименьшим id, т. к. `ORDER BY id DESC` и последняя запись в dict побеждает).
   6. Все выплаты месяца (`COALESCE(period, to_char(pay_date))`): множество `keys` и `paid_other[staff]` — сумма всех выплат, **кроме** ключей `...:final`.
   7. Для каждого человека: `base = week:{period}:{kind}:{profile_id}`; `paid = paid_other[sid]`; для каждого воскресенья `i`:
      - ключ `base:YYYY-MM-DD` уже есть → пропуск;
      - `amount = round(min(week, total − paid), 2)`; `<= 0` → пропуск;
      - добавить выплату (`comment` `Неделя i из «Зарплаты»`, `created_by` `Авто: неделя`).
   8. Если `final`: ключ `base:final` удаляется и пересоздаётся с `rest = total − paid` (если `> 0`), датой последнего дня, `comment` `Остаток до ИТОГО за месяц`, `created_by` `Авто: итог месяца`.
4. Пакетная вставка `INSERT ... SELECT FROM unnest(...) ON CONFLICT DO NOTHING`.
5. Возвращает `{weekly_added}` (в `index.py` результат игнорируется).

Особенности:
- В `acc_entries` эти выплаты не попадают (расход по зарплате формируется синхронизацией как ИТОГО месяца).
- Ручные выплаты учитываются в `paid` и уменьшают автоматические.
- Уже созданные недельные выплаты не пересчитываются при изменении данных «Зарплаты»; корректирует только `final`. Если ИТОГО уменьшилось ниже выплаченного — образуется переплата, которую ничто не сторнирует.
- Ключи `base` для `emp` и `mgr` разные, но `paid_other` считается по `staff_id` — у человека, который одновременно сотрудник и руководитель, выплаты одного вида уменьшат другой.
- Месяцы старше предыдущего не догоняются.
- `period` — вычисляемый месяц по `today`, `date.today()` — время сервера (UTC).

---

### 7. Синхронизация месяца, закрытие/открытие, snapshot

#### Какие месяцы синхронизируются — `_data_periods` (index.py:120–126)

Объединение `month_year` (формат `MM.YYYY`) из `salary_settings`, `collection_data` и `manager_data` (для `manager_data` — только где сумма `osn_hours+dop_hours+doplaty+vacation_pay > 0`). Из-за приоритета операторов SQL условие `AND (...) > 0` относится только к третьей части UNION. Результат переводится в `YYYY-MM`, отфильтрован `>= start_period`, отсортирован.

#### `sync_range(cur, d_from, d_to)` (index.py:238–247)

Берёт месяцы из `_data_periods` в диапазоне `[d_from[:7]; d_to[:7]]`, не позже текущего месяца, не закрытые; синхронизирует **последние 12** из них. Вызывается из `periods`, `entries`, `profit`, `dds`, `budget`, `salary`, `payslip` — т. е. любое чтение может писать в БД.

#### Отпечаток — `_fingerprint` (index.py:129–138)

`md5` от конкатенации:
- всех строк `salary_data` за месяц (`t::text`, отсортированы);
- всех строк `manager_data` за месяц;
- `revenue/days_in_month` из `salary_settings`;
- `shift_date + shift_type + fact_value` из `collection_data`;
- списка `acc_staff` `id:profile_id`;
- JSON `[cfg, params]`.

Если отпечаток совпадает с `acc_periods.fingerprint` и `force=False` — возврат `{'skipped': 'unchanged', ...snapshot}` без записи. Изменения в `acc_entries` (ручные операции, банк) отпечаток не меняют, поэтому `entry_save`/`entry_delete`/`settings_save` сбрасывают `fingerprint = NULL` **у всех месяцев**.

#### `sync_period(cur, period, cfg, params, force)` (index.py:160–235)

1. Месяц закрыт → `{'period', 'skipped': 'closed'}`; раньше `start_period` → `'skipped': 'before_start'`; отпечаток не изменился → `'skipped': 'unchanged'`.
2. `compute_period(MM.YYYY)`.
3. **Начисления** (`acc_accruals`): для каждого человека `totals[kind] += raw`; если `total != 0`:
   - `acc_staff` по `profile_id` (создаётся `pay_type='tabel', rate=0`, если нет);
   - `source_key = sheet:{period}:{emp|mgr}:{profile_id}`;
   - upsert: `pay_type='tabel'`, `rate`, `base=0`, `bonus=0`, `amount=round(total,2)`, `comment='Из раздела «Зарплата»'` (+ `' (руководитель)'`), `created_by='Синхронизация'`, `details={kind, rate, values}`; при конфликте обновляются `amount, rate, details, staff_id`, `void=false`.
   - Все прочие `sheet:{period}:%` начисления месяца → `void = true`.
4. **Расход по зарплате** (`acc_entries`, `source='salary'`) для `emp` (`Зарплата сотрудников`) и `mgr` (`Зарплата руководителей`), `source_key = {period}:{kind}`:
   - если в месяце уже есть неаннулированные расходы этой статьи **не** из синхронизации (ручные или банковские) — авто-строка аннулируется (`void=true`), чтобы не задвоить;
   - иначе если `round(totals,2) > 0` — upsert на последний день месяца, комментарий `ИТОГО к выдаче из «Зарплаты», сотрудников|руководителей: N`;
   - иначе аннулируется.
5. **Доход по инкассации** (`source='collection'`, статья `Инкассация`): `collection_data` за месяц с `shift_date` формата `DD.MM.YYYY`, сгруппировано по дню — `SUM(fact_value)`, `COUNT(*)`.
   - Если в месяце есть банковская (`source='bank'`) операция статьи «Инкассация» — дневные строки не создаются (и все существующие авто-строки будут аннулированы).
   - Для дня с суммой > 0: upsert `source_key = YYYY-MM-DD`, дата = день, комментарий `Инкассация (факт), смен: N`.
   - Авто-строки месяца, не попавшие в список дней, → `void=true`.
6. **Snapshot**: `{salary_emp, salary_mgr, collection, revenue, rate}` — upsert в `acc_periods` с `synced_at = now()` и пересчитанным отпечатком.
7. Возврат `{'period': ..., **snapshot}`.

`_upsert_entry` (index.py:141–147): `ON CONFLICT (source, source_key) WHERE source IS NOT NULL DO UPDATE` — обновляет `kind, entry_date, amount, category_id, comment, period`, `void=false`, `updated_at`; `created_by='Синхронизация'`.

#### Закрытие и открытие

- `period_close`: `sync_period(force=True)` (если месяц уже закрыт — `skipped: closed`), затем upsert `acc_periods.closed=true, closed_at=now(), closed_by=user.name`. В закрытом месяце запрещены: изменение/удаление/добавление операций с датой или `period` этого месяца, начисления, выплаты по дате, банковский импорт строк этого месяца; синхронизация и автоплатежи его не трогают. Snapshot фиксирует суммы на момент закрытия.
- `period_open`: `closed=false, closed_at=NULL, closed_by=NULL`. Синхронизация не запускается сразу — она выполнится при следующем чтении (отпечаток останется прежним, если исходные данные не менялись).
- `period_sync`: `sync_period(force=True)` без изменения статуса.

---

### 8. Справочник actions

Всего 29 actions. Для **всех** действуют общие проверки `handler`:

| Код | Текст |
|---|---|
| 405 | `Метод не поддерживается` |
| 401 | `Нужно войти в систему` |
| 403 | `Нет доступа к бухгалтерии` (нет раздела `/accounting`) |

Неизвестный `action` попадает в `_edit`: без `accounting.edit_salary` → `403 Нет права на это действие`, с ним → `400 Неизвестное действие`.

Сводка:

| action | Право | Вызывается из UI |
|---|---|---|
| `me` | раздел `/accounting` | да |
| `settings_save` | `is_deputy` | нет (UI использует `admin-api` `general_save`) |
| `periods` | раздел | да (`PeriodsBar`) |
| `entries` | `accounting.view_entries` | да |
| `profit` | `accounting.view_reports` | да |
| `dds` | `accounting.view_reports` | да |
| `budget` | `accounting.view_budget` | да |
| `counterparties` | `accounting.view_counterparties` | да |
| `cp_history` | `accounting.view_counterparties` | да |
| `salary_due` | `accounting.view_entries` | да |
| `salary` | `accounting.view_salary` | да |
| `payslip` | `accounting.view_salary` | да |
| `entry_save` | `accounting.edit_entries` | да |
| `entry_delete` | `accounting.delete_entries` | да |
| `category_save` | `accounting.edit_entries` | да |
| `period_close` | `accounting.close_month` | да |
| `period_open` | `accounting.close_month` | да |
| `period_sync` | `accounting.edit_entries` или `accounting.close_month` | да |
| `bank_preview` | `accounting.edit_entries` | да |
| `bank_import` | `accounting.edit_entries` | да |
| `budget_save` | `accounting.edit_budget` | да |
| `counterparty_save` | `accounting.edit_counterparties` (+ `sber.edit_requisites` для реквизитов) | да |
| `cp_doc_save` | `accounting.edit_counterparties` | да |
| `cp_doc_delete` | `accounting.edit_counterparties` | да |
| `staff_save` | `accounting.edit_salary` | да |
| `accrual_save` | `accounting.edit_salary` | да |
| `accrual_delete` | `accounting.edit_salary` | да |
| `payment_save` | `accounting.edit_salary` | да |
| `payment_delete` | `accounting.edit_salary` | да |

---

#### `me`

**Назначение.** Стартовые данные страницы: права, роль, справочники статей и контрагентов, месяц начала учёта (index.py:819–823).

**Право.** Только доступ к разделу `/accounting`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `action` | `"me"` | да | — |

**Проверки и ошибки.** Только общие (401/403/405).

**Логика по шагам.**
1. Неархивные контрагенты `id, name, kind` по алфавиту.
2. `actions` — отсортированный список прав пользователя.
3. Все статьи (`_categories`, включая архивные).
4. `start_period` (`_start`).

**Таблицы.** Чтение: `acc_counterparties`, `acc_categories`, `app_settings`.

**Ответ.**
```json
{"actions": ["accounting.view_entries", "accounting.edit_entries"], "role": "director", "is_deputy": false,
 "categories": [{"id": 1, "kind": "expense", "name": "Аренда", "archived": false}],
 "counterparties": [{"id": 7, "name": "ООО Ромашка", "kind": "supplier"}], "start_period": "2026-01"}
```

**Побочные эффекты.** Нет.

---

#### `settings_save`

**Назначение.** Установить месяц начала учёта; всё, что раньше, исключается из автоучёта (index.py:824–837).

**Право.** `user.is_deputy` (роль `deputy_director`).

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `start_period` | `YYYY-MM` | да | месяц начала учёта |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Только заместитель директора` |
| 400 | `Укажите месяц начала учёта` |

**Логика по шагам.**
1. Upsert `app_settings['accounting'] = {"start_period": sp}`, `updated_by`, `updated_at`. Значение **перезаписывается целиком** (иные ключи объекта `accounting` теряются).
2. `acc_accruals.void = (period < sp)` для всех авто-начислений (`source_key IS NOT NULL`).
3. `acc_entries.void = (period < sp)` для `source IN ('salary','collection')`.
4. `acc_periods.fingerprint = NULL` у всех месяцев.
5. Журнал `Начало учёта`.

**Таблицы.** Запись: `app_settings`, `acc_accruals`, `acc_entries`, `acc_periods`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Затрагивает и закрытые месяцы (п. 2–3 игнорируют `closed`); снятие `void` в п. 2–3 «воскрешает» и те авто-строки, которые синхронизация аннулировала намеренно (дубли с ручным/банковским расходом, удалённые из «Зарплаты» люди) — до следующей синхронизации месяца; в закрытых месяцах — навсегда.

---

#### `periods`

**Назначение.** Список месяцев со статусами для панели месяцев (index.py:838–842).

**Право.** Раздел `/accounting`.

**Вход.** Нет параметров.

**Проверки и ошибки.** Только общие.

**Логика по шагам.**
1. `sync_range('2000-01-01', сегодня)` — синхронизирует до 12 последних незакрытых месяцев с данными.
2. Множество месяцев = `_data_periods` ∪ месяцы из `acc_periods` ∪ текущий месяц, по убыванию.
3. Для каждого — данные `acc_periods` или `{closed: false}`.

**Таблицы.** Чтение: `salary_settings`, `collection_data`, `manager_data`, `salary_data`, `acc_staff`, `app_settings`, `acc_periods`, `profiles`. Запись (через синхронизацию): `acc_entries`, `acc_accruals`, `acc_staff`, `acc_categories`, `acc_periods`.

**Ответ.**
```json
{"periods": [
  {"period": "2026-10", "closed": false, "closed_at": null, "closed_by": null, "synced_at": "2026-10-18 09:00:00+00:00",
   "snapshot": {"salary_emp": 412000.0, "salary_mgr": 98000.0, "collection": 1250000.0, "revenue": 3100000.0, "rate": 104.166667}},
  {"period": "2026-09", "closed": true, "closed_at": "2026-10-02 ...", "closed_by": "Иванова А.", "synced_at": "...", "snapshot": {"...": "..."}}
]}
```
Для месяца без записи в `acc_periods` — только `{"period": "...", "closed": false}`.

**Побочные эффекты.** Синхронизация (запись в БД) при чтении.

---

#### `entries`

**Назначение.** Журнал операций доход/расход за диапазон (index.py:843–848).

**Право.** `accounting.view_entries`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `date_from` | ISO-дата | нет | по умолчанию `2000-01-01` |
| `date_to` | ISO-дата | нет | по умолчанию `2100-12-31` |

**Проверки и ошибки.** `403 Нет доступа к доходам и расходам`.

**Логика по шагам.**
1. `sync_range(date_from, date_to)`.
2. `_entries`: операции, у которых `period` (месяц учёта, а не дата!) в `[date_from[:7]; date_to[:7]]`, `NOT void`, сортировка по дате и id по убыванию, **не более 3000**.
3. Список закрытых месяцев.

**Таблицы.** Чтение `acc_entries`, `acc_categories`, `acc_counterparties`, `acc_periods`; запись — синхронизация.

**Ответ.**
```json
{"entries": [{"id": 101, "kind": "expense", "date": "2026-10-05", "amount": 15000.0, "category_id": 4, "category": "Аренда",
              "comment": "Банк №123: Аренда за октябрь", "from_salary": false, "created_by": "Иванова А.", "linked": "bank",
              "counterparty_id": 7, "counterparty": "ООО Ромашка", "period": "2026-10"}],
 "closed": ["2026-08", "2026-09"]}
```
`linked` = `source` (`salary` / `collection` / `bank` / `null`), `from_salary` = есть `payment_id`, `category` = `Без статьи` при отсутствии.

**Побочные эффекты.** Синхронизация.

---

#### `profit`

**Назначение.** Прибыль: доходы, расходы, разбивка по статьям и месяцам (index.py:849–853, `_profit` 263–274).

**Право.** `accounting.view_reports`.

**Вход.** `date_from`, `date_to` (как в `entries`).

**Проверки и ошибки.** `403 Нет доступа к отчётам`.

**Логика по шагам.**
1. `sync_range`.
2. Группировка неаннулированных `acc_entries` по `(kind, статья)` по **месяцу учёта** `period`; `linked = MAX(source)`.
3. Группировка по `period`: доход/расход.
4. `profit = income − expense`.

**Таблицы.** Чтение `acc_entries`, `acc_categories`; запись — синхронизация.

**Ответ.**
```json
{"income": 1250000.0, "expense": 610000.0, "profit": 640000.0,
 "by_category": [{"kind": "income", "category": "Инкассация", "total": 1250000.0, "count": 31, "linked": "collection"}],
 "by_month": [{"month": "2026-10", "income": 1250000.0, "expense": 610000.0}]}
```

**Побочные эффекты.** Синхронизация.

---

#### `dds`

**Назначение.** Отчёт о движении денежных средств: статьи × месяцы, остатки (index.py:849–853, `_dds` 277–300).

**Право.** `accounting.view_reports`.

**Вход.** `date_from`, `date_to`.

**Проверки и ошибки.** `403 Нет доступа к отчётам`.

**Логика по шагам.**
1. `sync_range`.
2. `opening` = Σ(доход − расход) всех неаннулированных операций с `entry_date < date_from` (с начала времён, без учёта `start_period`).
3. Группировка по `kind`, статье и месяцу **даты операции** (`to_char(entry_date)`), в отличие от `profit`.
4. Для каждого месяца с движением: `start`, `income`, `expense`, `end`.
5. Строки отсортированы: сначала доходы, внутри по убыванию суммы.

**Таблицы.** Чтение `acc_entries`, `acc_categories`.

**Ответ.**
```json
{"opening": 100000.0, "closing": 740000.0, "months": ["2026-10"],
 "balances": [{"month": "2026-10", "start": 100000.0, "income": 1250000.0, "expense": 610000.0, "end": 740000.0}],
 "rows": [{"kind": "income", "category": "Инкассация", "months": {"2026-10": 1250000.0}, "total": 1250000.0}]}
```

**Побочные эффекты.** Синхронизация. Месяцы без движения в `balances` отсутствуют.

---

#### `budget`

**Назначение.** План-факт бюджета за месяц (index.py:854–858, `_budget` 303–317).

**Право.** `accounting.view_budget`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `period` | `YYYY-MM` | нет | по умолчанию текущий месяц |

**Проверки и ошибки.** `403 Нет доступа к бюджету`. Неверный `period` молча заменяется текущим.

**Логика по шагам.**
1. `sync_range` за месяц.
2. План — `acc_budget` за месяц; факт — `SUM(acc_entries.amount)` по `category_id` за `period`, без `void`.
3. Все статьи; архивная статья без плана и факта пропускается.
4. `diff = fact − plan`, `pct = fact/plan·100` (null при нулевом плане).

**Таблицы.** Чтение `acc_budget`, `acc_entries`, `acc_categories`.

**Ответ.**
```json
{"period": "2026-10", "rows": [{"category_id": 4, "kind": "expense", "category": "Аренда", "plan": 15000.0, "fact": 15000.0, "diff": 0.0, "pct": 100.0}]}
```

**Побочные эффекты.** Синхронизация. Факт операций без статьи (`category_id NULL`) в строки не попадает.

---

#### `counterparties`

**Назначение.** Контрагенты с взаиморасчётами (index.py:859–864, `_counterparties` 320–334).

**Право.** `accounting.view_counterparties`.

**Вход.** Нет.

**Проверки и ошибки.** `403 Нет доступа к контрагентам`.

**Логика по шагам.** Для каждого контрагента (включая архивные, они в конце):
- `got` = Σ документов `in` (получили товар/услугу), `gave` = Σ документов `out`;
- `paid` = Σ расходных операций, `received` = Σ доходных (без `void`);
- `balance = (got − paid) − (gave − received)`; `we_owe = balance > 0`, `they_owe = −balance < 0`.

**Таблицы.** Чтение `acc_counterparties`, `acc_cp_docs`, `acc_entries`.

**Ответ.**
```json
{"counterparties": [{"id": 7, "name": "ООО Ромашка", "kind": "supplier", "kind_label": "Поставщик", "inn": "7701234567",
   "phone": null, "comment": null, "archived": false, "got": 50000.0, "gave": 0.0, "paid": 30000.0, "received": 0.0,
   "we_owe": 20000.0, "they_owe": 0.0}],
 "kinds": {"supplier": "Поставщик", "customer": "Покупатель", "landlord": "Арендодатель", "other": "Прочее"}}
```

**Побочные эффекты.** Нет (синхронизации нет). Коррелированные подзапросы — 4 на контрагента.

---

#### `cp_history`

**Назначение.** История документов и оплат контрагента (index.py:862–863, `_cp_history` 337–344).

**Право.** `accounting.view_counterparties`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `id` | int | да | id контрагента |

**Проверки и ошибки.** `403 Нет доступа к контрагентам`. Нечисловой `id` → `ValueError` в `int()` → 500. Несуществующий — пустой список.

**Логика по шагам.** `UNION ALL` документов (`doc`) и операций (`pay`, без `void`), сортировка по дате и id по убыванию; подпись по `(type, direction)`:
`doc/in` — `Получено от контрагента (товар/услуга)`, `doc/out` — `Отгружено/оказано контрагенту`, `pay/expense` — `Оплата контрагенту`, `pay/income` — `Оплата от контрагента`.

**Таблицы.** Чтение `acc_cp_docs`, `acc_entries`.

**Ответ.**
```json
{"history": [{"type": "pay", "id": 101, "date": "2026-10-05", "direction": "expense", "amount": 30000.0, "comment": "Банк №123: ...", "label": "Оплата контрагенту"}]}
```

**Побочные эффекты.** Нет.

---

#### `salary_due`

**Назначение.** Сколько по «Зарплате»/«Инкассации» положено и сколько уже проведено вручную — подсказка при вводе операции (index.py:865–885).

**Право.** `accounting.view_entries`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `period` | `YYYY-MM` | нет | по умолчанию текущий |
| `exclude_id` | int | нет | id редактируемой операции, исключается из «оплачено» |

**Проверки и ошибки.** `403 Нет доступа`. Нечисловой `exclude_id` → 500.

**Логика по шагам.**
1. `compute_period` (без синхронизации и без учёта `start_period`/закрытия).
2. Для `Зарплата сотрудников` и `Зарплата руководителей`: `total = Σ raw` по виду; `paid` = Σ неаннулированных расходов статьи за `period` с `source <> 'salary'`, кроме `exclude_id`; `left = max(total − paid, 0)`.
3. Для `Инкассация`: `total = Σ fact_value` за месяц; `paid` = доходы статьи с `source <> 'collection'`.
4. Ключ ответа — id статьи строкой.

**Таблицы.** Чтение `salary_*`, `manager_*`, `collection_data`, `acc_entries`; запись — `acc_categories` (`_cat_id` создаёт статьи, если их нет).

**Ответ.**
```json
{"period": "2026-10", "due": {"12": {"total": 412000.0, "paid": 100000.0, "left": 312000.0},
                              "13": {"total": 98000.0, "paid": 0.0, "left": 98000.0},
                              "2": {"total": 1250000.0, "paid": 0.0, "left": 1250000.0}}}
```

**Побочные эффекты.** Возможное создание статей. Для закрытого месяца показывает текущие (не зафиксированные) суммы.

---

#### `salary`

**Назначение.** Зарплатная ведомость месяца: сотрудники, начисления, выплаты, долги (index.py:886–893, `_salary` 347–384).

**Право.** `accounting.view_salary`. С `accounting.edit_salary` дополнительно возвращается список профилей.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `period` | `YYYY-MM` | нет | по умолчанию текущий |

**Проверки и ошибки.** `403 Нет доступа к зарплате`.

**Логика по шагам.**
1. `sync_range` за месяц.
2. `salary_weekly.run` — автоплатежи за прошлый и текущий месяцы.
3. Все `acc_staff`.
4. Начисления (без `void`) в диапазоне `[start_period; period]`: до месяца, в месяце, в месяце из синхронизации (`sheet`).
5. Выплаты (месяц = `period` выплаты или месяц `pay_date`) в том же диапазоне.
6. Для каждого: `debt_start = нач_до − выпл_до`, `accrued`, `paid`, `debt = debt_start + accrued − paid`, `sheet` (только для `pay_type='tabel'`).
7. Отбрасываются неактивные без движения и без долга.
8. Начисления месяца (`auto` = есть `source_key`), выплаты месяца.
9. Итоги `total_debt`, `total_debt_start`, `closed`, `before_start`.
10. При `edit_salary` — `profiles` со `status='active'`.

**Таблицы.** Чтение `acc_staff`, `acc_accruals`, `acc_payments`, `acc_periods`, `profiles`; запись — синхронизация и `acc_payments` (автоплатежи).

**Ответ.**
```json
{"period": "2026-10", "start_period": "2026-01", "before_start": false,
 "staff": [{"id": 3, "name": "Петров И.", "profile_id": "uuid", "position": null, "pay_type": "tabel", "rate": 0.0, "active": true,
            "debt_start": 0.0, "accrued": 42000.0, "sheet": 42000.0, "paid": 21000.0, "debt": 21000.0}],
 "accruals": [{"id": 55, "staff_id": 3, "period": "2026-10", "pay_type": "tabel", "rate": 104.1667, "base": 0.0, "bonus": 0.0,
               "amount": 42000.0, "comment": "Из раздела «Зарплата»", "created_at": "...", "auto": true}],
 "payments": [{"id": 90, "staff_id": 3, "date": "2026-10-12", "amount": 10500.0, "period": "2026-10", "comment": "Неделя 2 из «Зарплаты»"}],
 "total_debt": 21000.0, "total_debt_start": 0.0, "closed": false,
 "profiles": [{"id": "uuid", "name": "Петров Иван"}]}
```

**Побочные эффекты.** Синхронизация, автоматическое создание выплат (`salary_weekly`) — побочная запись в БД при каждом просмотре.

---

#### `payslip`

**Назначение.** Расчётный листок сотрудника за месяц (index.py:886–892, `_payslip` 387–428).

**Право.** `accounting.view_salary`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `staff_id` | int | да | `acc_staff.id` |
| `period` | `YYYY-MM` | нет | по умолчанию текущий |

**Проверки и ошибки.** `403 Нет доступа к зарплате`. Нечисловой `staff_id` → 500. Несуществующий сотрудник → `200 {}`.

**Логика по шагам.**
1. `sync_range`, `salary_weekly.run`.
2. `debt_start` = начисления − выплаты с `start_period` до месяца.
3. Начисления месяца: для авто (`details`) — строки `info` «Ставка, ₽/час», затем по каждому полю конфигурации с ненулевым значением (`accrual`/`deduction`, часы — `info`, подпись `label.capitalize()`), затем `total` «ИТОГО к выдаче по разделу «Зарплата»»; для ручных — одна строка `accrual` с комментарием или «Начисление».
4. Выплаты месяца, `paid`, `debt_end = debt_start + accrued − paid`.

**Таблицы.** Чтение `acc_staff`, `acc_accruals`, `acc_payments`, `app_settings`.

**Ответ.**
```json
{"name": "Петров И.", "position": null, "period": "2026-10", "debt_start": 0.0,
 "lines": [{"section": "info", "label": "Ставка, ₽/час", "amount": 104.1667},
           {"section": "info", "label": "Часы", "amount": 168.0},
           {"section": "deduction", "label": "Безнал", "amount": 1500.0},
           {"section": "total", "label": "ИТОГО к выдаче по разделу «Зарплата»", "amount": 42000.0}],
 "accrued": 42000.0, "payments": [{"date": "2026-10-05", "amount": 10500.0, "comment": "Неделя 1 из «Зарплаты»"}],
 "paid": 10500.0, "debt_end": 31500.0}
```

**Побочные эффекты.** Как у `salary`. Доступ к листку любого сотрудника для любого обладателя `view_salary`.

---

#### `entry_save`

**Назначение.** Создать или изменить ручную/банковскую операцию (index.py:511–571).

**Право.** `accounting.edit_entries`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `id` | int | нет | если задан — редактирование |
| `kind` | `income`/`expense` | да | тип |
| `date` | ISO-дата | да | дата операции |
| `amount` | число/строка | да | > 0 |
| `period` | `YYYY-MM` | нет | месяц учёта; по умолчанию месяц `date` |
| `category_id` | int | нет | статья того же типа |
| `counterparty_id` | int | нет | контрагент (не проверяется) |
| `comment` | string | нет | до 500 символов |

**Проверки и ошибки.**

| Код | Текст | Условие |
|---|---|---|
| 403 | `Нет права на это действие` | нет права |
| 404 | `Операция не найдена` | `id` не найден |
| 400 | `Эта строка приходит из раздела «Зарплата» или «Инкассация» — исправьте её там` | `source` не `bank` и не пуст |
| 400 | `Эта операция создана выплатой зарплаты — измените выплату во вкладке «Зарплата»` | есть `payment_id` |
| 400 | `Месяц MM.YYYY закрыт — изменения запрещены. Откройте месяц, если нужно поправить.` | закрыт месяц старой даты или новой даты |
| 400 | `Выберите: доход или расход` | неверный `kind` |
| 400 | `Укажите дату` | — |
| 400 | `Укажите сумму больше нуля` | `_money` = None |
| 400 | `Укажите, за какой месяц` | неверный `period` |
| 400 | `Месяц MM.YYYY закрыт — откройте его, чтобы добавить операцию` | закрыт месяц `period` |
| 400 | `Статья не подходит к типу операции` | статья не найдена или другого типа |

**Логика по шагам.**
1. При `id` — загрузка и проверки существующей записи.
2. Валидация полей, проверки закрытых месяцев.
3. `UPDATE` (все поля + `updated_at`) или `INSERT` с `created_by = user.name`.
4. Журнал `Изменена операция`/`Добавлена операция`.
5. `acc_periods.fingerprint = NULL` у всех месяцев.

**Таблицы.** `acc_entries` (R/W), `acc_categories` (R), `acc_periods` (R/W), `acc_log` (W).

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Сброс отпечатков → полная пересинхронизация до 12 месяцев при следующем чтении. Ручной расход статьи «Зарплата сотрудников/руководителей» или ручной/банковский доход «Инкассация» в месяце приведут к аннулированию соответствующих авто-строк (раздел 7). Редактирование банковской строки сохраняет `source='bank'` и `source_key`.

---

#### `entry_delete`

**Назначение.** Удалить операцию (index.py:511–537).

**Право.** `accounting.delete_entries`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `id` | int | да | id операции |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 404 | `Операция не найдена` (нет `id` или запись не найдена) |
| 400 | `Эта строка приходит из раздела «Зарплата» или «Инкассация» — исправьте её там` |
| 400 | `Эта операция создана выплатой зарплаты — измените выплату во вкладке «Зарплата»` |
| 400 | `Месяц MM.YYYY закрыт — изменения запрещены. Откройте месяц, если нужно поправить.` (по `entry_date`) |

**Логика по шагам.**
1. Банковская строка → `void = true` (остаётся как маркер дубля, повторно из выписки не загрузится).
2. Ручная → физический `DELETE`.
3. Журнал `Удалена операция`, сброс всех `fingerprint`.

**Таблицы.** `acc_entries`, `acc_periods`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Как у `entry_save`. Закрытие проверяется по дате, а не по `period` — операцию с датой открытого месяца, учтённую в закрытом, удалить можно.

---

#### `category_save`

**Назначение.** Добавить статью (index.py:573–584). Переименования/архивации нет.

**Право.** `accounting.edit_entries`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `kind` | `income`/`expense` | да | тип |
| `name` | string | да | до 80 символов |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 400 | `Укажите название статьи` (пустое имя или неверный `kind`) |
| 400 | `Такая статья уже есть` (без учёта регистра) |

**Логика по шагам.** Проверка уникальности → `INSERT` → журнал `Статья` → полный список статей.

**Таблицы.** `acc_categories`, `acc_log`.

**Ответ.** `{"ok": true, "categories": [{"id": 1, "kind": "expense", "name": "Аренда", "archived": false}]}`

**Побочные эффекты.** Нет.

---

#### `period_close`

**Назначение.** Синхронизировать и закрыть месяц (index.py:586–604).

**Право.** `accounting.close_month`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `period` | `YYYY-MM` | да | месяц |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права закрывать месяц` |
| 400 | `Укажите месяц` |

**Логика по шагам.**
1. `sync_period(period, force=True)` (раздел 7).
2. Upsert `acc_periods`: `closed=true`, `closed_at=now()`, `closed_by=user.name`.
3. Журнал `Месяц закрыт` с JSON результата.

**Таблицы.** Синхронизация + `acc_periods`, `acc_log`.

**Ответ.**
```json
{"ok": true, "result": {"period": "2026-09", "salary_emp": 405000.0, "salary_mgr": 97000.0, "collection": 1190000.0, "revenue": 3000000.0, "rate": 104.166667}}
```
Если месяц был закрыт: `"result": {"period": "2026-09", "skipped": "closed"}`; если раньше начала учёта — `"skipped": "before_start"` (месяц всё равно закрывается).

**Побочные эффекты.** Блокировка изменений месяца. Закрыть можно и будущий месяц.

---

#### `period_open`

**Назначение.** Открыть закрытый месяц (index.py:594–597).

**Право.** `accounting.close_month`.

**Вход.** `period` (`YYYY-MM`, обяз.).

**Проверки и ошибки.** `403 Нет права закрывать месяц`; `400 Укажите месяц`.

**Логика по шагам.** `UPDATE acc_periods SET closed=false, closed_at=NULL, closed_by=NULL`; журнал `Месяц открыт`. Если записи нет — ничего не происходит, ответ всё равно `ok`.

**Таблицы.** `acc_periods`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Месяц снова синхронизируется при чтениях; автоплатежи `salary_weekly` снова работают для него (если это прошлый/текущий месяц).

---

#### `period_sync`

**Назначение.** Принудительно обновить данные месяца из «Зарплаты»/«Инкассации» (index.py:586–604).

**Право.** `accounting.edit_entries` **или** `accounting.close_month`.

**Вход.** `period` (`YYYY-MM`, обяз.).

**Проверки и ошибки.** `403 Нет права на это действие`; `400 Укажите месяц`.

**Логика по шагам.** `sync_period(period, force=True)` — игнорирует отпечаток, но не закрытие и не `start_period`.

**Таблицы.** Как синхронизация.

**Ответ.** `{"ok": true, "result": {"period": "2026-10", "salary_emp": 412000.0, "salary_mgr": 98000.0, "collection": 1250000.0, "revenue": 3100000.0, "rate": 104.166667}}`

**Побочные эффекты.** Запись в `acc_entries`, `acc_accruals`, `acc_staff`, `acc_categories`, `acc_periods`. В журнал не пишется. Работает и для будущих месяцев (в отличие от `sync_range`).

---

#### `bank_preview`

**Назначение.** Разобрать выписку и показать, что будет загружено (index.py:606–615, `_bank` 443–499, `commit=False`).

**Право.** `accounting.edit_entries`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `file_name` | string | нет | имя файла (для определения `.xlsx`) |
| `file` | base64 / data-URL | да | содержимое |
| `categories` | `{ "idx": category_id }` | нет | ручные статьи по индексу строки |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 400 | `Файл не похож на выписку. В СберБизнес: Выписки → Экспорт → формат «1С» (.txt) или Excel.` |
| 400 | `Не нашёл в файле колонки «Дата» и «Сумма». Выгрузите выписку из СберБизнес в формате 1С (.txt) или Excel.` |
| 400 | `Не удалось прочитать файл. Выгрузите выписку из СберБизнес в формате 1С (.txt) или Excel (.xlsx).` (любое другое исключение, включая битый base64) |

**Логика по шагам.**
1. `parse_file` (раздел 5).
2. Справочники: неархивные статьи `(kind, lower(name)) → id`, все контрагенты, закрытые месяцы.
3. Для каждой операции с датой и суммой > 0:
   - ключ дубля и проверка `source='bank'` в `acc_entries`;
   - контрагент: по ИНН, затем по точному имени без учёта регистра;
   - статья: ручная `categories[idx]` → `default_category_id` контрагента → `guess_category` → `null`;
   - флаги `duplicate`, `closed`, `counterparty_new`.
4. Итоги `income`/`expense` по не-дублям (закрытые месяцы в итог входят).

**Таблицы.** Чтение `acc_categories`, `acc_counterparties`, `acc_entries`, `acc_periods`.

**Ответ.**
```json
{"account": "40702810000000000001", "date_from": "2026-10-01", "date_to": "2026-10-15",
 "rows": [{"date": "2026-10-05", "kind": "expense", "amount": 15000.0, "number": "123", "name": "ООО Ромашка", "inn": "7701234567",
           "purpose": "Аренда за октябрь 2026", "other_account": "40702...", "doc_type": "Платежное поручение",
           "idx": 0, "duplicate": false, "closed": false, "counterparty_id": 7, "counterparty_new": false, "category_id": 4}],
 "income": 0.0, "expense": 15000.0}
```

**Побочные эффекты.** Нет. Каждый запрос гоняет полный файл base64 через сеть и проверяет дубли отдельным запросом на строку.

---

#### `bank_import`

**Назначение.** Загрузить операции из выписки (index.py:606–615, `_bank`, `commit=True`).

**Право.** `accounting.edit_entries`.

**Вход.** Как у `bank_preview`, плюс:

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `skip` | `string[]` | нет | индексы строк, которые не загружать |

**Проверки и ошибки.** Как у `bank_preview`.

**Логика по шагам.** Как preview, затем для каждой строки:
1. дубль, закрытый месяц (по дате операции) или индекс в `skip` → `skipped += 1`.
2. Контрагента нет и есть имя → создаётся (`supplier` для расхода, `customer` для дохода, ИНН), добавляется в кэш.
3. Если у контрагента нет `default_category_id`, а статья выбрана — она запоминается как статья по умолчанию.
4. `INSERT acc_entries`: `source='bank'`, `source_key`, `period = period_from_text(purpose, date)`, `bank_purpose` (до 1000), `comment = "Банк №N: " + purpose[:400]`, `created_by = user.name`; `ON CONFLICT DO NOTHING`; `added += 1`.
5. Запись в `acc_bank_imports` (файл, счёт, период, added, skipped), журнал `Выписка банка`.

**Таблицы.** Запись: `acc_counterparties`, `acc_entries`, `acc_bank_imports`, `acc_log`.

**Ответ.** `{"ok": true, "added": 12, "skipped": 3}`

**Побочные эффекты.**
- `fingerprint` **не** сбрасывается — банковские строки «Зарплата»/«Инкассация» не вызовут аннулирования авто-строк до изменения исходных данных или `entry_save`/`period_sync` (возможно задвоение в отчётах).
- Проверяется закрытие месяца **даты**, но не месяца `period_from_text` — операция может попасть в закрытый месяц учёта.
- Индексы `categories`/`skip` относятся к порядку операций в файле; если файл изменился между preview и import, они «съедут».

---

#### `budget_save`

**Назначение.** Сохранить план бюджета месяца, опционально скопировав его из другого (index.py:617–635).

**Право.** `accounting.edit_budget`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `period` | `YYYY-MM` | да | месяц |
| `copy_from` | `YYYY-MM` | нет | откуда скопировать план |
| `items` | `[{category_id, plan}]` | нет | до 200 строк |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 400 | `Укажите месяц` |
| 400 | `Проверьте суммы плана` (`plan` < 0 или не число) |

**Логика по шагам.**
1. `copy_from` — upsert всех строк плана исходного месяца.
2. `items` — upsert каждой суммы (`allow_zero`). Ошибка в середине списка оставляет уже записанные строки (autocommit).
3. Журнал `План бюджета`; возврат `_budget(period)`.

**Таблицы.** `acc_budget`, `acc_log`; чтение `acc_entries`, `acc_categories`.

**Ответ.** `{"ok": true, "period": "2026-11", "rows": [{"category_id": 4, "kind": "expense", "category": "Аренда", "plan": 15000.0, "fact": 0.0, "diff": -15000.0, "pct": 0.0}]}`

**Побочные эффекты.** Закрытие месяца не проверяется. `category_id` не валидируется (несуществующий → ошибка FK/500, если FK есть).

---

#### `counterparty_save`

**Назначение.** Создать/изменить контрагента (index.py:640–659).

**Право.** `accounting.edit_counterparties`; изменение имени/ИНН контрагента с заполненным `account` — дополнительно `sber.edit_requisites`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `id` | int | нет | редактирование |
| `name` | string | да | до 150 |
| `kind` | `supplier`/`customer`/`landlord`/`other` | нет | иначе `supplier` |
| `inn` | string | нет | только цифры, до 12 |
| `phone` | string | нет | до 40 |
| `comment` | string | нет | до 300 |
| `archived` | bool | нет | — |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 400 | `Укажите название контрагента` |
| 403 | `Название и ИНН контрагента с банковскими реквизитами меняет только замдиректора (раздел СБЕР)` |

**Логика по шагам.** Нормализация → (при `id`) проверка реквизитов → `UPDATE`/`INSERT` → журнал `Контрагент`.

**Таблицы.** `acc_counterparties`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Несуществующий `id` — `UPDATE` 0 строк, ответ `ok`. Уникальность имени/ИНН не проверяется. `default_category_id` и `account` здесь не редактируются.

---

#### `cp_doc_save`

**Назначение.** Добавить документ поступления/отгрузки контрагента (index.py:664–674).

**Право.** `accounting.edit_counterparties`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `counterparty_id` | int | да (не проверяется) | контрагент |
| `direction` | `in`/`out` | да | `in` — получили от контрагента, `out` — отгрузили ему |
| `date` | ISO-дата | да | — |
| `amount` | число | да | > 0 |
| `comment` | string | нет | до 300 |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 400 | `Выберите тип документа` |
| 400 | `Укажите дату и сумму` |

**Логика по шагам.** `INSERT acc_cp_docs` с `created_by`; журнал `Документ контрагента`.

**Таблицы.** `acc_cp_docs`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Закрытие месяца не проверяется. Редактирования документов нет.

---

#### `cp_doc_delete`

**Назначение.** Удалить документ контрагента (index.py:660–663).

**Право.** `accounting.edit_counterparties`.

**Вход.** `id` (int, обяз.).

**Проверки и ошибки.** `403 Нет права на это действие`. Существование не проверяется.

**Логика по шагам.** `DELETE FROM acc_cp_docs WHERE id`; журнал `Удалён документ контрагента`.

**Таблицы.** `acc_cp_docs`, `acc_log`.

**Ответ.** `{"ok": true}` (даже если ничего не удалено).

**Побочные эффекты.** Закрытие месяца не проверяется.

---

#### `staff_save`

**Назначение.** Создать/изменить сотрудника зарплатного учёта (index.py:679–704).

**Право.** `accounting.edit_salary`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `id` | int | нет | редактирование |
| `name` | string | да | до 120 |
| `pay_type` | `salary`/`percent`/`hourly`/`tabel` | да | способ оплаты |
| `rate` | число | нет | ≥ 0; для `tabel` принудительно 0; для `percent` ≤ 100 |
| `profile_id` | string | для `tabel` | учётная запись (`profiles.id`) |
| `position` | string | нет | до 120 |
| `active` | bool | нет | по умолчанию `true`; `false` только явно |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 400 | `Укажите ФИО сотрудника` |
| 400 | `Выберите способ оплаты` |
| 400 | `Для расчёта из раздела «Зарплата» выберите учётную запись сотрудника` |
| 400 | `Укажите ставку числом` |
| 400 | `Процент не может быть больше 100` |

**Логика по шагам.** Валидация → `UPDATE`/`INSERT acc_staff` → журнал `Сотрудник (зарплата)`.

**Таблицы.** `acc_staff`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Изменение `profile_id` меняет отпечаток всех месяцев (в него входит список `acc_staff`) → пересинхронизация. Уникальность `profile_id` не проверяется; синхронизация берёт запись с минимальным id.

---

#### `accrual_save`

**Назначение.** Ручное начисление (index.py:706–735).

**Право.** `accounting.edit_salary`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `staff_id` | int | да | сотрудник |
| `period` | `YYYY-MM` | да | месяц |
| `pay_type` | тип | нет | по умолчанию тип сотрудника; `tabel` → `salary` с `rate=0` |
| `rate` | число | нет | по умолчанию ставка сотрудника |
| `base` | число | для `percent`/`hourly` | выручка или часы |
| `bonus` | число | нет | премия |
| `comment` | string | нет | до 300 |

Формула (`_calc_accrual`, index.py:436–438): `salary` → `rate + bonus`; `percent` → `base·rate/100 + bonus`; `hourly` → `base·rate + bonus`; округление до копеек.

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 404 | `Сотрудник не найден` |
| 400 | `Укажите месяц` |
| 400 | `Месяц закрыт` |
| 400 | `Неизвестный способ оплаты` |
| 400 | `Проверьте числа` |
| 400 | `Укажите выручку` (`percent`, base = 0) / `Укажите количество часов` (`hourly`) |
| 400 | `Сумма начисления получилась нулевой` |

**Логика по шагам.** Валидация → расчёт → `INSERT acc_accruals` (без `source_key`) → журнал `Начисление`.

**Таблицы.** `acc_staff` (R), `acc_periods` (R), `acc_accruals` (W), `acc_log` (W).

**Ответ.** `{"ok": true, "amount": 15000.0}`

**Побочные эффекты.** В `acc_entries` не попадает. Для `tabel`-сотрудника `pay_type='tabel'` с `rate=0` превращается в оклад 0 + бонус, т. е. начисление = `bonus`.

---

#### `accrual_delete`

**Назначение.** Удалить ручное начисление (index.py:737–748).

**Право.** `accounting.edit_salary`.

**Вход.** `id` (int, обяз.).

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 404 | `Начисление не найдено` |
| 400 | `Это начисление приходит из раздела «Зарплата» — исправьте его там` |
| 400 | `Месяц закрыт` |

**Логика по шагам.** Проверки → `DELETE` → журнал `Удалено начисление`.

**Таблицы.** `acc_accruals`, `acc_periods`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Нет.

---

#### `payment_save`

**Назначение.** Выплата сотруднику, опционально с расходной операцией (index.py:750–775).

**Право.** `accounting.edit_salary`.

**Вход.**

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| `staff_id` | int | да | сотрудник |
| `date` | ISO-дата | да | дата выплаты |
| `amount` | число | да | > 0 |
| `period` | `YYYY-MM` | да | за какой месяц |
| `comment` | string | нет | до 300 |
| `to_expenses` | bool | нет | по умолчанию `true` |

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 404 | `Сотрудник не найден` |
| 400 | `Укажите дату выплаты` |
| 400 | `Укажите сумму больше нуля` |
| 400 | `Укажите, за какой месяц выплата` |
| 400 | `Месяц MM.YYYY закрыт — изменения запрещены. Откройте месяц, если нужно поправить.` (по дате) |

**Логика по шагам.**
1. `INSERT acc_payments` (без `source_key`).
2. Если `to_expenses` и сотрудник **не** `tabel` — `INSERT acc_entries` (`expense`, статья `Зарплата сотрудников`, `payment_id`, `period`, комментарий `Зарплата: ФИО за период — комментарий`). Для `tabel` расход уже идёт ИТОГО из синхронизации.
3. Журнал `Выплата`.

**Таблицы.** `acc_staff` (R), `acc_payments`, `acc_entries`, `acc_categories`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Закрытие месяца `period` не проверяется (только даты). Расход ручной выплаты (не `source='salary'`) в статье «Зарплата сотрудников» при следующей синхронизации приведёт к аннулированию авто-строки ИТОГО по сотрудникам всего месяца — общий расход станет равен только ручным выплатам. Fingerprint не сбрасывается, так что эффект проявится при ближайшем изменении данных или `period_sync`.

---

#### `payment_delete`

**Назначение.** Удалить выплату и связанный расход (index.py:777–788).

**Право.** `accounting.edit_salary`.

**Вход.** `id` (int, обяз.).

**Проверки и ошибки.**

| Код | Текст |
|---|---|
| 403 | `Нет права на это действие` |
| 404 | `Выплата не найдена` |
| 400 | `Месяц MM.YYYY закрыт — изменения запрещены. Откройте месяц, если нужно поправить.` |

**Логика по шагам.** `DELETE acc_payments` → `DELETE acc_entries WHERE payment_id` → журнал `Удалена выплата`.

**Таблицы.** `acc_payments`, `acc_entries`, `acc_log`.

**Ответ.** `{"ok": true}`

**Побочные эффекты.** Удалённая **автоматическая** недельная выплата будет создана заново при следующем `salary`/`payslip` (ключ исчез), а удалённый `final` пересоздаётся всегда — удалить автоплатёж фактически нельзя.

---

### 9. Замечания по безопасности и корректности

#### Безопасность

1. **SQL из конфигурации полей.** `compute_period` вставляет `key` builtin-полей из `app_settings['fields']` прямо в текст SQL (`', '.join('d.' + c ...)`) — `backend/accounting-api/formulas.py:136-137`. Защита держится только на валидации при сохранении в `admin-api`; если туда попадёт произвольная строка, это SQL-инъекция с правами БД во всех функциях, использующих `formulas.py`. Стоит проверять `key` по `VAR_RE`/списку колонок прямо здесь.
2. **API-токены без срока действия.** `api_tokens` принимаются при единственном условии `revoked_at IS NULL` — `access.py:80-82`.
3. **Профиль ищется по email.** `p.user_id = %s OR lower(p.email) = lower(%s)` — `access.py:85-88`. Пользователь, чей email совпал с чужим профилем без `user_id`, получит роль и должность этого профиля.
4. **`is_admin` повышает до директора** при любой роли профиля — `access.py:91-92`.
5. **CORS `*`** и токен в `localStorage` (`src/lib/accountingApi.ts:48`) — при XSS на фронтенде токен уносится; ограничения Origin нет (`index.py:16-21`).
6. **Нет транзакций.** `conn.autocommit = True` — `index.py:806`. Синхронизация месяца (десятки команд), банковский импорт, `budget_save`, `payment_save` (выплата + расход) при сбое посередине оставляют частичное состояние.
7. **Чтения пишут в БД.** `periods/entries/profit/dds/budget/salary/payslip` запускают `sync_range` (`index.py:839, 846, 852, 857, 889`), а `salary`/`payslip` — ещё и создание выплат `salary_weekly.run` (`index.py:890`). Пользователь только с правом просмотра фактически создаёт начисления и выплаты; параллельные запросы конкурируют за одни и те же upsert'ы.
8. **Нет лимита размера файла выписки.** `parse_file` декодирует весь base64 и `openpyxl` читает книгу целиком — `bank.py:156`, `bank.py:111-113`; проверка дубля — отдельный SELECT на каждую строку (`index.py:456`).
9. **Ссылки не проверяются.** `counterparty_id` в `entry_save` (`index.py:558`) и `cp_doc_save` (`index.py:669-671`), `category_id` в `budget_save` (`index.py:631-633`), `staff_id` при отсутствии FK — без проверки существования.
10. **Расчётный листок любого сотрудника** доступен всем с `accounting.view_salary` — `index.py:891-892`. Сотрудник с этим правом видит зарплаты всех.
11. **`cp_doc_delete` без проверок** существования и закрытия месяца — `index.py:660-663`.
12. **Необработанные исключения → 500**: невалидный JSON `index.py:802`; `int(body['id'])` `index.py:863`; `int(exclude_id)` `index.py:875, 882`; `int(staff_id)` `index.py:892`. Сообщение платформы может раскрыть трассировку.
13. **`RecursionError` в формулах не перехватывается** `safe_eval` (`formulas.py:89`) — глубоко вложенная формула роняет все чтения бухгалтерии.

#### Корректность

14. **Закрытый месяц обходится**:
    - `entry_delete` проверяет месяц `entry_date`, но не `period` — `index.py:525`;
    - `payment_save` проверяет дату, но не `period` выплаты — `index.py:762`; `payment_delete` — только дату `index.py:782`;
    - `bank_import` проверяет месяц даты, а запись ставит в `period_from_text(...)` — `index.py:467, 489`;
    - `budget_save`, `cp_doc_save`, `counterparty_save` закрытие не проверяют;
    - `settings_save` переписывает `void` авто-строк во **всех** месяцах, включая закрытые — `index.py:833-834`.
15. **`settings_save` «воскрешает» аннулированные авто-строки** (`void = (period < sp)` ставит `false` всем строкам после начала учёта) — `index.py:833-834`. В закрытых месяцах дубли «ИТОГО + ручные выплаты» и удалённые из «Зарплаты» люди вернутся навсегда. Кроме того, значение `accounting` перезаписывается целиком.
16. **Ручная выплата гасит авто-расход всего месяца.** `payment_save` для не-`tabel` создаёт расход статьи «Зарплата сотрудников» без `source` (`index.py:769-773`); `sync_period` при любой такой сумме > 0 аннулирует ИТОГО по всем сотрудникам (`index.py:199-204`). Аналогично одна банковская строка «Инкассация» отключает всю дневную инкассацию месяца (`index.py:216-219`) — частичная выписка занизит доход.
17. **`bank_import` и `payment_save` не сбрасывают `fingerprint`** (в отличие от `entry_save/entry_delete`, `index.py:536, 570`) — правило из п. 16 применяется с задержкой, отчёты временно задваивают суммы.
18. **Отрицательный ИТОГО**: `totals += raw` включает отрицательные значения (`index.py:180`), а начисление создаётся при `total != 0` (`index.py:181-183`) — отрицательное начисление и уменьшенный расход. `salary_weekly` таких людей пропускает (`salary_weekly.py:52`).
19. **Автоплатежи не пересчитываются вниз.** Недельная выплата фиксируется один раз (`salary_weekly.py:74-81`); при уменьшении ИТОГО возникает переплата; удалённый вручную автоплатёж пересоздаётся (`salary_weekly.py:75`, `index.py:785`). `paid_other` суммируется по `staff_id`, смешивая `emp` и `mgr` (`salary_weekly.py:65-66, 72`).
20. **Разное чтение `start_period`**: `salary_weekly` учитывает настройку только если `value` уже `dict` (`salary_weekly.py:34`), `index._setting` делает ещё и `json.loads` (`index.py:98`).
21. **`_data_periods`**: условие `AND (...) > 0` относится только к `manager_data` (`index.py:121-124`) — так и задумано, но читается неоднозначно.
22. **`sync_range` синхронизирует только 12 последних месяцев** диапазона (`index.py:246`); более старые незакрытые месяцы с изменёнными данными останутся устаревшими, пока их не обновят через `period_sync`.
23. **`entries` молча обрезаются** до 3000 строк (`index.py:257`).
24. **Разные «месяцы» в отчётах**: `profit`/`budget`/`entries` группируют по `period` (месяц учёта), `dds` — по `entry_date` (`index.py:264-270` против `282-284`); итоги отчётов за один диапазон могут не совпадать. `opening` в ДДС игнорирует `start_period` (`index.py:279-280`).
25. **Дубли внутри одного файла выписки** имеют одинаковый `source_key`: вторая строка отбрасывается `ON CONFLICT DO NOTHING`, но считается в `added` (`index.py:455, 487-490`). Также совпадут разные платежи без номера с одной датой, суммой и контрагентом.
26. **Индексы `skip`/`categories`** связаны с порядком строк файла между preview и import — `index.py:461, 473`.
27. **`guess_category`**: подстроки без границ слов (`мтс`, `тко`, `тгк`, `енп`, `сфр`, `тариф`, `реестр`, `вывоз`) дают ложные статьи — `bank.py:171-180`. Поддержка «за 9 месяц» из docstring не реализована — `bank.py:206-218`.
28. **`_num` в bank.py**: запятая всегда считается десятичной, поэтому `"1,234"` (запятая как разделитель тысяч) превращается в `1.234`; `"1,234.56"` разбирается верно только потому, что лишние точки схлопываются; минус в середине (`"12-34"`) даёт `0.0` — `bank.py:14-21`.
29. **`_cat_id` создаёт статьи при чтении** (`salary_due`, `index.py:872, 880`) и без уникального ограничения возможны дубли статей при гонке (`index.py:84-90`).
30. **Несколько `acc_staff` на один `profile_id`**: `staff_save` это допускает (`index.py:695-702`), а синхронизация и автоплатежи всегда используют запись с минимальным id (`index.py:151`, `salary_weekly.py:15, 55-57`) — ручные начисления/выплаты на другую запись дадут раздельные, несводимые долги.
31. **Время сервера**: `date.today()` (UTC) определяет текущий месяц, воскресенья и `final` (`index.py:239, 817`, `salary_weekly.py:31`) — у границы суток по МСК возможен сдвиг на день.
32. **`period_close` закрывает будущие и до-стартовые месяцы** без предупреждения (`index.py:598-602`).
33. **Тесты** (`tests.json`) покрывают только OPTIONS/405/401 — ни одной проверки логики, прав и синхронизации.

---

# 3. СберБизнес (sber-api)

> Справочник по `backend/sber-api/`. Документ описывает текущее поведение кода, ничего не меняет.

### 1. Назначение и состав

Функция обслуживает раздел «СБЕР» (`/sber`) и вкладку «СберБизнес» в админ-панели:

- подключение к СберБизнес API (Sber API для юрлиц) по OAuth 2.0 + mTLS-сертификат организации, несколько подключений (организаций/счетов);
- ежедневная автозагрузка выписки по расчётному счёту в бухгалтерию (`acc_entries`) по cron-ссылке;
- справочник реквизитов контрагентов (`acc_counterparties`) с проверкой ИНН/счёта/БИК;
- недельные заявки на оплату (`sber_requests`): старший сотрудник создаёт и отправляет директору, директор оплачивает — создаётся черновик платёжки в СберБизнес, подпись по СМС на стороне банка;
- уведомления во ВКонтакте.

| Файл | Что это |
|---|---|
| `backend/sber-api/index.py` | обработчик `handler`, все действия, синхронизация выписки, оплата, OAuth-callback, cron |
| `backend/sber-api/sber.py` | клиент банка: хосты, Fernet-шифрование, mTLS, токены, тело платёжки, проверки ИНН/счёта, хэш реквизитов |
| `backend/sber-api/products.py` | «продукты» (приложения) Sber API: настройки, секреты и сертификат по каждому продукту, выбор рабочего |
| `backend/sber-api/ca_bundle.py` | только константа `SBER_CA_PEM` — встроенные PEM корневых/промежуточных сертификатов Минцифры (Russian Trusted Root CA) и Сбербанка; добавляется к `certifi` для проверки сервера банка |
| `backend/sber-api/access.py` | копия из accounting-api: `current_user` (сессия/API-токен → роль, разделы, права) |
| `backend/sber-api/bank.py` | копия из accounting-api: здесь используются только `guess_category` и `period_from_text` |
| `backend/sber-api/salary_weekly.py`, `formulas.py` | копии из accounting-api: еженедельные начисления зарплаты, вызываются из cron (`salary_weekly.run`) |
| `backend/sber-api/tests.json` | 5 тестов: OPTIONS → 200; `overview` без входа → 401; `pay` без входа → 401; `?cron=wrong` → 403; `?tls=check` → 200 и оба хоста `ok: true` |
| `backend/sber-api/requirements.txt` | `psycopg2-binary`, `requests`, `cryptography`, `openpyxl` (`certifi` приходит транзитивно с `requests`) |

Фронтенд: `src/lib/sberApi.ts` — `sberCall(body)` делает `POST` на URL из `backend/func2url.json['sber-api']` с заголовком `X-Authorization: <anod_session_token из localStorage>`; при сетевой ошибке возвращает `{error: 'Нет связи с сервером'}`, при не-2xx без `error` — `{error: 'Ошибка сервера'}`. Там же типы `SberOverview`, `SberRequest`, `ReqStatus`, подписи НДС, `openSberBusiness()` (Android intent на пакет `ru.sberbank.sbbol` с fallback на ссылку подписи).

Типичный порядок вызовов UI:
1. `src/pages/Sber.tsx`: `overview {week}` при загрузке и смене недели; разбор `?connect=ok|error|expired&reason=` и `?signed=1` после возврата из банка.
2. Создание/правка заявки — `request_save`; отмена — `request_delete`; «Отправить директору» — `send_week`; директор — `reject` или `PayDialog` → `pay {ids, connection_id, origin}` → открытие `sign_url` (через `openSberBusiness`); повторная ссылка — `sign_links {ids, origin}`.
3. `components/sber/BankCard.tsx`: `connect {origin}`, `sync {days: 7}`, `bank_settings`, `disconnect`.
4. `components/sber/CounterpartyForm.tsx`: `counterparty_save`.
5. Админка (`components/admin/SberTab.tsx`, `SberSection.tsx`, `SberProductPanel.tsx`): `overview`, `diagnose`, `tokens_save`, `notify_save`, `notify_test`, `connection_update`, `connection_delete`, `products`, `product_save`, `product_cert_upload`, `product_cert_delete`.
6. В UI не найдено вызовов: `scopes_save`, `cert_upload`, `cert_delete`, `product_keys_delete` (доступны только напрямую).

### 2. Авторизация и права

Порядок в `handler` (`index.py:514-552`):

1. `OPTIONS` → 200, только CORS (`Access-Control-Allow-Origin: *`, методы `GET, POST, OPTIONS`, заголовки `Content-Type, X-Authorization`).
2. Подключение к БД (`DATABASE_URL`, autocommit), сброс кэша хранилища `_VAULT` и `products.reset()`, затем `_load_cert(cur)` — **всегда, до любой проверки**: миграция продуктов, выбор рабочего продукта, загрузка сертификата и client_id/secret в модуль `sber`.
3. GET-ветки **без входа пользователя**: OAuth-callback (`?state=…&code=…|error=…`), `?tls=check`, `?cron=<ключ>`.
4. Иначе не-POST → `405 «Метод не поддерживается»`.
5. POST: `current_user` по `X-Authorization` (сессия `auth_sessions` с неистёкшим `expires_at` или неотозванный `api_tokens`). Нет пользователя → `401 «Нужно войти в систему»`. Нет раздела `/sber` в `user.sections` → `403 «Нет доступа к разделу СБЕР»`.
6. `_action(...)`; любое `sber.SberError` внутри превращается в `502 {error: текст}`. Прочие исключения не перехватываются (→ 500 платформы).

Права (`access.py`):

| Право | Смысл | Кому по умолчанию |
|---|---|---|
| `sber.view` | видеть заявки и выписку | director, senior_employee (принудительно), deputy |
| `sber.request` | создавать заявки, отправлять директору | director, senior_employee (принудительно), deputy |
| `sber.pay` | оплачивать / отклонять | director (принудительно), deputy |
| `sber.edit_requisites` | менять реквизиты контрагентов | только deputy (или через должность) |
| `sber.sync` | обновлять выписку | director, deputy |

«Замдиректора» (`is_deputy`, роль `deputy_director`) получает все права и все разделы. Пользователь с `is_admin` и ролью не director/deputy принудительно становится `director`. Если у профиля есть должность — права берутся из `positions.actions`, затем к director/senior добавляются принудительные права выше.

### 3. Переменные окружения и секреты

Только имена:

| Имя | Где | Назначение |
|---|---|---|
| `DATABASE_URL` | `index.py:522` | подключение к PostgreSQL |
| `MAIN_DB_SCHEMA` | `index.py:20` | схема (по умолчанию `public`) |
| `SBER_ENV` | `sber.py:84` | `test`/`ift`/`sandbox` → тестовый контур, иначе прод |
| `SBER_VAULT_KEY` | `sber.py:96` | зерно ключа шифрования хранилища |
| `AWS_SECRET_ACCESS_KEY` | `sber.py:96` | запасное зерно ключа, если `SBER_VAULT_KEY` пуст |
| `VK_GROUP_TOKEN` | `index.py:197` | токен сообщества ВК для `messages.send` |
| `SBER_CLIENT_ID`, `SBER_REDIRECT_URI`, `SBER_CLIENT_SECRET` | `products.py:64-73` | читаются **только** при одноразовой миграции в продукт `pay` |

Хосты (`sber.py:18-21, 238, 248`):

| Назначение | Прод | Тест |
|---|---|---|
| API (`/fintech/api…`) и токен (`/ic/sso/api/v2/oauth/token`) | `https://fintech.sberbank.ru:9443` | `https://iftfintech.testsbi.sberbank.ru:9443` |
| Страница входа OAuth (`/ic/sso/api/v2/oauth/authorize`) | `https://sbi.sberbank.ru:9443` | `https://efs-sbbol-ift-web.testsbi.sberbank.ru:9443` |
| Подпись платёжки (`/ic/ufs/rpp-light/index.html#/payment-creator/{externalId}`) | `https://sbi.sberbank.ru:9443` | `https://sbi-test.sberbank.ru` |
| `tls_check` | всегда `fintech.sberbank.ru:9443` и `sbi.sberbank.ru:9443` (без учёта `SBER_ENV`) | — |

### 4. Хранилище ключей и сертификатов

**Таблица `sber_vault`** (`key text PK, value text, updated_at`) — все секреты, значение зашифровано Fernet.

Ключ шифрования (`sber.py:95-100`): `key = SHA-256("sber-vault-v2:" + seed)`, `seed = SBER_VAULT_KEY || AWS_SECRET_ACCESS_KEY`; результат в urlsafe-base64 → `Fernet(key)`. Без зерна — `SberError('Не настроено шифрование хранилища')`. `decrypt` при любой ошибке возвращает `None` (значение молча считается отсутствующим).

Кэш: `_VAULT` — словарь всех строк таблицы, загружается один раз на вызов (сбрасывается в начале `handler`); `_vault_set/_vault_del` обновляют и БД, и кэш.

Ключи хранилища:

| Ключ | Содержимое |
|---|---|
| `p:{code}:client_secret` | Client Secret продукта |
| `p:{code}:cert_p12` | base64 файла .p12/.pfx продукта |
| `p:{code}:cert_password` | пароль к сертификату |
| `p:{code}:client_id` | устаревшее место client_id (переносится в `app_settings.sber_products`) |
| `cert_p12`, `cert_password` | устаревший «общий» сертификат (действия `cert_upload/cert_delete`), при миграции копируется в `p:pay:*` |
| `c{id}:access_token` | access token подключения |
| `c{id}:access_exp` | unix-время истечения access token |
| `c{id}:refresh_token` | refresh token подключения |

**mTLS** (`sber.py:179-233`): `cert_files()` открывает PKCS#12 паролем, пишет во временную папку `tempfile.mkdtemp(prefix='sber_')` файлы `cert.pem` (сертификат + цепочка) и `key.pem` (закрытый ключ PKCS8 **без шифрования**, `chmod 600`); пути кэшируются в процессе, сбрасываются при смене сертификата (`set_cert`). Проверка сервера: `_verify()` собирает `/tmp/sber_trusted_ca.pem` = `certifi` + `SBER_CA_PEM`. Все запросы `_request` идут с `cert=(cert.pem, key.pem)`, `verify=<bundle>`, таймаут 20 с. Ошибки SSL переводятся в понятные тексты:
- `certificate verify failed` → «Не удалось проверить сертификат сервера банка (цепочка доверенных сертификатов)»;
- `unknown ca`/`bad certificate`/`certificate required`/`alert` → «Банк отклонил сертификат организации: загрузите сертификат, выпущенный для Sber API (.p12 из СберБизнес → Сертификаты)»;
- прочие SSL → «Ошибка защищённого соединения с банком: …»; сетевые → «Банк не отвечает, попробуйте позже».

В `tls_check/diagnose` используется `ssl` с выключенным флагом `VERIFY_X509_STRICT` (российские сертификаты).

**Настройки в `app_settings`:**
- `sber` — `limit_payment` (по умолчанию 300000), `limit_day` (1000000), `scope` (по умолчанию `openid GET_CLIENT_ACCOUNTS GET_STATEMENT_ACCOUNT GET_STATEMENT_TRANSACTION PAY_DOC_RU`), `scope_v1`, `scope_v2`, `sign_url_template`, `cron_key`, `pay_method`, `cert` (устар.). При чтении (`_settings`, `index.py:61-73`) поля `scope_v1, scope_v2, back_url, redirect_uri, client_id, cert` **перекрываются** значениями рабочего продукта; `scope` = `scope_v2` или `scope` продукта, если заданы.
- `sber_products` — словарь продуктов (см. ниже).
- `sber_notify` — `{on_send, on_paid, on_reject}` (по умолчанию все `true`).
- `accounting.start_period` — читается при синхронизации.

### 5. Продукты Sber API

`products.py`: в Сбере одна организация может иметь несколько приложений («продуктов»). Описаны 5 кодов:

| code | title | app |
|---|---|---|
| `b2bsaas` (MAIN) | Платформам | `2907011706_B2BSaaS` |
| `pay` | Моментальные платежи | `2907011706_PAY` |
| `company` | Компаниям | `2907011706_Company` |
| `holding` | Холдингам | `2907011706_HOLDING` |
| `sbbid` | СберБизнес ID | `2907011706_SBBID` |

Поля продукта в `app_settings.sber_products[code]`: `active` (bool, по умолчанию true), текстовые `client_id`, `redirect_uri`, `back_url` (кроме `client_id` должны начинаться с `https://`, ≤500 символов), scope-поля `scope`, `scope_v1`, `scope_v2` (запятые → пробелы, нормализация пробелов, ≤2000), `cert` (метаданные: subject, org, serial, valid_from, valid_to, file_name, uploaded_at, uploaded_by), `updated_at`, `updated_by`. Секреты — в хранилище (`p:{code}:…`).

**Выбор рабочего продукта** (`_pick`, `products.py:99-104`): если у `b2bsaas` есть `client_id`, `client_secret` и сертификат — используется он, иначе — `pay` (даже если не настроен). Остальные продукты (`company`, `holding`, `sbbid`) только хранятся и отображаются, в работе не участвуют; флаг `active` на выбор не влияет.

**Миграция** (`_migrate`, `ensure`, вызывается при каждом запросе): переносит `p:{code}:client_id` из хранилища в настройки; если продукта `pay` ещё нет — создаёт его из старых `app_settings.sber` (scope*, cert), env `SBER_CLIENT_ID/SBER_REDIRECT_URI/SBER_CLIENT_SECRET` и старых `cert_p12/cert_password` хранилища. Сохраняется от имени «Система».

Scope: из настроек берётся `scope_v2 || scope` для authorize URL; множество выданных услуг (`scope_v2 || scope`, разбитое по пробелам) используется в `_create_payment` для порядка попыток `PAY_DOC_RU` / `PAY_DOC_RU_INVOICE_ANY`.

### 6. OAuth и подключения

#### 6.1. Поток OAuth (authorization code)

1. **UI** (`BankCard.tsx`) вызывает `connect {origin: window.location.origin}` (только замдиректора).
2. Сервер проверяет `sber.configured()` — `client_id`, `client_secret`, сертификат рабочего продукта; генерирует `state = token_urlsafe(24)`, `nonce = token_urlsafe(16)` и пишет строку в `sber_oauth (state, nonce, user_id, origin[:200], used=false, created_at)`.
3. Возвращает `url = {authHost}/ic/sso/api/v2/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=<scope_v2||scope>&state=…&nonce=…`. Без `redirect_uri` — ошибка «Для входа через СберБизнес нужен Redirect URI …».
4. Пользователь входит в СберБизнес; банк перенаправляет на `redirect_uri` — это URL самой функции: `GET ?state=…&code=…` (или `&error=…&error_description=…`).
5. `_oauth_callback` (`index.py:623-651`): атомарно `UPDATE sber_oauth SET used=true WHERE state=? AND NOT used AND created_at > now()-15 min RETURNING user_id, origin`. Возврат — `302` на `<origin>/sber?connect=…`:
   - строка не найдена → `?connect=expired` (если origin нет — относительный `/sber`);
   - `error` от банка → `?connect=error&reason=<error_description|error>[:300]`;
   - иначе `exchange_code(code)` → `POST {auth}/ic/sso/api/v2/oauth/token` (`grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret`, mTLS) → `_org()` (`GET /fintech/api/v1/client-info`) → `_upsert_connection` → `_store_tokens` → при отсутствии создаёт `cron_key` → лог `acc_log` «СБЕР: подключён» → `?connect=ok`;
   - `SberError` → лог «СБЕР: ошибка подключения» и `?connect=error&reason=…`.
6. `nonce` хранится, но **нигде не проверяется** (id_token не разбирается); `user_id` тоже не используется после сохранения.

#### 6.2. Хранение и обновление токенов

- `_store_tokens`: `c{id}:access_token`, `c{id}:access_exp = now + expires_in (по умолчанию 3600)`, `c{id}:refresh_token` (если банк выдал новый).
- `_token(conn_id)` (`index.py:134-145`): если access есть и до истечения > 60 с — он; иначе `refresh(refresh_token)` (`grant_type=refresh_token`) и сохранение новых токенов. Нет refresh — `SberError('У подключения нет ключей — замдиректора: Админ-панель → СберБизнес')`.
- Альтернатива OAuth — `tokens_save`: ручная вставка Access/Refresh Token (access_exp = now + 3000 с).
- Ошибки токен-эндпоинта (`_token_call`): не 200 → «Банк отказал (код): подсказка|detail»; подсказки: `invalid_client` — «неверный Client ID или Client Secret», `invalid_grant` — «ключ устарел или уже использован — получите новый», `unauthorized_client` — «приложению не разрешён этот вход»; текст `SSL certificate` → «Банк не принял сертификат организации — загрузите сертификат, выпущенный для Sber API».
- Любой API-вызов с 401 → «Банк не принял ключ доступа (Access Token) — обновите ключи подключения»; 400 c `SSL certificate` → как выше.

#### 6.3. Подключения (мульти-организация)

Таблица `sber_connections`: `id, title, org (jsonb: name, inn, kpp, accounts[{number, currency, bic, state, corr}]), account, is_default, active, last_sync, last_sync_result (jsonb {added, skipped}), last_error, created_by, created_at`.

`_upsert_connection(org, who, title, conn_id)` (`index.py:555-573`):
- рублёвые открытые счета: валюта `643/810/RUB/RUR` (или не указана), `state` `OPEN` (или не указан);
- `conn_id` задан → обновляет `org`, `active=true`, `last_error=NULL`, `title` (если дан); счёт сохраняется, если он есть среди счетов организации, иначе первый рублёвый;
- иначе ищется активное подключение с тем же `org->>'inn'`; найдено и `title` не задан → обновление его;
- иначе INSERT; `is_default=true`, если активного подключения по умолчанию нет.

`_connection(conn_id)` — только активные с `org` и `account`; нет таких → «СберБизнес не подключён»; указанный id не найден → «Подключение не найдено или отключено»; без id — подключение по умолчанию или первое.

Плательщик для платёжки (`_payer_bank`): БИК из счёта организации; корр. счёт — из счёта, иначе из `acc_counterparties` с тем же БИК, иначе вычисляется перебором `30101810{k}00000000{bic[-3:]}` с проверкой контрольного ключа (кроме БИК на 000/001/002).

### 7. Синхронизация выписки

Точки входа: действие `sync` (дни ≤31, по умолчанию 3) и cron (`days` 0–15, по умолчанию 1; `back` 0–120 — сдвиг окна в прошлое). `sync_all` проходит по всем активным подключениям со счётом; ошибка одного пишется в его `last_error` и в `errors[]`, остальные продолжаются.

`sync_statement(c, days, who, back)` (`index.py:367-462`):

1. Токен `_token(c.id)`; `start_period` из `app_settings.accounting` (по умолчанию `2000-01`); множество закрытых периодов `acc_periods.closed`; все контрагенты (`id, name, inn, default_category_id`).
2. Множество `seen` — `source_key` банковских `acc_entries` с `entry_date >= today − (days+back+3)`.
3. Для каждого дня от `today−(days+back)` до `today−back` и страниц `page = 1..20`:
   `GET /fintech/api/v2/statement/transactions?accountNumber=<счёт>&statementDate=<YYYY-MM-DD>&page=<n>`.
   - 404 или 202 (выписка не готова) → следующий день;
   - 403 → `SberError` «Сбер не дал доступ к выписке: в приложении Sber API нет услуги «Выписка» (GET_STATEMENT_TRANSACTION). Подключите её у менеджера Сбера и обновите ключи подключения»;
   - другой не-200 → «Банк не отдал выписку за {day} ({code})»;
   - пагинация: следующая страница, только если в `_links` есть `rel == 'next'`.
4. Для каждой транзакции:
   - `direction == CREDIT` → `income`, иначе `expense`; сумма = `|amountRub.amount|` или `|amount.amount|` (или скаляр);
   - пропуск без счёта: сумма ≤ 0 или месяц `operationDate` < `start_period`;
   - месяц закрыт → `skipped++`;
   - контрагент: из `rurTransfer.payerName/payerInn` (доход) или `payeeName/payeeInn` (расход);
   - ключ дедупликации `uid = t.uuid` или `"{op_date}|{kind}|{amount:.2f}|{number}|{inn or name[:40]}"`; уже в `seen` → `skipped++`;
   - связь с заявкой: по `t.externalId` = `sber_requests.external_id`; если статус заявки `paying/signing/sent/failed` → `status='paid', bank_status='EXECUTED'` и уведомление `paid`;
   - поиск контрагента: по ИНН, затем по точному имени (без регистра); не найден, но имя есть → INSERT `acc_counterparties (name[:150], kind = supplier|customer, inn)`;
   - статья: из заявки → `default_category_id` контрагента → `guess_category({kind, purpose, name})` по имени статьи (`acc_categories`, неархивные, тот же `kind`);
   - период: из заявки → `period_from_text(purpose, op_date)`;
   - `INSERT acc_entries (kind, entry_date, amount, category_id, comment = "Банк №{number}: {purpose[:400]}", counterparty_id, period, source='bank', source_key=uid, bank_purpose[:1000], created_by=who, bank_connection_id) ON CONFLICT (source, source_key) WHERE source IS NOT NULL DO NOTHING RETURNING id`;
   - при вставке и наличии заявки → `sber_requests.entry_id = id`; если вычисленный период закрыт — период записи переставляется на месяц операции.
5. Для затронутых периодов `acc_periods.fingerprint = NULL` (сброс отпечатка закрытия/кэша); `sber_connections.last_sync = now(), last_sync_result = {added, skipped}, last_error = NULL`.

`recategorize()` (после `sync` и в cron): до 1000 банковских неаннулированных операций без статьи → `default_category_id` контрагента или `guess_category`; ручной выбор не трогается (обрабатываются только `category_id IS NULL`).

**Остатки (balances):** в коде не запрашиваются — эндпоинтов остатков/`GET_STATEMENT_ACCOUNT` нет, хотя scope по умолчанию включает `GET_STATEMENT_ACCOUNT`. `client-info` используется только для списка счетов.

### 8. Заявки на оплату

Таблица `sber_requests`: `id, counterparty_id, amount numeric(14,2), purpose, vat_rate, week_start, status, requisites (jsonb — снимок name, inn, kpp, account, bic, bank_name, corr_account), requisites_hash, created_by (имя), created_by_user (user id), created_at, sent_at, decided_by, decided_at, reject_reason, external_id, bank_status, bank_comment, bank_checked_at, connection_id, entry_id, category_id, period`.

#### 8.1. Статусы

| Код | Подпись (`STATUS`) |
|---|---|
| `draft` | Черновик |
| `sent` | На оплате у директора |
| `rejected` | Отклонена |
| `paying` | Отправлена в банк |
| `signing` | Ждёт подписи по СМС |
| `paid` | Оплачена |
| `failed` | Ошибка банка |
| `cancelled` | Отменена |

#### 8.2. Переходы

| Из | В | Кто / что |
|---|---|---|
| — | `draft` | `request_save` без `sber.pay` |
| — | `sent` | `request_save` пользователем с `sber.pay` (сразу, `sent_at=now()`) |
| `draft`/`rejected`/`sent` | `draft` или `sent` | `request_save` с `id` (правка; `reject_reason` очищается) |
| `draft` | `sent` | `send_week` (все черновики недели автора; замдиректора — все) |
| `draft`/`rejected`/`sent` | `cancelled` | `request_delete` (автор или замдиректора) |
| `sent` | `rejected` | `reject` (`sber.pay`) |
| `sent` | `paying` | `pay` — атомарно до вызова банка, назначается `external_id` (UUID4, переиспользуется при повторе) и `connection_id` |
| `paying` | `signing` | банк создал черновик (200/201) |
| `paying` | `sent` | `SberError` при создании или 403 по обоим способам (с `bank_comment`) |
| `paying` | `failed` | другой ответ банка (`bank_status='ERROR'`) |
| `paying`/`signing` | `paid`/`failed`/`signing` | опрос `_refresh_statuses` |
| `paying`/`signing`/`sent`/`failed` | `paid` | операция найдена в выписке по `externalId` |

#### 8.3. Недели

`week_start` = понедельник (`_week_start`). `request_save`: неделя из `body.week` или текущая; не позже текущей + 14 дней («Планировать оплату можно максимум на 2 недели вперёд»), нижней границы нет. `overview` показывает заявки одной недели и сводку `pending` по всем неделям со статусом `sent`.

#### 8.4. Оплата (`_pay`)

1. Право `sber.pay`; подключение `_connection(connection_id)`; `ids` ≤ 50; все заявки должны быть `sent`, иначе «Часть заявок уже обработана — обновите страницу».
2. Для каждой: текущий `requisites_hash` контрагента должен совпадать с `sber.requisites_hash(снимок)` (SHA-256 JSON полей `name, inn, kpp, account, bic`, `sort_keys`); сумма ≤ `limit_payment`.
3. `_paid_today()` (сумма `paying/signing/paid` с `decided_at` сегодня) + итог ≤ `limit_day`.
4. **Пароль не проверяется**: функция `_check_password` (PBKDF2-SHA256, 150000 итераций, лимит 5 неудачных попыток за 15 мин в `sber_pay_attempts`) определена в `index.py:312-328`, но нигде не вызывается; `body.password` игнорируется, в `PayDialog.tsx` поля пароля нет.
5. Номер документа: `день_года * 100 + n` (n — счётчик заявок с `external_id`, решённых сегодня), в теле — последние 8 цифр.
6. `sber.payment_body(...)` (`sber.py:300-325`) — поля: `externalId, number, date, amount, operationCode='01', deliveryKind='электронно', priority='5', purpose[:210], vat, payerName[:160], payerInn, payerKpp, payerAccount, payerBankBic, payerBankCorrAccount, payeeName[:160], payeeInn ('0' если пусто), payeeKpp, payeeAccount, payeeBankBic, payeeBankCorrAccount`; пустые значения удаляются. КПП не из 9 цифр → `'0'`. НДС: `none` → `{type: NO_VAT, amount: 0}` и «НДС не облагается»; иначе `{type: INCLUDED, rate, amount = round(sum*rate/(100+rate), 2)}` и «В т.ч. НДС X% - Y руб.»; хвост про НДС дописывается к назначению, если в нём нет «ндс».
7. `_create_payment` (`index.py:469-482`): способы `PAY_DOC_RU → POST /v1/payments` (полное тело) и `PAY_DOC_RU_INVOICE_ANY → POST /v1/payments/from-invoice-any` (`invoice_any_body`: только получатель + `paymentNumber`). Порядок: сначала сохранённый `pay_method`, затем выданный в scope. При 403 — следующий способ; первый успешный способ сохраняется в `app_settings.sber.pay_method` («Автонастройка»).
8. Результат по заявке: 200/201 → `signing`, `bank_status = bankStatus|CREATED`, `sign_url`, лог «Оплата»; 403 → текст «Сбер не разрешил создать платёжку ни одним способом (PAY_DOC_RU и PAY_DOC_RU_INVOICE_ANY). Обновите ключи подключения: при входе должны быть выданы эти услуги — заявка осталась на оплате», возврат в `sent`, цикл прерывается; прочее → `failed`, `bank_comment = "{code}: {message (fields…)}"`, `print('SBER PAY ERROR', code, text[:1500])`.

#### 8.5. Проверки реквизитов (`counterparty_save`)

- `check_inn`: 10 или 12 цифр с контрольными суммами ФНС.
- КПП — ровно 9 цифр (если указан).
- При счёте или БИК: БИК 9 цифр; `check_account(acc, bic)` — счёт 20 цифр, ключ по весам `7,1,3` с префиксом `bic[-3:]` (кредитная организация) или `'0' + bic[4:6]` (счёт в РКЦ); корр. счёт — 20 цифр.
- НДС из `{none, 0, 5, 7, 10, 20, 22}`.
- Хэш реквизитов пересчитывается при наличии счёта и БИК; при изменении фиксируются `requisites_updated_at/by` и лог. Заявки со старым хэшем помечаются `requisites_changed` (для `draft/sent`) и не оплачиваются.
- `ready` контрагента = есть `account`, `bank_bic`, `name`, `requisites_hash`.

#### 8.6. Ссылки подписи

`_sign_url(s, externalId, back)`: если в настройках есть `sign_url_template` с `{externalId}` — подстановка `{externalId}` и `{backUrl}` (URL-encoded); иначе стандартная ссылка `sber.sign_url` с `?backUrl=`. `back` (`_back`): `back_url` продукта + `signed=1`, иначе `origin + '/sber?signed=1'`, если `origin` соответствует `^https://[a-z0-9.-]+(:\d+)?$`, иначе пусто.

#### 8.7. Опрос статусов банка

`_refresh_statuses` (в `overview`, `sync`, cron): до 20 заявок `paying/signing`, не проверявшихся > 2 минут. `GET /fintech/api/v1/payments/{externalId}/state` токеном подключения заявки (или подключения по умолчанию). Не 200 → только `bank_checked_at`. `bankStatus`:
- `EXECUTED, ACCEPTED_BY_ABS, ACCEPTED` → `paid`;
- `REFUSED, DECLINED, DELETED, INVALIDEDS, CANCELED, REFUSEDBYABS` → `failed`;
- `CREATED, NEW, IMPLEMENTED, PARTSIGNED, SIGNED, DELIVERED` → `signing`;
- прочее — статус не меняется. Сохраняются `bank_status`, `bank_comment[:500]`; при `paid/failed` — уведомление автору.

Связь с бухгалтерией — только через выписку (раздел 7): операция с тем же `externalId` создаёт `acc_entries` с категорией/периодом заявки и проставляет `sber_requests.entry_id`.

### 9. Уведомления ВКонтакте

`_vk_send(profile_ids, text)`: нужен `VK_GROUP_TOKEN`; получатели — `vk_bindings` со `status='confirmed'` и `vk_user_id` для этих профилей; `POST https://api.vk.com/method/messages.send` (`v=5.199`, `random_id`, `message[:3500]`, таймаут 8 с). Возвращает число успешных (без `error`) отправок; исключения игнорируются.

Настройки `app_settings.sber_notify` (`notify_save`): `on_send`, `on_paid` (также управляет `failed`), `on_reject`; по умолчанию всё включено.

| Событие | Получатели | Текст |
|---|---|---|
| `send_week` (`on_send`) | активные профили с `sber.pay` в должности, все `deputy_director`, а также `director` без должности | `💳 Заявки на оплату\nНеделя ДД.ММ–ДД.ММ\nОт: {имя}\n\n• {контрагент} — {сумма} ₽ …(до 15 строк, по убыванию суммы, все sent недели)\n\nИтого новых: {N} на {сумма}\n\nОплатить: АнодБИЗ → раздел СБЕР` |
| `paid` (`on_paid`) | профили автора заявки (`profiles.user_id = created_by_user`) | `✅ Оплачено\n{контрагент} — {сумма}\n\nАнодБИЗ → раздел СБЕР` |
| `failed` (`on_paid`) | автор | `⚠️ Банк не провёл платёж\n{контрагент} — {сумма}\n{bank_comment}\n\nАнодБИЗ → раздел СБЕР` |
| `rejected` (`on_reject`) | автор | `❌ Заявка отклонена\n{контрагент} — {сумма}\nПричина: {reason}\n\nАнодБИЗ → раздел СБЕР` |
| `notify_test` | сам пользователь | `🔔 Проверка уведомлений раздела СБЕР — всё работает` |

Формат суммы: `1 234,56 ₽`. Уведомление `failed` при ошибке непосредственно в `pay` (статус `failed`) **не** отправляется — только при опросе статуса.

### 10. Справочник действий

Общее для всех POST-действий: тело JSON `{action, …}`, заголовок `X-Authorization`; ошибки входа/раздела — см. раздел 2 (`401 «Нужно войти в систему»`, `403 «Нет доступа к разделу СБЕР»`); `SberError` → `502 {error}`; неизвестное действие → `400 «Неизвестное действие»`. Все ошибки — `{error: "текст"}`. Перед любым действием выполняется `_settings(cur)`.

#### 10.1. GET-обработчики (без входа пользователя)

#### `GET ?state=…&code=…` / `?state=…&error=…` (OAuth callback)

- **Назначение**: приём кода авторизации от СберБизнес, создание/обновление подключения.
- **Право**: нет (защита — одноразовый `state` с TTL 15 мин).
- **Вход**:

| Параметр | Тип | Описание |
|---|---|---|
| `state` | string | обязателен (иначе ветка не срабатывает) |
| `code` | string | код авторизации |
| `error`, `error_description` | string | ошибка от банка |

- **Проверки и ошибки** (всегда `302`, `Location`): `<origin>/sber?connect=expired` — state не найден/использован/старше 15 мин; `?connect=error&reason=<error_description|error>` — ошибка банка; `?connect=error&reason=<текст SberError>` — ошибка обмена/`client-info` (например «Банк отказал (400): ключ устарел или уже использован — получите новый», «Банк не вернул данные организации ({code})»).
- **Логика по шагам**: см. 6.1 п.5.
- **Внешние вызовы**: `POST {auth}/ic/sso/api/v2/oauth/token` (`authorization_code`), `GET {api}/fintech/api/v1/client-info`.
- **Таблицы**: `sber_oauth` (UPDATE used), `sber_connections` (INSERT/UPDATE), `sber_vault` (токены), `app_settings.sber` (`cron_key`), `acc_log`.
- **Ответ**: `302` без тела, `Location: <origin>/sber?connect=ok|error|expired[&reason=…]`.
- **Побочные эффекты**: новое подключение может стать подключением по умолчанию; при первом подключении создаётся `cron_key`.

#### `GET ?tls=check`

- **Назначение**: проверка, что серверы банка проходят проверку по встроенной цепочке CA (без ключей организации).
- **Право**: нет.
- **Вход**: `tls=check`.
- **Проверки и ошибки**: нет; ошибки соединения попадают в элементы списка (`ok: false, error`).
- **Логика по шагам**: для `fintech.sberbank.ru` и `sbi.sberbank.ru`, порт 9443: TLS-рукопожатие с `ssl.create_default_context(cafile=certifi+SBER_CA_PEM)`, без `VERIFY_X509_STRICT`, таймаут 8 с.
- **Внешние вызовы**: TCP/TLS к двум хостам банка.
- **Таблицы**: нет (но до этого выполняется `_load_cert`: чтение `sber_vault`, `app_settings`, возможна запись миграции продуктов).
- **Ответ**: `200 {tls: [{host, ok: true, issuer} | {host, ok: false, error}]}`.
- **Побочные эффекты**: файл `/tmp/sber_trusted_ca.pem`.

#### `GET ?cron=<ключ>[&days=N][&back=M]`

- **Назначение**: плановая задача: выписка, перекатегоризация, недельная зарплата, опрос статусов платежей.
- **Право**: совпадение с `app_settings.sber.cron_key`.
- **Вход**:

| Параметр | Тип | Описание |
|---|---|---|
| `cron` | string | ключ |
| `days` | int | 0–15, по умолчанию 1 |
| `back` | int | 0–120, по умолчанию 0 |

- **Проверки и ошибки**: нет ключа в настройках или не совпал → `403 «Нет доступа»`; нечисловые `days/back` → необработанный `ValueError` (500).
- **Логика по шагам**: `sync_all(days, back)` → `recategorize()` → `salary_weekly.run()` (ошибка → `weekly_error`) → `_refresh_statuses()` (`SberError` игнорируется).
- **Внешние вызовы**: выписка `GET /v2/statement/transactions`, токены (refresh), `GET /v1/payments/{ext}/state`, VK `messages.send`.
- **Таблицы**: `acc_entries`, `acc_counterparties`, `acc_periods`, `sber_connections`, `sber_requests`, `sber_vault`, таблицы зарплаты (`salary_weekly`).
- **Ответ**: `200 {ok: errors пуст, added, skipped, errors[], recategorized, …результат salary_weekly | weekly_error}` (ошибки подключений не дают не-200).
- **Побочные эффекты**: уведомления ВК об оплате/ошибке.

Прочие GET → `405 «Метод не поддерживается»`.

#### 10.2. Продукты Sber API

Для всех `products` и `product_*`: сначала в `index.py:656-662` — не замдиректора → `403 «Только заместитель директора»`; затем `products.handle`. `PermissionError` → 403.

#### `products`

- **Назначение**: список продуктов и их настроек для админ-панели.
- **Право**: замдиректора.
- **Вход**: нет.
- **Проверки и ошибки**: `403 «Только заместитель директора»`.
- **Логика по шагам**: `overview()`: для каждого из 5 кодов — `code, title, app, active, main (== b2bsaas), in_use (рабочий), client_id, redirect_uri, back_url, scope, scope_v1, scope_v2, cert, configured{client_id, client_secret}, updated_at, updated_by`.
- **Внешние вызовы**: нет.
- **Таблицы**: `app_settings.sber_products`, `sber_vault` (чтение).
- **Ответ**: `200 {products: [...]}`. Секреты не возвращаются, `client_id` возвращается.
- **Побочные эффекты**: нет.

#### `product_save`

- **Назначение**: сохранить настройки продукта.
- **Право**: замдиректора.
- **Вход**:

| Поле | Тип | Описание |
|---|---|---|
| `code` | string | один из 5 кодов |
| `active` | bool | опц. |
| `scope`, `scope_v1`, `scope_v2` | string | опц.; запятые → пробелы, ≤2000 |
| `client_id`, `redirect_uri`, `back_url` | string | опц.; ≤500 |
| `client_secret` | string | опц.; пустое не перезаписывает |

- **Проверки и ошибки**: неизвестный `code` → `502 «Неизвестный раздел Sber API»`; `redirect_uri`/`back_url` не с `https://` → `502 «Адрес должен начинаться с https://»`.
- **Логика по шагам**: обновить переданные поля; секрет → `sber_vault p:{code}:client_secret`; `updated_at/by`; сохранить; лог «СБЕР: Sber API «{title}»: настройки».
- **Внешние вызовы**: нет.
- **Таблицы**: `app_settings.sber_products`, `sber_vault`, `acc_log`.
- **Ответ**: `200 {products: [...]}`.
- **Побочные эффекты**: может сменить рабочий продукт (если у `b2bsaas` появились все ключи).

#### `product_cert_upload`

- **Назначение**: загрузить mTLS-сертификат продукта.
- **Право**: замдиректора.
- **Вход**: `code`, `file_name` (`.p12`/`.pfx`), `file` (base64, допускается data-URL префикс), `password`.
- **Проверки и ошибки** (все `502`): «Неизвестный раздел Sber API»; «Нужен файл сертификата .p12 или .pfx»; «Файл повреждён» (невалидный base64); «Файл не похож на сертификат» (размер не в (100; 50000) байт); «Не удалось открыть файл: неверный пароль или это не сертификат .p12/.pfx»; «В файле нет закрытого ключа или сертификата — выгрузите сертификат вместе с ключом»; «Сертификат уже истёк ({valid_to}) — загрузите новый».
- **Логика по шагам**: `inspect_cert` → сохранить `p:{code}:cert_p12` (base64) и `p:{code}:cert_password` → метаданные в `p.cert` → лог «… сертификат загружен» (subject, valid_to).
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_vault`, `app_settings.sber_products`, `acc_log`.
- **Ответ**: `200 {products}`.
- **Побочные эффекты**: сброс кэша рабочего продукта.

#### `product_cert_delete`

- **Назначение**: удалить сертификат продукта.
- **Право**: замдиректора.
- **Вход**: `code`.
- **Проверки и ошибки**: `502 «Неизвестный раздел Sber API»`.
- **Логика по шагам**: удалить `p:{code}:cert_p12`, `p:{code}:cert_password`; убрать `p.cert`; лог «… сертификат удалён».
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_vault`, `app_settings.sber_products`, `acc_log`.
- **Ответ**: `200 {products}`.
- **Побочные эффекты**: при удалении у `b2bsaas` рабочим становится `pay`.

#### `product_keys_delete`

- **Назначение**: удалить Client ID/Secret продукта.
- **Право**: замдиректора.
- **Вход**: `code`.
- **Проверки и ошибки**: `502 «Неизвестный раздел Sber API»`.
- **Логика по шагам**: удалить `p:{code}:client_secret`, `p:{code}:client_id` из хранилища, `client_id` из настроек; лог «… ключи удалены».
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_vault`, `app_settings.sber_products`, `acc_log`.
- **Ответ**: `200 {products}`.
- **Побочные эффекты**: токены подключений не удаляются. Вызова из UI нет.

Иное `product_*` с корректным `code` → `502 «Неизвестное действие»`.

#### 10.3. Обзор, настройки, подключения

#### `overview`

- **Назначение**: всё для страницы `/sber` и вкладки админки.
- **Право**: любое из `sber.view`, `sber.request`, `sber.pay`.
- **Вход**: `week` (ISO-дата, опц.; приводится к понедельнику; по умолчанию текущая неделя).
- **Проверки и ошибки**: `403 «Нет доступа»` (проверяется **после** опроса статусов банка); некорректная `week` → `ValueError` (500).
- **Логика по шагам**: `_refresh_statuses()` (ошибки игнорируются) → подключения (замдиректора — все с `has_tokens`; остальные — только живые, урезанные поля) → заявки недели (LIMIT 500; у кого нет ни `sber.pay`, ни `sber.view` — только свои) → `pending` по неделям (`sent`) → `sber.configured()` → расходные статьи → сборка ответа.
- **Внешние вызовы**: возможно `GET /v1/payments/{ext}/state` и refresh токенов; VK при смене статуса.
- **Таблицы**: `sber_requests`, `sber_connections`, `acc_counterparties`, `acc_categories`, `app_settings`, `sber_vault`.
- **Ответ**: `200 {week, requests[], pending[{week,count,amount}], counterparties[] (все, с реквизитами), categories[{id,kind,name}], statuses, can[sber.*], is_deputy, connections[], notify (только deputy), bank: {connected, configured{client_id,client_secret,certificate}, ready, test, org, account, last_sync, last_sync_result, last_sync_error, limit_payment, limit_day, paid_today, cron_url_ready, cert, scope_v1*, scope_v2*, has_tokens*, sign_url_template*, cron_key*}}` (* — только замдиректора, иначе `null`).
- **Побочные эффекты**: обновление статусов заявок, уведомления ВК.

#### `scopes_save`

- **Назначение**: сохранить scope v1/v2 и шаблон ссылки подписи.
- **Право**: замдиректора.
- **Вход**: `scope_v1`, `scope_v2` (string), `sign_url_template` (string, ≤500, опц.).
- **Проверки и ошибки**: `403 «Только заместитель директора»`; шаблон не `https://`, без `{externalId}` или не по `^https://[a-z0-9.-]*sberbank\.ru` → `400 «Ссылка подписания должна вести на сайт Сбербанка и содержать {externalId}»`.
- **Логика по шагам**: нормализация scope; `scope = scope_v2` если задан; сохранить `app_settings.sber`; лог «Scope».
- **Внешние вызовы**: нет.
- **Таблицы**: `app_settings.sber`, `acc_log`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: значения `scope_v1/scope_v2` при чтении перекрываются полями рабочего продукта (если там пусто — пустой строкой), поэтому сохранённые здесь scope фактически не действуют (`index.py:68-69`). В UI вызова нет.

#### `tokens_save`

- **Назначение**: подключение по вручную вставленным токенам.
- **Право**: замдиректора.
- **Вход**: `access_token`, `refresh_token` (string), `connection_id` (int, опц.), `title` (≤100, опц.).
- **Проверки и ошибки** (400, если не указано иное): `403 «Только заместитель директора»`; оба пусты → «Вставьте Access Token и Refresh Token»; нет refresh → «Нужен Refresh Token — без него ключи перестанут работать через час»; нет сертификата → «Сначала загрузите сертификат организации»; refresh отклонён → «Банк не принял Refresh Token: {e}»; `client-info` не прошёл → «Банк не принял ключи: {e}. Ничего не сохранено.».
- **Логика по шагам**: если access пуст — refresh; `_org(token)`; `_upsert_connection(org, имя, title, connection_id)`; сохранить refresh/access/`access_exp = now+3000`; создать `cron_key` при отсутствии; лог «Подключение по токенам»; пробная загрузка выписки за 7 дней (ошибка → `last_error`).
- **Внешние вызовы**: token refresh (опц.), `GET /v1/client-info`, выписка.
- **Таблицы**: `sber_connections`, `sber_vault`, `app_settings.sber`, `acc_log`, `acc_entries`, `acc_counterparties`, `acc_periods`, `sber_requests`.
- **Ответ**: `200 {ok: true, org, connection_id, loaded: {added, skipped} | null}`.
- **Побочные эффекты**: если access передан, refresh сохраняется без проверки банком.

#### `diagnose`

- **Назначение**: пошаговая диагностика соединения.
- **Право**: замдиректора.
- **Вход**: нет.
- **Проверки и ошибки**: `403 «Только заместитель директора»`.
- **Логика по шагам**: «Сертификат организации» (`cert_files` + `inspect_cert`) → «Соединение с банком» (mTLS-рукопожатие к API-хосту) → «Банк принял сертификат» (`POST /oauth/token` с `grant_type=refresh_token, refresh_token='check'`) → «Client ID и Client Secret» (`invalid_client` в ответе = не приняты). Первый провал останавливает проверку.
- **Внешние вызовы**: TLS и token-эндпоинт банка.
- **Таблицы**: нет.
- **Ответ**: `200 {steps: [{step, ok, text}], redirect_uri}`.
- **Побочные эффекты**: временные PEM-файлы.

#### `notify_save`

- **Назначение**: настройки уведомлений ВК.
- **Право**: замдиректора.
- **Вход**: `on_send`, `on_paid`, `on_reject` (bool).
- **Проверки и ошибки**: `403 «Только заместитель директора»`.
- **Логика по шагам**: upsert `app_settings.sber_notify`.
- **Внешние вызовы**: нет.
- **Таблицы**: `app_settings`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: нет (лог не пишется).

#### `notify_test`

- **Назначение**: тестовое сообщение себе во ВК.
- **Право**: любой пользователь с разделом `/sber`.
- **Вход**: нет.
- **Проверки и ошибки**: нет.
- **Логика по шагам**: `_vk_send([profile_id], '🔔 Проверка уведомлений раздела СБЕР — всё работает')`.
- **Внешние вызовы**: VK `messages.send`.
- **Таблицы**: `vk_bindings` (чтение).
- **Ответ**: `200 {ok: true, sent: N}` (0 — нет токена/привязки).
- **Побочные эффекты**: сообщение ВК.

#### `connection_update`

- **Назначение**: переименовать подключение, выбрать счёт, сделать основным.
- **Право**: замдиректора.
- **Вход**: `id` (int), `title` (≤100, опц.), `account` (опц.), `is_default` (bool, опц.).
- **Проверки и ошибки**: `403 «Только заместитель директора»`; `404 «Подключение не найдено»`; счёт не из `org.accounts` → `400 «Выберите счёт этой организации»`.
- **Логика по шагам**: `UPDATE title/account` (пустые не меняют); при `is_default` — `is_default = (id = X)` среди активных; лог «Подключение изменено».
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_connections`, `acc_log`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: подключение может быть неактивным — проверки `active` нет.

#### `connection_delete`

- **Назначение**: отключить одно подключение.
- **Право**: замдиректора.
- **Вход**: `id` (int).
- **Проверки и ошибки**: `403 «Только заместитель директора»`; `404 «Подключение не найдено»`.
- **Логика по шагам**: удалить все ключи `c{id}:*` из хранилища; `active=false, is_default=false`; если не осталось основного — основным становится активное с минимальным id; лог «Подключение отключено».
- **Внешние вызовы**: нет (токены в банке не отзываются).
- **Таблицы**: `sber_vault`, `sber_connections`, `acc_log`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: заявки `paying/signing` этого подключения больше не опрашиваются его токеном (будет взят токен основного, при ошибке пропуск).

#### `cert_upload` / `cert_delete` (устаревшие)

- **Назначение**: загрузка/удаление «общего» сертификата (до появления продуктов).
- **Право**: замдиректора.
- **Вход**: `cert_upload` — `file_name`, `file` (base64), `password`; `cert_delete` — нет.
- **Проверки и ошибки**: `403 «Сертификат загружает только заместитель директора»`; далее как у `product_cert_upload`, но коды: «Нужен файл сертификата .p12 или .pfx», «Файл повреждён», «Файл не похож на сертификат», «Сертификат уже истёк ({valid_to}) — загрузите новый» — `400`; ошибки `inspect_cert` — `502`.
- **Логика по шагам**: upload — ключи `cert_p12`, `cert_password`, `sber.set_cert` на время запроса, метаданные в `app_settings.sber.cert`, лог «Сертификат загружен»; delete — удалить эти ключи, `cert` из настроек, лог «Сертификат удалён».
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_vault`, `app_settings.sber`, `acc_log`.
- **Ответ**: upload `200 {ok: true, cert}`; delete `200 {ok: true}`.
- **Побочные эффекты**: в работе используется сертификат продукта (`_load_cert` при каждом запросе), а `s['cert']` в ответах перекрывается продуктовым — эти действия на рабочий mTLS не влияют (кроме разовой миграции в `pay`). В UI вызова нет.

#### `connect`

- **Назначение**: начать OAuth-вход в СберБизнес.
- **Право**: замдиректора.
- **Вход**: `origin` (string, адрес приложения для возврата).
- **Проверки и ошибки**: `403 «Только заместитель директора»`; не настроены ключи/сертификат → `400 «Сначала добавьте ключи СберБизнес и загрузите сертификат (Админ-панель → СберБизнес)»`; нет `redirect_uri` → `502 «Для входа через СберБизнес нужен Redirect URI (Админ-панель → СберБизнес) — или вставьте Access/Refresh Token в админ-панели»`.
- **Логика по шагам**: см. 6.1 п.2–3.
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_oauth` (INSERT).
- **Ответ**: `200 {url}` — UI выполняет переход.
- **Побочные эффекты**: строки `sber_oauth` не чистятся.

#### `disconnect`

- **Назначение**: отключить все подключения.
- **Право**: замдиректора.
- **Вход**: нет.
- **Проверки и ошибки**: `403 «Только заместитель директора»`.
- **Логика по шагам**: удалить все ключи `^c\d+:`; все `sber_connections` → `active=false, is_default=false`; лог «Отключён».
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_vault`, `sber_connections`, `acc_log`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: ключи продуктов и сертификаты сохраняются.

#### `bank_settings`

- **Назначение**: лимиты оплат и выбор счёта.
- **Право**: замдиректора.
- **Вход**: `limit_payment`, `limit_day` (число/строка, `,` → `.`), `account` (опц.), `connection_id` (опц.).
- **Проверки и ошибки**: `403 «Только заместитель директора»`; лимиты не в 0.01–99 999 999 или `limit_payment > limit_day` → `400 «Лимит одного платежа должен быть не больше дневного»`; ошибки `_connection` → `400` с её текстом; счёт не организации → `400 «Выберите счёт организации»`.
- **Логика по шагам**: при `account` — обновить счёт подключения; записать лимиты; лог «Лимиты».
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_connections`, `app_settings.sber`, `acc_log`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: нет.

#### `sync`

- **Назначение**: ручная загрузка выписки.
- **Право**: `sber.sync`.
- **Вход**: `days` (int, ≤31, по умолчанию 3).
- **Проверки и ошибки**: `403 «Нет права обновлять выписку»`; все подключения с ошибкой и ничего не добавлено → `502 «{title}: {ошибка}; …»`; `_refresh_statuses` здесь не обёрнут — его `SberError` → 502.
- **Логика по шагам**: `sync_all(days, who=имя)` → `recategorize()` → `_refresh_statuses()` → лог «Выписка».
- **Внешние вызовы**: выписка, токены, статусы платежей, VK.
- **Таблицы**: см. раздел 7 + `sber_requests`, `acc_log`.
- **Ответ**: `200 {ok: true, added, skipped, errors[], recategorized}`.
- **Побочные эффекты**: автосоздание контрагентов, отметка заявок оплаченными.

#### 10.4. Контрагенты и заявки

#### `counterparty_save`

- **Назначение**: создать/изменить контрагента с реквизитами.
- **Право**: `sber.edit_requisites`.
- **Вход**:

| Поле | Тип | Описание |
|---|---|---|
| `id` | int | опц.; есть — правка |
| `name` | string | обязательно, ≤160 |
| `kind` | string | по умолчанию `supplier` (не проверяется) |
| `inn`, `kpp`, `account`, `bic`, `corr_account` | string | нецифры удаляются |
| `bank_name` (≤160), `default_purpose` (≤200), `phone` (≤40), `comment` (≤300) | string | опц. |
| `vat_rate` | string | `none,0,5,7,10,20,22` |
| `default_category_id` | int | опц., не проверяется |
| `archived` | bool | опц. |

- **Проверки и ошибки** (400): `403 «Реквизиты контрагентов меняет только заместитель директора»`; «Укажите название получателя, как в банке»; «ИНН с ошибкой — проверьте цифры»; «КПП — 9 цифр»; «БИК — 9 цифр»; «Расчётный счёт не сходится с БИК — проверьте реквизиты»; «Корр. счёт — 20 цифр»; «Неизвестная ставка НДС»; `404 «Контрагент не найден»`.
- **Логика по шагам**: нормализация → проверки (см. 8.5) → `requisites_hash` (если есть счёт и БИК) → UPDATE (при смене хэша — `requisites_updated_at/by`, лог «Реквизиты изменены: счёт старый → новый, БИК …») или INSERT (лог «Новый контрагент»).
- **Внешние вызовы**: нет.
- **Таблицы**: `acc_counterparties`, `acc_log`.
- **Ответ**: `200 {ok: true, counterparties: [...]}`.
- **Побочные эффекты**: заявки со старым хэшем блокируются для оплаты.

#### `request_save`

- **Назначение**: создать/изменить заявку на оплату.
- **Право**: `sber.request` или `sber.pay`.
- **Вход**:

| Поле | Тип | Описание |
|---|---|---|
| `id` | int | опц.; правка |
| `counterparty_id` | int | обязательно |
| `amount` | number/string | 0.01–99 999 999 |
| `purpose` | string | опц.; ≤200 |
| `vat_rate` | string | опц.; неизвестная → `none` |
| `week` | ISO-дата | опц. |
| `period` | `YYYY-MM` | обязательно |
| `category_id` | int | обязательно (или статья контрагента) |

- **Проверки и ошибки** (400): `403 «Нет права создавать заявки»`; «Выберите контрагента» (нет/архивный); «У контрагента не заполнены банковские реквизиты — попросите замдиректора»; «Укажите сумму»; «Планировать оплату можно максимум на 2 недели вперёд»; «Укажите, за какой месяц расход»; «Выберите статью расхода»; при правке — «Изменить можно только неоплаченную заявку».
- **Логика по шагам**: назначение (если < 5 символов) генерируется: «Оплата (статья) за месяц ГГГГ г.»; снимок реквизитов и хэш контрагента; `direct = sber.pay`. Правка: 1) `UPDATE week_start` для `draft/rejected/sent` (без проверки автора); 2) UPDATE полей при условии статуса и (автор, или deputy, или `sber.pay`); 3) статус → `sent` (direct, `sent_at=now()`) или `draft`, `reject_reason=NULL`. Создание: INSERT со статусом `sent`/`draft`.
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_requests`, `acc_counterparties`, `acc_categories`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: заявка директора сразу «На оплате» без уведомления; правка `sent`-заявки сотрудником возвращает её в `draft`. Лог не пишется.

#### `request_delete`

- **Назначение**: отменить заявку.
- **Право**: `sber.request`.
- **Вход**: `id` (int).
- **Проверки и ошибки**: `403 «Нет права»`; не найдена/не в `draft/rejected/sent`/не автор и не deputy → `400 «Эту заявку уже нельзя отменить»`.
- **Логика по шагам**: `UPDATE status='cancelled'`.
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_requests`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: нет (без лога).

#### `send_week`

- **Назначение**: отправить черновики недели директору.
- **Право**: `sber.request`.
- **Вход**: `week` (ISO-дата, обязательна).
- **Проверки и ошибки**: `403 «Нет права»`; нет `week` → `KeyError` (500); нет черновиков → `400 «Нет черновиков для отправки»`.
- **Логика по шагам**: `UPDATE status='sent', sent_at=now()` для `draft` недели (свои; deputy — все) → лог «Заявки отправлены директору: неделя, N шт. на сумму» → при `on_send` — уведомление ВК (см. раздел 9).
- **Внешние вызовы**: VK `messages.send`.
- **Таблицы**: `sber_requests`, `acc_counterparties`, `profiles`, `positions`, `vk_bindings`, `acc_log`.
- **Ответ**: `200 {ok: true, count, notified}`.
- **Побочные эффекты**: сообщения директорам.

#### `reject`

- **Назначение**: отклонить заявку.
- **Право**: `sber.pay`.
- **Вход**: `id` (int), `reason` (≤300; пустая → «Без причины»).
- **Проверки и ошибки**: `403 «Нет права»`; не `sent` → `400 «Заявка уже обработана»`.
- **Логика по шагам**: `status='rejected', reject_reason, decided_by, decided_at` → лог «Заявка отклонена» → уведомление автору (`on_reject`).
- **Внешние вызовы**: VK.
- **Таблицы**: `sber_requests`, `profiles`, `vk_bindings`, `acc_log`.
- **Ответ**: `200 {ok: true}`.
- **Побочные эффекты**: сообщение автору.

#### `sign_links`

- **Назначение**: повторно получить ссылки подписи в СберБизнес.
- **Право**: `sber.pay`.
- **Вход**: `ids` (int[], ≤50), `origin`.
- **Проверки и ошибки**: `403 «Нет права»`.
- **Логика по шагам**: заявки из `ids` в `paying/signing` с `external_id` → `_sign_url(s, ext, _back(body, s))`.
- **Внешние вызовы**: нет.
- **Таблицы**: `sber_requests`.
- **Ответ**: `200 {links: [{id, url}]}`.
- **Побочные эффекты**: нет.

#### `pay`

- **Назначение**: оплата заявок директором — создание черновиков платёжек в СберБизнес.
- **Право**: `sber.pay`.
- **Вход**:

| Поле | Тип | Описание |
|---|---|---|
| `ids` | int[] | ≤50 |
| `week` | ISO-дата | если нет `ids` — все `sent` недели без изменённых реквизитов |
| `connection_id` | int | опц. |
| `origin` | string | для `backUrl` |
| `password` | string | **игнорируется** |

- **Проверки и ошибки**: нет заявок недели → `400 «На этой неделе нет заявок, готовых к оплате»`; `403 «Оплачивать может только директор»`; ошибки `_connection` → `400` («СберБизнес не подключён» / «Подключение не найдено или отключено»); `400 «Выберите заявки»`; `400 «Часть заявок уже обработана — обновите страницу»`; `400 «Реквизиты «{контрагент}» изменились после создания заявки. Отклоните её и создайте заново.»`; `400 ««{контрагент}»: сумма больше лимита одного платежа»`; `400 «Превышен дневной лимит оплат. Его меняет замдиректора в разделе СБЕР.»`; ошибка токена → `502`. Ошибки по отдельным заявкам — в `results[]`.
- **Логика по шагам**: см. 8.4.
- **Внешние вызовы**: refresh токена (опц.), `POST /fintech/api/v1/payments` и/или `/v1/payments/from-invoice-any`.
- **Таблицы**: `sber_requests`, `acc_counterparties`, `sber_connections`, `sber_vault`, `app_settings.sber` (`pay_method`), `acc_log`.
- **Ответ**: `200 {ok: true, results: [{id, ok: true, sign_url} | {id, ok: false, error}]}` — даже если все заявки с ошибкой.
- **Побочные эффекты**: черновики платёжек в банке (подписываются по СМС на странице банка), заявки → `signing`/`sent`/`failed`, лог в stdout при ошибке банка.

### Замечания по безопасности

Пути указаны относительно `/app/webapp/backend/sber-api/`.

1. **Оплата без подтверждения паролем** — `index.py:312-328` (`_check_password`) нигде не вызывается; `_pay` (`index.py:1044-1116`) не проверяет `body.password`, лимит попыток `sber_pay_attempts` не работает. Docstring обработчика (`index.py:515-517`) обещает «подтверждение паролем». Защита оплаты — только право `sber.pay`, лимиты и СМС-подпись в банке.
2. **Ключ шифрования хранилища может быть производным от `AWS_SECRET_ACCESS_KEY`** — `sber.py:96`: при пустом `SBER_VAULT_KEY` используется секрет облачного хранилища; его ротация сделает все секреты нерасшифровываемыми, а `decrypt` молча вернёт `None` (`sber.py:107-111`). Ключ — один SHA-256 без соли/KDF (`sber.py:99`) — приемлемо для высокоэнтропийного зерна, но не для слабого.
3. **Закрытый ключ mTLS пишется на диск без шифрования** — `sber.py:190-198` (`NoEncryption()`, `mkdtemp` в `/tmp`, права 600); файлы не удаляются после запроса и живут, пока жив контейнер.
4. **`_load_cert` выполняется до любой авторизации** — `index.py:529`: каждый анонимный запрос (включая `?tls=check`, `?cron=wrong`, любой POST без токена) читает и расшифровывает хранилище и может записать миграцию продуктов (`products.py:79-82`).
5. **Open redirect / доверие к `origin`** — `index.py:849` сохраняет `body.origin` без проверки, `index.py:627` использует его в `Location` OAuth-callback. Злоумышленник с правами замдиректора (или через подмену запроса) может направить возврат на чужой домен вместе с `reason`. В `_back` (`index.py:124`) `origin` проверяется regex-ом, но допускает любой https-домен.
6. **`nonce` не проверяется**, `state` не привязан к сессии браузера — `index.py:623-627`: callback принимает любой непросроченный неиспользованный `state` (15 мин), без сверки `user_id`; `id_token` не валидируется.
7. **Сравнение cron-ключа не за постоянное время** — `index.py:579` (`key != expected`); ключ передаётся в query-строке (попадает в логи), отдаётся замдиректору в `overview` (`index.py:703`), не ротируется.
8. **CORS `*`** — `index.py:22`; авторизация заголовком (не cookie), поэтому CSRF ограничен, но любые сайты могут вызывать API при наличии токена.
9. **Проверка права `sber.pay` в `pay` после выборки по неделе** — `index.py:1034-1038` выполняется до `_pay` (`index.py:1046`): пользователь без права получает различимый ответ «На этой неделе нет заявок, готовых к оплате» vs «Оплачивать может только директор» (утечка факта наличия заявок).
10. **Правка недели заявки без проверки автора** — `index.py:976`: первый `UPDATE week_start` выполняется для любой заявки `draft/rejected/sent` по `id`, проверка автора (`created_by_user`) есть только во втором UPDATE (`index.py:977-980`). Пользователь с `sber.request` может переносить чужие заявки по неделям.
11. **Сотрудник с `sber.request` видит все реквизиты контрагентов** — `overview` всегда возвращает `_counterparties(cur)` целиком (`index.py:690`, `index.py:279-281`), включая счета, телефоны, комментарии; заявки при этом фильтруются только у пользователей без `sber.view`/`sber.pay` (`index.py:683-684`).
12. **Логирование ответа банка в stdout** — `index.py:1112` печатает до 1500 символов тела ответа (могут быть реквизиты).
13. **`tokens_save` сохраняет refresh token без проверки, если передан access** — `index.py:729-745`: проверяется только access через `client-info`; `access_exp` выставляется в now+3000 с независимо от реального срока.
14. **Опрос статуса чужим токеном** — `index.py:492`: при пустом `connection_id` берётся подключение по умолчанию; при нескольких организациях запрос статуса может уйти не в ту организацию (функциональный риск).
15. **Дневной лимит — неатомарная проверка** — `index.py:1065` + `index.py:306-309`: два параллельных `pay` могут оба пройти проверку `limit_day` (проверка и перевод в `paying` не в одной транзакции, autocommit). `failed` в лимит не входит, поэтому повторы после ошибок банка лимит не расходуют.
16. **Действия `scopes_save`, `cert_upload`, `cert_delete` фактически не влияют на работу** (перекрываются продуктом, `index.py:67-72`, `index.py:127-131`) — риск ложной уверенности администратора, что сертификат удалён (`cert_delete` не трогает `p:pay:cert_p12`).
17. **Нет обработки нечисловых/отсутствующих параметров** — `index.py:582-583` (`int(qs.get('days'))`), `index.py:876`, `index.py:1002` (`body['week']`) → 500 вместо 400.
18. **Строки `sber_oauth` не удаляются**, а `sber_pay_attempts` не пополняется (см. п.1) — накопление state без очистки.

---

# 4. Админ-панель, камеры, управление ПК (admin-api, cameras-api, device-control)

Документ описывает три серверные функции:

| Функция | Файлы | URL (backend/func2url.json) |
|---|---|---|
| `admin-api` | `backend/admin-api/index.py`, `access.py`, `formulas.py` | `https://functions.poehali.dev/b105a470-7b26-48ea-8129-af36d5557d4e` |
| `cameras-api` | `backend/cameras-api/index.py` | `https://functions.poehali.dev/246cb9d5-b997-40d1-8f46-082cafe7879e` |
| `device-control` | `backend/device-control/index.py` | `https://functions.poehali.dev/f01f3da3-3368-428a-919d-fe5933bc5ab8` |

Что у всех трёх функций общего:

- Принимается только `POST`. На `OPTIONS` функция отвечает `200` с пустым телом и CORS-заголовками. Любой другой метод получает `405`.
- Нужное действие выбирается полем `action` в JSON-теле запроса.
- Токен передаётся в заголовке `X-Authorization` (также принимается `x-authorization`). Префикс `Bearer ` вырезается.
- CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Max-Age: 86400`.
- Ответ всегда JSON (`ensure_ascii=False`, `default=str`). Поэтому даты приходят строкой вида `2026-10-18 12:00:00+00:00`.
- Каждый запрос открывает своё соединение с БД: `psycopg2.connect(DATABASE_URL)`, `autocommit = True`. Транзакций нет, каждый SQL-запрос фиксируется сразу.
- Схема БД задаётся переменной `MAIN_DB_SCHEMA` (по умолчанию `public`). Все таблицы пишутся как `{SCHEMA}.table`.

---

## 1. admin-api

### 1.1 Назначение

Админ-панель заместителя директора (страница `src/pages/Admin.tsx`). Через неё настраиваются:
- должности и права по должностям (какие разделы меню видны, какие кнопки доступны);
- роль и должность каждого сотрудника;
- формулы зарплаты и глобальные проценты;
- поля форм «Зарплата», «Руководители», «Инкассация»;
- общие настройки учёта (месяц начала учёта, длительность смен);
- справочники бухгалтерии: статьи доходов и расходов, контрагенты.

Кроме того, функция отдаёт права текущего пользователя (`action=my_access`). Их загружает `AccessProvider` (`src/lib/access.tsx`) при каждом входе пользователя. По ним `canSee(path)` и `can(action)` решают, какие пункты меню и кнопки показать.

### 1.2 Общие модули (`access.py`, `formulas.py`)

Оба файла лежат в двух местах: `backend/admin-api/` и `backend/accounting-api/`. Копии побайтно одинаковы (проверено через `diff`). **Если меняете один файл, меняйте и второй**, иначе права и формулы в админке и в бухгалтерии разойдутся.

#### access.py

- `DEPUTY = 'deputy_director'`.
- `SECTIONS` — 14 разделов меню:
  `/dashboard, /documents, /base, /dto, /chat, /cameras, /skud, /schedule, /salary, /collection, /accounting, /sber, /employees, /settings`.
- `ACTIONS` — 24 ключа прав, сгруппированных по разделам:
  - Бухгалтерия: `accounting.view_entries`, `edit_entries`, `delete_entries`, `view_reports`, `view_budget`, `edit_budget`, `view_counterparties`, `edit_counterparties`, `view_salary`, `edit_salary`, `close_month`.
  - СБЕР: `sber.view`, `request`, `pay`, `edit_requisites`, `sync`.
  - Зарплата: `salary.view_full`, `edit`, `manage_rows`, `lock`, `broadcast`.
  - Инкассация: `collection.edit`, `import`, `unlock`.
- `ROLE_SECTIONS` и `ROLE_ACTIONS` — права по умолчанию для ролей. Они применяются, когда сотруднику не назначена должность:
  - `director`: все разделы; все права `*.view*`, плюс `collection.edit/import/unlock`, `sber.pay`, `sber.sync`.
  - `senior_employee`: 12 разделов (без `/accounting` и `/employees`); права `sber.view`, `sber.request`.
  - `employee`: 10 разделов (без `/accounting`, `/employees`, `/sber`, `/skud`); прав нет.

**`current_user(cur, schema, event)`** — авторизация, общая для admin-api и accounting-api. Алгоритм:
1. Взять токен из `X-Authorization`. Если токена нет, вернуть `None`.
2. Найти токен в `auth_sessions` с `expires_at > now()`, соединив с `auth_users`. Если не нашёлся, искать в `api_tokens` с `revoked_at IS NULL`. **Постоянные токены, включая токены ПК, принимаются как вход пользователя.**
3. Найти профиль в `profiles`: `user_id = u.id OR lower(email)=lower(u.email)`. Профиль, совпавший по `user_id`, имеет приоритет. К профилю присоединяется `positions`.
4. Определить роль:
   - если профиль есть, берётся его роль;
   - если профиля нет: `director` при `is_admin`, иначе `employee`;
   - если `is_admin` и роль не `director`/`deputy_director`, роль принудительно становится `director`.
5. Определить разделы и права:
   - `deputy_director`: все `SECTIONS` + `/devices` + `/admin`, все права из `ALL_ACTIONS`;
   - сотрудник с должностью (`position_id` задан и должность существует): разделы и права берутся из должности. `/admin` из разделов вырезается, права фильтруются по `ALL_ACTIONS`;
   - иначе: значения роли по умолчанию.
6. Добавки поверх:
   - `senior_employee`: всегда получает `sber.view`, `sber.request` и разделы `/sber`, `/skud`;
   - `director`: всегда получает `sber.view/request/pay/sync` и раздел `/sber`;
   - `/dashboard` добавляется всем, если его нет.
7. Результат: `{id, profile_id, role, name, position_id, position, sections, actions:set, is_deputy}`.

#### formulas.py

- `DEFAULT_FORMULAS`. Порядок вычисления — `FORMULA_ORDER`.

  | ключ | формула по умолчанию |
  |---|---|
  | `rate` | `revenue / (days * 24) * percent / 100` |
  | `total` | `(rate * hours + vacation) - non_cash - overtime - tax + underpayment` |
  | `week` | `total / 4` |
  | `manager_rate` | `rate * (1 + manager_percent / 100)` |
  | `manager_total` | `((osn_hours * manager_rate) + vacation) - non_cash + doplaty + dop_hours * rate + underpayment` |
  | `manager_week` | `manager_total / 4` |

- `DEFAULT_FIELDS` — встроенные поля трёх форм:
  - `salary`: hours_worked/hours, vacation_pay/vacation, non_cash, overtime, tax, underpayment;
  - `manager`: osn_hours, dop_hours, doplaty, vacation_pay/vacation, non_cash, underpayment;
  - `collection`: sbis_value/sbis, fact_value/fact.

  У каждого поля есть `key`, `var`, `label`, `visible`, `builtin`, `kind`. Значения `kind`: `accrual` | `deduction` | `number` | `text`.
- `GLOBAL_VARS = ['revenue','days','percent','manager_percent']`.
- `VAR_RE = ^[a-z_][a-z0-9_]{0,40}$`.
- `evaluate(expr, env)` — безопасный калькулятор на основе `ast`:
  - перед разбором `,` заменяется на `.`, `;` — на `,` (разделитель аргументов функций);
  - разрешены числа, имена переменных, унарные `+`/`-`, бинарные `+ - * /` и функции `round, min, max, abs, floor, ceil`. Именованные аргументы запрещены;
  - деление на 0 даёт 0;
  - ошибки (`FormulaError`): `Ошибка в записи формулы`, `Неизвестная переменная «x»`, `Разрешены только числа, переменные, + − × ÷, скобки и round/min/max/abs/floor/ceil`.
- `safe_eval` — то же, но при любой ошибке возвращает 0.
- `load_config` читает ключи `formulas` и `fields` из `app_settings` и сливает их с значениями по умолчанию. Для формул берутся только известные ключи. Поле формы, если в БД его нет или там пусто, берётся по умолчанию.
- `global_params` — `percent` из `salary_settings` (строка с `month_year IS NULL`, по умолчанию 2.5) и `manager_percent` из `manager_settings` (по умолчанию 5.0).
- `compute_period` используется только в accounting-api: считает зарплату за месяц `ММ.ГГГГ` по тем же формулам. Во фронтенде есть зеркальный калькулятор `evalFormula` в `src/lib/access.tsx`.

### 1.3 Авторизация

1. Без токена или с неверным токеном: `401 {"error":"Нужно войти в систему"}`. Это касается всех действий, включая `my_access`.
2. `my_access` доступен любому вошедшему пользователю.
3. Все остальные действия требуют `user.is_deputy` (роль `deputy_director` в профиле). Иначе ответ `403 {"error":"Админ-панель доступна только заместителю директора"}`.
   Пользователь с `is_admin` попадает сюда, только если в его профиле записано `deputy_director`. Директор (`director`) админку не получает.

### 1.4 Переменные окружения

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | строка подключения PostgreSQL |
| `MAIN_DB_SCHEMA` | схема (по умолчанию `public`) |

Внешних сервисов нет. Зависимости (`requirements.txt`): `psycopg2-binary`.

Тесты (`tests.json`): OPTIONS → 200; GET → 405; `my_access` без входа → 401; `overview` без входа → 401.

### 1.5 Служебные функции

- `_log(cur,user,action,details)` пишет в `acc_log (user_name, action='Админ: '+action, details[:500])`.
- `_set(cur,key,value,user)` выполняет UPSERT в `app_settings (key, value(json), updated_by=user.name, updated_at=now())`.
- `_general(cur)` читает из `app_settings` ключи `accounting` и `shift_hours` и возвращает:
  `{start_period: accounting.start_period || '2026-09', shift_hours: {Д:12,Н:12,Дп:12,Нп:12, ...сохранённое}}`.
- `_positions(cur)` — список должностей с числом людей: `[{id,name,sections[],actions[],people}]`, сортировка по name.
- `_variables(fields)` — список переменных для подсказок в редакторе формул.
- `_validate_formulas(formulas, fields)` прогоняет каждую формулу на тестовых значениях: все переменные = 1, `revenue=1e6`, `days=30`. Набор доступных переменных зависит от формулы:
  - `rate`: только глобальные;
  - `manager_rate`: глобальные + `rate`;
  - `manager_week`/`manager_total`: глобальные + поля руководителя + `rate`, `manager_rate`, `manager_total`;
  - остальные: глобальные + поля зарплаты + `rate`, `total`.

  Ошибка оборачивается так: `"<подпись формулы>: <текст>"`. Подписи берутся из `FORMULA_LABELS`, например `Ставка сотрудника, ₽/час (D)`.

### 1.6 Действия

Если действие не распознано (для зама): `400 {"error":"Неизвестное действие"}`.

#### `my_access`

**Назначение:** отдать права текущего пользователя и настройки форм. Используется для меню, кнопок и расчётов на клиенте.

**Кто может вызвать:** любой вошедший пользователь (сессия или api-токен).

**Вход:** только `action`.

**Проверки и ошибки:** `401 Нужно войти в систему`.

**Логика по шагам:**
1. `current_user`.
2. `load_config`.
3. `_general`.
4. Сборка ответа.

**Внешние вызовы:** нет.

**Таблицы (чтение):** `auth_sessions`, `api_tokens`, `auth_users`, `profiles`, `positions`, `app_settings`. Запись — нет.

**Ответ:**
```json
{"general":{"start_period":"2026-09","shift_hours":{"Д":12,"Н":12,"Дп":12,"Нп":12}},
 "role":"employee","position":"Кассир","sections":["/dashboard","/chat"],
 "actions":["salary.edit"],"is_deputy":false,
 "formulas":{"rate":"revenue / (days * 24) * percent / 100", "...":"..."},
 "fields":{"salary":[{"key":"hours_worked","var":"hours","label":"ЧАСЫ","visible":true,"builtin":true,"kind":"accrual"}],"manager":[],"collection":[]}}
```
`actions` отсортирован.

**Побочные эффекты:** нет.

#### `overview`

**Назначение:** все данные для страницы админки одним запросом.

**Кто может вызвать:** зам. директора.

**Вход:** только `action`.

**Проверки и ошибки:** 401, 403 (см. 1.3).

**Логика по шагам:**
1. `load_config`.
2. Профили: `SELECT id, full_name, role, department, position_id, status FROM profiles ORDER BY status, full_name`. Поле `active` = (`status == 'active'`).
3. Статьи: `acc_categories ORDER BY kind, archived, name`.
4. Контрагенты: `acc_counterparties ORDER BY archived, name`.
5. Должности: `_positions`.
6. Проценты: `global_params`.
7. Общие настройки: `_general`.

**Таблицы (чтение):** `profiles`, `positions`, `acc_categories`, `acc_counterparties`, `app_settings`, `salary_settings`, `manager_settings`.

**Ответ:**
```json
{"sections":[{"path":"/dashboard","label":"Главная"}],
 "actions":[{"key":"accounting.view_entries","group":"Бухгалтерия","label":"Видеть доходы и расходы"}],
 "positions":[{"id":1,"name":"Кассир","sections":["/chat"],"actions":[],"people":3}],
 "people":[{"id":"uuid","name":"Иванов И.","role":"employee","department":"...","position_id":1,"active":true}],
 "formulas":{},"default_formulas":{},"formula_labels":{},"formula_order":["rate","total","week","manager_rate","manager_total","manager_week"],
 "fields":{},"default_fields":{},
 "variables":{"global":[{"var":"revenue","label":"Выручка месяца (C3)"}],"salary":[],"manager":[]},
 "params":{"percent":2.5,"manager_percent":5.0},
 "categories":[{"id":1,"kind":"expense","name":"Аренда","archived":false}],
 "counterparties":[{"id":1,"name":"ООО Ромашка","kind":"supplier","inn":"7700000000","phone":null,"comment":null,"archived":false}],
 "general":{"start_period":"2026-09","shift_hours":{"Д":12,"Н":12,"Дп":12,"Нп":12}}}
```

**Побочные эффекты:** нет.

#### `general_save`

**Назначение:** задать месяц начала учёта и длительность смен (в часах) по типам Д / Н / Дп / Нп.

**Кто может вызвать:** зам. директора.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `start_period` | string `YYYY-MM` | да | месяц начала учёта |
| `shift_hours` | object `{Д,Н,Дп,Нп}` | нет | часы смены; отсутствующий ключ = 12; запятая допускается |

**Проверки и ошибки (все 400):**
- `start_period` не соответствует `^\d{4}-(0[1-9]|1[0-2])$` → `Укажите месяц начала учёта`;
- значение часов не число → `Часы смены — числом`;
- значение вне диапазона 0..24 → `Смена — от 0 до 24 часов`.

**Логика по шагам:**
1. Записать в `app_settings` ключ `accounting = {start_period}`.
2. Записать в `app_settings` ключ `shift_hours = {...}`.
3. `UPDATE acc_accruals SET void = (period < sp) WHERE source_key IS NOT NULL` — автоначисления до месяца начала учёта аннулируются, после него восстанавливаются.
4. `UPDATE acc_entries SET void = (period < sp) WHERE source IN ('salary','collection')`.
5. `UPDATE acc_periods SET fingerprint = NULL` — сброс отпечатков, чтобы бухгалтерия пересчитала месяцы.
6. Записать в журнал: `Общие настройки`.

**Таблицы:** запись в `app_settings`, `acc_accruals`, `acc_entries`, `acc_periods`, `acc_log`.

**Ответ:** `{"ok": true}`.

**Побочные эффекты:** массовое перевычисление флага `void` в бухгалтерии и пересчёт всех месяцев.

#### `position_save`

**Назначение:** создать должность или изменить существующую.

**Кто может вызвать:** зам. директора.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `id` | int | нет | если указан — обновление |
| `name` | string | да | обрезается до 80 символов |
| `sections` | string[] | нет | неизвестные пути отбрасываются (только `SECTIONS`, поэтому `/admin` и `/devices` выдать нельзя) |
| `actions` | string[] | нет | фильтруются по `ALL_ACTIONS` |

**Проверки и ошибки (400):**
- пустое название → `Укажите название должности`;
- название (без учёта регистра) совпадает с другой должностью → `Такая должность уже есть`.

**Логика:**
1. Проверка дубля.
2. `UPDATE positions SET name, sections(json), actions(json) WHERE id` или `INSERT`.
3. Запись в журнал: `Должность` — «имя: разделов N, прав M».

**Таблицы:** `positions` (чтение и запись), `profiles` (чтение, для подсчёта людей), `acc_log`.

**Ответ:** `{"ok":true,"positions":[...]}`.

**Побочные эффекты:** права всех сотрудников с этой должностью меняются при их следующем `my_access`.

#### `position_delete`

**Назначение:** удалить должность.

**Кто может вызвать:** зам. директора.

**Вход:** `id` (int, обязательно).

**Проверки и ошибки:** явных нет. Несуществующий `id` всё равно даёт `ok`.

**Логика:**
1. `UPDATE profiles SET position_id = NULL WHERE position_id = id`.
2. `DELETE FROM positions ... RETURNING name`.
3. Если строка удалена — запись в журнал `Удалена должность`.

**Таблицы:** запись в `profiles`, `positions`, `acc_log`.

**Ответ:** `{"ok":true,"positions":[...]}`.

**Побочные эффекты:** у сотрудников этой должности права возвращаются к значениям их роли по умолчанию.

#### `person_save`

**Назначение:** задать сотруднику роль и должность.

**Кто может вызвать:** зам. директора.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `profile_id` | string | да | id профиля |
| `role` | string | нет | `director`, `deputy_director`, `senior_employee`, `employee`; если не передана, остаётся текущая |
| `position_id` | int/null | нет | пустое значение снимает должность |

**Проверки и ошибки:**
- `404 Сотрудник не найден`;
- `400 Неизвестная роль`;
- `400 Нельзя снять последнего заместителя директора` — если текущая роль `deputy_director`, новая роль другая, а активных замов ≤ 1.

**Логика:**
1. Прочитать профиль.
2. Проверить роль.
3. Проверить, что это не последний зам.
4. `UPDATE profiles SET position_id, role`.
5. Запись в журнал: `Сотрудник`.

**Таблицы:** `profiles` (чтение и запись), `acc_log`.

**Ответ:** `{"ok": true}`.

**Побочные эффекты:** меняется роль, а значит и доступ во всех функциях (cameras-api, device-control и другие читают `profiles.role` напрямую).

#### `formulas_save`

**Назначение:** сохранить формулы зарплаты и глобальные проценты.

**Кто может вызвать:** зам. директора.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `formulas` | object | нет | ключи из `DEFAULT_FORMULAS`; пустое или отсутствующее значение = формула по умолчанию; обрезка до 500 символов |
| `params.percent` | number | нет | `salary_settings.percent` (глобальная строка) |
| `params.manager_percent` | number | нет | `manager_settings.manager_percent` |

**Проверки и ошибки:** `400 <Подпись формулы>: <ошибка FormulaError>`. Нечисловой `params.*` вызывает необработанный `ValueError` и ответ 500.

**Логика:**
1. `load_config`.
2. Собрать полный набор из 6 формул.
3. `_validate_formulas` с текущими полями форм.
4. `_set('formulas')`.
5. Обновить `salary_settings` и `manager_settings` в строках с `month_year IS NULL`.
6. Сбросить `acc_periods.fingerprint`.
7. Запись в журнал: `Формулы зарплаты`.

**Таблицы:** запись в `app_settings`, `salary_settings`, `manager_settings`, `acc_periods`, `acc_log`.

**Ответ:** `{"ok": true}`.

**Побочные эффекты:** пересчёт зарплаты на сайте и в бухгалтерии.

#### `formula_test`

**Назначение:** проверить формулу на подставленных значениях (кнопка «Проверить» в админке).

**Кто может вызвать:** зам. директора.

**Вход:** `expr` (string, да) — формула; `env` (object `{var: number}`, нет) — ключи, не подходящие под `VAR_RE`, отбрасываются.

**Проверки и ошибки:** `400 <текст FormulaError>`.

**Логика:** `evaluate`, затем округление до 4 знаков.

**Ответ:** `{"value": 123.4567}`.

**Побочные эффекты:** нет.

#### `fields_save`

**Назначение:** настроить поля одной формы (`salary` / `manager` / `collection`): подписи, видимость, тип, дополнительные поля.

**Кто может вызвать:** зам. директора.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `form` | string | да | `salary`, `manager` или `collection` |
| `fields` | array | да | не более 30 элементов `{key, var, label, visible, kind}` |

**Проверки и ошибки (400):**
- `Неизвестная форма`;
- `У каждого поля должно быть название`;
- `Поле «L»: имя для формулы — только латиница, цифры и _` (имя переменной нестандартного поля не проходит `VAR_RE`);
- `Имя «v» уже занято` (переменная совпадает с глобальной, с `rate/total/manager_rate/manager_total` или с другим полем);
- `Сначала поправьте формулу — <ошибка>` (для `salary`/`manager`: текущие формулы не проходят проверку с новым набором полей).

**Логика:**
1. Встроенное поле (`key` есть в `DEFAULT_FIELDS[form]`): из клиента берутся только `label` (≤40), `visible`, `kind`. `var` и `builtin` не меняются.
2. Дополнительное поле: `var` приводится к нижнему регистру; `key` = переданный key, если он начинается с `x_`, иначе `x_<var>`; `builtin=false`; `kind` из допустимого набора, иначе `number`.
3. Встроенные поля, которые клиент не передал, добавляются с `visible=false`. Удалить встроенное поле нельзя, только скрыть.
4. Проверка формул.
5. `_set('fields', {...все формы, form: out})`.
6. Запись в журнал: `Поля формы`.

**Таблицы:** запись в `app_settings`, `acc_log`.

**Ответ:** `{"ok":true,"fields":{"salary":[...],"manager":[...],"collection":[...]}}`.

**Побочные эффекты:** значения дополнительных полей хранятся в `extra` строк зарплаты, их читает `formulas._row_env`.

#### `reset`

**Назначение:** вернуть формулы или поля форм к значениям по умолчанию.

**Кто может вызвать:** зам. директора.

**Вход:** `what` (string, да) — `formulas` или `fields`.

**Проверки и ошибки:** `400 Неизвестная настройка`.

**Логика:**
1. `DELETE FROM app_settings WHERE key = what`.
2. Запись в журнал: `Сброс`.

Отпечатки месяцев (`acc_periods.fingerprint`) при этом **не сбрасываются**, в отличие от `formulas_save`.

**Таблицы:** запись в `app_settings`, `acc_log`.

**Ответ:** `{"ok": true}`.

#### `category_save`

**Назначение:** создать статью дохода или расхода либо изменить её (переименовать, отправить в архив).

**Кто может вызвать:** зам. директора.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `id` | int | нет | если указан — обновление |
| `kind` | string | да | `income` или `expense` |
| `name` | string | да | обрезка до 80 символов |
| `archived` | bool | нет | учитывается только при обновлении |

**Проверки и ошибки (400):** `Укажите название статьи` (неверный kind или пустое имя); `Такая статья уже есть` (дубль без учёта регистра в пределах kind).

**Логика:** `UPDATE acc_categories SET name, archived` (kind при обновлении не меняется) или `INSERT (kind, name)`. Запись в журнал: `Статья`.

**Таблицы:** `acc_categories` (чтение и запись), `acc_log`.

**Ответ:** `{"ok": true}`.

#### `counterparty_save`

**Назначение:** создать контрагента или изменить существующего.

**Кто может вызвать:** зам. директора.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `id` | int | нет | если указан — обновление |
| `name` | string | да | обрезка до 150 символов |
| `kind` | string | нет | `supplier` / `customer` / `landlord` / `other`; иначе `supplier` |
| `inn` | string | нет | остаются только цифры, не больше 12 |
| `phone` | string | нет | ≤40 |
| `comment` | string | нет | ≤300 |
| `archived` | bool | нет | |

**Проверки и ошибки:** `400 Укажите название контрагента`. Проверки на дубль нет.

**Логика:** `UPDATE` или `INSERT` в `acc_counterparties`. Запись в журнал: `Контрагент`.

**Таблицы:** запись в `acc_counterparties`, `acc_log`.

**Ответ:** `{"ok": true}`.

---

## 2. cameras-api

### 2.1 Назначение

Раздел «Камеры» (`src/pages/Cameras.tsx`, `src/pages/CamView.tsx`, `src/components/cameras/*`). Функция:
- ведёт список камер компании;
- выдаёт ссылку на живое видео (HLS);
- ищет записи на карте памяти и выдаёт ссылку на воспроизведение архива;
- делает снимок кадра.

Всё это идёт через облако производителя JFTech (XMeye / iCSee), режим **RPS**: камера адресуется по серийному номеру, без проброса портов. Логины и пароли камер на сайт не отдаются, ссылки на видео выдаёт только сервер.

### 2.2 Авторизация (`_auth`, index.py:291-315)

1. Без токена — `401 {"error":"Требуется вход в систему"}`.
2. Токен начинается с `rec_` — это **ключ службы-регистратора** (ПК склада, который пишет видео):
   - запрос: `SELECT device_code FROM recorder_keys WHERE key=%s AND revoked_at IS NULL`;
   - результат: `{recorder: device_code, can_manage: False}`;
   - регистратору разрешено **только** `action='live'` и только для камеры, которую разрешает `_recorder_camera` (см. ниже). Иначе `403 {"error":"Нет доступа"}`.
3. Обычный пользователь: сессия `auth_sessions` (не истёкшая) либо `api_tokens` (не отозванный).
   - Роль: `director`, если `is_admin`; иначе роль из профиля; если профиля нет — `employee`.
   - `can_manage = role ∈ {'director','deputy_director'}`.
4. Смотреть видео (`list, live_all, snapshot, live, records, playback`) может **любой вошедший пользователь**. Раздел `/cameras` из прав должности не проверяется.
5. Управлять камерами (`add, update, delete, set_default, reorder`) может только `can_manage`. Иначе `403 {"error":"Управлять камерами может только директор или зам. директора"}`.

`_recorder_camera(device_code, cam_id)` разрешает камеру, если выполняется хотя бы одно условие:
- есть активный `skud_controllers`, у которого `recorder_device = device_code` и `camera_id = cam_id` или `inside_camera_id = cam_id`;
- название камеры без пробелов в нижнем регистре равно `склад-вн` или `складвн`, и у этого регистратора есть хотя бы один активный контроллер.

Клиент (`src/lib/camerasApi.ts`) берёт токен из `localStorage.anod_session_token`. Если его нет — из `sessionStorage.abiz_device_token` (токен ПК в программе АБИЗ).

### 2.3 Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `DATABASE_URL` | — | БД |
| `MAIN_DB_SCHEMA` | `public` | схема |
| `JF_APP_UUID` | `<в коде cameras-api>` | uuid приложения открытой платформы JFTech |
| `JF_APP_KEY` | `<в коде cameras-api>` | appKey |
| `JF_APP_SECRET` | `<в коде cameras-api>` | appSecret |
| `JF_MOVED_CARD` | `2` | параметр `movedCard` в алгоритме подписи |

Значения по умолчанию — публичные ключи из официального демо производителя (так сказано в комментарии в коде).

Зависимости: `psycopg2-binary`, `requests`. Тесты: OPTIONS → 200; GET → 405; `list` без токена → 401.

### 2.4 Облако JFTech / XMeye

#### Хосты

- **TKS** (выдача токена устройства): `https://tks-iot.xmeye.net`.
- **RDS** (команды к устройству через облако): `https://rds-viot.bcloud365.net/v2/rtc/device`.

#### Подпись запроса токена (`_signature`, index.py:40-52)

1. `tm = '000002' + str(текущее время в мс)`.
2. `raw` = байты строки `JF_UUID + JF_KEY + JF_SECRET + tm`, длина `n`. `swapped` — копия `raw`.
3. Для `o = 0..n-1`:
   ```
   keep = swapped[o] if o % M > (n - o) % M else swapped[n-1-o]     # M = JF_MOVED_CARD
   swapped[o] = swapped[n-1-o]
   swapped[n-1-o] = keep
   ```
4. Создаётся массив `merged` длины `2n`: `merged[o] = raw[o]`, `merged[2n-1-o] = swapped[o]`. То есть исходные байты, за ними перемешанные в обратном порядке.
5. `signature = md5(bytes(merged)).hexdigest()`.

#### Получение токена устройства (`_cloud_token`)

```
POST https://tks-iot.xmeye.net/v2/device/token/{tm}/{signature}.rs
Headers: uuid: <JF_UUID>, appKey: <JF_KEY>
Body:    {"sns": ["<serial>"]}
Timeout: min(4.0, оставшийся_бюджет - 1.5)
```
Запрос успешен, если `code == 2000` и `data` не пуст. Тогда токен — `data[0].token`. При ошибке или исключении возвращается `None`.

#### Кэширование токена (`_camera_token`)

- Токен хранится в `cameras.cloud_token`, срок — в `cloud_token_expires`.
- Если токен есть и не истёк, а `force` не задан, используется кэш.
- Иначе запрашивается новый токен и записывается в БД с `expires = now + 3 ч` (когда `cam.id` известен).
- В `add`/`update` токен записывается вместе с карточкой камеры, и срок там ставится `now + 12 ч`.

#### Запрос к RDS (`_rds`)

```
POST https://rds-viot.bcloud365.net/v2/rtc/device/{path}/{token}
Headers: appKey, uuid, Content-Type: application/json; charset=UTF-8
Timeout: 3.5 с по умолчанию
```
При исключении (таймаут, сеть) функция возвращает «синтетический» ответ:
`{"code":2000,"data":{"Ret":-1,"RetMsg":"Камера не ответила вовремя, попробуйте ещё раз"}}`.
Клиент `camerasCall` повторяет `live/playback/snapshot/records` до 3 раз с паузой 700 мс, если текст ошибки совпадает с `/не ответила|timeout|сервер/i`.

`_with_token(cam, path, body)`:
1. Получить токен (из кэша или новый). Если токена нет — `{"code":-1,"msg":"Камера не найдена в облаке. Проверьте серийный номер и что камера в сети"}`.
2. Вызвать RDS. Если `code ∉ {2000, 4000}`, принудительно получить новый токен и повторить.

`_ret_error(data)` разбирает ответ:
- `code != 2000` → `msg` либо `Облако камер вернуло ошибку`;
- `data.Ret` не равен null и не равен 100:
  - 106 → `Неверное имя или пароль камеры`;
  - 119 → `За этот период записей нет`;
  - иначе `RetMsg` либо `Камера вернула код {ret}`.

#### Бюджет времени

`_DEADLINE = now + min(remaining_ms, 4300)/1000`. Функция укладывается максимум в 4,3 с с начала запроса, даже на «холодном» старте. `_budget(reserve)` возвращает, сколько ещё можно ждать облако (минимум 1 с).

#### RDS-пути и форматы запросов

| path | тело | где используется |
|---|---|---|
| `login` | `{"EncryptType":"DISABLE","LoginType":"DVRIP-Web","UserName":u,"PassWord":p,"Name":"generalinfo"}` | перед records / playback / snapshot |
| `livestream` | `{"mediaType":"hls","protocol":"ts","channel":"0","stream":"0"(hd)/"1"(sd),"username":u,"password":p,"expireTime":"<now_ms+3ч>"}` | live, live_all, проверка при add/update |
| `opdev` | `{"Name":"OPFileQuery","OPFileQuery":{"BeginTime":"YYYY-MM-DD HH:00:00","EndTime":"YYYY-MM-DD HH:59:59","Channel":0,"DriverTypeMask":"0x0000FFFF","Event":"*","Type":"h264","StreamType":"0x00000000"}}` | records (один запрос на каждый час) |
| `playbackUrl` | `{"mediaType":"hls","protocol":"hls","channel":0,"stream":"0","username":u,"password":p,"expireTime":"<now_ms+3ч>","startTime":start,"endTime":end}` | playback |
| `capture` | `{"Name":"OPSNAP","OPSNAP":{"Channel":0}}` | snapshot; ссылка на кадр — `data.image` |

Логин и пароль камеры уходят в облако в открытом виде внутри HTTPS (`EncryptType: DISABLE`).

#### Кэш ссылок на живое видео

- Колонки `cameras.live_url_sd`, `live_url_sd_at`, `live_url_hd`, `live_url_hd_at` (миграция V0015).
- TTL кэша `LIVE_CACHE_MINUTES = 60`. Ссылка самого облака действительна 3 ч (`expireTime`).
- `_live_url` перед выдачей ссылки из кэша проверяет её запросом `GET` с таймаутом 1,2 с. Ссылка считается живой, если ответ 200 и текст начинается с `#EXTM3U`. Облако иногда «забывает» ссылки раньше срока и отвечает 400.
- `_live_all` **не проверяет**, жива ли ссылка: отдаёт всё, что моложе 60 минут.

### 2.5 Таблица `cameras`

Создаётся в V0013: `id text PK, name, serial (UNIQUE), username default 'admin', password (plain text), network_mode default 'RPS', order_index, is_default, cloud_token, cloud_token_expires, created_at, updated_at`. В V0015 добавлены колонки `live_url_*`.

`_list(can_manage)` отдаёт `{id,name,order_index,is_default,network_mode}`. Для управляющих добавляются `serial` и `username`. **Пароль не отдаётся никогда.**

### 2.6 Действия

Если `action` не передан, используется `list`. Неизвестное действие (после проверки `can_manage`): `400 {"error":"Неизвестное действие: <action>"}`. Пользователь без права управления на неизвестное действие получает 403.

#### `list`

**Назначение:** список камер.

**Кто может вызвать:** любой вошедший пользователь (регистратору запрещено).

**Вход:** нет.

**Проверки и ошибки:** 401; 403 для регистратора.

**Логика:** `SELECT COLS FROM cameras ORDER BY order_index, created_at`, затем `_list`.

**Таблицы (чтение):** `cameras`.

**Ответ:**
```json
{"cameras":[{"id":"uuid","name":"Касса","order_index":0,"is_default":true,"network_mode":"RPS","serial":"abcd1234","username":"admin"}],"can_manage":true}
```

**UI:** `Cameras.tsx` выбирает камеру по умолчанию (`is_default`) или переданную в `jump.cam`.

#### `live_all`

**Назначение:** заранее получить ссылки на живое видео всех камер, чтобы переключение между камерами было мгновенным.

**Кто может вызвать:** любой вошедший пользователь.

**Вход:** `quality` (string, нет) — `hd` или `sd` (по умолчанию `sd`).

**Логика:**
1. Выбрать все камеры с колонками `live_url_{q}`, `live_url_{q}_at`.
2. Ссылка моложе 60 минут попадает в ответ сразу, без проверки.
3. Для остальных камер запросы идут параллельно (`ThreadPoolExecutor(max_workers=len(need))`):
   - если токен в кэше, `livestream` вызывается с таймаутом 1,6 с; при ошибке берётся новый токен и запрос повторяется с полным бюджетом;
   - если токена нет, сначала запрашивается новый;
   - ошибки: `Камера не в сети` (не удалось получить токен) или текст `_ret_error`.
4. Новые ссылки и токены записываются в `cameras` (`expires +3 ч`).

**Внешние вызовы:** TKS `token`, RDS `livestream`.

**Таблицы:** `cameras` (чтение и запись).

**Ответ:** `{"streams":{"<cam_id>":{"url":"https://...m3u8"},"<cam_id2>":{"error":"Камера не в сети"}}}`.

**UI:** ссылки складываются в `liveCache` (только SD).

#### `snapshot`

**Назначение:** снимок кадра. Используется как запасной вариант, если плеер не работает (`SnapshotView.tsx`).

**Кто может вызвать:** любой вошедший пользователь.

**Вход:** `id` (string, да).

**Проверки и ошибки:**
- `404 Камера не найдена`;
- ошибки облака приходят **со статусом 200** в виде `{"error": "..."}`.

**Логика:**
1. Получить камеру.
2. Вызвать `_login`. Результат не проверяется.
3. `_with_token('capture', OPSNAP)`.

**Внешние вызовы:** RDS `login`, `capture` (и TKS, если нужен токен).

**Таблицы:** `cameras` (чтение; запись токена).

**Ответ:** `{"url":"https://...jpg"}` или `{"error":"..."}`.

#### `live`

**Назначение:** ссылка на живое видео одной камеры.

**Кто может вызвать:** любой вошедший пользователь; регистратор — только для разрешённых ему камер.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `id` | string | да | id камеры |
| `quality` | string | нет | `hd` (stream 0) или `sd` (stream 1), по умолчанию `sd` |
| `fresh` | bool | нет | не брать кэш, запросить новую ссылку |

**Проверки и ошибки:** `404 Камера не найдена`. Со статусом 200 приходят `{"error":"Камера не найдена в облаке. Проверьте, что камера в сети"}` или ошибки `_ret_error`.

**Логика (`_live_url`):**
1. Если `fresh` не задан, ссылка из кэша моложе 60 минут и проверка GET показала, что она жива — вернуть `{url, cached:true}`.
2. Получить токен.
3. `livestream` с таймаутом 1,6 с. Облако привязывает токен к своему узлу; если узел завис, ответа можно ждать 15 с и больше.
4. При ошибке получить новый токен (`force`) и повторить запрос с полным бюджетом.
5. Записать `live_url_{q}` и `live_url_{q}_at = now()`.

**Внешние вызовы:** GET проверки ссылки, TKS, RDS `livestream`.

**Таблицы:** `cameras` (чтение и запись).

**Ответ:** `{"url":"https://.../index.m3u8","cached":true}` или `{"url":"..."}`.

**UI:** `HlsPlayer`, если браузер умеет HEVC (`HEVC_OK`). Иначе `WasmHevcPlayer`: Web Worker `src/lib/hevc/hevcWorker.ts` и `/hevc/hevc-decode.wasm`. При ошибке плеера клиент повторяет запрос с `fresh: true`.

#### `records`

**Назначение:** найти отрезки записей на карте памяти за часть суток.

**Кто может вызвать:** любой вошедший пользователь.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `id` | string | да | id камеры |
| `day` | string `YYYY-MM-DD` | нет | по умолчанию сегодня (время сервера) |
| `from_hour` | int | нет | по умолчанию 0 |
| `to_hour` | int | нет | по умолчанию 5; ограничивается 23 |

**Проверки и ошибки:** `404 Камера не найдена`. Со статусом 200 — `{"error":...}`: ошибка логина, например `Неверное имя или пароль камеры`. Нечисловой `from_hour` вызывает 500.

**Логика (`_records`):**
1. `_login`. Если ошибка — вернуть её.
2. Получить токен.
3. Параллельно для каждого часа `from..to` выполнить `_query_hour`: `opdev OPFileQuery` по одному часу, потому что камера отдаёт максимум 64 файла за запрос. Границы файлов обрезаются по часу. Если файлов ≥ 64, конец последнего отрезка растягивается до конца часа.
4. Отсортировать отрезки и склеить те, между которыми разрыв ≤ 5 с.

**Внешние вызовы:** RDS `login`, `opdev`.

**Ответ:** `{"records":[{"start":"2026-10-18 00:00:05","end":"2026-10-18 01:12:40"}]}`.

**UI:** `ArchiveBar.tsx` запрашивает сутки четырьмя кусками: `[0,5]`, `[6,11]`, `[12,17]`, `[18,23]`.

#### `playback`

**Назначение:** ссылка на воспроизведение архива.

**Кто может вызвать:** любой вошедший пользователь.

**Вход:** `id` (string, да); `start` и `end` (string `YYYY-MM-DD HH:MM:SS`, да). UI передаёт отрезок длиной до 1 часа от выбранной секунды.

**Проверки и ошибки:** 404; ошибки облака со статусом 200.

**Логика:**
1. `_login`.
2. `_with_token('playbackUrl', ...)`.
3. `_ret_error`.

**Ответ:** `{"url":"https://...m3u8"}`.

#### `add`

**Назначение:** добавить камеру.

**Кто может вызвать:** `director`, `deputy_director` (или `is_admin`).

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `name` | string | да | название |
| `serial` | string | да | серийный номер в облаке |
| `username` | string | нет | по умолчанию `admin` |
| `password` | string | нет | `null` превращается в `''` |

`CameraManager.tsx` дополнительно передаёт пустой `id`.

**Проверки и ошибки (400):**
- `Укажите название и серийный номер`;
- `Камера с таким серийным номером уже добавлена`;
- `Камера с таким серийным номером не найдена в облаке. Проверьте номер и что камера включена`;
- текст ошибки `_live_url`, например `Неверное имя или пароль камеры`.

**Логика:**
1. Проверить, что такого `serial` ещё нет.
2. Собрать временную карточку (`probe`, без id) и получить для неё токен.
3. Пробный запрос `_live_url(probe,'sd')` — проверяет логин и пароль. При `id=None` запросы `SELECT`/`UPDATE ... WHERE id = NULL` ничего не делают.
4. `INSERT`: `id = uuid4`, `network_mode='RPS'`, `order_index = max+1`, `is_default = (это первая камера)`, токен с `expires +12 ч`.

**Внешние вызовы:** TKS, RDS `livestream`.

**Таблицы:** `cameras` (чтение и запись).

**Ответ:** `{"ok":true,"id":"uuid","cameras":[...]}`. Список возвращается с `serial` и `username`.

#### `update`

**Назначение:** изменить камеру.

**Кто может вызвать:** как `add`.

**Вход:** `id` (да), `name`, `serial`, `username`, `password`. Пустой пароль или его отсутствие означает «оставить старый».

**Проверки и ошибки:** `404 Камера не найдена`; остальные — как в `add`.

**Логика:**
1. Если `serial`, `username` и `password` не изменились, обновляются только `name` и `updated_at`, облако не опрашивается.
2. Иначе выполняется облачная проверка как в `add`, затем `UPDATE` полей и токена. Кэш `live_url_*` **не сбрасывается**.

**Ответ:** `{"ok":true,"id":"...","cameras":[...]}`.

#### `delete`

**Назначение:** удалить камеру.

**Кто может вызвать:** `can_manage`.

**Вход:** `id` (да).

**Логика:**
1. `DELETE`.
2. Если ни одна камера не осталась камерой по умолчанию, ею становится первая по `order_index, created_at`.

**Ответ:** `{"ok":true,"cameras":[...]}`. Несуществующий id тоже даёт ok.

**Побочные эффекты:** ссылки из `skud_controllers.camera_id` и `inside_camera_id` не чистятся.

#### `set_default`

**Назначение:** назначить камеру по умолчанию.

**Кто может вызвать:** `can_manage`.

**Вход:** `id`.

**Логика:** `UPDATE cameras SET is_default = (id = %s)`. С неизвестным id камеры по умолчанию не останется ни одной.

**Ответ:** `{"ok":true,"cameras":[...]}`.

#### `reorder`

**Назначение:** задать порядок камер.

**Кто может вызвать:** `can_manage`.

**Вход:** `ids` (string[], да) — id в нужном порядке.

**Логика:** для каждого id `UPDATE order_index = позиция`.

**Ответ:** `{"ok":true,"cameras":[...]}`.

---

## 3. device-control

### 3.1 Назначение

Удалённое управление компьютерами с программой АБИЗ (киоск сотрудника) и АБИЗ-Админ. Функция обслуживает две стороны:

- **ПК (программа):**
  - `heartbeat`: ПК сообщает, что он онлайн, где находится (экран входа или работа), версию и статус обновления, и забирает команды;
  - `command_result`: результат выполнения команды, скриншот;
  - `device_log`: записи в журнал;
  - `check_update`: проверка новой версии;
  - счётчик непрочитанного в чате.
- **Сайт** (`src/pages/Devices.tsx`, `src/components/devices/ReleasePanel.tsx`, `src/lib/devices.ts`):
  - список ПК со статусами (обновляется каждые 5 с);
  - отправка команд;
  - журнал ПК;
  - выпуск обновлений программы.

Привязка ПК к сотруднику и отзыв доступа (`list_devices`, `link_device`, `revoke_device`) находятся **в auth-api**, а не здесь.

### 3.2 Авторизация

**Токен ПК (`_device_by_token`)**, используется в `heartbeat`, `command_result`, `device_log`, `check_update` и в `chat_*`, если передан `api_token`:
1. Токен берётся из `body.api_token`; если его нет — из заголовка `X-Authorization`.
2. `SELECT device_code FROM api_tokens WHERE token=%s AND revoked_at IS NULL`. Если `device_code` пуст (это личный токен пользователя, а не токен ПК), авторизация не проходит.
3. Строка устройства: `SELECT id, device_code, hostname, profile_id, status FROM devices WHERE device_code=%s`. Устройства нет — авторизация не проходит.
   Поле `devices.status` (`pending` / `linked` / `revoked`) здесь **не проверяется**: отзыв работает только через `api_tokens.revoked_at`.

**Пользователь сайта (`_site_user`):**
1. Токен из `X-Authorization`: `auth_sessions` (не истёкшая), иначе `api_tokens` (не отозванный).
2. Профиль ищется по `user_id`/email.
3. `role = 'director'`, если `is_admin`, иначе `profile.role`; если профиля нет — `employee`.
4. `can_control = role ∈ CONTROL_ROLES = {'deputy_director'}`.

Права по действиям сайта:
- без пользователя → `401 {"error":"Требуется вход в систему"}`;
- `devices_status` → роль `deputy_director` или `director`, иначе `403 {"error":"Недостаточно прав"}`;
- всё остальное (команды, выпуски, журналы) → только `can_control`, иначе `403 {"error":"Удалённое управление доступно только заместителю директора"}`.

### 3.3 Переменные окружения и сервисы

| Переменная | Назначение |
|---|---|
| `DATABASE_URL`, `MAIN_DB_SCHEMA` | БД |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | доступ к S3 poehali (`endpoint_url=https://bucket.poehali.dev`, bucket `files`). `AWS_ACCESS_KEY_ID` также участвует в публичной CDN-ссылке |

Зависимости: `psycopg2-binary`, `boto3`. Тесты: OPTIONS → 200; GET → 405; `heartbeat` без токена → 401; `devices_status` без входа → 401. Тело, которое не разбирается как JSON, даёт `400 {"error":"Некорректный JSON"}`.

#### S3: скриншоты (`_upload_screenshot`)

- Вход — base64. Префикс `data:...;base64,` отрезается по последней запятой.
- Ошибка декодирования или размер больше 6 000 000 байт → `None`. Скриншот молча не сохраняется.
- Ключ: `screenshots/{device_code}/{uuid4hex}.jpg`, `ContentType: image/jpeg`.
- Публичная ссылка: `https://cdn.poehali.dev/projects/{AWS_ACCESS_KEY_ID}/bucket/screenshots/{device_code}/{hex}.jpg`.
- Старые снимки не удаляются. В карточке ПК хранится только последний (`devices.screenshot_url`, `screenshot_at`).

#### S3: выпуски программы

- Префикс: `releases/{edition}/{uuid4hex}/`, где `edition` — `abiz` (киоск) или `admin` (АБИЗ-Админ). Любое значение, кроме `admin`, считается `abiz`.
- Части файла: `{folder}/part001.bin`, `part002.bin`, … (`ContentType: application/octet-stream`).
- Загрузка по частям. Клиент `publishRelease` (`src/lib/devices.ts`):
  1. Режет ZIP на куски по 1536 КиБ. После base64 это около 2 МБ, укладывается в лимит запроса около 3 МБ.
  2. Каждый кусок отправляет через `release_upload_part`, до 4 попыток с паузой 1 с. `folder`, полученный в первом ответе, передаётся в следующие запросы.
  3. Считает SHA-256 всего файла (`crypto.subtle.digest`) и вызывает `release_publish` с `parts`, `sha256` и `size`.
- В `app_releases.url` записывается **шаблон** `https://cdn.poehali.dev/projects/{KEY}/bucket/{folder}/part{n:03d}.bin|{parts}`. Программа на ПК подставляет номера 1..parts, скачивает части по порядку, склеивает их и сверяет SHA-256 (так сказано в комментарии в коде).
- **Канал обновлений:** для каждой редакции (`edition`) активен ровно один выпуск (`is_active`). ПК получает его через `check_update`. Программа проверяет сама каждые 10 минут, при запуске или по кнопке; немедленно — по команде `update`.

### 3.4 Модель данных

- `devices` — дополнительные колонки из V0014 и V0019: `presence` (default `'offline'`), `heartbeat_at`, `current_user_name`, `app_version`, `screenshot_url`, `screenshot_at`, `remote_lock`, `lock_message`, `update_status`. Плюс исходные `device_code` (9 символов), `hostname`, `profile_id`, `status`, `last_seen_at`, `created_at`.
- `device_commands`: `id text PK, device_code, command, payload jsonb, created_by (profile_id), created_by_name, created_at, delivered_at, done_at, result`.
- `device_logs`: `id bigserial, device_code, kind (signin|signout|presence|app_open|remote|note), message, actor_name, created_at`.
- `app_releases`: `id, edition, version, url, sha256, size_bytes, notes, is_active, created_by, created_at`.

### 3.5 Команды на ПК

Допустимые значения (`ALLOWED_COMMANDS`): `lock, unlock, message, screenshot, rudesktop, reload, logout, login_user, login_admin, update`.

| Команда | payload (с сайта) | Что делает сервер | Что ожидается от ПК | Запись в журнал (`remote`) |
|---|---|---|---|---|
| `lock` | `{message?: string}` | `devices.remote_lock = true`, `lock_message = message[:500]` или «Компьютер заблокирован заместителем директора» | показать экран блокировки | заблокировал ПК |
| `unlock` | `{}` | `remote_lock = false`, `lock_message = NULL` | снять блокировку | разблокировал ПК |
| `message` | `{message: string}` (UI: `{message: msgText.trim()}`) | только поставить в очередь | показать сообщение на весь экран | отправил сообщение на экран |
| `screenshot` | `{}` | очередь | снять экран и прислать `command_result` с `screenshot` | запросил снимок экрана |
| `rudesktop` | `{}` | очередь | запустить RuDesktop (удалённый доступ) | запустил удалённый доступ |
| `reload` | `{}` | очередь | перезапустить или обновить программу | обновил программу |
| `logout` | `{}` | очередь | выйти из учётной записи на ПК | вышел из системы на ПК |
| `login_user` | `{}`; сервер добавляет `full_name` сотрудника, к которому привязан ПК (или `''`) | очередь | войти как привязанный сотрудник, показать имя в заголовке | выполнил вход на ПК как сотрудник |
| `login_admin` | `{}` | очередь | войти как администратор | выполнил вход на ПК как администратор |
| `update` | `{}` | очередь; `update_all` ставит её всем ПК со статусом linked | выполнить `check_update`, скачать и установить | запустил обновление программы |

Payload не проверяется: в `device_commands.payload` записывается любой JSON.

**Жизненный цикл команды:**
1. Сайт вызывает `send_command`. Создаётся `INSERT device_commands` (`delivered_at`, `done_at` = NULL).
2. ПК вызывает `heartbeat` и получает до 10 команд с `done_at IS NULL` (`ORDER BY created_at`). У выданных команд ставится `delivered_at = now()`.
   Пока команда не выполнена (`done_at` пуст), она **выдаётся повторно при каждом heartbeat**, и `delivered_at` каждый раз перезаписывается. Программа должна уметь обрабатывать повторы, то есть быть идемпотентной.
3. ПК вызывает `command_result(command_id, result, screenshot?)`. Ставится `done_at = now()`, `result[:500]`.
4. Срока жизни у команд нет. Команды, поставленные выключенному ПК, выполнятся при следующем включении.

`lock`/`unlock` — стойкое состояние: каждый heartbeat возвращает `remote_lock` и `lock_message`. Даже если команда потерялась, ПК остаётся заблокированным.

### 3.6 Расчёт присутствия (presence)

- ПК в heartbeat присылает `presence`: `login` (экран входа) или `working` (сотрудник вошёл). Любое другое значение превращается в `login`.
- `_presence_row`:
  - `presence = devices.presence`; если пусто — `offline`;
  - если `heartbeat_at` задан и прошло больше `OFFLINE_SECONDS = 25` секунд — `offline`;
  - если `heartbeat_at` NULL — остаётся значение колонки. По умолчанию это `'offline'`.
- В UI: `offline` = не в сети, `login` = на экране входа, `working` = в сети. Команды `lock`, `rudesktop`, `reload`, `update` в UI доступны только онлайн. На сервере это не проверяется.

### 3.7 Действия

Неизвестное действие (для зама): `400 {"error":"Неизвестное действие: <action>"}`.

#### `heartbeat`

**Назначение:** ПК сообщает своё состояние и забирает команды. Вызывается каждые несколько секунд, чаще чем раз в 25 с.

**Кто может вызвать:** ПК с действующим токеном устройства.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `api_token` | string | нет (можно в заголовке) | токен ПК |
| `presence` | string | нет | `login` или `working` |
| `user_name` | string | нет | ≤200, кто сейчас вошёл |
| `app_version` | string | нет | ≤50 |
| `update_status` | string | нет | ≤200, текстовый статус обновления |

**Проверки и ошибки:** `401 {"error":"Устройство не авторизовано","revoked":true}`. По флагу `revoked` программа понимает, что её отвязали.

**Логика:**
1. `UPDATE devices SET heartbeat_at = now(), presence, current_user_name, app_version, update_status, last_seen_at = now()`.
2. Выбрать до 10 невыполненных команд.
3. Поставить им `delivered_at`.
4. Прочитать `remote_lock` и `lock_message`.

**Таблицы:** `api_tokens`, `devices` (чтение и запись), `device_commands` (чтение и запись).

**Ответ:**
```json
{"ok":true,"commands":[{"id":"uuid","command":"message","payload":{"message":"Подойдите к кассе"}}],"remote_lock":false,"lock_message":null}
```

**Побочные эффекты:** пустые `user_name`, `app_version`, `update_status` затирают прежние значения.

#### `command_result`

**Назначение:** ПК отчитывается о выполнении команды.

**Кто может вызвать:** ПК.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `command_id` | string | да | id команды |
| `result` | string | нет | ≤500 |
| `screenshot` | string (base64 JPEG) | нет | ≤6 МБ после декодирования |

**Проверки и ошибки:** `401 {"error":"Устройство не авторизовано"}`.

**Логика:**
1. Если пришёл `screenshot`: загрузить в S3 и записать `devices.screenshot_url` и `screenshot_at`.
2. `UPDATE device_commands SET done_at = now(), result WHERE id = command_id`. Принадлежность команды этому ПК не проверяется.

**Внешние вызовы:** S3 `put_object`.

**Таблицы:** запись в `devices`, `device_commands`.

**Ответ:** `{"ok":true,"screenshot_url":"https://cdn.poehali.dev/..."}`. Поле `screenshot_url` есть, только если снимок сохранён.

#### `device_log`

**Назначение:** ПК пишет событие в журнал (вход, выход, смена presence, открытая программа и т. п.).

**Кто может вызвать:** ПК.

**Вход:** `kind` (string, ≤30, по умолчанию `note`); `message` (string, ≤500).

**Проверки и ошибки:** 401 `Устройство не авторизовано`.

**Логика:** `INSERT device_logs (device_code, kind, message, actor_name = hostname)`.

**Ответ:** `{"ok": true}`.

#### `chat_unread`

**Назначение:** число непрочитанных сообщений в общем чате «РАБОЧИЙ». Используется для уведомлений в программе и на сайте.

**Кто может вызвать:** ПК (`api_token` в теле) или пользователь сайта (сессия в заголовке).

**Вход:** `api_token` (нет).

**Проверки и ошибки:** `401 {"error":"Требуется вход"}`.

**Логика:**
1. Если в теле есть `api_token` и это токен ПК, `uid = api_tokens.user_id`. Иначе используется `_site_user`.
2. Найти комнату `chat_rooms` с `name='РАБОЧИЙ'`. Комнаты нет — `{count:0}`.
3. Взять `chat_reads.last_read_at`.
4. Выбрать сообщения других отправителей (`sender_id <> uid`) новее `last_read_at`, `LIMIT 20`, сортировка DESC.
5. Если `last_read_at` ещё не было (первый вызов): создать запись `chat_reads` с `now()` и вернуть `{count:0}`. Старая переписка не показывается как новая.

**Таблицы:** `api_tokens`, `chat_rooms`, `chat_reads` (чтение и запись), `chat_messages`.

**Ответ:** `{"count":3,"last":{"id":"...","sender_name":"Иванов","content":"Привет"}}`. Счётчик не больше 20.

#### `chat_mark_read`

**Назначение:** отметить общий чат прочитанным.

**Кто может вызвать:** как `chat_unread`.

**Логика:** `UPSERT chat_reads (user_id, room_id, last_read_at=now())`. Если комнаты нет — `{count:0}`.

**Ответ:** `{"ok": true}`.

#### `check_update`

**Назначение:** ПК спрашивает, какая версия сейчас актуальна для его редакции.

**Кто может вызвать:** ПК.

**Вход:** `edition` (string, нет) — `admin`; любое другое значение означает `abiz`.

**Проверки и ошибки:** 401 `Устройство не авторизовано`.

**Логика:** `SELECT version, url, sha256, size_bytes, notes FROM app_releases WHERE edition AND is_active ORDER BY created_at DESC LIMIT 1`.

**Ответ:**
```json
{"version":"3.5","url":"https://cdn.poehali.dev/projects/<KEY>/bucket/releases/abiz/<hex>/part{n:03d}.bin|4","sha256":"<64 hex>","size":6123456,"notes":"Исправления"}
```
Если активного выпуска нет: `{"version": null}`. Сравнивать версии должен ПК: сервер не знает установленную версию.

#### `devices_status`

**Назначение:** список ПК со статусами.

**Кто может вызвать:** `deputy_director`, `director` (включая `is_admin`).

**Вход:** нет.

**Проверки и ошибки:** 401; `403 Недостаточно прав`.

**Логика:** `SELECT` из `devices LEFT JOIN profiles` (`ORDER BY created_at DESC`), затем `_presence_row`.

**Ответ:**
```json
{"devices":[{"id":"...","device_code":"ABC123XYZ","hostname":"KASSA-1","status":"linked","profile_id":"...","presence":"working",
 "heartbeat_at":"2026-10-18 10:00:00+00:00","current_user_name":"Иванов","app_version":"3.5","remote_lock":false,
 "profile_name":"Иванов Иван","screenshot_url":null,"screenshot_at":null,"update_status":"Актуальная версия"}],
 "can_control":true}
```

#### `send_command`

**Назначение:** поставить команду в очередь ПК.

**Кто может вызвать:** только `deputy_director`.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `device_code` | string | да | код ПК |
| `command` | string | да | одна из `ALLOWED_COMMANDS` |
| `payload` | object | нет | см. 3.5 |

**Проверки и ошибки:** `400 Неизвестная команда`; `404 Устройство не найдено`.

**Логика:**
1. Для `login_user` подставить `full_name` из профиля, к которому привязан ПК.
2. Проверить, что устройство существует.
3. Для `lock`/`unlock` обновить `devices.remote_lock` и `lock_message`.
4. `INSERT device_commands (id = uuid, payload json, created_by = profile_id, created_by_name)`.
5. Записать `device_logs` с `kind = 'remote'`: «<ФИО>: <действие>».

**Таблицы:** `devices` (чтение и запись), `profiles`, `device_commands`, `device_logs`.

**Ответ:** `{"ok": true}`.

#### `release_list`

**Назначение:** последние 30 выпусков.

**Кто может вызвать:** зам.

**Ответ:**
```json
{"releases":[{"id":"...","edition":"abiz","version":"3.5","url":"...|4","size":6123456,"notes":"","is_active":true,"created_at":"..."}]}
```

#### `release_upload_part`

**Назначение:** загрузить одну часть ZIP-архива выпуска.

**Кто может вызвать:** зам.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `edition` | string | нет | `abiz` / `admin` |
| `folder` | string | нет | для первой части пустой: сервер создаст `releases/{edition}/{uuid}` |
| `part` | int ≥1 | да | номер части |
| `data` | base64 | да | содержимое части |

**Проверки и ошибки (400):** `Неверная папка выпуска` (folder не начинается с `releases/{edition}/`); `Пустая часть файла`. Некорректный base64 даёт 500.

**Логика:** `put_object(files, '{folder}/part{NNN}.bin')`.

**Ответ:** `{"folder":"releases/abiz/<hex>","part":1}`.

#### `release_publish`

**Назначение:** выпустить загруженную версию: она становится активной для своей редакции.

**Кто может вызвать:** зам.

**Вход:**

| имя | тип | обязательно | описание |
|---|---|---|---|
| `edition` | string | нет | `abiz` / `admin` |
| `version` | string | да | `^\d+(\.\d+){1,3}$`, ≤20 символов |
| `folder` | string | да | `releases/{edition}/...` |
| `parts` | int ≥1 | да | число частей |
| `sha256` | string, 64 hex | да | контрольная сумма всего файла |
| `size` | int | нет | размер в байтах |
| `notes` | string | нет | ≤1000 |

**Проверки и ошибки (400):** `Номер версии — только цифры с точками, например 3.5`; `Выпуск загружен не полностью` (неверный folder, parts < 1 или длина sha ≠ 64).

**Логика:**
1. Сформировать шаблон url.
2. `UPDATE app_releases SET is_active = false WHERE edition`.
3. `INSERT` нового выпуска с `is_active = true`, `created_by = ФИО`.

Наличие частей в S3 и сам SHA сервер не проверяет.

**Ответ:** `{"ok":true,"id":"uuid"}`.

**Побочные эффекты:** все ПК этой редакции обновятся при ближайшей проверке, то есть в течение 10 минут.

#### `release_activate`

**Назначение:** откатиться на другой выпуск или переключиться на него.

**Кто может вызвать:** зам.

**Вход:** `id` (да).

**Проверки и ошибки:** `404 Выпуск не найден`.

**Логика:** `UPDATE app_releases SET is_active = (id = %s) WHERE edition = <редакция этого выпуска>`.

**Ответ:** `{"ok": true}`.

#### `release_delete`

**Назначение:** удалить запись о выпуске.

**Кто может вызвать:** зам.

**Вход:** `id`.

**Логика:** `DELETE FROM app_releases WHERE id`. Файлы в S3 не удаляются. Если удалён активный выпуск, у редакции не остаётся активного выпуска, и `check_update` возвращает `{version: null}`.

**Ответ:** `{"ok": true}`.

#### `update_all`

**Назначение:** разослать команду `update` всем привязанным ПК.

**Кто может вызвать:** зам.

**Логика:** для каждого `devices.status = 'linked'` выполнить `INSERT device_commands (command = 'update', payload = '{}')`. Наличие активного выпуска не проверяется. В журнал ничего не пишется.

**Ответ:** `{"ok":true,"count":12}`.

#### `device_logs`

**Назначение:** журнал одного ПК.

**Кто может вызвать:** только зам. Директор видит список ПК, но журнал получить не может.

**Вход:** `device_code` (да); `limit` (int, по умолчанию 100, максимум 300).

**Логика:** `SELECT kind, message, actor_name, created_at FROM device_logs WHERE device_code ORDER BY created_at DESC LIMIT`.

**Ответ:** `{"logs":[{"kind":"remote","message":"Петров П.: заблокировал ПК","actor_name":"Петров П.","created_at":"..."}]}`.

---

### Замечания по безопасности

#### cameras-api

1. **В коде лежат ключи облака JFTech** (`backend/cameras-api/index.py:17-19`): UUID, appKey и appSecret из публичного демо производителя используются по умолчанию. Если на эти ключи есть квоты или блокировки, они общие с чужими проектами. Стоит задать свои `JF_APP_*` секретами.
2. **Пароли камер хранятся открытым текстом** в `cameras.password` (миграция `V0013__cameras.sql`). Они передаются в облако в каждом `login`/`livestream`/`playbackUrl` с `EncryptType: DISABLE` (`index.py:134, 230-233, 282`). На клиент пароль не уходит: `_list` исключает его (`index.py:339-350`). Но любой, у кого есть доступ к БД или логам облака, видит пароли.
3. **Нет проверки доступа к разделу `/cameras`.** Смотреть живое видео, архив и снимки (`index.py:385-409`) может любой вошедший пользователь, включая тех, кому должность не даёт этот раздел (`access.py` здесь не используется).
4. **Ссылки на видео из облака работают без авторизации 3 часа** (`expireTime`, `index.py:88-89`) и кэшируются (`index.py:155, 187`). Кто получил ссылку, может смотреть поток без входа на сайт.
5. **Постоянные `api_tokens` (в том числе токены ПК) принимаются как вход пользователя** (`index.py:304-306`). Токен ПК, привязанного к директору или заму, даёт право управлять камерами.
6. **Роль считается по-другому, чем в `access.py`:** `is_admin` всегда превращается в `director` (`index.py:313`). Для камер это безопасно (обе роли управляющие), но логика расходится.
7. **Ключ регистратора `rec_*`:** поле `last_used_at` не обновляется (`index.py:296-299`), поэтому аудита использования нет. Правило «склад-вн» (`index.py:333-336`) даёт любому регистратору с активным контроллером доступ к камере с таким названием по одному имени.
8. `snapshot` игнорирует результат логина (`index.py:395`).
9. Нечисловые `from_hour`/`to_hour` вызывают необработанный `ValueError` и ответ 500 (`index.py:408`). Поле `day` не проверяется и уходит в облако как есть (`index.py:239`).
10. `ThreadPoolExecutor(max_workers=len(need))` (`index.py:217`): число потоков равно числу камер, ограничения нет.
11. `set_default` с несуществующим id оставляет компанию без камеры по умолчанию (`index.py:472`). `delete` не чистит ссылки в `skud_controllers` (`index.py:464`).

#### device-control

12. **`command_result` не проверяет, что команда принадлежит этому ПК** (`backend/device-control/index.py:209-211`). Любой авторизованный ПК может пометить чужую команду выполненной, например подавить `screenshot` или `update`.
13. **Отозванный ПК (`devices.status = 'revoked'`) продолжает работать**, если его `api_tokens.revoked_at` не выставлен: `_device_by_token` статус не проверяет (`index.py:78-86`). Корректность отзыва полностью зависит от auth-api.
14. **Пользователь с `is_admin` теряет управление, даже если в профиле он зам**: `role = 'director' if is_admin` (`index.py:64`). В `access.py:91` такой пользователь остаётся `deputy_director`. Поведение несогласованно.
15. **Payload команд не проверяется и не ограничен по размеру** (`index.py:300, 323-327`). При этом `login_admin` (`index.py:25`) — удалённый вход на ПК с правами администратора. Это самая мощная команда, и защищает её только роль зама.
16. **Команды без срока жизни, повторная выдача** (`index.py:172-184`). Команда остаётся в выдаче, пока ПК не пришлёт `command_result`. Старые `logout`/`login_admin`/`message` выполнятся при следующем включении ПК, даже через много дней. Если ПК не шлёт результат, команда выдаётся при каждом heartbeat.
17. **Скриншоты лежат в публичном CDN** без авторизации: `screenshots/{device_code}/{uuid}.jpg` (`index.py:112-114`). Ссылки не угадать, но они вечные, и снимки не удаляются.
18. В публичных ссылках CDN виден `AWS_ACCESS_KEY_ID` (`index.py:114, 374`). Это идентификатор, а не секрет, но он раскрывается.
19. **Выпуски:**
    - `release_upload_part` не ограничивает размер и число частей. Проверка `folder` — только `startswith` (`index.py:351-361`), поэтому можно перезаписать части уже выпущенного (активного) релиза. После этого SHA на ПК не совпадёт: ПК откажется обновляться, но выпуск будет испорчен.
    - `release_publish` не проверяет наличие частей и SHA (`index.py:369-383`): контрольную сумму присылает тот же клиент, что и файл.
    - `release_delete` не чистит S3 и может оставить редакцию без активного выпуска (`index.py:393-395`).
20. Некорректный base64 в `release_upload_part`, нечисловые `part`/`parts`/`limit` вызывают необработанные исключения и ответ 500 (`index.py:356-357, 370, 410`).
21. `chat_unread`/`chat_mark_read`: если `api_token` в теле не подошёл, функция молча переходит к сессии из заголовка (`index.py:225-232`). Поведение ожидаемое, но токен ПК даёт доступ к превью сообщений чата (`content` последнего сообщения).
22. `device_logs` доступен только заму, хотя `devices_status` видит и директор (`index.py:283, 294`). Это ограничение функциональности, а не уязвимость.
23. Серверная проверка «ПК онлайн» для команд отсутствует: она есть только в UI (`src/pages/Devices.tsx:159-195`).

#### admin-api и общие модули

24. **Постоянные `api_tokens`, включая токены ПК, дают полный вход** (`backend/admin-api/access.py:80-82`). Токен ПК, привязанного к заму, открывает всю админку и все права бухгалтерии.
25. **Зам может назначить кому угодно роль `director` или `deputy_director`** (`backend/admin-api/index.py:193-201`). Защищён только случай снятия последнего зама. Статус профиля (уволенный или неактивный) не проверяется, существование `position_id` не проверяется.
26. **Ошибки ввода дают 500 вместо 400, а данные остаются наполовину сохранёнными:**
    - `formulas_save`: `float(params[...])` (`index.py:215, 217`). При autocommit формулы к этому моменту уже сохранены (`index.py:212`), а проценты — нет;
    - `formula_test`: `float(v)` в `env` (`index.py:224`);
    - в `evaluate` неверное число аргументов функции (`round(1;2;3)`) вызывает `TypeError`, глубоко вложенное выражение — `RecursionError`. Ни то ни другое не перехватывается в `_validate_formulas` и `formula_test` (`formulas.py:73-74`, `index.py:87-90, 225-228`).
27. `reset formulas` не сбрасывает `acc_periods.fingerprint`, в отличие от `formulas_save` (`index.py:269-275` против `index.py:219`). Бухгалтерия может не пересчитать месяцы после сброса формул.
28. `general_save` массово перезаписывает `void` у начислений и операций бухгалтерии без транзакции (`index.py:153-157`). Если запрос оборвётся на середине, данные останутся несогласованными.
29. `position_delete` не логирует попытку с несуществующим id и всегда отвечает `ok` (`index.py:179-185`).
30. `access.py` и `formulas.py` продублированы в `backend/accounting-api/`. Если поправить только одну копию, права и формулы на сайте и в бухгалтерии разойдутся.
31. Во всех трёх функциях CORS `*` (`admin-api/index.py:13-18`, `cameras-api/index.py:25-30`, `device-control/index.py:14-19`). Токен лежит в `localStorage` и уходит в заголовке, а не в cookie, поэтому CSRF не применим. Но при XSS токен с правами зама крадётся напрямую.

---

# 5. СКУД, мост Gate, видеорегистратор (skud-api, GateBridge)

> Справочник по коду. Источники: `backend/skud-api/index.py`, `alerts.py`, `visits.py`, `recorder.py`, `tests.json`;
> мост и регистратор из `public/downloads/AbizShell-v22.zip`: `AbizShell/GateBridge.cs`, `AbizShell/SkudRecorder.cs`,
> `AbizShell/RecorderService.cs`, `AbizRecorder/Program.cs`; фронтенд-клиент `src/lib/skudApi.ts`.
> Ссылки вида `index.py:123` — номер строки в соответствующем файле.

### 1. Обзор, авторизация, справочники

#### 1.1 Назначение

`skud-api` — одна облачная функция (Python, `handler` в `index.py:547`), которая обслуживает СКУД двери склада:

- журнал событий двери (`skud_events`), сборку «посещений» и «открытий» (`skud_visits`, `skud_openings`, движок `visits.py`);
- ключ-карты Em-Marin сотрудников и гостей (`skud_cards`), расписания доступа (`skud_schedules`), режим «поймать карту» (`skud_enroll`);
- контроллер(ы) Gate-4000-Ethernet (`skud_controllers`) и очередь команд к ним (`skud_commands`);
- задания на видеоотрывки и их загрузку (`skud_clips`, `recorder.py`), ключи службы-регистратора (`recorder_keys`);
- сроки действия карт, уведомления в шапке сайта и ВКонтакте (`alerts.py`, таблицы `skud_notice_dismiss`, `skud_vk_sent`, настройка `app_settings.skud_notify`).

Принимает только `POST` (и `OPTIONS` для CORS). Действие выбирается полем `action` в JSON-теле. Подключение к БД — `psycopg2` с `autocommit = True` (`index.py:558-560`): каждый запрос фиксируется сразу, транзакций нет.

Общие ответы обработчика (`index.py:551-554`):

| Ситуация | Код | Тело |
|---|---|---|
| `OPTIONS` | 200 | пусто, заголовки CORS |
| метод не `POST` | 405 | `{"error": "Метод не поддерживается"}` |
| неизвестное действие сайта / моста / регистратора | 400 | `{"error": "Неизвестное действие"}` |

CORS (`index.py:15-20`): `Access-Control-Allow-Origin: *`, методы `POST, OPTIONS`, заголовки `Content-Type, X-Authorization, X-Skud-Key`.

Тесты (`tests.json`) проверяют только: OPTIONS→200, GET→405, `events` без входа→401, `bridge_push` без ключа→401, `rec_poll` и `rec_key` без токена ПК→401.

Фронтенд обращается через `skudCall()` в `src/lib/skudApi.ts:135-150`: `POST` на URL `skud-api` из `func2url`, токен берётся из `localStorage['anod_session_token']` и кладётся в `X-Authorization`; при сетевой ошибке возвращается `{error: 'Нет связи с сервером'}`, при не-2xx без `error` — `{error: 'Ошибка сервера'}`.

#### 1.2 Маршрутизация и три способа авторизации

Порядок разбора в `handler` (`index.py:562-595`):

1. `action` начинается с `bridge_` → **ключ контроллера** (`_controller_by_key`, `index.py:78-85`): берётся заголовок `X-Skud-Key` (или `x-skud-key`), либо поле `key` в теле. Ищется `skud_controllers WHERE secret = ключ AND active`. Нет → `401 {"error": "Неверный ключ контроллера"}`.
2. `action` начинается с `rec_` → **токен ПК** из `X-Authorization` (без префикса `Bearer `):
   - `rec_key` — только `recorder.device_by_api_token`: токен из `api_tokens` (не отозван), связанный с `devices` по `device_code`. Нет → `401 {"error": "Компьютер не привязан"}`.
   - остальные `rec_*` — `recorder.device_by_token` (`recorder.py:39-51`): если токен начинается с `rec_` — это **ключ службы-регистратора** из `recorder_keys` (не отозван, устройство в статусе `linked`), при успехе обновляется `recorder_keys.last_used_at`; иначе — как `device_by_api_token`. Нет → `401 {"error": "Компьютер не привязан"}`.
3. Всё остальное — **сессия сайта** (`_site_user`, `index.py:57-75`):
   - токен из `X-Authorization`; ищется в `auth_sessions` (`expires_at > now()`), затем в `api_tokens` (`revoked_at IS NULL`);
   - профиль: `profiles WHERE user_id = id OR lower(email) = lower(email)`, приоритет — совпадение по `user_id`;
   - роль: `director`, если `auth_users.is_admin`, иначе `profiles.role`, при отсутствии профиля — `employee`;
   - результат `{id, role, name, profile_id}`; `name` — ФИО из профиля или email.
   - Нет пользователя → `401 {"error": "Нужно войти в систему"}`.
   - `notices` и `notice_dismiss` доступны **любому** вошедшему; прочие уходят в `_site`.

Права в `_site` (`index.py:21-23`, `336-337`):

| Константа | Значение |
|---|---|
| `MANAGER_ROLES` | `director`, `deputy_director` — доступны все действия |
| `CARD_ROLES` | `director`, `deputy_director`, `senior_employee` |
| `CARD_ACTIONS` | `overview`, `cards`, `card_save`, `card_rewrite`, `card_check`, `enroll_start`, `enroll_poll`, `events`, `visits` — то, что разрешено старшему сотруднику |

Проверка: роль не в `MANAGER_ROLES` и не (`CARD_ROLES` и действие в `CARD_ACTIONS`) → `403 {"error": "Это доступно директору и заместителю директора"}` (тот же текст и для старшего сотрудника, вызвавшего запрещённое действие).

**Ключ службы-регистратора** (`rec_` + 64 hex-символа, `recorder.py:54-63`) выдаётся действием `rec_key` программе АБИЗ, которая кладёт его в `C:\ProgramData\AnodBiz\recorder\key` для Windows-службы `AbizRecorder`. По замыслу «только видео», но фактически этим ключом доступны все `rec_*`, включая `rec_gate_*` (управление дверью, см. раздел «Замечания»).

#### 1.3 Типы событий `KINDS` (`index.py:26-31`)

| kind | Подпись |
|---|---|
| `entry` | Вход по карте |
| `exit` | Выход по карте |
| `exit_button` | Выход по кнопке |
| `denied` | Отказ в доступе |
| `denied_blocked` | Заблокированная карта |
| `remote_open` | Открыта с сайта |
| `forced` | Дверь взломана |
| `held_open` | Дверь не закрыта |
| `door_closed` | Дверь закрыта |
| `power` | Питание / перезапуск |
| `other` | Событие контроллера |

Неизвестный `kind` при сохранении заменяется на `other` (`index.py:110`). Статусы карт `CARD_STATUSES = {active, blocked}` (`index.py:32`).

Выходы контроллера по умолчанию `OUTPUTS_DEFAULT` (`index.py:24-25`): addr 1 «Реле 2», 2 «Выход SW2», 3 «Выход SW3», 4 «Выход SW0», 5 «Выход SW1».

#### 1.4 Нормализация номера карты `norm_card` (`index.py:40-54`)

Строка обрезается, переводится в верхний регистр, пробелы удаляются, `.` и `/` заменяются на `,`. Затем:

| Вход | Правило | Пример |
|---|---|---|
| `ггг,ннннн` (1–3 и 1–5 цифр) | дополняется нулями до `ddd,ddddd` | `12,345` → `012,00345` |
| 6–10 цифр подряд | число `v`: серия `(v>>16)&0xFF`, номер `v&0xFFFF` | `0001234567` → `018,54919` |
| 6–12 HEX-символов | то же, но число из HEX | `12D687` → `018,54919` |
| иначе | возвращается как есть (после очистки) | |

Валидный номер для сайта — `^\d{3},\d{5}$`. Замечание: строка из 6–10 цифр сначала трактуется как десятичная, поэтому HEX без букв (например `123456`) никогда не будет разобран как HEX.

#### 1.5 Сохранение события `_save_event` (`index.py:109-142`)

Используется мостом (`bridge_push`) и сайтом (`open_door`, `emergency`).

1. `kind` — из входа, если есть в `KINDS`, иначе `other`.
2. `card` → `norm_card`. Владелец (`_card_owner`, `index.py:103-106`): `profile_id`, `status`, имя (`profiles.full_name` или `skud_cards.label`), `card_type`.
   - карта `blocked` и kind `denied`/`other` → kind = `denied_blocked`;
   - гостевая карта и kind `entry`/`exit` → к `note` добавляется «Гостевая карта» (если в исходной заметке нет «гост»);
   - карта не найдена → `UPDATE skud_enroll SET card_number = карта, captured_at = now() WHERE id = 1 AND until_at > now()` (захват карты для записи, если открыто окно «поднесите карту»).
3. `person` из входа перекрывает имя (до 200 символов).
4. `granted` — из входа, иначе `true` для `entry/exit/exit_button/remote_open`.
5. `direction` — из входа, иначе `in` для `entry`, `out` для `exit/exit_button`.
6. `INSERT INTO skud_events (...) ON CONFLICT (controller_id, event_time, event_code, card_number) DO NOTHING`. Время — `_parse_time` (`index.py:88-100`): число (секунды или миллисекунды, если > 1e11) или строка в нескольких форматах; без пояса — считается MSK (+03:00); не разобрать — **текущее время**. `note` до 300 символов, `raw` — JSON до 2000 символов.
7. Если строка вставлена и kind ∈ `alerts.ALERT_KINDS` (`forced`, `held_open`, `denied_blocked`) → `alerts.alarm(...)` с именем двери из `skud_controllers.name` (по умолчанию «Склад»).
8. Возвращает `true`, если строка вставлена.

#### 1.6 Вспомогательные выборки

- `_schedules` (`index.py:145-147`): до 7 записей `skud_schedules ORDER BY id`, каждой присваивается `zone` = порядковый индекс 0..6 (номер временной зоны в контроллере). Удаление расписания сдвигает зоны остальных.
- `_cards_for_controller` (`index.py:150-161`): активные карты в пределах `valid_from/valid_to`; карты сотрудников, у которых наступила дата удаления (`alerts.card_dates(written_at)['removed']`), пропускаются. Элемент: `{card, pin, mask, guest}`; `mask = 1 << zone` расписания или `0x80` («всегда»).
- `_controllers` (`index.py:228-248`): все активные контроллеры с камерами и ПК; `online` — `last_seen_at` < 90 с, `recorder_online` — `recorder_seen_at` < 60 с, `gate_online` — `gate_seen_at` < 60 с; `key` — секрет контроллера; `outputs` — из БД или `OUTPUTS_DEFAULT`.
- `_cards` (`index.py:315-332`): все карты с `last_used` (max времени события по номеру — подзапрос на каждую карту), для `employee` — `expires_at`, `removed_at`, `expiry_state` = `grace` / `warn` / `ok`.
- `_events` (`index.py:251-278`) и `_visits` (`index.py:281-312`) — см. соответствующие действия.

### 2. Действия API

Всего 37 действий: 25 действий сайта в `_site`, 2 действия уведомлений, 3 `bridge_*`, 4 `rec_*` и 3 `rec_gate_*`.
Если не указано иное, успешный ответ — HTTP 200. Необработанные исключения (например, `int('abc')` или `strptime` на неверной дате) дают 500 от платформы: в коде нет общего `try/except`.

Общая проверка для всех действий 2.1–2.25: вход по сессии сайта (иначе `401 Нужно войти в систему`) и права из п. 1.2 (иначе `403 Это доступно директору и заместителю директора`).

#### 2.1 Действия сайта: чтение

#### `overview`
- **Назначение**: начальная загрузка раздела СКУД.
- **Кто может вызвать**: `CARD_ROLES` (директор, зам. директора, старший сотрудник).
- **Вход**: ничего.
- **Проверки и ошибки**: только общие.
- **Логика по шагам**: (1) активные профили `id, full_name, department` по ФИО; (2) камеры `id, name` по `order_index`; (3) `_controllers()`; (4) если роль не менеджерская — из контроллеров убираются `key`, `last_ip`, `gate_host`; (5) `_cards()`, `_schedules()`, `alerts.settings()`.
- **Таблицы**: `profiles`, `cameras`, `skud_controllers`, `devices`, `skud_cards`, `skud_events` (подзапрос `last_used`), `skud_schedules`, `app_settings` — только чтение.
- **Ответ**: `{controllers, cards, employees, cameras, schedules, notify: {alarms_to_employees}, is_manager}`.
- **Побочные эффекты**: нет. Карты (включая признак `has_pin`) видны и старшему сотруднику.

#### `events`
- **Назначение**: журнал событий двери.
- **Кто может вызвать**: `CARD_ROLES`.
- **Вход**: `date_from`, `date_to` (`YYYY-MM-DD`, MSK, `date_to` включительно), `profile_id`, `kind` (`pass` | `alarm`), `limit` (по умолчанию 500, максимум 3000).
- **Проверки и ошибки**: неверный формат даты или `limit` → исключение (500).
- **Логика по шагам**: условие `(c.active OR c.id IS NULL)`; `pass` = `entry, exit, exit_button, remote_open`; `alarm` = `denied, denied_blocked, forced, held_open`; сортировка `event_time DESC, id DESC`.
- **Таблицы**: `skud_events` ⟕ `profiles` ⟕ `skud_controllers` (чтение).
- **Ответ**: `{events: [{id, time, kind, kind_label, direction, granted, card, profile_id, name, department, role, note, source, door, camera_id}]}`; `name` — ФИО профиля или `person_name`.
- **Побочные эффекты**: нет.

#### `cards`
- **Назначение**: список карт.
- **Кто может вызвать**: `CARD_ROLES`.
- **Вход**: ничего.
- **Проверки и ошибки**: общие.
- **Логика по шагам**: `_cards()` (п. 1.6).
- **Таблицы**: `skud_cards`, `profiles`, `skud_events` (чтение).
- **Ответ**: `{cards: [{id, card, profile_id, name, label, status, valid_from, valid_to, synced, created_at, last_used, card_type, has_pin, schedule_id, written_at, written_by, [expires_at, removed_at, expiry_state]}]}`.
- **Побочные эффекты**: нет.

#### `visits`
- **Назначение**: посещения склада с открытиями двери и видеоотрывками.
- **Кто может вызвать**: `CARD_ROLES`.
- **Вход**: `date_from`, `date_to` (по `started_at`, MSK), `alarm` (только посещения с тревогой).
- **Проверки и ошибки**: неверная дата → 500.
- **Логика по шагам**: (1) для **каждого** активного контроллера вызывается `visits.process()` — разбор необработанных событий и закрытие по таймаутам; (2) до 300 посещений активных контроллеров по `started_at DESC`; (3) открытия (`skud_openings`) и отрывки (`skud_clips` ⟕ `cameras`) этих посещений.
- **Таблицы**: чтение `skud_visits`, `skud_openings`, `skud_clips`, `cameras`, `skud_controllers`; запись — через движок (`skud_visits`, `skud_openings`, `skud_clips`, `skud_events.processed/note`).
- **Ответ**: `{visits: [{id, status, started_at, ended_at, inside, entries, exits, alarm, note, door, openings: [{id, opened_at, last_open_at, closed_at, assumed, held, marks, status}], clips: [{id, opening_id, camera_id, camera, mode, from, to, status, url, size, error}]}]}`. Поле `people` посещения в ответ не попадает.
- **Побочные эффекты**: запуск движка посещений (создаются задания на отрывки).

#### `devices`
- **Назначение**: список ПК для выбора «ПК, который записывает видео».
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: ничего.
- **Проверки и ошибки**: общие.
- **Логика по шагам**: `devices WHERE status = 'linked'` ⟕ `profiles`.
- **Таблицы**: `devices`, `profiles` (чтение).
- **Ответ**: `{devices: [{code, host, name, heartbeat_at}]}`.
- **Побочные эффекты**: нет.

#### `card_check`
- **Назначение**: проверить номер, введённый/считанный на сайте.
- **Кто может вызвать**: `CARD_ROLES`.
- **Вход**: `card`.
- **Проверки и ошибки**: нет (невалидный номер возвращается с `valid: false`).
- **Логика по шагам**: `norm_card` → `_card_owner`.
- **Таблицы**: `skud_cards`, `profiles` (чтение).
- **Ответ**: `{card, valid, owner, status}`.
- **Побочные эффекты**: нет.

#### `enroll_poll`
- **Назначение**: узнать, поднесли ли новую карту к считывателю двери.
- **Кто может вызвать**: `CARD_ROLES`.
- **Вход**: ничего.
- **Проверки и ошибки**: общие.
- **Логика по шагам**: `SELECT card_number, until_at > now() FROM skud_enroll WHERE id = 1`.
- **Таблицы**: `skud_enroll` (чтение).
- **Ответ**: `{card: номер|null, waiting: bool}`.
- **Побочные эффекты**: нет.

#### 2.2 Действия сайта: карты

#### `card_save`
- **Назначение**: создать или изменить карту (сотрудника или гостевую).
- **Кто может вызвать**: `CARD_ROLES`; у старшего сотрудника урезаны права (см. шаги).
- **Вход**: `id` (для изменения), `card`, `card_type` (`guest` | иначе `employee`), `profile_id`, `label` (до 100), `valid_from`, `valid_to`, `pin` (6 цифр), `pin_clear`, `schedule_id`, `rewrite`.
- **Проверки и ошибки** (все 400):
  - номер после `norm_card` не `ddd,ddddd` → «Не похоже на номер карты Em-Marin. Поднесите карту к считывателю ещё раз»;
  - номер уже есть у другой карты → «Эта карта уже записана на {ФИО}» (или без « на …», если профиль не найден);
  - гостевая без `valid_to` → «Для гостевой карты укажите, до какого числа она действует»;
  - `pin` не 6 цифр → «Код для клавиатуры — ровно 6 цифр».
- **Логика по шагам**:
  1. `schedule_id` берётся, только если это строка цифр.
  2. Не менеджер: `pin` обнуляется, `pin_clear = False`, `schedule_id` — прежний у этой карты (или `NULL` для новой).
  3. `valid_to` сохраняется только для гостевой карты.
  4. С `id`: читается старый номер; `rewrite = body.rewrite` или номер изменился. `UPDATE` всех полей, `synced=false`, `updated_at=now()`, при `rewrite` ещё `written_at=now(), written_by=имя`. Существование `id` не проверяется: при отсутствии строки обновится 0 строк, но ответ всё равно `ok`, а PIN-шаг тоже ничего не сделает.
  5. Без `id`: `INSERT` с `created_by = written_by = имя` (`written_at` — значение по умолчанию в БД).
  6. `pin_clear` → `pin_code = NULL`; иначе непустой `pin` → `pin_code = pin` (PIN хранится открытым текстом).
  7. Сбрасывается режим захвата: `skud_enroll SET until_at = NULL, card_number = NULL WHERE id = 1`.
- **Таблицы**: `skud_cards` (R/W), `profiles` (R), `skud_enroll` (W).
- **Ответ**: `{ok: true, card, cards}`.
- **Побочные эффекты**: карта помечается несинхронизированной, мост перезапишет список в контроллере. Новая карта сотрудника запускает месячный цикл срока действия.

#### `card_rewrite`
- **Назначение**: «перезаписать» карту сотрудника — продлить на месяц.
- **Кто может вызвать**: `CARD_ROLES`.
- **Вход**: `id`.
- **Проверки и ошибки**: нет (несуществующий `id` или гостевая карта — 0 строк, ответ `ok`).
- **Логика по шагам**: `UPDATE skud_cards SET written_at = now(), written_by = имя, synced = false, updated_at = now() WHERE id = %s AND card_type = 'employee'`.
- **Таблицы**: `skud_cards`.
- **Ответ**: `{ok: true, cards}`.
- **Побочные эффекты**: новый цикл срока, прежние закрытия уведомлений перестают действовать (у цикла другой `written_at`).

#### `card_status`
- **Назначение**: заблокировать или разблокировать карту.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`, `status` (`active` | `blocked`).
- **Проверки и ошибки**: статус не из списка → `400 Неверный статус`.
- **Логика по шагам**: `UPDATE ... SET status, synced=false, updated_at=now()`.
- **Таблицы**: `skud_cards`.
- **Ответ**: `{ok: true, cards}`.
- **Побочные эффекты**: заблокированная карта перестаёт отдаваться контроллеру; её попытки прохода записываются как `denied_blocked` с тревогой в ВК.

#### `card_delete`
- **Назначение**: удалить карту.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`.
- **Проверки и ошибки**: нет.
- **Логика по шагам**: `DELETE FROM skud_cards WHERE id`; затем `UPDATE skud_cards SET synced=false` для всех карт (чтобы мост выгрузил новый список).
- **Таблицы**: `skud_cards`.
- **Ответ**: `{ok: true, cards}`.
- **Побочные эффекты**: полная пересинхронизация карт.

#### `enroll_start`
- **Назначение**: открыть окно на 2 минуты «поднесите новую карту к считывателю».
- **Кто может вызвать**: `CARD_ROLES`.
- **Вход**: ничего.
- **Проверки и ошибки**: общие.
- **Логика по шагам**: `UPDATE skud_enroll SET until_at = now() + 2 minutes, card_number = NULL WHERE id = 1`. Строка `id = 1` должна существовать заранее, она не создаётся.
- **Таблицы**: `skud_enroll`.
- **Ответ**: `{ok: true}`.
- **Побочные эффекты**: в течение 2 минут первая незнакомая карта из события контроллера (`_save_event`) попадёт в `skud_enroll.card_number`. Окно одно на всю систему.

#### 2.3 Действия сайта: контроллер и дверь

#### `controller_save`
- **Назначение**: создать или настроить контроллер.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`, `name` (по умолчанию «Склад», до 80), `open_seconds` (1..30, по умолчанию 3), `pre_seconds`/`post_seconds` (0..120, по умолчанию 10), `camera_id`, `inside_camera_id`, `recorder_device`, `recorder_quality` (`hd` | иначе `sd`), `gate_host`, `gate_port` (1..65535, по умолчанию 5000), `gate_address` (1..254, по умолчанию 1).
- **Проверки и ошибки**: `gate_host` не IPv4 вида `d.d.d.d` → `400 IP-адрес контроллера в виде 192.168.1.50 (или оставьте пустым — найдётся сам)`. Нечисловые значения → 500.
- **Логика по шагам**:
  - с `id`: `UPDATE gate_host, gate_port, gate_address`; `UPDATE name, camera_id, open_seconds, inside_camera_id, pre_seconds, post_seconds, recorder_device, recorder_quality`; в очередь всегда ставится команда `set_open_time {seconds}`. Существование `id` не проверяется;
  - без `id`: `INSERT` с `model = 'Gate-4000-Ethernet'`. Поля `gate_host/gate_port/gate_address` при создании **не сохраняются**, их можно задать только повторным сохранением. `secret` в запросе не задаётся (берётся значение по умолчанию из БД).
- **Таблицы**: `skud_controllers`, `skud_commands`.
- **Ответ**: `{ok: true, controllers}`.
- **Побочные эффекты**: мост переподключится при смене адреса и порта; время открытия запишется в контроллер.

#### `open_door`
- **Назначение**: открыть дверь с сайта.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id` контроллера.
- **Проверки и ошибки**: контроллера нет → `404 Контроллер не найден`. Активность контроллера не проверяется.
- **Логика по шагам**: (1) `INSERT skud_commands (operation='open_door', created_by)`; (2) `_save_event(kind='remote_open', time=now, person=имя, note='Открыто кнопкой на сайте', source='site')`; (3) `process_visits`.
- **Таблицы**: `skud_controllers`, `skud_commands`, `skud_events`, таблицы движка.
- **Ответ**: `{ok: true}` — ещё **до** фактического открытия.
- **Побочные эффекты**: событие «Открыта с сайта» записывается сразу, даже если мост не на связи. Если команду не забрали за 60 с, при следующем опросе она закрывается с результатом «не выполнена: контроллер был не на связи», а событие в журнале остаётся. Контроллер обычно сам пишет «Открыто оператором» (код 08h), но мост это событие пропускает.

#### `emergency`
- **Назначение**: аварийное открытие (дверь открыта постоянно) — включить или выключить.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`, `on`.
- **Проверки и ошибки**: `404 Контроллер не найден`.
- **Логика по шагам**: `UPDATE emergency_open`; событие `remote_open` («Аварийное открытие: дверь открыта постоянно») или `other` («Аварийное открытие выключено»), `source='site'`; `process_visits`.
- **Таблицы**: `skud_controllers`, `skud_events`, таблицы движка.
- **Ответ**: `{ok: true, controllers}`.
- **Побочные эффекты**: мост применяет флаг при следующем опросе (запись `0x73` по адресу D0:0015), включённый режим повторяет раз в 5 минут.

#### `sync_clock`, `gate_info`
- **Назначение**: выставить часы контроллера / прочитать модель и прошивку.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`.
- **Проверки и ошибки**: `404 Контроллер не найден`.
- **Логика по шагам**: `INSERT skud_commands (operation = action)`.
- **Таблицы**: `skud_controllers`, `skud_commands`.
- **Ответ**: `{ok: true, controllers}`.
- **Побочные эффекты**: результат (`ok: Gate-4000-Ethernet 4xxx/nnn`) попадает только в `skud_commands.result`, сайт его не возвращает. Модель и прошивка обновляются в `skud_controllers` при каждом опросе и без этой команды.

#### `antipassback`
- **Назначение**: включить или выключить запрет повторного прохода.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`, `on`.
- **Проверки и ошибки**: `404 Контроллер не найден`.
- **Логика по шагам**: `UPDATE antipassback`; все карты `synced=false` (флаг бит 7 в блоке ключа).
- **Таблицы**: `skud_controllers`, `skud_cards`.
- **Ответ**: `{ok: true, controllers}`.
- **Побочные эффекты**: мост пишет режим в D0:0016 и перезаписывает карты. На Gate-4000-Ethernet с одним считывателем не работает (см. «Замечания»).

#### `outputs_save`
- **Назначение**: подписи выходов контроллера.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`, `outputs: [{addr, name}]`.
- **Проверки и ошибки**: `404 Контроллер не найден`; элементы с `addr` не из `1..7` молча отбрасываются.
- **Логика по шагам**: имя до 40 символов, пустое — «Выход N»; JSON пишется в `skud_controllers.outputs`.
- **Таблицы**: `skud_controllers`.
- **Ответ**: `{ok: true, controllers}`.
- **Побочные эффекты**: нет.

#### `output`
- **Назначение**: включить, выключить или дать импульс на выход контроллера.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`, `addr` (1..7), `mode` (`on`/`off`/`pulse`, по умолчанию `pulse`), `seconds` (1..255, по умолчанию 5).
- **Проверки и ошибки**: `404 Контроллер не найден`; `addr` вне 1..7 → `400 Неверный выход`.
- **Логика по шагам**: `INSERT skud_commands (operation='output', payload={addr, mode, seconds})`.
- **Таблицы**: `skud_controllers`, `skud_commands`.
- **Ответ**: `{ok: true, controllers}`.
- **Побочные эффекты**: мост шлёт команду 0Eh. У Gate-4000-Ethernet одно реле — дополнительные выходы фактически отсутствуют (см. «Замечания»).

#### `sync_cards`
- **Назначение**: принудительно перезаписать карты в контроллере.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: ничего.
- **Проверки и ошибки**: общие.
- **Логика по шагам**: `UPDATE skud_cards SET synced=false`.
- **Таблицы**: `skud_cards`.
- **Ответ**: `{ok: true}`.
- **Побочные эффекты**: при следующем опросе мост получит полный список.

#### `clip_retry`
- **Назначение**: повторить неудавшиеся видеоотрывки посещения.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `visit_id`.
- **Проверки и ошибки**: нет.
- **Логика по шагам**: `UPDATE skud_clips SET status='pending', attempts=0, error=NULL WHERE visit_id AND status IN ('failed','missing')`.
- **Таблицы**: `skud_clips`.
- **Ответ**: `{ok: true}`.
- **Побочные эффекты**: если `clip_to` старше 24 ч, следующий `rec_poll` сразу вернёт отрывок в `failed`.

#### 2.4 Действия сайта: расписания и настройки

#### `schedule_save`
- **Назначение**: создать или изменить расписание (временную зону).
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`, `name` (до 60), `days` (битовая маска, бит 0 = Пн … бит 6 = Вс, `& 0x7F`), `from`, `to` (`HH:MM`).
- **Проверки и ошибки** (400): пустое имя, `days = 0`, неверный формат времени или `from >= to` → «Укажите название, дни недели и время «с» меньше, чем «до»»; новое восьмое расписание → «Контроллер хранит не больше 7 расписаний». Значения часов и минут не проверяются (`25:99` пройдёт).
- **Логика по шагам**: `UPDATE` или `INSERT skud_schedules`; все карты `synced=false`.
- **Таблицы**: `skud_schedules`, `skud_cards`.
- **Ответ**: `{ok: true, schedules, cards}`.
- **Побочные эффекты**: мост перепишет зоны и карты. Расписание через полночь задать нельзя.

#### `schedule_delete`
- **Назначение**: удалить расписание.
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `id`.
- **Проверки и ошибки**: нет.
- **Логика по шагам**: картам с этим расписанием `schedule_id = NULL` (доступ «всегда»), `DELETE`, все карты `synced=false`.
- **Таблицы**: `skud_schedules`, `skud_cards`.
- **Ответ**: `{ok: true, schedules, cards}`.
- **Побочные эффекты**: номера зон оставшихся расписаний сдвигаются (зона = порядковый номер по `id`), поэтому меняются и маски карт. Мост каждый раз пишет все 7 блоков (массив из 56 байт, отсутствующие зоны — нули), так что освободившийся последний блок обнуляется. Зоны пишутся при каждом получении массива `zones`, даже если карты не записываются из-за пустого списка.

#### `notify_save`
- **Назначение**: настройка «тревоги ВК и сотрудникам».
- **Кто может вызвать**: `MANAGER_ROLES`.
- **Вход**: `alarms_to_employees`.
- **Проверки и ошибки**: общие.
- **Логика по шагам**: upsert `app_settings (key='skud_notify', value={alarms_to_employees}, updated_by)`.
- **Таблицы**: `app_settings`.
- **Ответ**: `{ok: true, notify}`.
- **Побочные эффекты**: тревоги начнут уходить и сотрудникам с ролью `employee`.

#### 2.5 Уведомления (любой вошедший)

#### `notices`
- **Назначение**: уведомления о сроке карт для шапки сайта.
- **Кто может вызвать**: любой вошедший пользователь (не проходит через `_site`).
- **Вход**: ничего.
- **Проверки и ошибки**: `401 Нужно войти в систему`.
- **Логика по шагам**: (1) `alerts.daily_once()` — раз в сутки (MSK) ежедневная обработка: ВК-напоминания и удаление просроченных карт; (2) `alerts.notices_for(user)`.
- **Таблицы**: `skud_vk_sent`, `skud_cards`, `profiles`, `vk_bindings`, `skud_notice_dismiss`.
- **Ответ**: `{notices: [{id: "card_id:cycle", card_id, cycle, text, grace, days}]}`.
- **Побочные эффекты**: первый запрос за день от любого пользователя запускает рассылку в ВК и удаление карт (запрос может выполняться долго из-за HTTP-вызовов к VK с таймаутом 5 с).

#### `notice_dismiss`
- **Назначение**: закрыть уведомление крестиком.
- **Кто может вызвать**: любой вошедший.
- **Вход**: `card_id`, `cycle` (ISO-строка `written_at`).
- **Проверки и ошибки**: `401`. Значения не проверяются.
- **Логика по шагам**: `INSERT skud_notice_dismiss (user_id, card_id, cycle) ON CONFLICT DO NOTHING`.
- **Таблицы**: `skud_notice_dismiss`.
- **Ответ**: `{ok: true}`.
- **Побочные эффекты**: уведомление по этой карте скрыто для пользователя до следующей перезаписи карты. Сравнение `(card_id, cycle)` в `notices_for` идёт с `datetime` из БД, поэтому `cycle` должен быть в формате, который БД приведёт к тому же `timestamptz`.

#### 2.6 Мост контроллера (`X-Skud-Key`)

Общее для трёх действий (`_bridge`, `index.py:164-197`): ключ из `X-Skud-Key` или `body.key` → `401 Неверный ключ контроллера`. При каждом вызове обновляются `skud_controllers.last_seen_at = now()`, `last_ip` (из `requestContext.identity.sourceIp`), а также `serial`, `model`, `fw_version`, `door_open` (через `COALESCE`, только если переданы).

#### `bridge_push`
- **Назначение**: передать пачку событий контроллера.
- **Кто может вызвать**: мост с ключом контроллера (и `rec_gate_push`, см. 2.8).
- **Вход**: `events: [{time, code, kind, card, granted, direction, note, person, raw}]` — обрабатываются первые 500 элементов, не-объекты пропускаются.
- **Проверки и ошибки**: `401`.
- **Логика по шагам**: для каждого события `_save_event(..., source='controller')` (п. 1.5); затем `process_visits(ctrl)`.
- **Таблицы**: `skud_events`, `skud_cards`, `skud_enroll`, `skud_vk_sent`, `vk_bindings`, `profiles`, таблицы движка.
- **Ответ**: `{ok: true, saved: N}` — число новых (не дублей) событий.
- **Побочные эффекты**: тревоги в ВК, захват карты для записи, сборка посещений и заданий на видео. Поле `person` позволяет мосту подставить любое имя.

#### `bridge_poll`
- **Назначение**: получить команды и (при необходимости) карты и расписания.
- **Кто может вызвать**: мост.
- **Вход**: `want_cards` (принудительно получить карты), а также `serial/model/fw/door_open`.
- **Проверки и ошибки**: `401`.
- **Логика по шагам**:
  1. Команды `open_door`, не отправленные и созданные больше 60 с назад, закрываются: `sent_at = done_at = now()`, `result = 'не выполнена: контроллер был не на связи'`.
  2. До 20 неотправленных команд по `id`; им ставится `sent_at = now()` (повторно не выдаются, даже если мост упадёт до выполнения).
  3. `cards_changed` = есть ли карта с `NOT synced`.
  4. Если `cards_changed` или `want_cards` — добавляются `cards = _cards_for_controller()` и `zones = _schedules()`.
- **Таблицы**: `skud_commands`, `skud_cards`, `skud_schedules`.
- **Ответ**: `{commands: [{id, operation, payload}], cards_changed, [cards, zones]}`.
- **Побочные эффекты**: команды помечаются отправленными.

#### `bridge_ack`
- **Назначение**: подтвердить выполнение команд и запись карт.
- **Кто может вызвать**: мост.
- **Вход**: `done: [{id, result}]` (до 50), `cards_synced`.
- **Проверки и ошибки**: `401`.
- **Логика по шагам**: `UPDATE skud_commands SET done_at=now(), result=(result или 'ok', до 300) WHERE id AND controller_id`; при `cards_synced` — `UPDATE skud_cards SET synced = true WHERE NOT synced`.
- **Таблицы**: `skud_commands`, `skud_cards`.
- **Ответ**: `{ok: true}`.
- **Побочные эффекты**: флаг `synced` общий для всех карт и не привязан к контроллеру; изменения, сделанные между `poll` и `ack`, тоже помечаются синхронизированными (гонка, см. «Замечания»).

#### 2.7 Регистратор (`X-Authorization` = токен ПК или ключ `rec_…`)

#### `rec_key`
- **Назначение**: выдать программе АБИЗ ключ для службы `AbizRecorder`.
- **Кто может вызвать**: только ПК с токеном из `api_tokens`, привязанным к `devices` (ключ `rec_…` здесь не принимается).
- **Вход**: ничего.
- **Проверки и ошибки**: `401 Компьютер не привязан`.
- **Логика по шагам**: последний неотозванный ключ устройства из `recorder_keys`; если его нет — создаётся `'rec_' + uuid4().hex + uuid4().hex`.
- **Таблицы**: `api_tokens`, `devices`, `recorder_keys`.
- **Ответ**: `{key}`.
- **Побочные эффекты**: новый ключ без срока действия (отзыв — только через `revoked_at` в БД).

#### `rec_poll`
- **Назначение**: регистратор получает список камер для записи и задания на отрывки.
- **Кто может вызвать**: ПК (токен) или служба (ключ `rec_`).
- **Вход**: `status` (строка до 300 символов для сайта).
- **Проверки и ошибки**: `401 Компьютер не привязан`.
- **Логика по шагам** (`recorder.poll`, `recorder.py:66-111`):
  1. Активные контроллеры с `recorder_device = код ПК`; нет — ответ `{recorder: false}`.
  2. Для каждого: `recorder_seen_at = now()`, `recorder_status`; `visits.process()`; камеры `camera_id` и `inside_camera_id` с качеством `recorder_quality` (по умолчанию `sd`); если внутренняя камера не задана — ищется камера с именем «Склад-ВН»/«СкладВН» (без пробелов, без учёта регистра).
  3. Зависшие задания: `taken` дольше 10 минут и `attempts < 6` → `pending`.
  4. `pending`/`taken` с `attempts >= 6` или `clip_to` старше 24 ч → `failed` (ошибка «Не удалось сохранить отрывок», если другой нет).
  5. До 3 заданий `pending` с `clip_to <= now − 20 с` по `clip_to`; каждому `status='taken', taken_at=now(), attempts+1` и генерируется ключ S3 `skud/YYYY-MM/<uuid>.mp4` (месяц по MSK от `clip_from`).
- **Таблицы**: `skud_controllers`, `cameras`, `skud_clips`, `skud_visits`, таблицы движка.
- **Ответ**: `{recorder: true, cameras: [{id, quality, name}], keep_hours: 720, max_disk_gb: 15, part_bytes: 1048576, jobs: [{id, camera_id, from, to, mode, key}]}`.
- **Побочные эффекты**: шаги 3–4 выполняются по **всем** контроллерам, а не только по своим.

#### `rec_part`
- **Назначение**: загрузить кусок готового MP4 (base64).
- **Кто может вызвать**: ПК или служба.
- **Вход**: `key`, `part` (номер), `data` (base64).
- **Проверки и ошибки**: `401`; ключ не начинается с `skud/` или содержит `..` → `200 {"error": "bad key"}`. Ошибки S3 и base64 не перехватываются (500).
- **Логика по шагам**: `put_object(Bucket='files', Key=f'{key}.part{NNNN}')`.
- **Таблицы**: нет (S3).
- **Ответ**: `{ok: true}`.
- **Побочные эффекты**: запись в S3. Ключ не сверяется с выданным в задании: любой привязанный ПК может писать любой объект с префиксом `skud/`.

#### `rec_done`
- **Назначение**: завершить задание (успех, ошибка или «подождать»).
- **Кто может вызвать**: ПК или служба.
- **Вход**: `id`; варианты: `wait: true` | `error` (+ `missing`) | `key`, `parts`, `duration`.
- **Проверки и ошибки**: `401`; неверный ключ → `200 {"error": "bad key"}`; файла нет в S3 → `200 {"error": "Файл не найден в хранилище"}` и отрывок возвращается в `pending` с ошибкой «Файл не дошёл до хранилища».
- **Логика по шагам** (`recorder.done`, `recorder.py:159-184`):
  - `wait` → `pending`, `attempts = max(attempts−1, 0)`, `taken_at = NULL`;
  - `error` → статус `missing` (если `missing`) или `pending`, текст ошибки до 300 символов;
  - иначе: при `parts` — склейка `key.part0000..` в `key` (`ContentType: video/mp4`) и удаление частей, без `parts` — `head_object` (прямая загрузка); `status='done', url=CDN, size_bytes, duration_sec, done_at, error=NULL`; затем `site_cleanup`.
- **Таблицы**: `skud_clips`.
- **Ответ**: `{ok: true}`.
- **Побочные эффекты**: удаление старых отрывков, если на сайте больше 6 ГБ. Принадлежность `id` устройству не проверяется.

#### 2.8 Мост через ПК (`rec_gate_*`)

`rec_gate_poll`, `rec_gate_push`, `rec_gate_ack` обрабатывает `_gate` (`index.py:203-225`); их вызывает `GateBridge.cs` с токеном ПК или ключом `rec_`.

- **Назначение**: мост к контроллеру Gate через ПК склада без отдельного ключа контроллера.
- **Кто может вызвать**: ПК или служба, у которой `devices.device_code` указан в `skud_controllers.recorder_device` (берётся первый активный контроллер по `created_at`).
- **Вход**: `status`, `connected`, `found_host`, `found_port`, а также тело соответствующего `bridge_*` (`want_cards`, `events`, `done`, `cards_synced`, `model`, `fw`).
- **Проверки и ошибки**: `401 Компьютер не привязан`; ПК не выбран ни для одного контроллера → `200 {gate: null}`.
- **Логика по шагам**:
  1. Если `found_host` — IPv4-строка (`[0-9.]{7,15}`), а у контроллера `gate_host` пуст — сохраняются `gate_host = found_host`, `gate_port = found_port || 5000` (автопоиск).
  2. `gate_status`, `gate_seen_at = now()`.
  3. При `connected = false` → `{ok: true}`; иначе вызывается `_bridge(..., 'bridge_' + суффикс)`, его JSON берётся как основа ответа (HTTP-код `_bridge` игнорируется; для неизвестного суффикса в ответе будет `error`, но код 200).
  4. Добавляется `gate: {controller_id, name, host, port, address, open_tenths = open_seconds×10, emergency, antipassback}`.
  5. `alerts.daily_once()`.
- **Таблицы**: `skud_controllers` и всё, что трогает соответствующий `bridge_*`.
- **Ответ**: ответ `bridge_*` + `gate`.
- **Побочные эффекты**: как у `bridge_*`, плюс ежедневная обработка сроков карт.

### 3. alerts.py — сроки карт, уведомления, тревоги

#### 3.1 Константы (`alerts.py:16-22`)

| Константа | Значение | Смысл |
|---|---|---|
| `GRACE_DAYS` | 5 | резервные дни после окончания месяца |
| `WARN_DAYS` | 5 | за сколько дней до конца месяца начинается предупреждение |
| `MSK` | UTC+3 | часовой пояс для дат и ключей |
| `ALERT_KINDS` | `forced` → «Дверь склада взломана!», `held_open` → «Дверь склада оставлена открытой», `denied_blocked` → «Попытка пройти по заблокированной карте» | события-тревоги |
| `NOTIFY_ROLES` | `director`, `deputy_director`, `senior_employee` | кому идут тревоги |
| `EXPIRY_ROLES` | `deputy_director`, `senior_employee` | кому идут уведомления о сроках по всем картам (директор **не входит**) |

#### 3.2 Даты карты сотрудника

Срок действия есть только у карт `card_type = 'employee'`. Гостевые ограничены `valid_from/valid_to`.

- `add_month(d)` (`alerts.py:25-32`): тот же день следующего месяца; если такого дня нет — пробуются 30, 29, 28 (31 января → 28/29 февраля); запасной вариант `+30 дней`. Время суток сохраняется.
- `card_dates(written_at)` (`alerts.py:35-37`):
  - `expires` = `add_month(written_at)` — конец месяца действия;
  - `removed` = `expires + 5 дней` — удаление карты;
  - `warn_from` = `expires − 5 дней` — начало предупреждений.
- Состояние в `_cards` (`index.py:327-330`): `grace`, если `now >= expires`; `warn`, если `now >= warn_from`; иначе `ok`.
- `_days_left` — разница **календарных** дат по MSK, не меньше 0.
- Карта в резервные дни продолжает работать в контроллере; после `removed` она исключается из `_cards_for_controller` сразу, а из БД удаляется ежедневной обработкой.

#### 3.3 `expiring()` (`alerts.py:95-110`)

Активные карты сотрудников, у которых `now >= warn_from`. Элемент: `card_id, card, profile_id, name` (ФИО, `label` или «без имени»), `cycle` (= `written_at`), `expires`, `removed`, `grace` (`now >= expires`), `days` (до `removed` в резерве, иначе до `expires`). Заблокированные карты в выборку не попадают.

#### 3.4 Тексты уведомлений (`notice_text`, `alerts.py:113-118`) — дословно

Предупреждение (до конца месяца):

```
Внимание! Карта СКУД сотрудника {name}, через {days} дн. перестанет работать! Перезапишите карту! После истечения срока действия карты, будет дано 5 резервных дней!
```

Резервные дни:

```
Внимание! Карта СКУД сотрудника {name} работает в резервные дни: через {days} дн. она будет удалена! Перезапишите карту!
```

#### 3.5 Аудитория уведомлений на сайте (`notices_for`, `alerts.py:121-132`)

- `deputy_director`, `senior_employee` — по всем картам из `expiring()`.
- Все остальные роли (включая **директора** и `employee`) — только по карте, у которой `profile_id` совпадает с профилем пользователя. У директора без своей карты уведомлений не будет.
- Скрываются пары `(card_id, cycle)` из `skud_notice_dismiss` для этого `user_id`.
- `id` уведомления = `"{card_id}:{cycle ISO}"`.

#### 3.6 Циклы закрытия

`dismiss()` (`alerts.py:135-137`) записывает `(user_id, card_id, cycle)`. Цикл — это `written_at` карты. После перезаписи (`card_rewrite` или `card_save` с `rewrite` / сменой номера) `written_at` меняется — начинается новый цикл, и закрытие прошлого на него не действует: новое предупреждение снова появится через ~25 дней. Закрытие действует и для предупреждения, и для резервных дней одного цикла: закрыв предупреждение, пользователь не увидит на сайте и «резервные дни» (в ВК напоминания продолжатся).

#### 3.7 Ежедневная обработка

`daily_once()` (`alerts.py:166-169`): ключ `daily:YYYY-MM-DD` (MSK) вставляется в `skud_vk_sent`; если вставка удалась (первый вызов за сутки) — `daily()`. Вызывается из `notices` (любой вошедший пользователь) и из каждого `rec_gate_*` (каждые ~6 с с ПК склада). Отдельного планировщика нет: если за день никто не зашёл на сайт и мост не работал, обработка не выполнится.

`daily()` (`alerts.py:140-163`):

1. Для каждой карты из `expiring()`:
   - если `now >= removed`: `DELETE skud_cards WHERE id`, все карты `synced = false`, `removed += 1`; один раз на цикл (ключ `removed:{card_id}:{cycle}`) в ВК для `EXPIRY_ROLES` + владельца уходит текст (дословно):
     ```
     Карта СКУД сотрудника {name} ({card}) удалена: прошёл месяц и 5 резервных дней. Запишите карту заново.
     ```
     В этом списке получателей возможны дубли (нет `dict.fromkeys`), но `vk_send` выбирает `DISTINCT vk_user_id`, так что повторной отправки нет.
   - иначе раз в сутки на карту и цикл (ключ `expiry:{card_id}:{cycle}:{YYYY-MM-DD}`) — `notice_text(x)` в ВК для `EXPIRY_ROLES` + владельца.
2. Удаляются гостевые карты с `valid_to < current_date − 1`; если удалено хоть что-то — все карты `synced = false`.
3. Чистится `skud_vk_sent` старше 60 дней.
4. Возвращает `{sent, removed}` (никем не используется).

Удаление карты по сроку приходится на момент первого вызова `daily()` после наступления `removed` — то есть до суток позже фактической даты (в контроллер карта перестаёт отдаваться сразу, но лишь при следующей синхронизации — которая запускается как раз удалением).

#### 3.8 Тревоги `alarm()` (`alerts.py:80-92`)

Вызывается из `_save_event` только для **новых** событий `forced`, `held_open`, `denied_blocked`.

- Защита от повторов: ключ `alarm:{kind}:{card}:{YYYY-MM-DD HH:MM MSK}` в `skud_vk_sent` — одно сообщение на тип и карту в минуту.
- Текст (дословно, с переводами строк):
  ```
  ⚠ СКУД «{door}»: {title}
  {DD.MM.YYYY HH:MM}
  Карта: {name или «не записана»} ({card})
  ```
  Третья строка есть, только если известны имя или карта; « ({card})» — только при наличии номера.
- Получатели: активные профили с ролями `NOTIFY_ROLES`, плюс `employee`, если `app_settings.skud_notify.alarms_to_employees = true`.

#### 3.9 Отправка в ВК `vk_send()` (`alerts.py:44-60`)

- Нужен секрет `VK_GROUP_TOKEN`; без него или без получателей — 0.
- Получатели: `DISTINCT vk_user_id` из `vk_bindings` (`status='confirmed'`) по `profile_id`.
- `POST https://api.vk.com/method/messages.send`, `v=5.199`, `random_id` — случайный, текст обрезается до 3500 символов, таймаут 5 с на сообщение, ошибки молча пропускаются.
- Ключ в `skud_vk_sent` вставляется **до** отправки, поэтому при сбое VK повторной попытки не будет.

### 4. visits.py — движок посещений

#### 4.1 Сущности

| Сущность | Таблица | Смысл |
|---|---|---|
| Открытие (opening) | `skud_openings` | от первого срабатывания (ключ, кнопка, сайт, взлом) до закрытия двери; повторные срабатывания до закрытия продлевают его. Поля: `visit_id, controller_id, status (open/closed), opened_at, last_open_at, closed_at, closed_assumed, held, marks (JSON)` |
| Посещение (visit) | `skud_visits` | цикл «вошли по ключу → все вышли». Поля: `status, started_at, ended_at, inside (счёт людей), entries, exits, alarm, note, inside_until (докуда нарезано видео внутренней камеры), people (JSON-список имён)` |
| Отрывок (clip) | `skud_clips` | задание на видео: `visit_id, opening_id, camera_id, mode (door/inside), clip_from, clip_to` + статусы из `recorder.py` |
| Метка (mark) | внутри `marks` | `{t, kind, name}`; у `exit_button` ещё `inside` (список людей) и `count` |

#### 4.2 Константы (`visits.py:19-25`)

| Константа | Значение | Смысл |
|---|---|---|
| `OPEN_KINDS` | `entry, exit, exit_button, remote_open, forced` | события, открывающие дверь |
| `REJOIN_WINDOW` | 30 мин | окно «дописать к прошлому посещению» |
| `SENSOR_WAIT` | 10 мин | ожидание события «Дверь закрыта», если датчик есть |
| `STALE_VISIT` | 12 ч | автозакрытие забытого посещения |
| `PART` | 10 мин | максимальная длина одного отрывка |
| `READY_DELAY` | 20 с | задержка выдачи задания после `clip_to` |
| `INSIDE_NAMES` | `склад-вн`, `складвн` | имя внутренней камеры по умолчанию |

Параметры контроллера (`load_controller`, `visits.py:259-274`): `door_cam = camera_id`; `inside_cam = inside_camera_id`, а если не задан — камера с именем «Склад-ВН» (без пробелов, без учёта регистра); `open_seconds` (по умолчанию 3); `pre`/`post` (по умолчанию 10 с); `sensor` = было ли **хоть одно** событие `door_closed` у контроллера за всё время; текущее открытое открытие и открытое посещение (последние по `id`).

В движке: `pre`, `post`, `lock = open_seconds + 2 с` (`visits.py:31-33`).

#### 4.3 `process()` (`visits.py:284-307`)

1. Загружает контроллер; до 500 необработанных событий (`NOT processed`) по `event_time, id` с именем (`profiles.full_name` или `person_name`) и картой.
2. Нет событий, открытия и посещения — выход.
3. `Engine.load()` восстанавливает открытое открытие и посещение (и посещение открытия, если оно другое).
4. `apply()` для каждого события, затем `tick(now)`, `save()`.
5. События помечаются `processed = true`.

Вызывается из `bridge_push`, `open_door`, `emergency`, `visits` (для всех контроллеров) и `rec_poll`. Блокировок нет: параллельные вызовы для одного контроллера могут обработать одни и те же события дважды.

#### 4.4 `apply()` по типам событий (`visits.py:150-211`)

Сначала: если есть открытое открытие и его срок (`_deadline` = `last + SENSOR_WAIT` при наличии датчика, иначе `last + lock`) уже прошёл к моменту события — открытие закрывается «предположительно» (`assumed`) в `last + lock`.

Для `OPEN_KINDS` текущее посещение `v` = открытое посещение, если есть.

- **`entry`**: нет посещения — новое (`_new_visit`); `inside += 1`, `entries += 1`; в `people` добавляется имя, иначе «карта NNN», иначе «без имени» (без повторов).
- **`exit`**: нет открытого посещения — `_rejoin_or_new`; имя удаляется из `people`; `inside = max(inside − 1, 0)`, `exits += 1`.
- **`exit_button`**: как `exit`, но имя неизвестно; в метку пишутся `inside` (копия `people`) и `count` (= `inside` до вычитания). В `event_notes` записывается текст для события:
  - «На складе были: {имена через запятую}» или «На складе по картам никого не было»;
  - если `inside > len(people)` — дописывается « (по счёту внутри {inside} чел.)».
- **`remote_open`, `forced`**: нет посещения — новое; у `forced` `alarm = true`.
- Затем для всех `OPEN_KINDS`: если открытое открытие относится к этому же посещению — метка добавляется, `last` продлевается; иначе прежнее открытие закрывается (`assumed`) в момент `t` и создаётся новое (`opened_at = last = t`). После этого `_inside_parts(v, t, False)` — нарезка внутреннего видео.
- **`held_open`** (при открытом открытии): метка, `held = true`, `last` продлевается, посещению `alarm = true`.
- **`door_closed`** (при открытом открытии): закрытие с `assumed = false` в `max(t, last)`.
- **`denied`, `denied_blocked`** (при открытом посещении): в `note` дописывается «Отказ: {имя | карта | «карта»}»; у `denied_blocked` — `alarm = true`. Без открытого посещения отказы в посещения не попадают.
- `door_closed`/`held_open` без открытия, `power`, `other` — игнорируются.

#### 4.5 Закрытие открытия и посещения

`_close_opening(op, at, assumed)` (`visits.py:127-135`): `status = closed`, `closed_at`, `assumed`; если есть дверная камера — `_door_clip(op, opened_at − pre, at + post)`; если посещение открыто и `inside <= 0` — посещение закрывается в `at`. Т. е. посещение заканчивается закрытием двери после того, как счёт людей стал 0.

`_close_visit(v, at, note)` (`visits.py:101-107`): `status = closed`, `ended_at = at`, заметка дописывается через «; », `_inside_parts(v, at + post, final=True)` — хвост внутреннего видео.

#### 4.6 Окно повторного присоединения (`_rejoin_or_new`, `visits.py:80-99`)

Для выхода (`exit`/`exit_button`) при отсутствии открытого посещения:

1. Ищется закрытое посещение, закончившееся не раньше чем за 30 минут до события (сначала среди загруженных в память, затем в БД — последнее по `ended_at`).
2. Нет — создаётся новое посещение с заметкой «Выход по кнопке без входа по ключу» (заметка ставится и для `exit` по карте).
3. Найдено — посещение снова открывается (`status = open`, `ended_at = NULL`). Хвостовые отрывки внутренней камеры, созданные в этой же обработке (ещё не сохранены), отменяются, а `inside_until` откатывается к их началу. Если хвост уже был сохранён в прошлом вызове — он остаётся, и видео внутри может перекрываться.

Сценарий: двое вошли по одной карте, счёт дошёл до 0 после первого выхода, второй выходит кнопкой — его выход приписывается тому же посещению.

#### 4.7 Зависшие посещения (`tick`, `visits.py:213-225`)

- Просроченное открытие закрывается (`assumed`) в `last + lock`.
- Открытое посещение: `last` = максимум `last` его открытий в памяти, иначе `max(last_open_at)` из БД, иначе `started_at`. Если `now − last > 12 ч` и нет открытого открытия — посещение закрывается в `last + lock` с заметкой «Выход не отмечен — посещение закрыто автоматически». Иначе — дорезка внутреннего видео до `now`.

#### 4.8 Видеоотрывки

**Дверная камера (`mode = 'door'`)**, `_door_clip` (`visits.py:137-148`): интервал `[opened_at − pre, closed_at + post]` на каждое открытие. Если предыдущий дверной отрывок того же посещения (только в рамках текущей обработки — `last_door_clip` в памяти) перекрывается с новым и общая длина не превышает 10 минут — он продлевается. Иначе интервал режется на куски по 10 минут.

**Внутренняя камера (`mode = 'inside'`)**, `_inside_parts` (`visits.py:109-121`): пишется всё посещение. Начало — `inside_until = started_at − pre` при создании посещения (если внутренняя камера есть). Пока посещение открыто, при каждом событии и `tick` нарезаются только полные 10-минутные куски; при закрытии (`final`) — оставшийся хвост до `ended_at + post` (помечается `tail`). `inside_until` сдвигается на конец последнего куска.

Отрывок дверной камеры получает `opening_id`, внутренней — `NULL`.

#### 4.9 Запись `save()` (`visits.py:228-256`)

1. `UPDATE skud_visits` для изменённых посещений (включая `people` JSON).
2. Заметки `exit_button`: если `note` пустая или равна «Нажата кнопка выхода» — заменяется, иначе дописывается через « · ».
3. Открытия: новые — `INSERT ... RETURNING id`, изменённые — `UPDATE`.
4. Все отрывки — одним `INSERT` (многострочный `VALUES`). Отрывки не сохраняются в памяти между вызовами, поэтому дублирование исключается только логикой `inside_until` и тем, что открытие закрывается один раз.

### 5. recorder.py — жизненный цикл видеоотрывков

#### 5.1 Константы (`recorder.py:11-17`)

| Константа | Значение | Смысл |
|---|---|---|
| `STUCK` | 10 мин | задание в `taken` дольше — возвращается в `pending` |
| `MAX_ATTEMPTS` | 6 | после стольких выдач — `failed` |
| `KEEP_HOURS` | 720 | сколько часов хранить запись на ПК (передаётся регистратору) |
| `PENDING_HOURS` | 24 | отрывок с `clip_to` старше — `failed` |
| `PC_MAX_GB` | 15 | предел записи на диске ПК |
| `SITE_MAX_BYTES` | 6 ГиБ | предел готовых отрывков на сайте |
| `PART_BYTES` | 1 МиБ | размер куска загрузки (до base64) |

#### 5.2 Статусы `skud_clips`

```
pending ──rec_poll (clip_to ≤ now−20с)──▶ taken ──rec_done ok──▶ done ──(>6 ГБ)──▶ deleted
   ▲                                       │
   ├──── taken > 10 мин и attempts < 6 ────┤
   ├──── rec_done wait (attempts−1) ───────┤
   ├──── rec_done error (не missing) ──────┤
   ├──── rec_done: файла нет в S3 ─────────┤
   │                                       └──rec_done error+missing──▶ missing
   └── attempts ≥ 6 или clip_to < now−24ч ──▶ failed
clip_retry: failed/missing ──▶ pending (attempts = 0, error = NULL)
```

- `pending` — создан движком (статус по умолчанию в БД), ждёт выдачи.
- `taken` — выдан регистратору: `taken_at = now()`, `attempts + 1`.
- `done` — `url` (CDN), `size_bytes`, `duration_sec`, `done_at`.
- `missing` — на ПК нет записи за этот интервал (камера не писалась, запись удалена, камера недоступна).
- `failed` — исчерпаны попытки или прошли сутки.
- `deleted` — удалён при чистке сайта, `url = NULL`, ошибка «Видео удалено: на сайте храним не больше 6 ГБ».

Попытки: каждая выдача `+1`; ответ `wait` (последний кусок ещё пишется) возвращает попытку. Ошибка ffmpeg или загрузки возвращает задание в `pending` без возврата попытки, после 6 выдач — `failed`.

#### 5.3 Ключи S3 и URL

- Бакет `files`, endpoint `https://bucket.poehali.dev`, ключи доступа — `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (`recorder.py:20-23`).
- Ключ задания: `skud/YYYY-MM/<uuid4 hex>.mp4` (месяц `clip_from` по MSK), создаётся при выдаче (`recorder.py:101`). При повторной выдаче — новый ключ; части старой неудачной загрузки не удаляются.
- Части: `{key}.part0000`, `.part0001`, … (`recorder.py:145`); после склейки удаляются.
- Публичный URL: `https://cdn.poehali.dev/projects/{AWS_ACCESS_KEY_ID}/bucket/{key}` (`recorder.py:26-27`).
- `finish_parts` (`recorder.py:150-156`) склеивает все части **в памяти функции** и пишет один объект — для 10-минутного HD-отрывка это может быть десятки-сотни МБ.

#### 5.4 Задержка готовности

Задание выдаётся только когда `clip_to <= now − READY_DELAY (20 с)` (`recorder.py:98`), и не более 3 за опрос. Регистратор дополнительно ждёт, пока ffmpeg закроет последний минутный кусок (иначе `rec_done wait`). На практике отрывок появляется через ~1–1,5 минуты после `clip_to` (запись режется по минутам на границе минуты).

#### 5.5 Чистка сайта (`site_cleanup`, `recorder.py:114-135`)

После каждого успешного `rec_done`: если сумма `size_bytes` готовых отрывков > 6 ГиБ — берутся до 200 самых старых по `clip_from`, файлы удаляются из S3 (если URL с нашим CDN-префиксом), статус `deleted`, пока сумма не станет ≤ 6 ГиБ.

### 6. Мост GateBridge.cs и регистратор SkudRecorder / AbizRecorder

Исходники — из архива `public/downloads/AbizShell-v22.zip`. Все компоненты обращаются к `skud-api` по адресу `https://functions.poehali.dev/150e30dd-bd2d-45c5-8db8-a4055bf55fd9` (`GateBridge.cs:32`, `SkudRecorder.cs:32`, `RecorderService.cs:19`) с заголовком `X-Authorization: <токен ПК или ключ rec_…>` (без `Bearer`). `X-Skud-Key` (действия `bridge_*`) в этой версии клиента **не используется** — мост работает через `rec_gate_*`.

#### 6.1 Кто запускает мост и регистратор

- `RecorderService.Start(apiToken)` (`RecorderService.cs:40-54`): если в реестре есть служба `HKLM\SYSTEM\CurrentControlSet\Services\AbizRecorder` — программа АБИЗ останавливает свои `SkudRecorder`/`GateBridge` и один раз передаёт службе ключ: `rec_key` (до 20 попыток через 30 с; при 401 — прекращает), ключ пишется в `C:\ProgramData\AnodBiz\recorder\key`. Если службы нет — АБИЗ сама запускает `SkudRecorder.EnsureStarted` и `GateBridge.EnsureStarted` с токеном ПК.
- Служба `AbizRecorder` (`AbizRecorder/Program.cs`): Windows-служба (`UseWindowsService`), `StatusPrefix = "служба · "`. Раз в 30 с читает файл ключа; ключ принимается, только если начинается с `rec_`; при смене ключа перезапускает регистратор и мост. `PrepareDir()` даёт группе `BUILTIN\Users` право `Modify` на папку `recorder` (наследуемое), чтобы АБИЗ с обычными правами могла записать ключ.
- Оба класса — одиночки (`_instance`), перезапускаются при смене токена.

#### 6.2 GateBridge: основной цикл (`GateBridge.cs:90-206`)

Каждую итерацию:

1. `rec_gate_poll` с `status` (префикс + текущее состояние), `connected`, `want_cards` (при подключении: если нужен полный список или прошло > 6 ч с последней полной записи), `found_host/found_port`, `model`, `fw`.
2. Нет объекта `gate` в ответе → ПК не выбран: соединение закрывается, статус «этот ПК не выбран для контроллера», пауза 60 с.
3. `ApplyConfig` — при смене `host/port/address` соединение пересоздаётся. Поле `open_tenths` из ответа **не используется**.
4. Не подключён → `ConnectAsync`; пауза 1 с при успехе, 30 с при неудаче.
5. Подключён:
   - выполнить команды (`RunCommand`), собрать `done`;
   - антипассбэк — при изменении флага (см. 6.6);
   - `zones` → `WriteZones`; `cards` → `WriteCards`; при `ok` — `cardsSynced`, `wantCards = false`;
   - аварийное открытие — при изменении или каждые 5 минут, пока включено;
   - часы — каждые 6 ч;
   - ежедневно в 4-м часу (не чаще раза в 20 ч) — простая команда `0Ch` (`c.Simple(0x0C)`; назначение в коде не прокомментировано);
   - `rec_gate_ack` с `done` и `cards_synced`, если есть что подтверждать;
   - `ReadEvents` → `rec_gate_push`; при `ok: true` в контроллер пишется новый указатель чтения, пауза 1 с.
6. Паузы: обычная 6 с; `GateException` → статус «контроллер: …», разрыв, 10 с; другое исключение → «ошибка: …», 15 с.

Сеть HTTP: `HttpClient` с таймаутом 30 с; неразбираемый ответ превращается в `{}`.

#### 6.3 Подключение и автопоиск (`GateBridge.cs:222-290`)

- Если на сайте задан IP — пробуется только он. Иначе не чаще раза в 5 минут — сканирование: все IPv4-интерфейсы в состоянии Up (кроме loopback), сеть `/24`, не больше 4 сетей, 254 адреса параллельно, TCP-подключение к порту **5000** с таймаутом 400 мс. Найденные адреса проверяются запросом версии.
- Удачный кандидат: `ReadVersion()`, сброс флагов «применено» для аварийного режима и антипассбэка, установка часов. Найденный адрес отправляется на сайт (`found_host`), сервер сохраняет его, если `gate_host` пуст.
- Статусы ошибок: «контроллер не найден в сети — укажите его IP на сайте (СКУД → Контроллер)», «нет связи с {host}:{port}».
- TCP: `NoDelay`, таймауты приёма/передачи 1,5 с, подключение — 3 с (`GateClient.Open`, `GateBridge.cs:652-658`).

#### 6.4 Протокол GATE: кадры (`GateClient`, `GateBridge.cs:631-780`)

**Запрос**: `FA` + экранированный `[01, addr, body…, crc]` + `F5`, где `crc` = XOR байтов `body` (без `01` и `addr`).

Экранирование: `FA → FF 01`, `F5 → FF 02`, `FF → FF 03`.

**Ответ**: `7F 00 01 addr data… crc`; проверка `resp[0] == 7F`, `resp[2] == 01`, длина ≥ 6; `crc` = XOR `resp[2..n−2]`. Полезные данные `data = resp[4..n−2]`:

- `55 55 <cmd>` — ACK, возвращается пустой массив;
- `55 AA <cmd>` — занят: пауза 100 мс и повтор;
- `<cmd> …` — данные (без кода команды);
- иное — `GateException("ошибка памяти контроллера")`.

Перед отправкой входной буфер очищается. До 3 попыток (неверный кадр, CRC или `IOException`), затем «контроллер не отвечает». Ожидание кадра — 1,5 с.

**Команды**:

| Байты тела | Метод | Назначение |
|---|---|---|
| `09` | `ReadVersion` | версия: `d[0] >> 4` — модель (8 → Gate-8000, 4 → Gate-4000, 1 → Gate-1000), прошивка `"{d0}{d1}/{d3:000}"` |
| `04 bus type count addrHi addrLo` | `Read` | чтение памяти (длина ответа должна совпасть с `count`) |
| `05 bus type len addrHi addrLo data…` | `Write` | запись памяти |
| `07 door` | `OpenDoor` | открыть дверь (используется `door = 0`) |
| `0E ctl sec` | `Request2` | управление выходом |
| `66 73` / `66 00` | `SetNetworkMode` | включить/выключить сетевой режим (на время записи ключей) |
| `0C` | `Simple` | вызывается раз в сутки около 4:00 |

Размеры памяти: Gate-8000 — буфер событий `0xFFF8` (прошивка ≥ 84h) или `0x10000`, конец области ключей `0xFFF8`; остальные модели — `0x8000` и `0x8000`.

#### 6.5 Карта памяти (как используется в коде)

| bus | type | Адрес | Размер | Что |
|---|---|---|---|---|
| 00 | D0 | `0000` | 8 | часы: сек, мин, час (BCD), день недели (1..7, Вс = 7), день, месяц, год (BCD), `0x10` |
| 00 | D0 | `0008` | 4 | указатели журнала: верхний (запись) и нижний (чтение) |
| 00 | D0 | `000A` | 2 | нижний указатель (подтверждение прочитанных событий) |
| 00 | D0 | `000C` | 6 | код последнего поднесённого ключа |
| 00 | D0 | `0015` | 1 | аварийное открытие: `73` — вкл., `00` — выкл. |
| 00 | D0 | `0016` | 1 | антипассбэк: `16` — вкл., `00` — выкл. |
| 00/01 | A0 | `0000` | 1 | время открытия замка, десятые доли секунды (банк 0 и 1) |
| 00/01 | A0 | `0001` | 1 | параметр, который выставляется в 50, если равен 0 при включении антипассбэка (в коде не подписан) |
| 00/01 | A0 | `0078` | 56 | 7 временных зон по 8 байт |
| 00/01 | A0 | `00BE` | 2 | конец списка ключей |
| 00/01 | A0 | `00C0…` | 8×N | блоки ключей |
| 02 | A0 | `0000…` | буфер | журнал событий, записи по 8 байт |

#### 6.6 Команды с сайта (`RunCommand`, `GateBridge.cs:294-335`)

| operation | Действие | Результат |
|---|---|---|
| `open_door` | `07 00` | `ok` |
| `set_open_time` | `payload.seconds` (по умолчанию 3) × 10, ограничено 1..255 → A0:0000 в банки 0 и 1 | `ok` |
| `output` | `ctl = (mode == off ? 0 : 0x10) | 0x08 | (addr & 7)`; второй байт — секунды (1..255) для `pulse`, иначе 0; команда `0E` | `ok` |
| `sync_clock` | `SetClock` | `ok` |
| `gate_info` | `ReadVersion` | `ok: {Model} {Firmware}` |
| другое | — | `неизвестная команда` |

Ошибка протокола — результат `ошибка: …`. Для `output` режим `on` и `pulse` отличаются только вторым байтом (0 при `on` — бит «время в секундах» всё равно выставлен).

**Антипассбэк** (`GateBridge.cs:139-151`): при изменении флага — запись D0:0016 (`16`/`00`); при включении, если A0:0001 банка 0 равен 0 — в банки 0 и 1 пишется 50. Затем `wantCards = true` — карты перезаписываются с битом 7.

**Аварийное открытие** (`GateBridge.cs:161-167`): D0:0015 = `73`/`00` при изменении; включённый режим повторяется каждые 5 минут.

**Часы** (`SetClock`, `GateBridge.cs:337-347`): местное время ПК в BCD, при подключении, каждые 6 ч и по команде.

#### 6.7 Временные зоны (`WriteZones`, `GateBridge.cs:351-367`)

56 байт (7 × 8), блок зоны `idx` (0..6): байт 0 — маска дней (`& 0x7F`), 1–2 — «с» (час, минута BCD), 3–4 — «до» (час, минута BCD), 5–7 — нули. Пишется в A0:0078 банков 0 и 1.

#### 6.8 Запись карт (`WriteCards`, `KeyBlock`, `GateBridge.cs:408-488`)

1. Из списка берутся номера вида `ddd,ddddd` без повторов, с метаданными `pin`, `mask` (по умолчанию `0x80`), `guest`.
2. Пустой список → статус «карты: на сайте нет активных карт — карты в контроллере не трогаю», подтверждения нет (чтобы случайно не закрыть дверь для всех).
3. Ёмкость = `(KeyAreaEnd − 0xC0) / 8` (4064 для Gate-4000); лишние карты отбрасываются молча.
4. Блок ключа 8 байт:
   - байты 0–5 — код: если карта есть в `learned.json` (сырой 6-байтовый код, снятый с контроллера) — он; иначе `b[3] = серия`, `b[4..5] = номер` (big-endian), `b[0..2] = 0`;
   - при PIN из 6 цифр — `b[0..2]` = PIN в BCD (перезаписывает начало кода), флаг `0x02` («карта с кодом»);
   - байт 6 — флаги: `0x02` PIN, `0x08` гость, `0x80` антипассбэк;
   - байт 7 — маска расписаний (`0` → `0x80`, «всегда»).
5. Включается сетевой режим. Для банков 0 и 1: читается прежний конец A0:00BE; данные пишутся кусками по 96 байт с адреса `0xC0` (после каждого куска повторно включается сетевой режим); хвост прежнего списка заполняется `0x55`; пишется новый конец списка. В `finally` сетевой режим выключается.
6. Список сохраняется в `C:\ProgramData\AnodBiz\gate\written.json` — по нему мост определяет номер карты по адресу ключа в событиях.
7. Результат `ok: записано карт N`.

#### 6.9 Чтение событий (`ReadEvents`, `GateBridge.cs:523-609`)

1. Указатели D0:0008: `upper`, `lower`. Равны — событий нет.
2. Чтение из bus 02 / A0 с `lower` до `upper` кусками до 96 байт (кратно 8), с переходом через конец кольцевого буфера; не больше 240 записей за цикл.
3. Если в пачке есть «карта не найдена» (`(code & 7E) == 02`) — читается D0:000C (код последнего ключа): номер `ddd,ddddd` из байтов 3–5, сырой код запоминается в `learned.json`. Этот номер присваивается только **последнему** такому событию пачки — именно он попадает на сайт и захватывается окном «поднесите карту».
4. Разбор записи (8 байт): `code = e[0] & 0x7F`, дверь = `code & 1`, базовый код = `code` для 12h/13h/14h, иначе `code & 7E`. Время: `e[3..7]` = месяц, день, час, минута, секунда (BCD); год — текущий, или прошлый, если месяц > текущий + 1; ошибка даты → текущее время ПК. Время передаётся строкой с поясом ПК (`yyyy-MM-dd HH:mm:sszzz`).
5. Карта для кодов 04, 06, 0A, 1A, 38, 20, 24, 26: адрес ключа = `e[1..2]` (для Gate-8000 полностью, для остальных — без старшего бита `e[1]`), индекс `(addr − 0xC0) / 8` в `written.json`.
6. Событие: `{time, code: "XX", kind, card, granted (entry/exit/exit_button), note, raw (hex)}`.
7. После успешного `rec_gate_push` в D0:000A пишется новый `lower`.

**Таблица кодов → kind** (`GateBridge.cs:495-521`):

| Код | kind | Заметка |
|---|---|---|
| 00 | `exit_button` | Нажата кнопка выхода |
| 02 | `denied` | Карта не найдена в контроллере |
| 04 | `entry` (дверь 1 → `exit`) | Проход по карте |
| 06 | `denied` | Доступ запрещён по расписанию |
| 08 | пропуск | Открыто оператором |
| 0A | `denied` | Дверь заблокирована |
| 0C | `forced` | Дверь взломана |
| 0E | `held_open` | Дверь оставлена открытой |
| 10 | пропуск | Проход состоялся |
| 12 | `other` | Сработал датчик 1 |
| 13 | `other` | Сработал датчик 2 |
| 14 | `power` | Перезагрузка контроллера |
| 16 | `other` | Залипание кнопки открывания |
| 1A | `denied` | Запрет повторного прохода |
| 20 | `denied` | Введён неверный код |
| 22 | пропуск | Код подтверждён |
| 24 | `denied` | Неверная карта подтверждения |
| 26 | `denied` | Не введён код (истекло время) |
| 28 | `other` | Проход не был совершён |
| 2A | `door_closed` | Дверь закрыта |
| 34 | `other` | Неисправность считывателя (DATA0) |
| 36 | `other` | Неисправность считывателя (DATA1) |
| 38 | `entry` (дверь 1 → `exit`) | Проход по гостевой карте |
| 3A | пропуск | Ожидание кода |
| прочие | `other` | Событие контроллера XXh |

Пропущенные коды не отправляются на сайт, но указатель через них сдвигается.

#### 6.10 SkudRecorder: непрерывная запись (`SkudRecorder.cs`)

- **Цикл** (`SkudRecorder.cs:94-159`): `rec_poll` с `status`. Ошибка сервера (`error` без `recorder`) → пауза 60 с; `recorder: false` → все записи останавливаются, «не выбран для записи», 60 с. Иначе применяются `keep_hours`, `max_disk_gb`, `part_bytes`; нет ffmpeg — скачивается в фоне (опрос через 5 с, после неудачи — 60 с); затем `SyncCameras`, `CleanupOld`, обработка заданий по одному; пауза 10 с, после заданий — 2 с.
- **ffmpeg** (`SkudRecorder.cs:369-461`): ищется `ffmpeg.exe` рядом с программой, затем `C:\ProgramData\AnodBiz\ffmpeg\ffmpeg.exe` (> 1 МБ). Иначе скачиваются 37 частей `…/skud/tools/ffmpeg-9.0.2.zip.partNNNN` с CDN (4 параллельно, до 5 попыток с нарастающей паузой), проверяется SHA-256 `348378…6c641`; при неудаче — запасной архив `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip` **без проверки хэша**. Прогресс («скачивается ffmpeg: N%») уходит на сайт. После нахождения ffmpeg — `KillOrphans` убивает процессы `ffmpeg` с тем же путём (остатки после аварийного выхода).
- **Камеры** (`SyncCameras`, `SkudRecorder.cs:169-198`): для каждой камеры из `cameras` — свой `CameraRecording` в `C:\ProgramData\AnodBiz\SkudVideo\<camera_id>\`; при смене качества — перезапуск; лишние останавливаются.
- **Запись одной камеры** (`CameraRecording.RunAsync`, `SkudRecorder.cs:595-639`): ссылка на живой поток — `POST` к `cameras`-функции (`https://functions.poehali.dev/246cb9d5-…`) с `{action: "live", id, quality, fresh}` и тем же `X-Authorization` (2 попытки); нет ссылки — пауза 15 с и `fresh = true`. ffmpeg: `-i <url> -map 0:v:0 -map 0:a:0? -c copy -f segment -segment_time 60 -segment_atclocktime 1 -reset_timestamps 1 -strftime 1 seg_%Y%m%dT%H%M%S.ts` — без перекодирования, куски по минуте на границе минуты, имя — местное время ПК. Если процесс прожил < 2 мин — следующая ссылка запрашивается «свежей», пауза 5 с, иначе 1 с.
- **Время куска** (`SegmentTime`, `SkudRecorder.cs:349-355`): из имени файла (местное → UTC) минус `StreamDelay = 4 с` (задержка облачного потока).
- **Исправность**: процесс жив и есть `.ts`, изменённый за последние 30 с. Статус: «{камера}: пишет | переподключение; … · на диске X,X из N ГБ».

#### 6.11 Хранение на ПК (`CleanupOld`, `SkudRecorder.cs:204-238`)

- Куски `.ts` сортируются по времени. Удаляются старейшие, пока суммарный объём > `max_disk_gb` (15 ГБ с сервера) **или** свободного места на диске < 2 ГБ, а также все старше `keep_hours` (с сервера 720 ч = 30 дней; по умолчанию в клиенте 72 ч). Куски моложе 3 минут не удаляются никогда.
- Временные `clip_*.mp4` старше часа удаляются.
- Комментарий в шапке класса говорит «хранит последние 3 часа» — устарел: фактически хранение ограничено 15 ГБ / 30 днями.

#### 6.12 Вырезка, перекодирование и загрузка (`HandleJobAsync`, `SkudRecorder.cs:244-331`)

1. Выбираются куски камеры, пересекающие `[from, to]` (кусок считается длиной 60 + 5 с).
2. Последний нужный кусок ещё пишется (его начало + 60 с > сейчас − 3 с) → `rec_done {wait: true}`.
3. Кусков нет → `rec_done {error, missing: true}` с причиной: «Камера не записывалась на ПК (не выбрана или недоступна)» / «Запись уже удалена с ПК (на диске храним не больше 15 ГБ)» / «Нет записи за это время — камера была недоступна».
4. Список для concat → ffmpeg: `-f concat -safe 0 -i list -ss <offset> -t <duration> -map 0:v:0 -map 0:a:0? -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart clip_<id>.mp4` (таймаут 8 минут). При ошибке или файле < 1 КБ — повтор без звука (`-an`). Не получилось → `rec_done {error: "Не удалось вырезать отрывок: …"}` (задание вернётся в `pending`).
5. Загрузка: файл читается целиком, режется по `part_bytes` (1 МиБ), каждый кусок — `rec_part` в base64 (до 3 попыток с паузой 1,5 с). Неудача → `rec_done {error: "Не удалось загрузить отрывок на сайт"}`.
6. Успех → `rec_done {id, key, parts, duration}` (секунды, округление).
7. Временные файлы удаляются в `finally`.

Прямая загрузка в S3 (ветка `head_object` в `recorder.done`) этим клиентом не используется — только части.

### Замечания по безопасности и ограничения

#### Безопасность

1. **Ключ службы «только видео» на деле управляет дверью.** `device_by_token` принимает ключ `rec_…` для всех `rec_*`, включая `rec_gate_*` (`index.py:575-585`), а `_gate` передаёт их в `_bridge` (`index.py:220`). С этим ключом можно получить все активные карты с **PIN-кодами** (`bridge_poll`, `index.py:186-188`, `160`), отправить поддельные события с любым `person` и временем (`index.py:124-125`, `171`), подтвердить чужие команды и пометить карты синхронизированными. Это противоречит комментариям `recorder.py:40`, `recorder.py:55` и `AbizRecorder/Program.cs:16-17`.
2. **Ключ доступен любому локальному пользователю ПК.** Служба даёт `BUILTIN\Users` право `Modify` на `C:\ProgramData\AnodBiz\recorder` с наследованием (`AbizRecorder/Program.cs:74-81`), значит файл `key` можно прочитать или подменить без прав администратора. Ключ бессрочный, отзывается только вручную (`recorder.py:56-63`).
3. **PIN-коды хранятся открытым текстом** (`index.py:412`) и в открытом виде уходят на ПК (`index.py:160`).
4. **Загрузка видео не привязана к заданию.** `rec_part` пишет любой ключ с префиксом `skud/` (`recorder.py:141-146`), `rec_done` принимает любой `id` и любой `key` (`recorder.py:159-182`) — привязанный ПК может перезаписать чужие отрывки или подставить к отрывку другой файл. Проверка `'..'` есть, но владелец задания не сверяется.
5. **`finish_parts` склеивает весь файл в памяти функции** (`recorder.py:152`): для длинного HD-отрывка возможен выход за лимит памяти и таймаут; при повторной выдаче части прошлой загрузки остаются в S3 (у задания новый ключ, `recorder.py:101`).
6. **Старший сотрудник может перепривязать любую карту** к любому профилю, сменить номер и продлить срок (`card_save`, `card_rewrite` в `CARD_ACTIONS`, `index.py:23`, `385-402`, `415-417`). PIN и расписание ему недоступны (`index.py:385-392`), но владельца карты, тип (`guest`/`employee`) и `valid_to` гостевой карты он менять может.
7. **CORS `*`** (`index.py:16`) вместе с токенами в `X-Authorization`: защита держится только на секретности токена.
8. **Запасной ffmpeg скачивается без проверки хэша** (`SkudRecorder.cs:431-439`) — в отличие от основного источника (`SkudRecorder.cs:417-421`); исполняемый файл запускается службой Windows.
9. **Ключ тревог вставляется до отправки в ВК** (`alerts.py:86`, `150`, `155`): при сбое VK сообщение не будет повторено.

#### Корректность данных

10. **Дедупликация событий не работает для событий без карты.** `ON CONFLICT (controller_id, event_time, event_code, card_number)` (`index.py:133`): `card_number = NULL` у кнопки выхода, взлома, «дверь не закрыта» и т. п., а в уникальном индексе PostgreSQL `NULL` не равны. Если `rec_gate_push` сохранил события, но ответ не дошёл до моста, указатель в контроллере не сдвигается (`GateBridge.cs:181-185`) и те же события придут ещё раз — дубли, лишние посещения и повторные тревоги (тревоги частично спасает поминутный ключ, `alerts.py:85`).
11. **Неразобранное время подменяется текущим** (`index.py:100`); год события мост угадывает по месяцу (`GateBridge.cs:582`), а при неверной дате тоже ставит текущее время (`GateBridge.cs:585`).
12. **Гонка синхронизации карт.** `bridge_ack` с `cards_synced` ставит `synced = true` всем несинхронизированным картам (`index.py:194-195`), включая изменённые после `bridge_poll`, — такие изменения не попадут в контроллер до следующей полной выгрузки (мост просит её не реже раза в 6 ч, `GateBridge.cs:105`). Флаг `synced` общий для всех контроллеров.
13. **Команды помечаются отправленными до выполнения** (`index.py:181-182`): если мост упал между `poll` и выполнением, команда потеряна (`done_at` пуст навсегда).
14. **`open_door` пишет событие «Открыта с сайта» до открытия** (`index.py:473-477`); при недоступном мосте команда через 60 с отменяется (`index.py:175-177`), а событие и посещение остаются.
15. **Нет блокировок движка посещений.** `process()` вызывается из `bridge_push`, `rec_poll`, `visits`, `open_door`, `emergency` (`index.py:172`, `357`, `477`, `536`; `recorder.py:77`) без `SELECT … FOR UPDATE` и при `autocommit` — одновременные вызовы могут обработать одни и те же события дважды (два открытия, два набора отрывков).
16. **Признак датчика двери** — `EXISTS` по всей истории событий на каждом вызове (`visits.py:263`): одно случайное `door_closed` навсегда переключает ожидание закрытия на 10 минут (`visits.py:125`). Запрос дорожает с ростом журнала; аналогично подзапрос `last_used` на каждую карту в `_cards` (`index.py:317`).
17. **Номер отказной карты** присваивается только последнему событию «карта не найдена» в пачке (`GateBridge.cs:548-595`): при нескольких отказах за цикл остальные придут без номера.
18. **Лишние карты молча отбрасываются** при превышении ёмкости (`GateBridge.cs:423-424`); на сайте об этом не сообщается (`ok: записано карт N`).
19. **Ежедневная обработка не имеет планировщика** (`alerts.py:166-169`): запускается первым запросом `notices` или `rec_gate_*` за сутки. Удаление карт и напоминания зависят от того, что кто-то зашёл на сайт или работает мост.
20. **Директор не получает уведомления о сроках чужих карт** ни на сайте, ни в ВК: его нет в `EXPIRY_ROLES` (`alerts.py:22`, `125`, `151`, `157`).
21. **`norm_card` неоднозначна**: 6–10 цифр всегда трактуются как десятичное число (`index.py:48-50`), HEX без букв разобран как HEX не будет.
22. **`controller_save` при создании не сохраняет `gate_host/gate_port/gate_address`** (`index.py:464-467`) и не проверяет существование `id` при изменении (`index.py:454-462`); расписание через полночь невозможно (`index.py:483`).
23. **Комментарий о хранении «3 часа» устарел** (`SkudRecorder.cs:22`): фактически сервер задаёт 720 ч и 15 ГБ (`recorder.py:13-15`), клиент по умолчанию — 72 ч (`SkudRecorder.cs:53`).
24. **Тесты** (`tests.json`) проверяют только коды 200/405/401 без входа — бизнес-логика не покрыта.

#### Ограничения оборудования: Gate-4000-Ethernet — один считыватель и одно реле

Контроллер по умолчанию — `Gate-4000-Ethernet` (`index.py:466`). У него один считыватель (на вход) и одно реле замка, поэтому часть функций в коде на нём не работает:

- **Антипассбэк бесполезен.** Запрет повторного прохода требует считывателей на вход и на выход. Мост пишет режим в D0:0016 и бит `0x80` в каждый ключ (`GateBridge.cs:139-151`, `484`), а сайт позволяет его включить (`index.py:510-512`). Но с одним считывателем выход по карте не регистрируется: после первого входа контроллер может начать отказывать той же карте (код 1Ah «Запрет повторного прохода», `GateBridge.cs:510`), пока выход не будет отмечен, — то есть включение может заблокировать сотрудников.
- **Выход по карте не возникает.** `exit` определяется по двери 1 (`GateBridge.cs:575`), а на однодверном Gate-4000 все проходы по карте — `entry`. Выход фиксируется только кнопкой (`exit_button`), поэтому «кто вышел» неизвестен, а движок посещений восстанавливает это по списку вошедших (`visits.py:167-174`). Запись карт во второй банк (`GateBridge.cs:435`) на этой модели ничего не даёт.
- **Дополнительные выходы отсутствуют.** Сайт по умолчанию показывает 5 выходов («Реле 2», «Выход SW0…SW3», `index.py:24-25`) и принимает адреса 1–7 (`index.py:515`, `521`), мост шлёт команду 0Eh с любым адресом (`GateBridge.cs:321-322`). У Gate-4000-Ethernet одно реле (замок), поэтому команды `output` либо игнорируются контроллером, либо (адрес реле замка) открывают дверь, а результат всё равно `ok` — в журнале и посещениях такое открытие не отражается.
- **Время открытия и зоны пишутся в оба банка** (`GateBridge.cs:309-310`, `365-366`) — для однодверного режима второй банк лишний.
- `open_door` всегда открывает дверь 0 (`GateBridge.cs:302`); поле `gate.open_tenths` из ответа сервера мостом не используется (`index.py:222`, `GateBridge.cs:208-220`).

---

# 6. Страницы: Табель, Зарплата, Инкассация, Главная

Документ описывает, как сейчас работает код (состояние репозитория на 18.10.2026). Код не менялся.
Пути указаны от корня проекта `/app/webapp`.

Исходные файлы:

- `src/pages/Schedule.tsx`, `src/lib/scheduleSolver.ts`
- `src/components/EmployeeSettingsModal.tsx`, `EmployeePermanentSettings.tsx`, `EmployeeVariableSettings.tsx`, `EmployeePreferencesAndExclude.tsx`, `RotationSettings.tsx`
- `src/pages/Salary.tsx`, `src/components/salary/SalaryGrid.tsx`, `src/lib/access.tsx` (формулы и права)
- `src/pages/Collection.tsx`
- `src/pages/Dashboard.tsx`, `src/components/dashboard/MonthSlab.tsx`, `src/components/dashboard/StatsRow.tsx`
- `src/lib/sdk.ts`, `backend/data-api/index.py`, `backend/vk-api/index.py`, `src/lib/vkBinding.ts`

---

### 0. Общий слой данных: `db.from(table)` → `data-api`

`src/lib/sdk.ts` даёт объект `db` с интерфейсом «как у Supabase», но каждый запрос — это один `POST` на функцию `data-api` (URL берётся из `backend/func2url.json`).

#### 0.1. Как строится запрос

`db.from('t')` создаёт `QueryBuilder`. Методы цепочки только накапливают параметры, запрос уходит при `await` (метод `then` вызывает `execute`):

| Метод | Что попадает в тело запроса |
|---|---|
| `select(cols)` | ничего: аргумент игнорируется, всегда `SELECT *` |
| `insert(v)` / `upsert(v)` | `op: 'insert'`, `payload: v`. **`upsert` — это обычный insert**, конфликт не обрабатывается |
| `update(v)` | `op: 'update'`, `payload: v` |
| `delete()` | `op: 'delete'` |
| `eq/neq/in/is/gt/gte/lt/lte/ilike` | элемент `filters: [{col, op, value}]` |
| `not(col, op, v)` | фильтр `op: 'not_' + op` |
| `order(col, {ascending})` | `order: {col, ascending}` |
| `limit(n)` | `limit: n` |
| `single()` / `maybeSingle()` | `single_mode: 'single' / 'maybe'` |

Тело запроса: `{ table, op, filters, order?, limit?, single_mode?, payload? }`.
Заголовки: `Content-Type: application/json` и `X-Authorization: <токен из localStorage['anod_session_token']>`.
Ответ — `{data, error}`. При сетевой ошибке возвращается `{data:null, error:{message:'Сетевая ошибка'}}`, исключение не бросается.

#### 0.2. Что делает сервер (`backend/data-api/index.py`)

1. Принимает только `POST` (на `OPTIONS` отвечает CORS-заголовками, `Allow-Origin: *`).
2. Таблица должна входить в белый список `ALLOWED_TABLES` (`index.py:15`): `companies, profiles, pin_codes, schedule_config, employee_schedule_settings, schedule_data, schedule_settings, salary_data, salary_settings, manager_data, manager_settings, employee_rotation, collection_data, documents, folders, base_files, dto_categories, dto_templates, chat_rooms, chat_messages, devices, kiosk_buttons`.
3. Проверка токена (`_authenticate`, `index.py:132`): ищется действующая сессия в `auth_sessions` (не истёкшая) или неотозванный API-токен в `api_tokens`. Без токена — 401.
4. **Ролей, компании и владельца строки сервер не проверяет.** Любой вошедший пользователь может выполнить над любой таблицей из списка любые `select/insert/update/delete`.
5. Особенности операций:
   - `select` — `SELECT * ... WHERE ... ORDER BY ... LIMIT`. Для `profiles` к условию всегда добавляется `id <> 'demo-director-profile'`, для `schedule_config`, `employee_schedule_settings`, `salary_data` — `profile_id IS DISTINCT FROM 'demo-director-profile'`.
   - `single_mode`: если строк нет — `maybe` даёт `data:null` без ошибки, `single` — ошибку `PGRST116`. Если строк несколько, возвращается первая.
   - `insert` — каждая запись вставляется отдельным `INSERT ... RETURNING *`. Если `id` не передан, он генерируется (uuid4). `dict/list` сериализуются в JSON. Всё в одной транзакции.
   - `update` и `delete` без фильтров отклоняются (400). С фильтрами выполняются `... RETURNING *`.
   - Операторы фильтров: `eq` с `null` превращается в `IS NULL`, `neq null` — в `IS NOT NULL`, `in []` — в `FALSE`, `not_eq` — в `(col IS NULL OR col != v)`, `not_is null` — в `IS NOT NULL`.
   - Все прочие ошибки возвращаются с HTTP 200 в виде `{data:null, error:{message}}`.

#### 0.3. Доступ к страницам (общий для всех)

`src/App.tsx:45` — `ProtectedRoute`:
- нет пользователя — переход на `/login`;
- если передан `path` (так у `/schedule`, `/salary`, `/collection`) и `access` уже загружен: при `!canSee(path)` — переход на `/dashboard`;
- `canSee(p)` (`access.tsx`) = `!access || access.is_deputy || access.sections.includes(p)`. Пока `access` не загружен (`null`), страница **показывается всем**.

`access` загружается через `admin-api` (`action: 'my_access'`) и содержит: `role`, `position`, `sections`, `actions`, `is_deputy`, `formulas`, `fields`, `general.shift_hours`.
`can(a)` = `access && (access.is_deputy || access.actions.includes(a))`.

---

### 1. Страница «Табель» (`/schedule`, `src/pages/Schedule.tsx`)

#### 1.1. Назначение

Это график смен на месяц. Тип смены записывается в ячейку сотрудник × день:

| Код | Смысл (по коду и подписям) | Цвет |
|---|---|---|
| `Д` | дневная, старший | зелёный |
| `Н` | ночная, старший | синий |
| `Дп` | дневная, помощник/младший | янтарный |
| `Нп` | ночная, помощник/младший | фиолетовый |
| `''` | выходной (отображается `—` или `·`) | — |

На странице можно сгенерировать график автоматически (солвер), поправить его вручную, сохранить и заблокировать, распечатать и разослать картинкой в VK. Здесь же настраиваются ограничения каждого сотрудника.

#### 1.2. Кто что видит и может

`Schedule.tsx:238`: `isDeputy = role === 'deputy_director' || role === 'director'`. **В отличие от «Зарплаты», здесь директор приравнен к заместителю.**

`isResponsible = user.profileId === schedule_settings[month_year IS NULL].responsible_profile_id`. Ответственного назначают в «Настройках» (`src/pages/Settings.tsx`), строка `schedule_settings` с `month_year = NULL`.

| Флаг | Формула | Где используется |
|---|---|---|
| `canEdit` | `(isDeputy \|\| isResponsible) && editing && !isLocked` | выпадающие списки в ячейках |
| `canSave` | `isDeputy \|\| isResponsible` | кнопка «Сохранить» (если не заблокировано) |
| `canLock` | `isDeputy` | блокировка при сохранении |
| `canUnlock` | `isDeputy` | функция `handleUnlock` (кнопки для неё нет, см. 1.9) |
| `canManageSettings` | `isDeputy \|\| isResponsible` | **объявлен, но нигде не используется** |

Без проверки ролей доступны всем, кто открыл страницу:
- кнопка «Рассылка»;
- кнопка «Печать»;
- правый клик по строке, который открывает модалку настроек сотрудника, с сохранением в БД;
- кнопка «Исключённые (N)» и в ней «Настройки» / «Вернуть».

Бейджи в шапке: «Заблокировано» (если `isLocked`) и «Ответственный» (если `!isDeputy && isResponsible`).

#### 1.3. Период

- Месяц и год выбираются в двух `select`. Годы зашиты: `[2025, 2026, 2027, 2028]`.
- Ключ периода `monthYear` — **строка вида `"Октябрь 2026"`** (`RUSSIAN_MONTHS[m] + ' ' + year`). В «Зарплате» и «Инкассации» формат другой: `"10.2026"`.
- Число дней: `new Date(year, month+1, 0).getDate()`.

#### 1.4. Загрузка данных (`loadSchedule`, `Schedule.tsx:336`)

Запускается при смене месяца или года и после сохранения настроек сотрудника.

1. `loadEmployees()`:
   1. `db.from('profiles').select('*')` — все профили.
      - Ошибка: `debugInfo = "Ошибка профилей: ..."`.
      - Пусто: `"Таблица profiles пуста."`.
   2. `allProfiles` = все профили `{id, full_name || email || 'Без имени', vk_id}`.
   3. Сотрудники табеля = профили, у которых `role` не пустая и не `director`. Если таких нет: `"Из N профилей нет сотрудников с рабочей ролью."`.
   4. `db.from('schedule_config').select('*')` — постоянные настройки (все строки), индекс по `profile_id`.
   5. `db.from('employee_schedule_settings').select('*').eq('month_year', monthYear)` — настройки на этот месяц.
   6. Для каждого сотрудника собирается `ScheduleEmployee`:
      - `status` = `cfg.status || 'ЛБ'`; `no_day`, `no_night`; `break_days ?? 0`; `priority ?? 3`; `excluded`; `st_no_day / st_no_night / ml_no_day / ml_no_night`;
      - `delays` = объединение без повторов `parseDateRange(cfg.delays)` и `parseDateRange(vs.delay)`;
      - `unavailable` = объединение `parseDateRange(cfg.unavailable)` и `parseDateRange(vs.unavailable)`;
      - `preferences`: если массив — без пустых; если строка — `split(',')`, `trim`, без пустых.
2. Ответственный: `db.from('schedule_settings').select('responsible_profile_id').is('month_year', null).limit(1)`.
3. Данные графика: `db.from('schedule_data').select('*').eq('month_year', monthYear)`.
   - Строки есть: берутся только те, чей `profile_id` есть среди сотрудников и **не исключён**; `shifts` обрезается до числа дней. **Сотрудники без строки в `schedule_data` не появятся, пока график не сгенерируют заново.**
   - Строк нет: каждому неисключённому сотруднику — пустая строка `Array(days).fill('')`.
4. Блокировка: `db.from('schedule_settings').select('is_locked').eq('month_year', monthYear).limit(1)` → `isLocked`.

Разбор диапазона дат (`parseDateRange`): разделители `,` и `;`. Элемент с `-` — это диапазон `a-b` (порядок неважен, берутся `min..max`), иначе одно число (`parseInt`). Мусор пропускается. Числа вне 1..31 не отбрасываются; в модалке при показе фильтруются как 1..31.

#### 1.5. Интерфейс

**Верхняя панель:**
- «←» ведёт на `/dashboard`;
- кнопка выхода: `signOut()` и переход на `/login`;
- «Редактировать / Редактирование» (только `isDeputy || isResponsible`) переключает `editing`, в БД ничего не пишет;
- «Исключённые (N)» показывается, если есть исключённые; переключает блок со списком.

**Сообщение статуса** (зелёное, гаснет через 3 с): «Подбираю лучший вариант табеля...», «Расписание сгенерировано: 4 смены каждый день», «Расписание сохранено и заблокировано» / «Расписание сохранено», «Сотрудник возвращён в табель».

**Мобильный вид (`md:hidden`):** у каждого сотрудника карточка.
- Заголовок: «N смен · Д x · Н y», плюс «Дп» и «Нп», если они больше 0.
- Сетка 7 колонок: в каждой ячейке число (красное в субботу и воскресенье) и смена.
- При `canEdit` поверх ячейки лежит прозрачный `select` с вариантами `—, Д, Н, Дп, Нп`.

**Десктоп (таблица):**
- Колонки: ФИО (закреплена), дни 1..N, «Итого», «Д», «Н», «Дп», «Нп».
- Ячейка при `canEdit` — `select`, иначе текст.
- Правый клик по строке (`onContextMenu`) открывает модалку настроек сотрудника. Ролевой проверки нет.
- Строка «ИТОГО»: по каждому дню число назначенных смен с цветом: ≥4 — зелёный, 1–3 — янтарный, 0 — красный. Плюс общая сумма и суммы по типам.

**Блок «Исключённые из табеля»:** строки «ФИО (статус)» с кнопками:
- «Настройки» — открыть модалку с `index = -1`, кнопка «Далее» в ней не работает;
- «Вернуть» — `handleRestoreEmployee`.

**Нижняя панель:**
- «Генерировать» — при `(isDeputy || isResponsible) && !isLocked`;
- «Печать» — если есть строки;
- «Рассылка» — неактивна, если строк нет или идёт отправка;
- «Сохранить» — при `canSave && !isLocked`.

Под панелью — результат рассылки: зелёный, если текст начинается с `✓`, иначе красный.

#### 1.6. Действия

**Генерировать (`handleGenerate`, `:382`)**
1. `generating = true`, статус «Подбираю лучший вариант табеля...».
2. Через `setTimeout(50 мс)` (чтобы успел отрисоваться индикатор) вызывается `generateSchedule(employees, days)` → `solveSchedule(неисключённые, days, isAdjacentAllowed)`.
3. Строки заменяются результатом в порядке неисключённых сотрудников. Если для сотрудника результата нет — пустая строка.
4. Статус «Расписание сгенерировано: 4 смены каждый день» (гаснет через 3 с). Текст выводится всегда, даже если какие-то дни не заполнены.
5. **В БД ничего не пишется**, нужно нажать «Сохранить».

**Ручная правка (`handleShiftChange`)**: при `canEdit` в состоянии меняется `rows[i].shifts[d]`. В БД не пишется до «Сохранить». Правила солвера при ручной правке не проверяются.

**Сохранить (`handleSave`, `:438`)** — схема «удалить всё и вставить заново»:
1. `db.from('schedule_data').delete().eq('month_year', monthYear)` — удаляются все строки месяца.
2. Для каждой строки по очереди (отдельный запрос на строку): `insert({month_year, profile_id, shifts: string[], user_id: user.id || ''})`.
3. Если `canLock` (зам или директор):
   - ищется `schedule_settings` с `month_year`;
   - есть — `update({is_locked: true})` по `id`;
   - нет — `insert({month_year, is_locked: true})`;
   - `isLocked = true`.
4. `editing = false`, статус «Расписание сохранено и заблокировано» (для зама) или «Расписание сохранено» (для ответственного).
5. Ошибки отдельных запросов не проверяются. Транзакции нет: если сбой случится после delete, данные месяца частично потеряются.

**Разблокировать (`handleUnlock`, `:461`)**: при `canUnlock` для существующей строки `schedule_settings` ставит `is_locked: false`, затем `isLocked=false`, `editing=true`. **В интерфейсе нет кнопки, которая вызывала бы эту функцию.** Значок `Unlock` импортирован, но не используется. Заблокированный месяц со страницы табеля разблокировать нельзя.

**Исключить сотрудника (`handleDeleteRow`, `:409`)**: найти `schedule_config` по `profile_id`; если есть — `update({excluded:true})`, иначе `insert({profile_id, excluded:true})`; убрать строку из состояния. **Функция нигде не вызывается** — исключают только через модалку.

**Вернуть (`handleRestoreEmployee`, `:424`)**: если строка `schedule_config` есть — `update({excluded:false})`; если её нет, ничего не пишется. Затем `loadSchedule()` и статус «Сотрудник возвращён в табель». Подтверждения и проверки роли нет.

#### 1.7. Печать (`printSchedule`, `:171`)

1. HTML собирается строкой. Стиль: Arial 10px, таблица с рамками, цвета смен, `@page { size: landscape; margin: 10mm }`.
2. Заголовок «Табель учёта рабочего времени», подзаголовок `"<monthYear> • Напечатано: <дата ru-RU>"`.
3. Колонки: ФИО, 1..N (`—` для пустых), Итого, Д, Н, Дп, Нп. Строка ИТОГО: по дням — число смен, затем общий итог и итоги по типам.
4. `window.open('', '_blank')`, `document.write(html)`, на `onload` вызывается `print()`.
5. ФИО вставляется в HTML **без экранирования**.

#### 1.8. Рассылка табеля в VK (`handleDistributeSchedule`, `:471`)

1. `responsibleName` = ФИО ответственного из `allProfiles`, если не найден — `—`.
2. Картинка: `createScheduleImage(monthYear, rows, days)`.
   - Canvas размером `w = 180 + days*32 + 80*4 + 20`, `h = 50 + (rows+2)*28 + 20`, масштаб ×2.
   - Тёмный фон `#1e293b`. Заголовок «Табель — <monthYear>», строка «Создано: <дата>».
   - Колонки: ФИО, дни, счётчики Д/Н/Дп/Нп; цветные коды смен; полосы через строку.
   - Последняя строка «ИТОГО» содержит только суммы по типам, без итогов по дням.
   - Результат — `dataURL` PNG.
3. Текст сообщения (строки соединены через `\n`):
   ```
   📅 РАСПИСАНИЕ ОБНОВЛЕНО
   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
   🏢 АнодБИЗ · <monthYear>

   👔 Ответственный: <ФИО ответственного или —>

   В базу поступили новые данные о расписании — смотрите приложенный табель.
   ```
4. Привязки VK: `getAllVkBindings()` → `GET <vk-api>?action=bindings_list` **без авторизации**. Ответ — карта `profile_id → vk_user_id`.
5. Получатели — профили, у которых есть строка в текущем табеле. `items = [{vk_user_id, message}]` для тех, у кого есть привязка. `skipped` — сколько получателей без VK.
6. Если `items` пуст: «✗ Ни у кого из табеля не привязан VK — рассылка не отправлена.» (6 с).
7. `POST <vk-api>` с телом `{action:'broadcast', items, photo_base64}`, **без заголовка авторизации**.
   - Сервер (`vk-api/index.py:139,207`) один раз загружает фото во VK (если не получилось — шлёт без фото) и вызывает `messages.send` для каждого `item` от имени группы (`VK_GROUP_TOKEN`).
   - Возвращает `{sent, failed}`.
8. Успех: «✓ Табель (фото) отправлен в VK: sent из N. Без VK: k. Не доставлено: f.» (8 с). Ошибка: «✗ Ошибка при отправке рассылки» (5 с).
9. Сохранять график перед рассылкой не нужно: отправляется то, что сейчас на экране.

#### 1.9. Блокировка месяца (итог)

- Флаг хранится в `schedule_settings(month_year='Октябрь 2026').is_locked`.
- Ставит его только «Сохранить» у зама или директора. Сохранение ответственным не блокирует.
- Когда месяц заблокирован, скрыты «Генерировать» и «Сохранить», `canEdit = false`. Кнопка «Редактировать» видна, но ячейки не редактируются.
- Кнопки разблокировки в интерфейсе нет (см. 1.6).
- Проверки только в UI: сервер блокировку не соблюдает.

#### 1.10. Модалка «Настройки сотрудника» (`EmployeeSettingsModal.tsx`)

**Открывается:** правым кликом по строке (с `index` в списке активных) или кнопкой «Настройки» у исключённого (`index = -1`).

**Загрузка (`loadConfig`):**
- `schedule_config.eq('profile_id', id).limit(1)` — постоянные настройки;
- `employee_schedule_settings.eq('profile_id', id).eq('month_year', monthYear).limit(1)` — настройки месяца;
- значения по умолчанию: `break_days 0`, `priority 3`, назначение `ЛБ`, флаги `false`, строки пустые.

**Блок «Переменные настройки» (`EmployeeVariableSettings`)** — «Действуют только в текущем месяце (<monthYear>)»:
- «Отсрочка (на месяц)» → `employee_schedule_settings.delay` (строка вида `1-5,7,10-15`);
- «Недоступен (на месяц)» → `employee_schedule_settings.unavailable`;
- под полями — чипы с распознанными днями 1..31.

**Блок «Постоянные настройки» (`EmployeePermanentSettings`)** — «Действуют всегда и сохраняются на все месяцы»:
- «Запрет дня» (`no_day`) — нельзя `Д` и `Дп`; «Запрет ночи» (`no_night`) — нельзя `Н` и `Нп`;
- «Перерыв (дней)» `break_days`, поле 0..7 (ограничение только HTML-атрибутами `min/max`). Подсказка: «0 = каждый день; 1 = через день; 2 = 2 дня отдыха»;
- «Приоритет»: 1 Срочно, 2 Необходимо, 3 Размерено, 4 Меньше, 5 Редко. В солвере даёт штраф `priority*0.3`: чем больше число, тем реже ставят;
- «Назначение» → `schedule_config.status`: `СТ` (Старший), `МЛ` (Младший), `ЛБ` (Любой). Для `ЛБ` есть подблок с запретами по типам: СТ «Запрет дня» (`st_no_day` — нельзя `Д`), СТ «Запрет ночи» (`st_no_night` — нельзя `Н`), МЛ «Запрет дня» (`ml_no_day` — нельзя `Дп`), МЛ «Запрет ночи» (`ml_no_night` — нельзя `Нп`);
- «Задержка (постоянная)» → `schedule_config.delays`; «Недоступен (постоянно)» → `schedule_config.unavailable`. Действуют каждый месяц. В солвере задержки и недоступность работают одинаково: в эти дни ставить нельзя.

**Блок «Ограничение по напарнику» (`EmployeePreferencesAndExclude`):**
- Это жёсткое условие: сотрудника ставят **только** в паре с одним из выбранных. Пары: `Д` + `Дп` (день), `Н` + `Нп` (ночь).
- Список — все профили, кроме самого сотрудника (включая директоров).
- Хранится строкой id через запятую в `schedule_config.preferences`.
- «Удалить» показывает подтверждение «Вы уверены?...» с кнопками «Да, исключить» и «Отмена». «Вернуть в табель» срабатывает без подтверждения. Обе вызывают `handleToggleExcluded`:
  - найти `schedule_config` по `profile_id`;
  - `update({excluded: !excluded})` или `insert({profile_id, excluded})`;
  - показать «✓ Сохранено» на 2 с и вызвать `onSave()` (перезагрузка табеля).

**Сохранить (`handleSave`):**
1. Постоянные настройки: найти `schedule_config` по `profile_id` и сделать `update` или `insert` с полями `{profile_id, no_day, no_night, break_days, priority, status, preferences, excluded, st_*, ml_*, delays, unavailable}`.
2. Переменные настройки: найти `employee_schedule_settings` по `(profile_id, month_year)` и сделать `update` или `insert` с полями `{profile_id, month_year, delay, unavailable}`. Строка создаётся, даже если поля пустые.
3. Показать «✓ Сохранено» (2 с) и вызвать `onSave()` → `loadSchedule()`.

Валидации нет. Ошибки только пишутся в консоль. Проверки роли нет.

**Далее:** сначала `handleSave()`, затем переход к следующему активному сотруднику; у последнего модалка закрывается.

**Закрыть:** кнопка «Закрыть», крестик или клик по фону. Несохранённое теряется.

#### 1.11. Алгоритм солвера (`src/lib/scheduleSolver.ts`)

**Вход:** неисключённые сотрудники (`profile_id, status, no_day, no_night, break_days, priority, delays, unavailable, preferences, st_*/ml_*`), число дней `days`, функция `adjacentAllowed`, ширина луча `beamWidth = 60`.

**Выход:** `string[][]`, по строке на сотрудника в порядке входа.

**Цель:** каждый день 4 слота `SLOTS = ['Д','Н','Дп','Нп']`, на каждом не больше одного человека; один человек — не больше одной смены в день.

##### Константы

| Имя | Значение | Смысл |
|---|---|---|
| `RULE` | 100 | штраф за нарушение правила компании |
| `EMPTY` | 5000 | штраф за незаполненный слот |
| `BAL` | 6 | вес выравнивания количества смен (меняется через `setBalanceWeight`, но нигде не вызывается) |
| `NO_NIGHT_COST` | 5 | сниженный штраф, когда «Н» закрывает другой СТ после «Д» СТ без ночей (`setNoNightCost` не вызывается) |
| `PARTNER` | `[2,3,0,1]` | напарник слота: Д↔Дп, Н↔Нп |
| `topK` | 8 | сколько лучших расстановок дня берётся из одного состояния |

##### Допустимость (жёсткие ограничения, `allowed(e, s, dayNum)`)

Смена `s` в день `dayNum` (с 1) допустима, только если выполнены все условия:
1. Тип смены подходит под статус: `СТ` → `Д, Н`; `МЛ` → `Дп, Нп`; остальные (`ЛБ` и прочие) → все четыре.
2. `no_day` запрещает `Д` и `Дп`; `no_night` — `Н` и `Нп`.
3. Только для `ЛБ`: `st_no_day` запрещает `Д`, `st_no_night` — `Н`, `ml_no_day` — `Дп`, `ml_no_night` — `Нп`.
4. День не входит в `unavailable` и в `delays`.

Ещё два жёстких ограничения:
- **Напарник:** у сотрудника с непустым списком (учитываются только id среди активных) напарник в парном слоте должен существовать и быть в его списке. Если у напарника тоже есть список, в нём должен быть этот сотрудник. Иначе расстановка дня отбрасывается.
- **Один человек — одна смена в день** (множество `used` при переборе).

##### Классы сотрудников

- `isSt(e)`: `status === 'СТ'` и нет `no_day` и `no_night` — полноценный старший по схеме «Д → Н».
- `isMl(e)`: `status === 'МЛ'`, `break_days == 0` и нет `no_day` и `no_night` — младший по схеме серий «Дп...Нп».
- Остальные (СТ или МЛ с ограничениями, ЛБ) — по общим правилам.
- Группы выравнивания `group(e)`: `'СТ'` — любой СТ (в том числе с ограничениями), `'МЛ'` — `isMl`, `'МЛx'` — прочие МЛ, `'ЛБ'` — остальные. Группа `'СТx'` объявлена, но всегда пуста.

##### Состояние луча

`rows` (график), `last[p]` (индекс дня последней смены, по умолчанию −99), `lastShift[p]`, `dp[p]` (длина текущей серии `Дп` подряд), `count[p]` (сколько смен, вес смены 1), `target[p]` (желаемая длина серии МЛ, случайно 3..6), `cost`.

##### Штрафы одного назначения (`expand`, для дня `d`)

Обозначения: `prev` — смена вчера, `gap = d − last[p]`, `dpn = dp[p]`.

**Штраф за невыход `skip[p]`.** Он добавляется ко дню, если сотрудника не поставили:
- СТ по схеме: если вчера было `Д` — `RULE` (после «Д» обязана идти «Н»).
- МЛ по схеме: если `dpn >= 3` или (`dpn > 0` и серия не началась с первого дня месяца) — `RULE` (серию нельзя прерывать; закончить её можно только «Нп»).

**СТ по схеме (`isSt`):**
- `Н`: если `d > 0` и вчера не `Д` → `+RULE`. Если вчерашнюю `Д` отработал СТ с запретом ночи (`dayByNoNight`), то вместо этого `+NO_NIGHT_COST` (5). Дополнительно, если `gap <= max(1, break_days)` → `+RULE`. В первый день месяца `Н` без штрафа: это продолжение пары с прошлого месяца.
- `Д`: если вчера была любая смена → `+RULE`; если `gap <= max(1, break_days)` → `+RULE`; если завтра (в пределах месяца) `Н` недопустима → `+RULE`.
- Итог: пара «Д, Н», затем отдых не меньше `max(1, break_days)` дней.

**МЛ по схеме (`isMl`):**
- `Нп`: если не (`dpn >= 3`, или серия идёт с первого дня месяца, или сегодня первый день) → `+RULE`. Если `dpn == 0`, не первый день и `gap <= 2` → `+RULE`.
- `Дп`: `dpn >= 6` → `+RULE`; `dpn == 0` и `gap <= 2` → `+RULE` (после серии 2 дня отдыха); `dpn >= target` → `+8` (мягкое окончание серии на случайной длине 3..6); если `dpn == 0` и в ближайшие 3 дня есть день, когда `Дп` недопустима → `+40`.
- Итог: `Дп` подряд 3–6 дней, затем `Нп`, затем 2 дня отдыха.

**Остальные:**
- `gap <= break_days` → `+RULE`. При `break_days = 0` не срабатывает никогда, потому что `gap >= 1`.
- `gap == 1` (работал вчера) и `!adjacentAllowed(lastShift, s)` → `+RULE`. Разрешённые переходы «вчера → сегодня» (`Schedule.tsx:70`): `Д→Н`, `Дп→Н`, `Д→Нп`. Все прочие подряд идущие смены (например, `Н→Д` или `Д→Д`) штрафуются.

**Ко всем назначениям добавляется** `(count[p] − mean(группы p)) * BAL + priority * 0.3`. Здесь `mean` — среднее `count` по группе на текущий момент: кто отработал больше среднего, тот дороже.

##### Перебор дня

1. Для каждого слота кандидаты — все, у кого штраф конечен (смена допустима), плюс «пусто» (−1).
2. Рекурсивно перебираются все сочетания 4 слотов с разными людьми (полный перебор, примерно n⁴).
3. Стоимость сочетания: `Σ skip` (все) `− skip` выбранных `+ Σ pen` выбранных `+ EMPTY` за каждый пустой слот. Нарушение правила напарника отбрасывает сочетание.
4. Добавляется шум `Math.random() * noise`.
5. Сортировка по возрастанию, берутся `topK = 8`.

##### Применение (`apply`)

Для выбранных: записать смену, `last = d`, `lastShift = s`, `count += 1`. `dp` растёт на `Дп` и обнуляется на любой другой смене. На `Нп` `target` пересчитывается заново случайно (3..6). У невышедших `dp = 0`.

##### Лучевой поиск

- До 6 прогонов. Прогон 0 выполняется всегда, остальные — пока не прошло 2500 мс с начала.
- Шум: прогон 0 — `0.5`, прогон k ≥ 1 — `3 + 2k` (5, 7, 9, 11, 13).
- Старт: одно пустое состояние, `target` каждому случайно 3..6.
- По каждому дню: каждое состояние луча раскрывается в 8 вариантов → сортировка по `cost` → удаление дублей → первые 60 (`beamWidth`). Ключ дубля — смены всех сотрудников сегодня и вчера плюс `round(cost/50)`.
- Итоговая оценка состояния: `cost + BAL * Σ (count[i] − mean_g)²` по группам `СТ, МЛ, СТx, МЛx`. Группа `ЛБ` в итоговое выравнивание **не входит**.
- Выбирается состояние с минимальной оценкой среди всех прогонов. Если не нашлось ни одного — пустой массив.

Свойства:
- Результат случайный: каждое нажатие даёт разный график.
- Правила компании — мягкие (штраф 100), их можно нарушить, если иначе остаётся пустой слот (5000).
- Жёсткие ограничения — только допустимость смены, напарник и одна смена в день.
- Состояние прошлого месяца не учитывается, только послабления в первый день.
- Вычисления идут синхронно в основном потоке браузера, страница «замирает» на 1–3 с.

#### 1.12. Ротация сотрудников (`RotationSettings.tsx`)

Компонент встроен в настройки (`src/components/settings/SettingsWorkTabs.tsx:122`), а не в страницу табеля. Он связан с «Зарплатой».

- **Загрузка:** `employee_rotation.select('*').order('position')`. Если родитель не передал профили, компонент загружает `profiles` сам.
- **Интерфейс:** заголовок «Ротация сотрудников», подпись «Автоматическое заполнение ЗП на 6 лет вперёд». В строке: номер, ФИО (или «Неизвестный (ID: xxxxxxxx)»), поле «Магазин» (`store_name`), кнопки ↑/↓, переключатель активности, удаление. Внизу — «Добавить сотрудника» (только не директора и тех, кого ещё нет в списке).
- **Права:** всё редактирование только при `isDeputy` (`role === 'deputy_director'`, передаётся из Settings). Остальным поля неактивны, кнопки скрыты.
- **Сохранить ротацию (`handleSave`):**
  1. Прочитать все id из `employee_rotation` и удалить их пачками по 20 (`delete().in('id', batch)`).
  2. Вставить все строки одним запросом: `{profile_id, position: i+1, store_name, active}`. При ошибке — «Ошибка записи ротации: ...».
  3. Если активных нет — «✓ Сохранено».
  4. Иначе предзаполнение зарплаты на `MONTHS_COUNT = 72` месяца (6 лет), начиная с текущего. Период — `MM.YYYY`. Для каждого активного сотрудника и каждого месяца, если пары `profile_id:month_year` ещё нет в `salary_data`, создаётся строка `{hours_worked:0, revenue:0, days_in_month: дни месяца, vacation_pay:0, non_cash:0, overtime:0, tax:0, month_year, responsible_user_id, user_id}`. Вставка пачками по 50.
  5. Сообщение: «✓ Сохранено. Создано N строк ЗП на 6 лет».
- Порядок (`position`) и `store_name` больше нигде в коде не используются.

---

### 2. Страница «Зарплата» (`/salary`, `src/pages/Salary.tsx`)

#### 2.1. Назначение

Расчёт зарплаты за месяц по двум таблицам:
- «Таблица сотрудников» — `salary_data`, параметры месяца в `salary_settings`;
- «Заведующий» — `manager_data`, параметры в `manager_settings`.

Ставка за час выводится из выручки. Формулы и набор колонок настраиваются в админ-панели. Есть рассылка расчётов в VK.

#### 2.2. Роли и права (`Salary.tsx:111–120`)

- `isDeputy = role === 'deputy_director'`. **Директор здесь не зам:** `isDirector = role === 'director'` получает только просмотр и кнопку «ПОЛНАЯ».
- `usePositions = access && !isDeputy && access.position !== null` — у пользователя есть должность в админ-модели, права берутся из `actions`.
- Флаги действий (зам получает их всегда):
  - `canEditPerm = isDeputy || can('salary.edit')`;
  - `canManageRows = isDeputy || can('salary.manage_rows')`;
  - `canLock = isDeputy || can('salary.lock')`;
  - `canViewFull = isDeputy || can('salary.view_full')`.
- Ответственный за сотрудников — `salary_settings[month_year IS NULL].responsible_profile_id`. Ответственный за заведующих — `manager_settings[month_year IS NULL].responsible_profile_id`. Задаются в «Настройках».

| Проверка | Формула |
|---|---|
| `canEditHours()` | `!locked && (usePositions ? canEditPerm : (isDeputy \|\| ответственный))` |
| `canEditRevenueDays()` | `!locked && (isDeputy \|\| ответственный)` |
| `canAddDeleteRow()` | `!locked && canManageRows` |
| `canEditManager()` | `!managerLocked && (usePositions ? canEditPerm : (isDeputy \|\| ответственный за заведующих))` |
| Видны все колонки (`showExpanded`) | `canViewFull \|\| ответственный \|\| showFullTable` |

Метка роли в шапке: «👁 Директор» / «✏️ Зам. директора» / «✏️ Ответственный» / «👤 Сотрудник».

#### 2.3. Период и загрузка (`loadData`, `:171`)

- Период — `MM.YYYY` (например, `10.2026`). Годы: от текущего −2 до +2.
- Загрузка запускается при смене периода. Параллельно выполняются 7 запросов:
  1. `profiles.select('*')`;
  2. `salary_data.eq('month_year', P)`;
  3. `salary_settings.eq('month_year', P).maybeSingle()`;
  4. `salary_settings.is('month_year', null).limit(1)` — глобальные: `percent` (по умолчанию 2.5) и `responsible_profile_id`;
  5. `manager_data.eq('month_year', P)`;
  6. `manager_settings.eq('month_year', P).maybeSingle()`;
  7. `manager_settings.is('month_year', null).limit(1)` — `manager_percent` (по умолчанию 5) и ответственный.
- Настройки периода: `revenue`, `days_in_month` (если пусто — календарное число дней), `id`, `is_locked` → `periodLocked`. Если строки нет: выручка 0, дни календарные, не заблокировано.
- Настройки заведующих за период: `is_locked` → `managerLocked`, `id`.

**Копирование с прошлого месяца** (`copyRowsFromPreviousPeriod`, `:239`; `copyManagerRowsFromPreviousPeriod`, `:262`) срабатывает, если строк за период нет, у **любого** открывшего страницу:
1. Прочитать все `month_year` таблицы, кроме текущего (`not('month_year','is',null).neq(...)`).
2. Взять уникальные значения, `.sort().reverse()` (сортировка строк) — «последний» период `periods[0]`.
3. Взять `profile_id` строк этого периода. Если их нет — все профили, кроме директоров.
4. Вставить пачкой нулевые строки:
   - сотрудники: `{hours_worked, revenue, days_in_month: 0, vacation_pay, non_cash, overtime, tax, underpayment: 0, month_year: P, responsible_user_id, user_id}`;
   - заведующие: `{osn_hours, dop_hours, doplaty, vacation_pay, non_cash, underpayment, hourly_rate: 0, month_year: P, user_id}`.
5. Копируется только список людей, значения не переносятся.

#### 2.4. Формулы и расчёты

Вычислитель — `evalFormula` (`src/lib/access.tsx:79`), свой безопасный парсер без `eval`:
- `+ - * /`, скобки, унарные `±`;
- функции `round(x; n)`, `min`, `max`, `abs`, `floor`, `ceil`;
- `,` в числах заменяется на `.`, `;` — разделитель аргументов;
- неизвестная переменная = 0, деление на 0 = 0, любая ошибка разбора = 0.

Формулы по умолчанию (`DEFAULT_FX`). Если `access.formulas` загружен, используются его формулы:

```
rate          = revenue / (days * 24) * percent / 100
total         = (rate * hours + vacation) - non_cash - overtime - tax + underpayment
week          = total / 4
manager_rate  = rate * (1 + manager_percent / 100)
manager_total = ((osn_hours * manager_rate) + vacation) - non_cash + doplaty + dop_hours * rate + underpayment
manager_week  = manager_total / 4
```

Базовые переменные: `revenue` (C3. ВЫРУЧКА), `days` (C9. ДНИ), `percent` (глобальный % из `salary_settings`), `manager_percent`.

Переменные строки берутся из полей (`DEFAULT_FIELDS` или `access.fields`); для каждого поля `env[f.var] = cellValue(row, f)`:

| Таблица | key → var (подпись, вид) |
|---|---|
| сотрудники | `hours_worked→hours` (ЧАСЫ), `vacation_pay→vacation` (ОТПУСК), `non_cash→non_cash` (БЕЗНАЛ, удержание), `overtime→overtime` (ПЕРЕБОР, удержание), `tax→tax` (НАЛОГ), `underpayment→underpayment` (НЕДОПЛАТА, начисление) |
| заведующие | `osn_hours`, `dop_hours`, `doplaty`, `vacation_pay→vacation`, `non_cash`, `underpayment` |

- Встроенные поля (`builtin`) читаются из колонок таблицы. Пользовательские — из JSON-колонки `extra[key]`; вид `text` даёт строку, в формулах такое поле равно 0.
- Ставка сотрудника `employeeRate` одна на всех (`rate`). Ставка заведующего `managerRate` считается от неё.
- На строку: `i = total`, `j = week`; у заведующего `itog` и `week`.
- Итоги: `totals.hours`, `underpayment`, `i`, `j`. В шапке: «₽/Час», «Сотр: N», «Итого: Σi ₽».
- Подсказка `K2 = days × 24`.
- Округление: в расчётах нет. Вывод `fmt` — `ru-RU`, 2 знака. Часы (`hours_worked/osn_hours/dop_hours`) выводятся как есть. Итог первой колонки — `Math.round(sum*100)/100`.

#### 2.5. Интерфейс

**Шапка:**
- «←» на `/dashboard`; выбор месяца и года;
- показатели «₽/Час», «Сотр», «Итого»;
- если `periodLocked`: для `canLock` — кнопка «Разблокировать», иначе бейдж «Заблокировано»;
- «ПОЛНАЯ / Скрыть» — только директор, переключает `showFullTable` (показ всех колонок);
- «Часы из табеля» — при `canEditHours()`;
- «Настройки ЗП» — ссылка на `/admin`, только зам.

**Блок C3/C9:** поля «ВЫРУЧКА» и «ДНИ», редактируемые при `canEditRevenueDays()`, иначе текст.

**Таблица сотрудников (`SalaryGrid`):**
- Колонки: СОТРУДНИК, первое видимое поле, ₽/ЧАС, остальные поля, ИТОГ (красный, если < 0), НЕДЕЛЯ, удаление.
- Поле видно, если `f.visible` и (`showAll` или ключ в `shortKeys`). У сотрудников `shortKeys = ['hours_worked']`: без полного режима видны только часы и расчётные колонки. У заведующих `showAll = true`.
- Ячейки — `input` (`number` или `text`) при `canEdit`. Строки добавления и удаления — при `canManageRows`.
- Строка ИТОГО: суммы полей (кроме текстовых), ставка, Σ итог, Σ неделя.

**Таблица «Заведующий»:** в заголовке «₽/Час», «Процент: X%», бейдж «Заблокировано» и кнопка «Разблокировать» (при `canLock && managerLocked`).

**Нижняя панель** (если есть строки сотрудников):
- «Рассылка» — при `!usePositions || can('salary.broadcast')`;
- «Сохранить» — при `canLock || ответственный`. Неактивна, если заблокированы обе таблицы, тогда надпись «Заблокировано».

#### 2.6. Действия

- **Изменение ячейки (`updateGridCell`, `:345`):** состояние обновляется и **сразу на каждое изменение** уходит `update` по `id`.
  - встроенное поле: `update({[key]: value})`;
  - пользовательское: `update({extra: {...row.extra, [key]: value}})`.
  - Без debounce и проверки ошибок. `onChange` числового поля даёт `Number(...)`, пустая строка превращается в 0.
- **Выручка и дни (`updateRevenue/updateDays`):** состояние меняется, а в БД (`salary_settings.update`) пишется **только если строка периода уже есть**. Иначе значение сохранится при «Сохранить».
- **Добавить сотрудника (`addRow`):** при `canAddDeleteRow()` — `salary_data.insert({нулевые поля, month_year, responsible_user_id, user_id}).select().single()`. В списке выбора — не директора, которых ещё нет в таблице.
- **Удалить строку (`deleteRow`):** `salary_data.delete().eq('id')`. **Подтверждения нет.**
- **Заведующие:**
  - `addManagerRow` проверяет только `canManageRows`, блокировку не проверяет (в интерфейсе кнопка скрыта, когда заблокировано);
  - `deleteManagerRow` — `manager_data.delete().eq('id')`, тоже без подтверждения.
- **Сохранить (`saveAll`, `:405`)**, допускается при `canLock || ответственный`:
  1. `salary_settings`: если строка периода есть — `update({revenue, days_in_month, is_locked: true})`, иначе `insert({revenue, days_in_month, percent: глобальный, month_year, is_locked: true, responsible_profile_id})`.
  2. Для каждой строки сотрудников — отдельный `update({hours_worked, vacation_pay, non_cash, overtime, tax, underpayment})`. Поля `extra` здесь не пишутся: они уже сохранены при вводе.
  3. `manager_settings`: `update({is_locked: true})` или `insert({manager_percent, is_locked: true, month_year, responsible_profile_id})`.
  4. Для каждой строки заведующих — `update({osn_hours, dop_hours, doplaty, vacation_pay, non_cash, underpayment})`.
  5. В состоянии обе таблицы становятся заблокированными. Сообщения об успехе нет.
  - Сохранение у ответственного тоже блокирует месяц. Снять блокировку он не может: для этого нужен `canLock`.
- **Разблокировать сотрудников (`handleUnlockPeriod`, `:478`):** при `canLock` — `salary_settings.update({is_locked: false})`. Без подтверждения.
- **Разблокировать заведующих (`handleUnlockManager`, `:486`):**
  1. Модалка «Разблокировка таблицы»: «Введите код для разблокировки таблицы «Заведующий»:», поле-пароль, Enter или кнопка.
  2. Проверка в браузере: `unlockCode === '<код-разблокировки>'` (`Salary.tsx:487`).
  3. Верно: `managerLocked = false`, `manager_settings.update({is_locked:false})` без `await`, модалка закрывается.
  4. Неверно: «Неверный код», поле очищается.
  5. Внутри функции проверки `canLock` нет.
- **Часы из табеля (`fillHoursFromSchedule`, `:455`):**
  1. Работает при `canEditHours()`.
  2. Запрос `schedule_data.select().eq('month_year', "<Месяц> <Год>")` (переход к формату табеля).
  3. Часы за смену: `{Д:12, Н:12, Дп:12, Нп:12}`, переопределяются `access.general.shift_hours`. На сервере это `app_settings.shift_hours` (`admin-api`), задаётся в админ-панели.
  4. `shifts` — массив или JSON-строка. `hours[profile] += Σ часов по сменам`; пустые и неизвестные коды дают 0.
  5. Если табель пуст: `alert('В табеле за этот месяц нет смен')`.
  6. Меняются только строки, где профиль есть в табеле и часы отличаются. Если таких нет: `alert('Часы уже совпадают с табелем')`.
  7. `confirm('Подставить часы из табеля?\n\n<ФИО: старые → новые>...')`.
  8. На каждую строку — `salary_data.update({hours_worked})`, затем обновление состояния.

#### 2.7. Рассылка зарплаты (`handleDistributeSalary`)

1. `responsibleName` — ФИО ответственного за сотрудников. Оно же подставляется и в сообщения заведующим.
2. `getAllVkBindings()` → `GET vk-api?action=bindings_list`, без авторизации.
3. На каждую строку сотрудников и заведующих, у чьего профиля есть привязка VK, — личное сообщение только этому человеку. Остальные считаются в `skipped`.
4. Шаблон для сотрудника (пустые строки выкидываются; строка «Недоплата» есть, только если значение ≠ 0):
   ```
   💰 РАСЧЁТ ЗАРПЛАТЫ
   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
   🏢 АнодБИЗ · <Месяц> <Год>
   👤 Сотрудник: <ФИО>
   👔 Ответственный: <ФИО ответственного>
   ⏱ Часы: <hours_worked>
   💵 Час/Руб: <rate>
   🌴 Отпускные: <vacation_pay>
   💳 Безнал: <non_cash>
   📈 Перебор: <overtime>
   📉 Налог: <tax>
   ⚠️ Недоплата: <underpayment>
   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
   ✅ ИТОГО: <total> ₽
   ```
   Пустые строки из массива-шаблона удаляются через `filter(Boolean)`, поэтому визуальных разрывов в итоговом тексте нет.
5. Для заведующего: те же заголовки, затем «⏱ Часы (ОСН)», «⏱ Часы (ДОП)», «💵 Час/Руб: <manager_rate>», «➕ Доплаты», «🌴 Отпускные», «💳 Безнал», «⚠️ Недоплата» (если ≠ 0), разделитель, «✅ ИТОГО: <itog> ₽».
6. Пользовательские поля (`extra`) в сообщения не попадают.
7. Если `items` пуст: «✗ Ни у кого из списка зарплаты не привязан VK — рассылка не отправлена.»
8. `POST vk-api {action:'broadcast', items}` без фото и без авторизации.
9. Результат показывается модалкой с кнопкой «Понятно»: «✓ Отправлено S из N персональных расчётов. Без VK: k. Не доставлено: f. Каждому уходит только его строка.»

#### 2.8. Блокировка (итог)

- Сотрудники: `salary_settings(month_year=P).is_locked`. Заведующие: `manager_settings(month_year=P).is_locked`.
- Обе таблицы блокирует только «Сохранить».
- Сотрудников разблокирует кнопка у `canLock`. Заведующих — кнопка у `canLock` плюс код `<код-разблокировки>`, который проверяется на клиенте.
- Блокировка соблюдается только в интерфейсе.

---

### 3. Страница «Инкассация» (`/collection`, `src/pages/Collection.tsx`)

#### 3.1. Назначение

Сверка наличных по сменам: «Сбис» (из отчёта кассы) против «Факта» (пересчитано). У строки есть статус, а при недостаче — виновный. Сумма недостачи переносится удержанием («ПЕРЕБОР», `overtime`) в зарплату следующего месяца.

#### 3.2. Права (`:140–147`)

- `usePositions = access && !access.is_deputy && access.position !== null`.
- `isDir = usePositions ? can('collection.edit') : (role ∈ {director, deputy_director})` — право редактировать и сохранять.
- `canImport = usePositions ? can('collection.import') : isDir`.
- `canUnlock = usePositions ? can('collection.unlock') : isDir`.
- `isEditable = isDir && (!monthLocked || tempUnlocked)`.
- Нижняя панель с кнопками видна только при `isDir`. Остальные видят таблицу только для чтения.
- Настройка полей: `access.fields.collection`.
  - `sbis_value` — подпись и видимость (колонку «Сбис» можно скрыть);
  - `fact_value` — только подпись, колонка видна всегда;
  - остальные определения полей (в том числе пользовательские, `extra`) страница **не использует**, хотя колонка `collection_data.extra` в БД есть (`db_migrations/V0030`).

#### 3.3. Модель данных и смены

- Период `MM.YYYY`. Дата смены `shift_date` — строка `DD.MM.YYYY`. Тип смены — `Д` или `Н`.
- Сетка месяца строится в браузере (`generateMonthRows`): по 2 строки на день (Д, Н) с нулями, `status: null`, `responsible_person: ''`.
- Строка `collection_data`: `{id, month_year, shift_date, shift_type, sbis_value, fact_value, status, responsible_person, locked}`.
- Статусы: `verified` — «✓ Проверено» (зелёный), `error` — «⚠ Ошибка» (жёлтый), `shortage` — «✗ Недостача» (красный); `null` — «—».

#### 3.4. Загрузка (`loadData`)

1. Запускается при смене месяца или года, а также кнопкой ⟳ «Обновить данные из БД». Сбрасывает временную разблокировку.
2. `collection_data.select('*').eq('month_year', P)`. При ошибке: «Ошибка чтения БД: ...».
3. `monthLocked = есть хотя бы одна строка с locked = true`.
4. Сетка месяца объединяется с сохранёнными строками по ключу `shift_date_shift_type`: сохранённая строка заменяет сгенерированную.
5. Список ФИО для недостачи (`loadFioList`):
   - все `profile_id` из **всех** строк `salary_data`, к ним `full_name` из `profiles`, без повторов;
   - если `salary_data` пуст — ФИО всех профилей с `role != 'director'`.

#### 3.5. Интерфейс

- **Шапка:** «←»; заголовок «ИНКАССАЦИЯ»; бейдж «Заблокировано» или «Активно»; месяц и год; ⟳; «Загрузить XLSX» (неактивна при `importing || !isEditable || !canImport`, принимает `.xlsx,.xls`); «Разблокировать» (при `monthLocked && canUnlock`).
- **Сообщения:**
  - ошибка (красная, с крестиком);
  - инфо импорта (синяя, 6 с);
  - успех (зелёный, 4 с);
  - «Временная разблокировка активна. Автоблокировка через 15 минут.»
- **Карточки:** «Итого нал. (СБИС)» = Σ`sbis_value`; «Итого Факт» = Σ`fact_value`; «Расхождение» = Сбис − Факт. Больше 0 — красный со знаком «+» (недостача), меньше 0 — синий (излишек).
- **Таблица:** Дата | Смена (бейдж Д/Н) | Сбис ₽ (только для чтения, `—` при 0) | Факт ₽ | Расхождение | Статус. Внизу строка ИТОГО.
  - «Факт» при `isEditable` — `input number step 0.01`, `parseFloat || 0`.
  - «Статус» при `isEditable` — `select` «— Указать —» и три статуса. При выборе не-«Недостачи» поле `responsible_person` очищается. Для «Недостачи» появляется второй `select` «— ФИО —» из списка ФИО.
  - Без права редактирования вместо селектов показывается `StatusBadge` — значок, подпись и `(ФИО)` для недостачи.
- **Нижняя панель (`isDir`):** подсказка «🔒 Месяц заблокирован. Данные защищены от изменений.» или «Обновить — зафиксировать в БД. Сохранить — заблокировать месяц.»; кнопки «Обновить» и «Сохранить и заблокировать». Обе неактивны при `!isEditable`.

#### 3.6. Импорт отчёта СБИС (`parseSabiReport`, `handleUpload`)

1. Работает только при `isEditable`. Иначе ошибка «Месяц заблокирован. Используйте разблокировку пин-кодом для загрузки файла.»
2. Библиотека загружается во время работы с CDN: `import('https://esm.sh/xlsx@0.18.5')`. Не загрузилась — «Не удалось загрузить библиотеку для чтения XLSX. Проверьте подключение к интернету.»
3. Читается **первый лист** (`sheet_to_json`, `header: 1`, пустые ячейки — `''`). Нет листов — «Файл не содержит листов».
4. Строка заголовков ищется среди первых 10 строк: ячейка содержит «Дата и время открытия». Не нашлась — «Не найдена строка заголовков в файле. Убедитесь, что загружается отчёт по сменам из САБИ.»
5. Колонки:
   - дата — заголовок содержит «Дата и время открытия», иначе «Не найден столбец «Дата и время открытия»»;
   - наличные — заголовок **ровно** «Наличными», иначе «Не найден столбец «Наличными»».
6. Каждая строка ниже заголовка:
   - пустая дата или начинается с «Итого» — пропуск;
   - сумма: убрать всё, кроме цифр, `.`, `,`, `-`; первую `,` заменить на `.`; `parseFloat || 0`;
   - дата и время: формат `ДД.ММ.ГГ(ГГ) ЧЧ:ММ...` через пробел; год < 100 → +2000. Ячейки-даты Excel в виде числа (не текста) не разбираются: при `cellDates: false` придёт число без пробела, строка пропустится;
   - смена по часу открытия (`classifyShift`): 5–8 → Д, 18–20 → Н, иначе `<12` → Д, `≥12` → Н. Фактически граница одна: до 12:00 — Д, с 12:00 — Н;
   - суммы складываются по ключу `ДД.ММ.ГГГГ_Д/Н`.
7. Сопоставление: каждой строке сетки, у которой в файле есть ключ с суммой > 0, ставится `sbis_value = сумма` (замена, не сложение). Даты из других месяцев игнорируются. Нулевые суммы не затирают старое значение.
8. Сообщение: «Загружено N смен из файла. Нажмите «Обновить» для сохранения.» В БД ничего не пишется. Поле файла очищается.

#### 3.7. Обновить (`handleRefresh`, `:255`)

1. Работает при `isDir`. Перебираются строки, где `sbis_value > 0 || fact_value > 0 || status`, остальные пропускаются.
2. Запись: `{month_year, shift_date, shift_type, sbis_value, fact_value, status, responsible_person, locked: false}`. Если есть `id` — `update().eq('id')`, иначе `insert().select()` и запоминается новый `id`. По одному запросу на строку.
3. Ошибки собираются: «Ошибки записи (N): <первая>».
4. `carryShortageToNextMonth()` (3.9), затем `loadData()`, затем «Обновлено: N записей зафиксировано в БД.»

#### 3.8. Сохранить и заблокировать (`handleSave`, `:313`)

1. То же, что «Обновить», но записываются **все** строки сетки (2 × дней), с `locked: true`.
2. Затем перенос недостач, `loadData()`, `monthLocked = true`, временная разблокировка снимается.
3. Сообщение «Месяц заблокирован! Сохранено N записей.» Подтверждения нет.

#### 3.9. Перенос недостач в зарплату (`carryShortageToNextMonth`, `:385`)

1. `collection_data` где `month_year = P`, `status = 'shortage'` и `responsible_person` не `''` (фильтр `not_eq`, поэтому `NULL` тоже проходит).
2. По каждому ФИО: `Σ max(0, sbis − fact)`.
3. Следующий период — `MM+1.YYYY` (после декабря — январь следующего года).
4. Профиль ищется по **точному совпадению `full_name`**; при совпадении имён побеждает последний.
5. `salary_data` за следующий период для этого профиля (`maybeSingle`):
   - строка есть — `update({overtime: overtime + недостача})`;
   - нет — `insert({profile_id, нулевые поля, overtime: недостача, month_year: следующий, user_id})`.
6. Вызывается при **каждом** «Обновить» и «Сохранить», учёта уже перенесённого нет (см. замечания). Ошибки только пишутся в консоль.

#### 3.10. Блокировка и пин-код

- Месяц заблокирован, если хотя бы у одной строки `locked = true`.
- «Разблокировать» (при `canUnlock`) открывает модалку «Разблокировка — Введите пин-код для временного доступа» (до 4 цифр).
- Проверка в браузере: `pinInput === UNLOCK_PIN` (`'<код-разблокировки>'`, `Collection.tsx:136`).
  - Верно: `tempUnlocked = true` на 15 минут (таймер), в БД ничего не меняется.
  - Неверно: поле подсвечивается красным на 2 с.
- Во время временной разблокировки «Обновить» пишет строки с данными с `locked: false`. Пустые строки, сохранённые ранее, остаются `locked: true`, поэтому после перезагрузки месяц снова считается заблокированным. «Сохранить» снова ставит всем `locked: true`.

---

### 4. Главная (`/dashboard`, `src/pages/Dashboard.tsx`)

Маршрут без `path`: видна любому вошедшему.

1. **Hero:**
   - надпись «Табель» и заголовок «<Текущий месяц> закрыт.» — **это статичный текст**: статус табеля не проверяется;
   - кнопка «Открыть табель» ведёт на `/schedule`;
   - строка «<workdays> смен из <workdays>» — `workdays` считается по календарю как число будних дней (пн–пт) текущего месяца (`monthInfo`), с данными табеля не связана.
2. **MonthSlab:** календарь текущего месяца, неделя с понедельника. Выходные бледные. Справа вверху — «<workdays × 8> часов». Только оформление, данных из БД нет.
3. **Приветствие:**
   - «<Компания или companyName или 'АнодБИЗ'> · <роль по-русски>»;
   - «Здравствуйте, <Имя>» — второе слово `fullName` (порядок «Фамилия Имя»), иначе первое слово; без имени — «Сводка».
4. **StatsRow:** 4 карточки-счётчика: «Документов» (`documents`), «Файлов в базе» (`base_files`), «Сообщений» (`chat_messages`), «Сотрудников» (`profiles`).
   - Каждый счётчик — `db.from(t).select('id')`. На деле выполняется `SELECT *` по всей таблице, на клиенте берётся `data.length`.
   - Пока не загрузилось — `—`.
   - Карточки — ссылки на разделы. «Сотрудники» для не директора и не зама — неактивная карточка, но число показывается всем.
5. **Разделы:** плитки из `visibleNav(role, access.sections)` без `/dashboard`.
   - Зам видит всё.
   - При наличии `sections` — разделы из списка, кроме `/admin` и `/devices`.
   - Иначе — по `roles` в `NAV_ITEMS`.

---

### Замечания по безопасности и корректности

#### Хардкод кодов разблокировки

1. **`src/pages/Salary.tsx:487`.** Таблица «Заведующий» разблокируется кодом `'<код-разблокировки>'`, который зашит в клиентский бандл и проверяется только в браузере. Сама запись `manager_settings.update({is_locked:false})` (`:489`) — обычный запрос к data-api, его может отправить любой авторизованный пользователь без кода. В `handleUnlockManager` нет проверки `canLock`. Запрос идёт без `await`, ошибка теряется.
2. **`src/pages/Collection.tsx:136`.** `const UNLOCK_PIN = '<код-разблокировки>'` — тот же код, тоже на клиенте. Разблокировка — только флаг `tempUnlocked` в состоянии React (`:376`). Таймер на 15 минут обходится перезапуском или правкой состояния.

#### Права только в интерфейсе; сервер не проверяет роли

3. **`backend/data-api/index.py:160–300`.** Проверяется только валидность токена. Роли, компания, владелец строки и блокировки не проверяются. Поэтому любой сотрудник со своим токеном может напрямую:
   - читать `salary_data`, `manager_data`, `salary_settings` (все зарплаты всех);
   - менять или удалять любые строки `schedule_data`, `salary_data`, `collection_data`, `employee_rotation`, `profiles`, `pin_codes` и других таблиц;
   - снимать флаги `is_locked` / `locked`.

   Все проверки `canEdit/canLock/isDir/isDeputy` в `Schedule.tsx:375–379`, `Salary.tsx:115–118, 297–307`, `Collection.tsx:143–147, 252` — это только интерфейс.
4. **Скрытие колонок в «Зарплате» — косметика.** `Salary.tsx:176,179` загружают в браузер все строки `salary_data` и `manager_data` за период. `showExpanded` (`:339`) лишь прячет колонки в `SalaryGrid`. Полные суммы всех сотрудников видны в ответе сети.
5. **`Schedule.tsx:530–536, 701`.** Правый клик открывает модалку настроек сотрудника для **любого** пользователя. Её «Сохранить» и «Удалить/Вернуть» (`EmployeeSettingsModal.tsx:135–229`) пишут в `schedule_config` и `employee_schedule_settings` без проверки роли. Так же кнопки «Исключённые» → «Настройки» и «Вернуть» (`Schedule.tsx:618, 761, 768`) доступны всем.
6. **Безусловная запись при просмотре.** `Salary.tsx:225–231`: при открытии месяца без строк **любой** пользователь, даже рядовой сотрудник или директор в режиме просмотра, вставляет строки в `salary_data` и `manager_data` (`:258, :281`). Защиты от гонок нет: два одновременных открытия создадут дубли.
7. **В «Зарплате» директор не может редактировать.** `Salary.tsx:111`: `isDeputy` = только `deputy_director`, хотя в табеле (`Schedule.tsx:238`) директор приравнен к заму. Права расходятся между страницами.

#### VK-рассылки

8. **`vk-api` без авторизации.** `Schedule.tsx:503–507`, `Salary.tsx:581–585`: `POST vk-api {action:'broadcast', items}` идёт без `X-Authorization`, и `backend/vk-api/index.py:207–211` его не требует. Кто угодно, зная URL функции, может разослать произвольный текст и картинку на любые `vk_user_id` от имени группы (`VK_GROUP_TOKEN`).
9. **Открытый список привязок.** `src/lib/vkBinding.ts:61` → `GET vk-api?action=bindings_list` (`vk-api/index.py:184`) без авторизации отдаёт полную карту `profile_id → vk_user_id`. Без авторизации работают также `generate_code` и `unbind` (`index.py:194–205`).
10. **Кто может запустить рассылку зарплат.** `Salary.tsx:774`: при `!usePositions` (пользователь без должности) кнопка видна любому, и он может разослать расчёты всем. Рассылка табеля (`Schedule.tsx:797`) доступна всем без условий.

#### Целостность данных

11. **Повторный перенос недостач.** `Collection.tsx:299, 355, 385–437`: `carryShortageToNextMonth` выполняется при каждом «Обновить» и «Сохранить» и каждый раз прибавляет всю сумму недостач к `overtime` следующего месяца (`:422`). Отметки о переносе нет, поэтому повторные нажатия многократно увеличивают удержание. Сопоставление по `full_name` (`:408–413`) ломается на однофамильцах и при переименовании.
12. **Очистка значений не сохраняется.** `Collection.tsx:264–265`: «Обновить» пропускает строки без данных, поэтому сброс «Факт» в 0 или удаление статуса у уже сохранённой строки не записываются в БД. Записывает только «Сохранить» (с блокировкой).
13. **Неверный «последний месяц».** `Salary.tsx:244, 267`: период `MM.YYYY` ищется сортировкой строк, и `"12.2025"` оказывается «позже» `"01.2026"`. Список людей копируется не из того месяца.
14. **Сохранение табеля не атомарно.** `Schedule.tsx:440–445`: сначала удаляются все строки месяца, затем идут построчные вставки без транзакции и без проверки ошибок. Сбой посередине частично теряет табель. Ошибки сохранения не показываются.
15. **Табель нельзя разблокировать из интерфейса.** `Schedule.tsx:461–469`: `handleUnlock` не привязан ни к одной кнопке. `handleDeleteRow` (`:409`) и `canManageSettings` (`:376`) тоже не используются.
16. **Новые сотрудники не попадают в сохранённый табель.** `Schedule.tsx:350–361`: если за месяц уже есть `schedule_data`, сотрудники без строки (новые, возвращённые) не показываются, пока график не сгенерируют заново. «Вернуть» (`:429–431`) ничего не пишет, если строки `schedule_config` нет.
17. **Запись при каждом нажатии клавиши.** `Salary.tsx:345–357`: `update` уходит на каждое изменение ячейки, без debounce и обработки ошибок. Ответы могут прийти не по порядку, и в БД останется промежуточное значение. Выручка и дни до первой «Сохранить» в БД не пишутся (`:377–385`).
18. **Ответственный блокирует, но не разблокирует.** `Salary.tsx:405–450`: сохранение ответственным блокирует обе таблицы, а снять блокировку он не может (`canLock`). `addManagerRow` (`:387`) не проверяет `managerLocked`.
19. **Подтверждений нет.** Удаление строк ЗП (`Salary.tsx:371, 397`), сохранение с блокировкой и пересоздание ротации (`RotationSettings.tsx:134–140` — удаление всех строк `employee_rotation` и вставка заново) выполняются сразу. Ротация создаёт до 72 × N строк `salary_data` (`:174–216`).

#### Клиентский код и XSS

20. **XSS через ФИО при печати.** `Schedule.tsx:206, 229`: печать вставляет `full_name` в HTML через `document.write` без экранирования. Окно `about:blank` наследует origin приложения. ФИО с `<script>` или `<img onerror>` выполнит код с доступом к `localStorage['anod_session_token']` через `opener` или в том же origin. Поменять ФИО через data-api может любой пользователь (п. 3).
21. **Внешняя зависимость во время работы.** `Collection.tsx:76`: XLSX-парсер загружается с `esm.sh` при каждом импорте, без фиксации целостности (SRI). Это риск цепочки поставок, и без интернета импорт не работает.
22. **Ошибки парсинга СБИС.** `Collection.tsx:38–42`: правила 5–9 и 18–21 в `classifyShift` ничего не дают (итог — `hour < 12`). Ночная смена, открытая после полуночи (например, в 00:30), будет отнесена к «Д» следующей даты. Даты-числа Excel (не текст) не разбираются (`:111–115`).

#### Солвер

23. **Правила солвера мягкие.** `scheduleSolver.ts:31–32`: правила СТ/МЛ можно нарушить, если иначе останется пустой слот, а сообщение «4 смены каждый день» (`Schedule.tsx:393`) выводится всегда, даже при пустых слотах (их видно только по красным и янтарным итогам дня). `setBalanceWeight` и `setNoNightCost` экспортированы, но не вызываются. Группа `СТx` всегда пуста. Перебор дня — n⁴ сочетаний в основном потоке браузера: при большом штате интерфейс зависает.

---

# 7. Остальные страницы и оболочка сайта

Документ описывает, как ведут себя страницы и оболочка SPA (Vite + React + TS). Внутреннее устройство серверных функций описано в других файлах `docs/ref/*`. Здесь указано только то, **какой запрос уходит** и **что происходит в интерфейсе**.

Обозначения:
- `data-api: <table>.<op>(фильтры)` — универсальный CRUD-запрос через `db.from(table)` из `src/lib/sdk.ts`. Он уходит POST-ом на функцию `data-api` с телом `{table, op, filters, order, limit, single_mode, payload}` и заголовком `X-Authorization: <anod_session_token>`. Обратите внимание: `upsert()` в SDK на деле выполняет `insert` (`sdk.ts:59`), а `select(cols)` колонки игнорирует и отдаёт `SELECT *` (`sdk.ts:57`).
- `auth-api: action` — запрос через `auth.*` (`sdk.ts`) или `src/lib/devices.ts`. Токен передаётся **в теле** (`token`), а не в заголовке.
- `admin-api / accounting-api / sber-api / skud-api / cameras-api / device-control: action` — POST `{action, ...}` с заголовком `X-Authorization`. Обёртки: `adminCall`, `accCall`, `sberCall`, `skudCall`, `camerasCall`, `callControlApi`.
- `vk-api` — вызывается **без токена** (`src/lib/vkBinding.ts`).

---

### 0. Общая инфраструктура

#### 0.1. Хранилища браузера

| Ключ | Где | Кто пишет / читает | Назначение |
|---|---|---|---|
| `anod_session_token` (localStorage) | `sdk.ts:14` | пишут signin/signup/pin_signin/redeem_login_link, удаляет signOut; читают все API-обёртки | сессионный токен |
| `biz_pin_match` (localStorage) | `PinLogin.tsx:35`, `PinAuth.tsx:19` | PinLogin пишет `{userName, profileEmail}`, PinAuth читает и удаляет | передаёт найденный по PIN профиль на шаг ввода пароля |
| `anodbiz_chat_last_seen_id` (localStorage) | `useChatNotifications.ts:10` | глобальный опрос чата | id последнего увиденного сообщения |
| `anodbiz_chat_unread` (localStorage) | `chatUnread.ts:6` | счётчик непрочитанных + событие `anodbiz-chat-unread-changed` | бейдж «Чат» в меню |
| `abiz_device_token` (sessionStorage) | `CamView.tsx:22`, `camerasApi.ts:31` | CamView достаёт его из `#t=` | токен ПК для `cameras-api` без входа на сайт |

#### 0.2. AuthProvider (`src/lib/auth.tsx`)

**Инициализация** (`:148-165`): `auth.getSession()` отправляет `auth-api: session {token}`. Если пользователя нет, токен удаляется. Если сессия есть:
1. `loadCompany()` делает `data-api: companies.select(id='main').maybeSingle`. Система рассчитана на одну компанию.
2. `resolveUserRole(email, userId)`:
   - `auth-api: get_roles`. Если среди ролей есть `admin` (это первый зарегистрированный пользователь, `auth_users.is_admin`), роль = **director**, а профиль ищется через `profiles.select(email=…)`.
   - Иначе ищется `profiles.select(user_id=authUserId).limit(1)`, при неудаче `profiles.select(email=authEmail)`. Комментарий говорит «без учёта регистра», но в коде стоит обычный `eq`.
   - Роль берётся из `profiles.role`, если значение входит в `director|deputy_director|senior_employee|employee`. Иначе и при отсутствии профиля роль = `employee`.
3. Собирается объект `User {id, email, login=email до @, role, companyId, companyName, fullName, profileId, department, inn, ogrn}`.

`loading=true`, пока не закончится инициализация.

**Методы:**
- `signUp(data)` (`:167-234`): `auth-api: signup {email,password}`, токен сохраняется. Затем:
  - `companies.select(id='main')`; если запись есть, `companies.update({name,inn,ogrn,type}).eq(id,'main')`, иначе `companies.insert({id:'main',…})`;
  - `profiles.insert({user_id, full_name, email, role:'director', department:'Руководство', status:'active', has_system_access:true})`. Ошибка только пишется в консоль;
  - `user` и `company` выставляются локально, роль = `director` (без повторной проверки на сервере).
- `signIn(email,password)`: `auth-api: signin`. Сервер возвращает токен и `api_token`; токен сохраняется. Затем `loadCompany` + `buildUser`. Без `user` в ответе бросается «Не удалось войти. Проверьте email и пароль.»
- `signInWithPin(pin, adpodSlug)`: `auth-api: pin_signin {pin, adpod_slug}` (вход без пароля), затем то же.
- `signInWithLoginCode(code)`: `auth-api: redeem_login_link {code}`.
- `signOut()`: `auth-api: signout {token}` (ошибки игнорируются), токен удаляется, `user=null`.
- `refreshUser()`: заново выполняет `session` + сборку пользователя.
- `refreshRoles()`: `auth-api: get_roles` → `true`, если есть `admin`. В `Employees` и `Settings` результат не используется.

#### 0.3. AccessProvider (`src/lib/access.tsx`)

- При изменении `user` выполняется `admin-api: my_access`. Ответ `AccessInfo {role, position, sections[], actions[], is_deputy, formulas, fields, general}`. При ошибке `access` остаётся `null`.
- `can(action) = access && (is_deputy || actions.includes(action))`.
- `canSee(path) = !access || is_deputy || sections.includes(path)`. Пока доступ не загружен или запрос упал, **разрешено всё**.
- `adminCall(body)` — общая обёртка над `admin-api`. Ошибки превращаются в `{error:'Ошибка сервера'|'Нет связи с сервером'}`.
- `evalFormula(expr, env)` — безопасный парсер формул без `eval`: `+ - * / ( )`, функции `round/min/max/abs/floor/ceil`, `;` разделяет аргументы, `,` воспринимается как десятичная точка; деление на 0 даёт 0.

#### 0.4. Маршрутизация и guard (`src/App.tsx`)

`ProtectedRoute({directorOnly, deputyOnly, path})` (`App.tsx:45-61`):
1. Пока `loading` — спиннер.
2. Нет `user` → `<Navigate to="/login">`.
3. Если передан `path` **и** `access` уже загружен: при `!canSee(path)` → `/dashboard`, иначе страница внутри `AppShell`. **Проверки `directorOnly/deputyOnly` в этой ветке не выполняются.**
4. Иначе (нет `path` или `access` ещё `null`) проверяются `directorOnly` (director или deputy_director) и `deputyOnly` (только deputy_director).
5. Страница рендерится в `AppShell`.

| Маршрут | Компонент | Guard |
|---|---|---|
| `/` | → `/dashboard` | — |
| `/login`, `/register`, `/pin-login`, `/pin-auth`, `/device-login`, `/cam-view` | публичные | нет |
| 3 пути АдПодов из `PIN_ADPODS` | `AdpodPinLogin` | нет |
| `/dashboard` | Dashboard | только авторизация |
| `/documents` `/base` `/dto` `/chat` `/cameras` `/skud` `/salary` `/schedule` `/sber` `/accounting` `/collection` `/settings` | … | `path` → `canSee` |
| `/employees` | Employees | `directorOnly` + `path`. После загрузки access решает только `canSee('/employees')` |
| `/admin`, `/devices` | Admin, Devices | `deputyOnly` (роль `deputy_director`) |
| `*` | → `/dashboard` | — |

Компоненты `NotFound` и `Index` в маршрутах **не используются**.

#### 0.5. Навигация (`src/lib/navigation.ts`)

`NAV_ITEMS` разбиты на группы-разделители 0–3: Главная; Документация, База документов, ДТО, Чат, Камеры, СКУД (roles: director/deputy/senior); Табель, Зарплата, Инкассация, Бухгалтерия, СБЕР (roles: director/deputy/senior); Сотрудники (director/deputy), Админ-панель (deputy), Управление ПК (deputy), Настройки.

`visibleNav(role, sections)`:
- `deputy_director` видит все пункты;
- если `sections` загружены: `/dashboard` плюс пункты из `sections`, кроме `/admin` и `/devices`;
- иначе фильтр по `roles` у пунктов.

`ROLE_LABELS`: Директор / Зам. директора / Старший сотрудник / Сотрудник. `initials()` и `shortName()` формируют «Фамилия И. О.».

---

### 1. Оболочка (Shell)

#### 1.1. `AppShell` (`components/shell/AppShell.tsx`)

Сетка `app-grid` состоит из четырёх зон:
- **Боковая панель** (`aside`, только `lg+`) с `SideNav`.
- **Шапка**: строка-уведомление. Значение по умолчанию **захардкожено**: «Зарплата за сентябрь рассчитана по табелю.» и ссылка «Проверить ›» на `/salary` (`AppShell.tsx:17-20`). Проп `notice` никто не передаёт. На мобильных слева кнопка «Меню», она открывает `Sheet` (выезжает слева, 280px) с той же `SideNav`; переход по пункту закрывает лист.
- **main**: вверху `<SkudNotices/>`, ниже содержимое страницы.
- **BottomNav** (только `< lg`).
- Вызывается `useChatNotifications()`, поэтому глобальный слушатель чата работает на любой защищённой странице.

#### 1.2. `SideNav`

- Логотип и подпись «АнодБИЗ».
- Пункты из `visibleNav(user.role, access.sections)` с разделителями между группами. У «Чата» красный бейдж непрочитанных (`getUnreadCount` + `subscribeUnread`, больше 99 показывается как «99+»).
- Внизу аватар с инициалами, краткое ФИО, название роли и кнопка «Выйти»: `signOut()` → `navigate('/login')`.

#### 1.3. `BottomNav`

- Приоритет пунктов: `/dashboard, /chat, /schedule, /sber, /salary, /documents, /collection`. Показываются первые 4 из доступных, плюс кнопка «Ещё» (открывает Sheet с полной навигацией). «Ещё» подсвечивается, если текущий путь не входит в основные 4.
- У «Чата» бейдж непрочитанных.

#### 1.4. `SkudNotices`

- При монтировании и затем каждые **10 минут**: `skud-api: notices`. Каждое уведомление `{id, card_id, cycle, text, grace, days}` показывается плашкой: красной при `grace` (резервные дни), иначе жёлтой. В плашке ссылка «Перезаписать карту в СКУД ›» на `/skud?cards=1`, она сразу открывает панель карт.
- Крестик убирает плашку локально и отправляет `skud-api: notice_dismiss {card_id, cycle}`. Ответ не проверяется.
- При ошибке API (например, нет прав) блок не показывается.

#### 1.5. Глобальные уведомления чата (`hooks/useChatNotifications.ts`)

Включаются при наличии `user`:
1. Если `Notification.permission === 'default'`, вызывается `Notification.requestPermission()`.
2. Опрос `poll()` выполняется сразу и далее каждые **6000 мс**:
   - id комнаты кэшируется; в первый раз вызывается `ensureWorkingRoom()`: `chat_rooms.select(name='РАБОЧИЙ').limit(1)`, при отсутствии `chat_rooms.insert({name:'РАБОЧИЙ', type:'group', participants:[]})`;
   - `chat_messages.select(room_id=…).order(created_at desc).limit(20)`;
   - **первый проход** после загрузки приложения только запоминает `data[0].id` в `anodbiz_chat_last_seen_id`, если там пусто, и ничего не уведомляет;
   - далее список разворачивается от старых к новым. Ищется позиция `lastSeen`; «входящими» считаются сообщения после неё. Если `lastSeen` не найден среди последних 20, входящих нет;
   - если входящие есть, `last_seen` сдвигается на самое новое;
   - выбираются входящие от других (`sender_id !== user.id`). Если такие есть и **чат сейчас не открыт** (`isChatActive()`):
     - `incrementUnread(n)`;
     - проигрывается звук `/sounds/notification.mp3` на громкости 1 (ошибка автоплея игнорируется);
     - вибрация `[200,100,200]`;
     - системное уведомление `Notification` (только при разрешении). Заголовок: «<Имя> · РАБОЧИЙ» или «РАБОЧИЙ · N новых сообщений». Текст: первые 140 символов. Параметры `tag:'anodbiz-chat'`, `silent:true`. По клику — фокус окна и переход на `/chat`. Уведомление принудительно закрывается через **5 минут**.
3. Все ошибки глушатся.

#### 1.6. Счётчик непрочитанных (`lib/chatUnread.ts`)

- `getUnreadCount / setUnreadCount / incrementUnread / resetUnread` хранят значение в `localStorage['anodbiz_chat_unread']` и рассылают событие `anodbiz-chat-unread-changed`. `subscribeUnread` слушает это событие и `storage` (синхронизация между вкладками).
- Флаг в памяти `chatActive` (`setChatActive/isChatActive`).
- `markChatReadOnServer()`: `device-control: chat_mark_read` с заголовком `X-Authorization`. Нужен, чтобы десктоп-программа АБИЗ перестала напоминать. Без токена или URL запрос не отправляется; ошибки игнорируются.

---

### 2. Страницы авторизации

#### 2.1. `/login` — `Login.tsx`

- **Назначение:** вход по email и паролю. Публичная.
- Форма: Email (`type=email`, обязательное), Пароль (обязательное). Кнопка «Войти», во время запроса «Вход...».
- Отправка:
  1. Ошибка очищается, `loading=true`.
  2. `signIn(email, password)` → `auth-api: signin`.
  3. Успех → `navigate('/dashboard')`.
  4. Ошибка → красная плашка с `err.message` (текст с сервера, например «Неверный email или пароль»). Запасной текст: «Неверный email или пароль».
- «Быстрый вход по пин-коду» ведёт на `/pin-login`.
- Ссылка «Зарегистрировать компанию» на `/register` (обычный `<a>`, полная перезагрузка страницы).
- Если пользователь уже вошёл, страница его **не** перенаправляет.

#### 2.2. `/register` — `Register.tsx`

Двухшаговый мастер. Публичная страница, работает всегда (ограничения «только первая регистрация» на клиенте нет).

**Шаг 1. Компания:**
- Тип организации: переключатель «ИП»/«ООО», по умолчанию ООО.
- Название (обязательно).
- ИНН: нецифровые символы вырезаются, `maxLength=12`; длина должна быть 10 или 12.
- ОГРН: только цифры, `maxLength=15`; длина 13 или 15.
- Ошибки: «Введите название компании», «Введите ИНН», «ИНН должен содержать 10 или 12 цифр», «Введите ОГРН», «ОГРН должен содержать 13 или 15 цифр».
- «Далее» переводит на шаг 2.

**Шаг 2. Руководитель:**
- ФИО, Email (regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`), Пароль (не менее 6), Подтверждение (должно совпасть).
- Ошибки: «Введите ФИО руководителя», «Введите email», «Введите корректный email», «Придумайте пароль», «Пароль должен содержать минимум 6 символов», «Пароли не совпадают».
- «Назад» возвращает на шаг 1. «Зарегистрироваться» (во время запроса «Регистрация...») вызывает `signUp`.

**Что создаётся (`auth.tsx:167-234`):**
1. `auth-api: signup`: запись в `auth_users`. Если таблица пуста, ставится `is_admin=true` (такой пользователь становится «директором»). Создаётся сессия.
2. `companies`: запись `id='main'` обновляется или создаётся (name, inn, ogrn, type). **Существующая компания перезаписывается** при любой новой регистрации.
3. `profiles.insert({user_id, full_name, email, role:'director', department:'Руководство', status:'active', has_system_access:true})`.
4. После успеха `navigate('/dashboard')`. Ветка `needsEmailConfirmation` (экран «Регистрация завершена» с кнопкой на `/login`) недостижима: SDK всегда возвращает `false`.
- Ошибки сервера (например, 409 «Пользователь с таким email уже существует») показываются плашкой.

#### 2.3. `/pin-login` — `PinLogin.tsx` (PIN + пароль)

1. Четыре поля `type=password inputMode=numeric maxLength=1`. Фокус автоматически переходит вперёд при вводе и назад по Backspace на пустом поле. Кнопка неактивна, пока не введены 4 цифры.
2. Отправка: проверка длины (иначе «Пин-код должен содержать 4 цифры»), затем `auth.pinLookup(pin)` → `auth-api: pin_lookup {pin, adpod_slug:''}`. В ответе `{email, full_name}`. Ошибка сервера превращается в `null`.
3. `null` → «Неверный пин-код».
4. Успех: в `localStorage['biz_pin_match']` пишется `{userName, profileEmail}`, показывается зелёное «Найден: <Имя>. Переход...», через 500 мс переход на `/pin-auth`.
5. Исключение → «Произошла ошибка. Попробуйте ещё раз.»
6. «Обычный вход (email + пароль)» ведёт на `/login`.

#### 2.4. `/pin-auth` — `PinAuth.tsx`

Состояния: `loading | need_password | success | error`.
1. Читается `biz_pin_match`. Если ключа нет: «Данные входа не найдены», через 2 с переход на `/pin-login`.
2. Если `user` уже есть: ключ удаляется, «Добро пожаловать, <Имя>!», через 1 с `/dashboard`.
3. Если в данных есть email, показывается форма пароля: «Добро пожаловать!», имя, email в рамке, поле пароля.
4. Нет email: «Не удалось определить email для входа», ключ удаляется, через 2 с `/pin-login`. Ошибка разбора JSON: «Ошибка авторизации», та же реакция.
5. Ввод пароля: `signIn(profileEmail, password)` → `auth-api: signin`. Успех: ключ удаляется, success, через 1 с `/dashboard`. Ошибки разбираются по подстрокам:
   - «Invalid login credentials», «неверн», «невозможно», «check» → «Неверный email или пароль…»;
   - «Email not confirmed», «подтверд» → «Email не подтверждён…»;
   - остальное → текст ошибки.
6. Кнопка «Другой пин-код» удаляет ключ и ведёт на `/pin-login`.

#### 2.5. АдПоды — `AdpodPinLogin.tsx` + `lib/pinAdpods.ts`

- Маршруты (публичные, захардкожены в коде):
  - `/pin-cod-sallet-inword-okredfit-offsdin` — «АдПод 1»;
  - `/pin-cod-tutokenswe-ruidfal-manu-direst` — «АдПод 2»;
  - `/pin-cod-famolderreg-hoocind-injoorenaz` — «АдПод 3».
- Ввод 4 цифр устроен так же, как в PinLogin. Подзаголовок — метка АдПода.
- Отправка: `signInWithPin(pin, slug)` → `auth-api: pin_signin`. Сервер ищет пин и требует `pin_codes.adpod_slug == slug`, затем находит `auth_users` по email или через `profiles.user_id` и создаёт сессию **без пароля**.
- Успех: «Добро пожаловать! Переход...», через 500 мс `/dashboard`.
- Ошибка: сообщение сервера («Неверный пин-код», «Этот пин-код привязан к другому адресу входа», «У сотрудника нет учётной записи для входа…»), поля PIN очищаются.

#### 2.6. `/device-login` — `DeviceLogin.tsx`

- Автовход из десктоп-программы по ссылке `?code=<одноразовый>&next=<путь>`.
- Нет `code` → «Ссылка неполная: отсутствует код входа.»
- `next` принимается, только если совпадает с `^/[a-z0-9/-]*$`, иначе используется `/dashboard`. Это защита от open redirect.
- `signInWithLoginCode(code)` → `auth-api: redeem_login_link`. Успех: `navigate(target, {replace:true})`. Ошибка: красная плашка и ссылка «Войти вручную» на `/login`. Пока идёт запрос, показывается «Выполняется вход...».

#### 2.7. `/cam-view` — `CamView.tsx`

- Полноэкранная живая камера для экрана входа АБИЗ, без входа на сайт.
- Если в адресе есть `#t=<токен ПК>`, токен сохраняется в `sessionStorage['abiz_device_token']`, а hash убирается (`history.replaceState`).
- Каждую секунду обновляются часы (оверлей).
- `cameras-api: list`: выбирается камера, чьё имя начинается с `?name=` (без учёта регистра), иначе камера `is_default`, иначе первая. Нет камер → ошибка «Камеры не найдены».
- `cameras-api: live {id, quality:'sd', fresh}`. Ошибка: показать текст и через 4 с повторить с `fresh=true`. Плеер `WasmHevcPlayer`; по `onFatal` — переподключение.
- `camerasCall` повторяет действия `live/playback/snapshot/records` до 3 раз с паузой 700 мс при ошибках вида «не ответила/timeout/сервер».

---

### 3. `/cameras` — Камеры (`Cameras.tsx`)

- **Кто видит:** `ProtectedRoute path="/cameras"`. Кнопки управления показываются при `can_manage` из ответа `cameras-api: list`.
- **Выбор плеера:** в браузере АБИЗ (UA `AbizShell|AbizAdmin|ABIZ/`) или с параметром `?wasm` используется свой WASM-декодер HEVC. Иначе, если браузер поддерживает HEVC/HLS, используется `HlsPlayer`, в противном случае тоже WASM.
- **Загрузка:**
  1. `cameras-api: list` → `cameras[], can_manage`. Выбирается камера из `?cam=`, иначе `is_default`, иначе первая. Если пришли `?cam&day&sec` (переход из СКУД), включается режим архива на эту секунду и открывается панель архива.
  2. Параллельно `cameras-api: live_all` заполняет кэш URL живых потоков (только SD).
- **Подключение** при смене камеры, режима или HD:
  - живой режим: URL из кэша (если не HD) или `cameras-api: live {id, quality: hd?'hd':'sd', fresh}`;
  - архив: `cameras-api: playback {id, start:'<day> HH:MM:SS', end: start+1ч (не позже 23:59:59)}`;
  - защита от гонок через `reqId`. Ошибка → «Не удалось получить видео».
- **Управление поверх видео:**
  - бейдж «АРХИВ dd.mm.yyyy»;
  - переключатель HD/SD;
  - звук вкл/выкл (по умолчанию выключен);
  - «Архив» показывает или скрывает `ArchiveBar`, который делает `cameras-api: records {id, day, from_hour, to_hour}`, отрисовывает записи, `onSeek(day,sec)` переводит в архив, `onLive` возвращает к живому видео;
  - «Настройка камер» (при `can_manage`) открывает `CameraManager`;
  - «На весь экран» (Fullscreen API);
  - стрелки «пред./след.» и клавиши ← → переключают камеры по кругу и возвращают живой режим (клавиши не работают в полях ввода и при открытом менеджере);
  - лента миниатюр-кнопок по названиям камер.
- **onFatal плеера:** URL удаляется из кэша. В живом режиме через 1 с переподключение с `fresh`. В архиве — «Запись прервалась. Выберите другое время.»
- **Пустое состояние:** «Камер пока нет». Для менеджера кнопка добавить и подсказка, остальным «Директор или зам. директора ещё не добавил камеры.»
- **`CameraManager` (диалог):**
  - форма: Название, Серийный номер, Имя для входа (по умолчанию `admin`), Пароль. Сохранение: `cameras-api: add` или `update {...form}`; в ответе `cameras[]`;
  - «Сделать по умолчанию» → `set_default {id}`;
  - стрелки порядка: локальная перестановка и `reorder {ids}`;
  - удаление: `confirm("Удалить камеру «…»?")` → `delete {id}`;
  - ошибки выводятся в диалоге.

---

### 4. `/chat` — Чат (`Chat.tsx`)

- **Кто видит:** `ProtectedRoute path="/chat"`.
- **Комнаты:** одна общая группа «РАБОЧИЙ» (`ensureWorkingRoom`, см. 1.5). Личных комнат нет.
- **При открытии:** `setChatActive(true)`, `resetUnread()`, `markChatReadOnServer()` (`device-control: chat_mark_read`). При уходе со страницы: `setChatActive(false)` и снова `chat_mark_read`.
- **Загрузка:** `ensureWorkingRoom()`, затем `chat_messages.select(room_id).order(created_at asc)`. Загружается **вся история без лимита**.
- **Опрос:** каждые **4000 мс** перезагрузка сообщений, `resetUnread()` и `chat_mark_read`.
- **Отображение:** группы по дням («Сегодня», «Вчера», «d месяца»). Свои сообщения справа синим, чужие слева с инициалами и именем. Время HH:MM. При каждом изменении списка автопрокрутка вниз.
- **Отправка:** Enter (Shift+Enter — перевод строки) или кнопка.
  1. Пустой текст и повторная отправка блокируются.
  2. Поле очищается сразу.
  3. `chat_messages.insert({room_id, sender_id:user.id, sender_name:user.fullName||'Сотрудник', content, read:false})`.
  4. Успех: сообщение добавляется в конец. Ошибка: текст возвращается в поле, без сообщения пользователю.
- Флаг `read` в БД ни где не меняется. «Прочитанность» хранится только локально (last_seen + unread) и на сервере через `chat_mark_read`.

---

### 5. `/documents` — Документация (`Documents.tsx`)

- **Кто видит:** `path="/documents"`. Удалять может только director или deputy_director, и проверка есть только в UI.
- **Загрузка:** `documents.select().order(created_at desc)`. Если `tags` не массив, подставляется `[]`.
- **Поиск** по названию или тегам на клиенте.
- **«Новый документ»** создаёт локальный черновик `id='new_<ts>'` («Новый документ») и открывает редактор.
- **Карточка документа:** клик открывает модалку просмотра (контент, «Создан/Обновлён/Автор», кнопки «Скачать» и закрыть).
- **Меню ⋮:**
  - «Просмотреть»;
  - «Скачать» — `.txt` из `content`;
  - «Редактировать» — открывает редактор: Название, Теги через запятую, Содержимое;
  - «Удалить» (только director/deputy) → `documents.delete(id)`. **Без подтверждения**; карточка удаляется локально даже при ошибке.
- **Сохранение:**
  - новый документ: `documents.insert({title, content, author:user.fullName, tags})`, черновик заменяется ответом;
  - существующий: `documents.update({title, content, updated_at, tags}).eq(id)`;
  - ошибки глушатся. «Отмена» закрывает редактор, но несохранённый черновик `new_` остаётся в списке до перезагрузки.

---

### 6. `/base` — База документов (`DocumentBase.tsx`)

- **Кто видит:** `path="/base"`. Удаление доступно director/deputy, проверка только в UI (`canDelete`, `:124,131,176`).
- **Загрузка** при смене папки: `folders.select(parent_id=currentFolder).order(name)` и `base_files.select(folder_id=currentFolder).order(uploaded_at desc)`. Для корня `eq(null)` превращается в `IS NULL`.
- **Статистика:** число файлов, суммарный объём, число папок (по текущей папке).
- **Хлебные крошки:** «Корень» и путь; клик обрезает путь.
- **Поиск** по имени папок и файлов.
- **«Новая папка»:** модалка с названием. Пустое название игнорируется. Иначе `folders.insert({name, parent_id})`.
- **«Загрузить»:** модалка, выбор нескольких файлов. Для каждого файла:
  1. `storage.upload('documents', file)` → `file-upload` (base64 data URL). Ошибка пишется в консоль, загрузка продолжается **без URL**.
  2. `base_files.insert({name, type, size, folder_id, uploaded_by: fullName||email, is_protected:false, url})`.
  3. Ошибки: «Ошибка сохранения «X»: …» или «Ошибка загрузки «X»».
- **Папки:** клик открывает папку; иконка корзины (director/deputy) → `folders.delete(id)` без подтверждения и без каскада.
- **Файлы:** просмотр, скачивание, удаление.
  - Просмотр: изображения через `<img>`, PDF через `<iframe>`, остальное — карточка с именем. Без URL: «Файл загружен без привязки к хранилищу».
  - Скачивание: по URL в новой вкладке. Без URL скачивается `.txt` с метаданными.
  - Удаление `base_files.delete(id)` без подтверждения. Файл в хранилище не удаляется.
  - Флаг `is_protected` только отображается (🔒) и ни на что не влияет.

---

### 7. `/dto` — ДТО, шаблоны документов (`Dto.tsx`)

- **Кто видит:** `path="/dto"`.
- **Загрузка:** `dto_categories.select().order(name)` (если пусто, используются встроенные «Договоры, Приказы, Акты, Счета, Другое») и `dto_templates.select().order(created_at desc)`. К каждому шаблону подставляется `category_name`.
- **Блоки:**
  - вид «плитка/список»;
  - «Новый шаблон»;
  - карточки-фильтры по категориям со счётчиками (повторный клик снимает фильтр);
  - поиск по названию и описанию;
  - select категории.
- **Карточка шаблона:** клик открывает просмотр; кнопка скачать (`.txt`).
- **Модалка просмотра:**
  - «Редактировать» открывает модалку правки;
  - «Скачать»;
  - «Удалить» видна только director/deputy → `dto_templates.delete(id)` без подтверждения;
  - внизу счётчик «N использований». `usage_count` нигде не увеличивается.
- **Создание:** Название (обязательно; иначе ничего не происходит), Категория, Описание, Текст → `dto_templates.insert({…, usage_count:0})`.
- **Правка:** `dto_templates.update({name, category_id, content, description}).eq(id)`.
- Ошибки глушатся.

---

### 8. `/employees` — Сотрудники (`Employees.tsx`)

- **Кто видит:** `ProtectedRoute directorOnly path="/employees"`. Пока access не загружен, пускаются director/deputy. После загрузки — любой, у кого в `sections` есть `/employees` (deputy видит всегда). Пункт меню виден director/deputy или по `sections`.
- **Загрузка** (`loadData`, после `refreshRoles()`):
  1. `profiles.select().order(created_at desc)` — все профили.
  2. `pin_codes.select()` — **все PIN-коды компании в открытом виде**.
  3. Для каждого профиля `vk-api GET ?action=status&profile_id=…` (N запросов без авторизации). Из ответа собирается `binding {vk_user_id, vk_link, status, message}`.
- **Шапка:**
  - «Устройства» открывает модалку устройств;
  - «Добавить» открывает модалку добавления.
- **Статистика:** Всего; С доступом (`has_system_access`); VK привязано (`status==='confirmed'`); ещё одна карточка-счётчик.
- **Поиск** по ФИО, email, отделу.
- **Таблица:**
  - Сотрудник (инициалы, ФИО, email); Роль (метки для deputy/senior/employee, иначе сырое значение); Отдел;
  - VK: «Привязан» или «Ожидание», иначе «—»;
  - Доступ: Есть/Нет;
  - Пин-код: **показан открытым текстом** с кнопкой копирования;
  - меню ⋮: «Редактировать», «Пин-код» (неактивен без доступа), «Удалить». Меню закрывается кликом вне.
- **Тост:** зелёный или красный в правом верхнем углу, 3 с.

#### 8.1. Добавление сотрудника

Поля: ФИО*, Email*, Роль (Сотрудник / Старший сотрудник / Зам. директора; роли «Директор» нет), Отдел (Руководство, Отдел продаж, Бухгалтерия, IT, Маркетинг, HR), чекбокс «Доступ в систему» («Сотрудник сможет войти по email + пароль»). При доступе появляется поле «Пароль» (placeholder «Минимум 6 символов»).

Кнопка неактивна без ФИО и email, а также при включённом доступе без пароля.

Шаги:
1. Если доступ включён и пароль задан: `auth.signUpWithPassword` → `auth-api: signup` (публичное действие). Ошибка → «Ошибка создания аккаунта: …», выход.
   **Побочный эффект:** `signUpWithPassword` сохраняет в `localStorage` токен **нового** пользователя (`sdk.ts:185`). Сессия директора подменяется сессией сотрудника, и все последующие запросы, включая `profiles.insert`, идут от имени сотрудника.
2. `user_id = authUserId`, если это UUID, иначе `crypto.randomUUID()` (фиктивный).
3. `profiles.insert({full_name, email, role, department, status:'active', has_system_access, user_id})`. Ошибка → «Ошибка сохранения: …».
4. Успех: модалка закрывается, тост «Сотрудник добавлен», `loadData()`.

#### 8.2. Редактирование

Модалка с полями ФИО, Email, Роль, Отдел («Без отдела» + список), Статус (Активен/Неактивен), Доступ в систему.

При открытии: `vk-api status` → текущий код привязки.

**Блок «Привязка VK»:**
- статус `confirmed`: «Привязан», ссылка VK, кнопка «Отвязать VK» → `unbindVk(id)`: `vk-api POST {action:'unbind', profile_id}` и `profiles.update({vk_link:null, vk_id:null})`. Тост «VK отвязан»;
- иначе: код привязки (если есть) с подсказкой «Сотрудник отправляет этот код боту VK». Кнопка «Создать код» / «Новый код» → `vk-api POST {action:'generate_code', profile_id}`. Тосты «Код сгенерирован» или «Ошибка генерации кода».

«Сохранить» → `profiles.update({full_name, email, role, department, status, has_system_access}).eq(id)`, тост «Данные обновлены». Пароль и учётная запись `auth_users` при этом не меняются. Включение «доступа» аккаунт не создаёт.

#### 8.3. Удаление

Модалка «Удалить сотрудника?» → «Удалить»:
1. `pin_codes.delete(email=…)`;
2. `unbindVk(id)`;
3. `profiles.delete(id)`.

Запись `auth_users` **не удаляется**, сессии и API-токены сотрудника остаются. Тост «Сотрудник удалён».

#### 8.4. PIN-коды и АдПоды

Модалка «Пин-код для входа»:
- **Пин есть:** крупно показан текущий пин (копирование) и подпись привязанного АдПода. Привязку сменить нельзя: можно только выбрать АдПод и пересоздать пин.
- **Пина нет:** «Пин-код ещё не создан», select «— Выберите АдПод —» со списком «АдПод N (путь)».
- Кнопка генерации неактивна без доступа в систему или без выбранного АдПода.

`handleGeneratePin(profile, slug)`:
1. Проверки с тостами: «У сотрудника нет доступа в систему», «Сначала выберите адресный поддомен (АдПод)», «У сотрудника нет email».
2. `pin_codes.delete(email)` удаляет старые пины.
3. Генерация 4 цифр через `Math.random()`. До 50 попыток: проверка уникальности `pin_codes.select(pin=…).limit(1)`. Если все попытки заняты, используется последний сгенерированный пин, даже повторяющийся.
4. `pin_codes.insert({user_id: UUID или случайный, pin, email, shortcut_code:'default', adpod_slug})`.
5. Тост «Пин-код сгенерирован», `loadData()`.

#### 8.5. Устройства (ПК с программой АБИЗ)

- «Устройства» открывает модалку и делает `auth-api: list_devices` (токен в теле).
- Список: код устройства, статус (Привязано / Ожидает / Отозвано), hostname и ФИО. Пустое состояние: «Пока ни одно устройство не подключалось…»
- **pending → «Привязать»:** диалог «Привязать устройство», код устройства, select сотрудника (с пометкой «(нет входа)», если `user_id` пуст). Для сотрудника без `user_id` появляется поле «Пароль для входа» (не менее 6 символов; без него тост об ошибке).
  `auth-api: link_device {device_code, profile_id, password}`. Успех: тост «Устройство привязано к X», модалка с **API-ключом устройства** («единственный раз, когда он показан полностью», кнопка «Скопировать»), обновление устройств и сотрудников.
- **linked → «Пароль»:** диалог «Сменить пароль» (не менее 6) → `auth-api: set_employee_password {profile_id, password}`, тост «Пароль обновлён».
- **linked → «Отозвать»:** `auth-api: revoke_device {device_code}` **без подтверждения**, тост «Доступ устройству отозван».

---

### 9. `/settings` — Настройки (`Settings.tsx` + `components/settings/*`)

- **Кто видит:** `path="/settings"`. Внутри вкладок: `isDeputy = role==='deputy_director'`, `isDirector = role==='director'`.
- **Вкладки:** Профиль, Компания, Быстрый вход, Зарплата, Табель, Уведомления, Безопасность. Данные вкладки подгружаются при её открытии.

#### 9.1. Профиль

- При открытии: `profiles.select(user_id=user.id).limit(1)` → `vk_link, vk_id`; затем `vk-api status` → текущий код.
- Поля ФИО, Email, Телефон. Телефон никуда не сохраняется.
- «Сохранить» → `profiles.update({full_name, email}).eq(user_id, user.id)`. При ошибке и наличии `profileId` повтор с `.eq(id, profileId)`. Затем `refreshRoles()`. Надпись «Сохранено!» на 2 с, **даже при ошибке**. Email в `auth_users` не меняется, а `user` в контексте не обновляется (`refreshRoles` его не перечитывает).
- **Привязка VK:**
  - если `vk_id` есть: «VK привязан (ссылка)» и «Отвязать VK» → `unbindVk`;
  - иначе «Получить код» / «Новый код» → `vk-api generate_code`. Ошибки: «Профиль не найден. Сохраните ФИО.», «Не удалось создать код…».

#### 9.2. Компания

Поля Название, ИНН, ОГРН. Кнопка «Сохранить» вызывает **тот же `handleSaveProfile`**: данные компании **не сохраняются** (`SettingsAccountTabs.tsx:156`), таблица `companies` не обновляется.

#### 9.3. Быстрый вход

- `pin_codes.select(email=user.email)`.
- Пинов нет: «Пин-код не назначен». Для директора кнопка «Создать мой пин (<PIN-директора>)», для остальных «Обратитесь к руководителю…».
- Пины есть: маска «••••», кнопки «показать/скрыть» и «копировать». Для директора кнопка «Обновить пин на <PIN-директора>».
- `handleCreateDirectorPin`: `pin_codes.delete(email)` и `pin_codes.insert({user_id, pin:'<PIN-директора>', email, shortcut_code:'default'})`. Пин **константный** (`Settings.tsx:13`), без `adpod_slug`: на АдПодах он не работает, работает через `/pin-login`. Ошибка выводится через `alert`.

#### 9.4. Зарплата (только deputy)

- Не deputy: «Доступно заместителю директора».
- Загрузка:
  - `profiles.select()`;
  - `salary_settings.select().is(month_year,null).limit(1)` → percent (по умолчанию 2.5), is_locked, responsible_profile_id;
  - `manager_settings.select().is(month_year,null).limit(1)` → manager_percent (по умолчанию 5), responsible.
- Поля:
  - «Процент от выручки» (неактивно при блокировке). «Заблокировать» открывает диалог кода (`SettingsDialogs`); при совпадении с `SECRET_CODE='<код-разблокировки>'` (`Settings.tsx:12`) выполняется `saveGlobalSalarySettings(…, locked:true)`, иначе «Неверный код». «Разблокировать» снимает блокировку **без кода** (`handleUnlockPercent`);
  - «Ответственный за расчёт ЗП»;
  - «Процент заведующего»;
  - «Ответственный за заведующих».
- «Сохранить»: `salary_settings` update или insert (`{percent, is_locked, responsible_profile_id, revenue:0, days_in_month:30, month_year:null}`), затем `manager_settings` update или insert. Результат «Сохранено!» или `alert('Ошибка сохранения настроек зарплаты')`.
- **`RotationSettings`** (ротация сотрудников по магазинам, редактирует deputy):
  - загрузка `profiles.select()`, `employee_rotation.select().order(position)`;
  - строки: магазин, ↑ ↓, активен вкл/выкл, удалить; добавление сотрудника;
  - «Сохранить»: удаление **всех** строк `employee_rotation` пачками по 20 (`delete().in(id, …)`), затем `insert` новых строк `{profile_id, position, store_name, active}`;
  - после этого для активных сотрудников **предсоздаются строки `salary_data` на 72 месяца вперёд** `{profile_id, нули, days_in_month, month_year:'MM.YYYY', responsible_user_id, user_id}`, пачками по 50, кроме уже существующих. Показывается число созданных.

#### 9.5. Табель

- Загрузка:
  - `profiles.select()`, без роли `director` и без пустой роли;
  - `schedule_settings.select().is(month_year,null).limit(1)`;
  - `schedule_config.select()` → множество `excluded`.
- Поле «Ответственный за табель» (неактивно, если не deputy).
- «Удаление сотрудников из табеля»: кнопки «Убрать»/«Вернуть» (только deputy).
- «Сохранить» (deputy):
  - `schedule_settings` update или insert `{responsible_profile_id}`;
  - для **каждого** профиля `schedule_config.select(profile_id)`, затем `update({excluded})` или `insert({profile_id, excluded, status:'ЛБ', no_day:false, no_night:false, break_days:1, priority:3})`. Это 2 последовательных запроса на сотрудника;
  - `alert` при ошибке.

#### 9.6. Уведомления

Четыре переключателя (Email, Push, Чат, Документы) хранятся только в памяти. **Никуда не сохраняются.**

#### 9.7. Безопасность

- «Изменить пароль»: три поля **без кнопки и без обработчика**. Функции не существует.
- «Доступ для десктоп-приложения»: при открытии `auth-api: get_api_token`. Ключ показан в поле-маске с кнопками «показать» и «скопировать».
- «Отозвать и выпустить новый ключ»: диалог подтверждения «Отозвать ключ доступа?» → `auth-api: revoke_api_token`. Новый ключ показывается открытым.
- Ключ не получен → «Не удалось получить ключ. Обновите страницу.»

---

### 10. `/accounting` — Бухгалтерия (`Accounting.tsx` + `components/accounting/*`)

- **Кто видит:** `path="/accounting"`. Внутри — права по действиям из `accounting-api: me` → `{actions, role, is_deputy, categories, counterparties}`. `can(a) = is_deputy || actions.includes(a)`.
- **Вкладки и права:**

| Вкладка | Право |
|---|---|
| Доходы и расходы (`entries`) | `accounting.view_entries` |
| Прибыль (`profit`) | `accounting.view_reports` |
| ДДС (`dds`) | `accounting.view_reports` |
| План-факт (`budget`) | `accounting.view_budget` |
| Контрагенты (`counterparties`) | `accounting.view_counterparties` |
| Зарплата (`salary`) | `accounting.view_salary` |

- Открывается первая доступная вкладка. Если доступных нет: «У вашей должности нет доступа к бухгалтерии…». Ошибка `me` выводится текстом.
- Бейдж «Только просмотр», если нет ни одного из прав `edit_entries/edit_salary/edit_budget/edit_counterparties`.
- **Период** (для entries, profit, dds): ← месяц →, две даты «с/по» (ручной ввод сбрасывает режим месяца, «Свой период»), кнопка «Весь год».

#### 10.1. `PeriodsBar` (виден при `close_month` или `edit_entries`)

- `accounting-api: periods`. Свёрнутый вид: «Месяцы · открыто N, закрыто M».
- Таблица: Месяц, Зарплата (сотр.+рук., из snapshot), Инкассация факт, Статус («закрыт · кто» или «открыт, синхронизируется»).
- «Обновить» (`canSync`, только для открытых месяцев) → `period_sync {period}`.
- «Закрыть месяц» (`close_month`) → confirm «Закрыть … Суммы зарплаты и инкассации зафиксируются…» → `period_close`.
- «Открыть» → confirm → `period_open`.
- Ошибки через `alert`. После успеха перезагрузка вкладок через `reloadKey`.

#### 10.2. Доходы и расходы (`EntriesTab`)

- `accounting-api: entries {date_from, date_to}` → `entries[]` и `closed[]` (закрытые месяцы).
- Фильтры: Все/Доходы/Расходы; статья; поиск по комментарию; источник (Внесено вручную, Инкассация (факт), Зарплата по месяцам, Выписка банка).
- Итоги: Доходы, Расходы, Разница.
- Кнопки (`edit_entries`): «Доход», «Расход», а также `BankImport`.
- Строка редактируема, если она не из инкассации или зарплаты (кроме банковских), её месяц не закрыт и она не `from_salary`. Иконки «изменить» (`edit_entries`) и «удалить» (`delete_entries`). Удаление: confirm «Удалить доход/расход на X?» → `entry_delete {id}`.
- **Диалог операции:**
  - вид (доход/расход), дата оплаты, месяц-период (последние месяцы), сумма, статья, контрагент, комментарий;
  - при выборе периода `accounting-api: salary_due {period, exclude_id}` → подсказка «Начислено / Инкассация по факту за месяц: X · уже внесено Y» с кнопкой «Подставить Z»;
  - новая статья: «Добавить» → `category_save {kind, name}`, статья сразу выбирается;
  - «Сохранить» → `entry_save {...form, id, category_id, counterparty_id}`. Ошибка показывается в диалоге.
- **`BankImport`:**
  - кнопка выбора файла выписки → `bank_preview {file_name, file(base64)}`;
  - диалог «Выписка банка»: строки (дата, контрагент и назначение, сумма, статья). Дубли и строки закрытых месяцев отмечены. Можно пропустить строку чекбоксом и выбрать статью;
  - «Загрузить» → `bank_import {file_name, file, categories{}, skip[]}` → «Загружено операций: N. Пропущено (уже были или месяц закрыт): M.»

#### 10.3. Прибыль (`ProfitTab`)

`profit {date_from, date_to}`: карточки доходов, расходов и прибыли, разбивка по статьям, таблица по месяцам. Только чтение.

#### 10.4. ДДС (`DdsTab`)

`dds {date_from, date_to}`: таблица статей по месяцам с итогами. «В Excel» выгружает CSV (`;`, BOM, десятичная запятая) с именем `ДДС_<from>_<to>.csv`.

#### 10.5. План-факт (`BudgetTab`)

- Свой выбор месяца. `budget {period}` → строки Статья / План / Факт / Отклонение / Исполнение.
- При `edit_budget` поля плана редактируемы.
- «Сохранить план» (активна при изменениях) → `budget_save {period, items}`.
- «Скопировать план прошлого месяца» → confirm → `budget_save {…, copy_from}`.
- Ошибки через `alert`.

#### 10.6. Контрагенты (`CounterpartiesTab`)

- `counterparties` → таблица: получено / оплачено / мы должны / нам должны.
- «+ Контрагент» (`edit_counterparties`): диалог (вид, название, ИНН, телефон, комментарий, «В архиве» при правке) → `counterparty_save`. После сохранения повторно запрашивается `me`, чтобы обновить справочник.
- Клик по строке: карточка контрагента и `cp_history {id}` (документы и оплаты).
- «Добавить документ» (направление, дата, сумма, комментарий) → `cp_doc_save {counterparty_id, …}`.
- Удаление документа: confirm → `cp_doc_delete {id}`.

#### 10.7. Зарплата (`SalaryTab`)

- Свой выбор месяца. `salary {period}` → сотрудники: долг на начало, начислено, выплачено, долг на конец.
- «CSV» → `Зарплата_<period>.csv`.
- «+ Сотрудник» (`edit_salary`): ФИО, связь с учётной записью, должность, способ оплаты (Из «Зарплаты» / Оклад / Процент от выручки / По часам), ставка → `staff_save`.
- По строке:
  - «Начислить»: способ, ставка, выручка или часы, премия, комментарий, предпросмотр суммы → `accrual_save`;
  - «Выплатить»: дата, сумма, комментарий, чекбокс «Записать в расходы по статье „Зарплата“» (для типа `tabel` не показывается) → `payment_save {…, to_expenses}`;
  - «Расчётный листок»: `Payslip` → `payslip {staff_id, period}`, кнопка печати `window.print()`;
  - «История за месяц»: начисления и выплаты с удалением (`accrual_delete` для неавтоматических, «Удалить начисление?»; `payment_delete`, «Удалить выплату? Расход по ней тоже удалится.»);
  - «Изменить».

---

### 11. `/sber` — СБЕР (`Sber.tsx` + `components/sber/*`)

- **Кто видит:** `path="/sber"`. Права приходят из `sber-api: overview` → `can[]`: `sber.pay`, `sber.request`, `sber.sync`, `sber.edit_requisites`, а также `is_deputy`.
- **Загрузка:** `sber-api: overview {week}` → `week, requests, counterparties, categories, bank, connections, pending, can, is_deputy`. Выбор сбрасывается.
- **Возврат из банка (query):**
  - `?signed=1` → «Вы вернулись из СберБизнес. Если платёжка подписана…»;
  - `?connect=ok|expired|<ошибка>&reason=` → соответствующее сообщение.
  - Параметры удаляются из URL. Сообщение закрывается крестиком.
- **Шапка:** «Оплатить за неделю · N на X» (`sber.pay`, банк подключён, есть заявки `sent` без `requisites_changed`) открывает `PayDialog`.
- **`BankCard`:**
  - банк не подключён: deputy видит «Подключить» → `sber-api: connect {origin}` и редирект на `r.url`; остальным «Подключение выполняет заместитель директора»;
  - банк подключён: счёт, лимиты, последняя синхронизация и ошибка. «Синхронизировать» (`sber.sync`) → `sync {days:7}` → «Загружено новых операций: N». Для deputy «Настройки»: счёт, лимит платежа, лимит дня → `bank_settings`; «Отключить банк» → confirm → `disconnect`.
- **Вкладка «Оплаты по неделям»:**
  - навигация по неделям, вперёд не дальше текущей недели +2;
  - чипы «ждут оплаты: неделя · N на X» переключают неделю;
  - сводка: заявок, черновики, ждут оплаты, оплачено или в банке;
  - «Новая оплата» / «Заявка на оплату» (`sber.request` или `sber.pay`; нужен хотя бы один контрагент с реквизитами): диалог с выбором контрагента (`CounterpartyPicker` с поиском). Подставляются назначение, НДС и статья по умолчанию. Поля сумма, назначение, НДС, статья, месяц → `request_save {…, week}`;
  - «Отправить директору (N)» (`sber.request`, есть свои черновики или deputy) → confirm → `send_week {week}` → «Отправлено директору: N заявок · уведомление ушло в ВК»;
  - «Подписать все (N)» (`sber.pay`, больше одной заявки в `signing`) открывает СберБизнес (`SBBOL_WEB`; на Android — intent приложения);
  - «Оплатить выбранные» (чекбоксы у заявок `sent` без смены реквизитов);
  - строка заявки, кнопки по статусу и правам:
    - «Оплатить» (`pay`, `sent`) → `PayDialog`;
    - «Подписать по СМС» (`pay`, `signing`) → `sign_links {ids, origin}` и открытие ссылки;
    - «Отклонить» (`pay`, `sent`) → диалог причины → `reject {id, reason}`;
    - «Изменить» (draft/rejected автору, deputy или pay; `sent` — только pay);
    - «Отменить» (`sber.request`, draft/rejected/sent, автор или deputy) → confirm «Отменить заявку?» → `request_delete {id}`.
  - Заявки со статусом `cancelled` скрыты.
- **`PayDialog`:**
  - список платежей с реквизитами (ИНН, р/с, БИК), назначение, НДС, итог;
  - выбор счёта списания, если активных подключений больше одного;
  - «Оплатить» → `pay {ids, connection_id, origin}` → результат по каждой: «Платёжка создана, осталось подписать» с кнопкой подписи (`sign_url`) или текст ошибки;
  - «Готово» закрывает диалог и обновляет данные.
- **Вкладка «Контрагенты и реквизиты»:** список. «+ Контрагент» и карандаш — только `sber.edit_requisites`, иначе «Реквизиты меняет только заместитель директора». `CounterpartyForm` → `counterparty_save`.

---

### 12. `/admin` — Админ-панель (`Admin.tsx` + `components/admin/*`)

- **Кто видит:** `ProtectedRoute deputyOnly` (роль `deputy_director`). Пункт меню виден только deputy.
- **Загрузка:** `admin-api: overview` → `AdminData`. После любого изменения выполняются `load()` и `access.reload()` (`my_access`).
- **Вкладки:**
  1. **Должности и доступ (`PositionsTab`):**
     - карточки должностей (сотрудников, разделов, кнопок, чипы разделов);
     - «+ Должность» или карандаш открывает модалку: название, чекбоксы разделов (`/dashboard` закреплён; кнопка «все / ничего»), чекбоксы действий по группам → `position_save`;
     - удаление: confirm «Удалить должность «X»? У N сотрудников она снимется.» → `position_delete`;
     - таблица сотрудников (только активные): select роли (`ROLE_LABELS`) и select должности («— по роли (…) —») → `person_save {profile_id, position_id, role}`; ошибка через `alert`.
  2. **Формулы зарплаты (`FormulasTab`):**
     - формулы `rate, total, week, manager_rate, manager_total, manager_week` и параметры (процент, процент руководителя);
     - живой пример через `evalFormula` (выручка 1 000 000, 30 дней, 160 часов);
     - кнопки-переменные дописывают переменную в выбранную формулу;
     - «↺» у формулы возвращает стандартную;
     - «Сохранить формулы» → `formulas_save {formulas, params}`;
     - «Сбросить к стандартным» → confirm → `reset {what:'formulas'}`.
  3. **Поля форм (`FieldsTab`):**
     - формы: Зарплата — сотрудники / руководители / Инкассация;
     - таблица колонок: порядок ↑↓, подпись, переменная, тип, видимость, удаление (только не встроенных);
     - «+ Колонка»; «Сохранить» → `fields_save {form, fields}`; «Стандартные колонки» (локально).
  4. **Справочники (`DirectoriesTab`):**
     - статьи: добавление и архивирование → `category_save`;
     - контрагенты: диалог (вид, название, ИНН, телефон, комментарий, архив) → `counterparty_save`.
  5. **Общие (`GeneralTab`):** «Начало учёта в бухгалтерии» (month) и «Часы в смене» по типам смен → `general_save {start_period, shift_hours}`.
  6. **СберБизнес (`SberSection`):**
     - `sber-api: products` → подвкладки по приложениям Sber API;
     - **`SberProductPanel`:**
       - сертификат `.p12/.pfx` с паролем → `product_cert_upload {code, file_name, file, password}`; удаление: confirm → `product_cert_delete`;
       - настройки: Client ID, Client Secret (не отображается после сохранения), Redirect URI (кнопка «Подставить адрес системы» — URL `sber-api`), Back URL (`<origin>/sber`), scope v1/v2 → `product_save`;
       - показ «Последнее изменение».
     - **`SberTab`** (только для основного продукта):
       - «Проверка связи с банком» → `diagnose` (шаги и redirect_uri);
       - список подключений: «Сделать основным» → `connection_update {id, is_default}`; «Обновить ключи»; «Отключить» → confirm → `connection_delete`;
       - «Новое подключение» (название, Access Token, Refresh Token) → `tokens_save` → «Банк принял ключи: <орг>»;
       - «Уведомления в ВК»: чекбоксы `on_send/on_paid/on_reject…`, каждый сразу отправляет `notify_save`; «Проверить» → `notify_test`.

---

### 13. `/devices` — Управление ПК (`Devices.tsx` + `components/devices/ReleasePanel.tsx`)

- **Кто видит:** `ProtectedRoute deputyOnly`.
- **Загрузка и опрос:** `device-control: devices_status` при открытии и каждые **5000 мс**, плюс кнопка «Обновить». Выбранное устройство обновляется вместе со списком.
- **Карточка ПК:**
  - статус: «Работа в сети» (working), «В сети (экран входа)» (login), «Не в сети» (offline);
  - ФИО или hostname, код, версия, статус обновления, «В системе: …», «Был на связи: N мин назад», «Заблокирован вами».
- **Кнопки** → `device-control: send_command {device_code, command, payload}`. Тост и перезагрузка через 1,5 с:

| Кнопка | Команда | Условие |
|---|---|---|
| Заблокировать / Разблокировать | `lock` / `unlock` | lock только онлайн; показывается по `remote_lock` |
| Сообщение | `message {message}` | онлайн. Диалог «Сообщение на весь экран», пустой текст запрещён |
| Экран (RuDesktop) | `rudesktop` | онлайн |
| Обновить страницу | `reload` | онлайн |
| Войти как сотрудник | `login_user` | presence=login и ПК привязан |
| Войти как админ | `login_admin` | presence=login |
| Выйти на экран входа | `logout` | presence=working |
| Обновить программу | `update` | онлайн |
| Журнал | `device_logs {device_code, limit:150}` | всегда. Модалка со списком «дата — сообщение» |

Тексты тостов: «Команда «Заблокировать» отправлена», «Сообщение отправлено на экран» и т. п. Ошибки — тост с текстом. Команда `screenshot` существует в типах, но кнопки для неё нет.

- **`ReleasePanel`:**
  - `release_list`; показываются активные версии для `abiz` и `admin`;
  - «Обновить все ПК» → `update_all` → «Команда «обновиться» отправлена на N ПК»;
  - «Выпустить версию»: модалка (редакция abiz/admin, номер версии `^\d+(\.\d+){1,3}$`, иначе «Номер версии — только цифры с точками…»; файл `.zip`; заметки). Загрузка частями по 1,5 МБ через `release_upload_part` (до 4 попыток на часть) с прогрессом, затем `release_publish {edition, version, folder, parts, sha256, size, notes}`;
  - история выпусков: «Вернуть» → `release_activate {id}`; «Удалить» → confirm → `release_delete {id}`.

---

### 14. `/skud` — СКУД (`Skud.tsx` + `components/skud/*`)

- **Кто видит:** `path="/skud"`. Пункт меню (без `sections`) виден director, deputy и senior. Права «менеджера» приходят из `skud-api: overview` → `is_manager`.
- **Загрузка:**
  - `skud-api: overview` → controllers (используется первый), cards, employees, cameras, schedules, notify, is_manager. Ошибка показывается на всю страницу;
  - `events {date_from, date_to, profile_id?, kind}`;
  - `visits {date_from, date_to, alarm}`. Фильтр по сотруднику для визитов делается на клиенте, по имени в отметках.
- **Опрос:** каждые **10 с**, если вкладка видима, повторяются все три запроса.
- **Шапка:**
  - кнопка состояния контроллера («<имя>: на связи / не на связи» или «Добавить контроллер»); для менеджера открывает `ControllerPanel`;
  - «Дверь открыта постоянно» (при аварийном открытии);
  - «Ключ-карты» (точка-индикатор, если есть карты с истекающим сроком) открывает `CardsPanel`;
  - «Доступ и тревоги» (менеджер) открывает `AccessPanel`;
  - «Открыть дверь» (менеджер и наличие контроллера) → confirm «Открыть дверь «X»?» → `open_door {id}`, ошибки через `alert`.
- **Статистика за сегодня (МСК):** входов, тревог (`denied, denied_blocked, forced, held_open`), активных карт.
- **Фильтры:** вкладки «Посещения с видео» / «Журнал», период (по умолчанию 7 дней), сотрудник, вид (Все/Проходы/Тревоги), «В Excel» (CSV `СКУД_<день>.csv`).
- **Посещения:**
  - если не выбран ПК-регистратор: плашка «Видео посещений не сохраняется…» с кнопкой «Выбрать»;
  - `VisitCard`: раскрывающиеся открытия, отметки и клипы. «Повторить» → `clip_retry {visit_id}`.
- **Журнал (`EventsTable`):** кнопка видео ведёт на `/cameras?cam=<camera_id или камера склада>&day=<МСК>&sec=<время − 10 с>`.
- **`CardsPanel`:**
  - список карт: срок действия и состояние (ok/warn/grace), «Перезаписать» (по сроку), «Изменить»; для менеджера блок/разблок → `card_status {id, status}` и удаление → confirm «Удалить карту …? Проходы в журнале сохранятся.» → `card_delete`;
  - «Записать новую карту»: тип (сотрудник/гость); номер с USB-считывателя (проверка `card_check {card}`, при невалидном номере «Не похоже на номер карты…»);
  - «Считать на двери» → `enroll_start`, затем опрос `enroll_poll` каждые **1,5 с**, пока не придёт номер («Карта X считана на двери») или `waiting=false`;
  - поля: сотрудник или гость, подпись, «Действует до» (гость; для сотрудника подсказка «1 месяц + 5 резервных дней»); для менеджера — расписание и 6-значный код клавиатуры (с «Убрать код»);
  - «Записать/Сохранить/Перезаписать» → `card_save {...form, schedule_id}`.
- **`AccessPanel` (менеджер):**
  - расписания (до 7): название, дни недели (битовая маска), время → `schedule_save`; удаление → confirm «… Карты с ним станут круглосуточными.» → `schedule_delete`;
  - «Запрет повторного прохода» → `antipassback {id, on}`;
  - дополнительные выходы: «10 сек», «Вкл», «Выкл» → `output {id, addr, mode, seconds}`; переименование → `outputs_save`;
  - «Присылать тревоги и простым сотрудникам» → `notify_save {alarms_to_employees}`;
  - ошибки через `alert`.
- **`ControllerPanel`:**
  - `skud-api: devices` (ПК-регистраторы);
  - поля: название двери, камера у двери, камера внутри склада, время открытия замка, видео до и после, ПК склада, качество SD/HD, IP/порт/номер контроллера → `controller_save`;
  - для существующего контроллера: «Синхронизировать время» → `sync_clock`; «Перезаписать карты» → `sync_cards`; «Аварийное открытие» → confirm → `emergency {on:true}`, выключение `emergency {on:false}` без подтверждения;
  - показ ключа контроллера по кнопке «показать».

---

### 15. `NotFound.tsx` и `Index.tsx`

- `NotFound`: «404 / Упс! Страница не найдена», ссылка на `/`, `console.error` с путём. **В маршрутах не подключён**: `*` перенаправляет на `/dashboard`.
- `Index`: заглушка шаблона («Добро пожаловать!… Юра создает первую версию проекта»). **Не используется.**

---

### Замечания по безопасности и корректности

#### A. Авторизация и роли

1. **data-api не проверяет роли.** `backend/data-api/index.py:179-200` проверяет только белый список таблиц и наличие действующего токена (`_authenticate`). Поэтому любой вошедший сотрудник может напрямую читать и писать `profiles`, `pin_codes`, `companies`, `salary_settings`, `chat_messages` и т. д. Все «ролевые» ограничения ниже существуют только в UI.
2. **Повышение роли.** `src/pages/Settings.tsx:279` отправляет `profiles.update({full_name,email}).eq('user_id', …)`, но API позволит записать и `role`. Роль на клиенте берётся из `profiles.role` (`src/lib/auth.tsx:110-113`), и от неё зависят `deputyOnly` (`App.tsx:57`) и `visibleNav`. Сотрудник может сделать себя `deputy_director` одним запросом. Серверные `admin-api`, `skud-api` и другие могут проверять роль иначе, это нужно сверить с backend-документацией.
3. **Удаление только в UI:** `Documents.tsx:117`, `DocumentBase.tsx:124,131`, `Dto.tsx:385`. Причём `handleDeleteTemplate` (`Dto.tsx:136`) вообще не проверяет роль.
4. **Guard `/employees`:** при загруженном access `directorOnly` игнорируется (`App.tsx:50-53`). Страница доступна любому, кому дали раздел `/employees` в должности, а пока access не загружен, `canSee` возвращает `true` (`access.tsx:66`). Сама страница никаких проверок не делает.
5. **`Settings` → Зарплата/Табель:** проверка `isDeputy` есть только в UI (`Settings.tsx:328,339`); запись идёт напрямую в `salary_settings`, `manager_settings`, `schedule_settings`, `schedule_config`, `employee_rotation`, `salary_data`.

#### B. Чувствительные данные напрямую из браузера

6. **PIN-коды в открытом виде:** `Employees.tsx:152` загружает **все** строки `pin_codes`; пины показаны в таблице (`:673`) и в модалке (`:977`). Любой авторизованный может сделать `pin_codes.select()` и затем войти без пароля через АдПод (`pin_signin`).
7. **PIN генерируется на клиенте** через `Math.random()` (`Employees.tsx:46`) и пишется через data-api (`:440,457`). Всего 10 000 вариантов. По коду клиента не видно ни ограничения попыток, ни блокировки на `pin_lookup/pin_signin` (`backend/auth-api/index.py:177-222`): перебор 4-значного PIN по трём известным путям АдПодов тривиален. `pin_lookup` вдобавок раскрывает email и ФИО владельца пина.
8. **Пин директора захардкожен:** `DIRECTOR_PIN = '<PIN-директора>'` (`Settings.tsx:13`). Кнопка «Создать мой пин (<PIN-директора>)» ставит одинаковый известный пин.
9. **Код блокировки процента в коде:** `SECRET_CODE = '<код-разблокировки>'` (`Settings.tsx:12`), сравнивается на клиенте (`:310`). Разблокировка вообще без кода (`:322`). «Блокировка» декоративная.
10. **Слаги АдПодов** (`src/lib/pinAdpods.ts:13-29`) лежат в бандле. Это «секретные» адреса входа без пароля.
11. **Создание сотрудника подменяет сессию директора:** `Employees.tsx:202` вызывает `auth.signUpWithPassword`, а тот делает `setToken` (`sdk.ts:185`). Последующий `profiles.insert` и вся дальнейшая работа идут под токеном нового сотрудника. При этом `auth-api: signup` публичен и сам создаёт `is_admin`, если пользователей нет (`backend/auth-api/index.py:151-158`).
12. **Регистрация перезаписывает компанию:** `auth.tsx:184-193`. Любой, кто откроет `/register`, после `signup` обновит `companies.main` и создаст себе профиль `role:'director'` (`:201-209`), поскольку data-api роль не проверяет.
13. **vk-api без авторизации:** `src/lib/vkBinding.ts:19,36,61,77`. Кто угодно может сгенерировать код привязки для чужого `profile_id`, привязать свой VK и получать чужие табели и зарплату, а также отвязать VK или получить полный список `bindings_list` (profile_id → vk_user_id). `unbindVk` дополнительно чистит `profiles` через data-api (`:82`).
14. **Удаление сотрудника не отзывает доступ:** `Employees.tsx:284-286` удаляет только `pin_codes` и `profiles`. `auth_users`, сессии и API-токены остаются; после удаления профиля такой пользователь входит с ролью `employee` (fallback в `auth.tsx:116`).
15. **Подделка отправителя в чате:** `Chat.tsx:102-106` передаёт `sender_id/sender_name` с клиента, и сервер их не проверяет (п. 1). Сообщения можно править и удалять через data-api.
16. **Токены в localStorage** (`anod_session_token`) и в URL-hash для CamView (`CamView.tsx:19-23`, затем sessionStorage) уязвимы к XSS. CamView корректно убирает hash из истории.

#### C. Корректность и UX

17. Вкладка «Компания» не сохраняет данные: кнопка вызывает `handleSaveProfile` (`SettingsAccountTabs.tsx:156`).
18. «Изменить пароль» без обработчика (`SettingsSystemTabs.tsx:50-55`). «Уведомления» не сохраняются. «Телефон» в профиле не сохраняется.
19. `handleSaveProfile` показывает «Сохранено!» даже при ошибке (`Settings.tsx:276-293`), меняет `profiles.email`, но не email для входа.
20. Ветка `needsEmailConfirmation` в Register и Employees недостижима (`sdk.ts:186`).
21. В `resolveUserRole` комментарий обещает поиск по email без учёта регистра, но используется `eq` (`auth.tsx:99-103`).
22. `AppShell` всегда показывает захардкоженное «Зарплата за сентябрь рассчитана по табелю.» (`AppShell.tsx:17-20`).
23. Уникальность PIN при 50 неудачных попытках не гарантируется (`Employees.tsx:443-452`). Между проверкой и вставкой возможна гонка.
24. Удаления без подтверждения: документы (`Documents.tsx:116`), файлы и папки базы (`DocumentBase.tsx:123-134`, папка без каскада, файл в хранилище остаётся), шаблоны ДТО (`Dto.tsx:136`), отзыв устройства (`Employees.tsx:399`).
25. Ошибки data-api в Documents, DocumentBase (папки), Dto и Chat молча глушатся. В Documents удаление убирает карточку даже при ошибке.
26. Чат грузит всю историю без лимита каждые 4 с (`Chat.tsx:58-62,88`). Глобальный опрос каждые 6 с: при всплеске больше 20 сообщений `last_seen` теряется и уведомлений не будет (`useChatNotifications.ts:111-112`). Флаг `read` в БД не используется.
27. `RotationSettings` при каждом сохранении удаляет все строки ротации (неатомарно) и создаёт `salary_data` на 72 месяца вперёд (`src/components/RotationSettings.tsx:20,133-210`). Это раздувает таблицу.
28. `handleSaveSchedule` выполняет 2 последовательных запроса на каждого сотрудника (`Settings.tsx:342-352`), без транзакции.
29. Employees при загрузке делает N запросов к vk-api, по одному на профиль (`Employees.tsx:157`).
30. Компоненты `NotFound` и `Index` не используются. Для неизвестного пути 404 не показывается, происходит редирект на `/dashboard` (`App.tsx:98`).
31. `canSee` разрешает всё, пока `my_access` не загружен или упал (`access.tsx:66`). Защищённые страницы на мгновение рендерятся до редиректа.

---

# 8. Программа для Windows (АБИЗ, АБИЗ-Админ, AbizRecorder)

Источник: `public/downloads/AbizShell-v22.zip` (распакован и прочитан полностью). Все пути вида
`AbizShell/Файл.cs:строка` указаны **внутри архива**. Файлы `AbizShell/GateBridge.cs` (мост к контроллеру
СКУД Gate-4000/8000) и `AbizShell/SkudRecorder.cs` (видеорегистратор склада на ffmpeg) здесь описаны только
на уровне точек входа — их внутреннее устройство документируется отдельно.

---

### 0. Версии и сравнение архива с папкой `desktop-app/` репозитория

#### 0.1. Номера версий (в архиве v22)

| Где | Значение | Комментарий |
|---|---|---|
| `VERSION.txt` | `ABIZ project version 22 (program 3.10)` | v22 — расписания, PIN, anti-passback и др. в GateBridge; v21 — журнал двери, карты, открытие с сайта |
| `AbizShell/AbizShell.csproj:16` | `<Version>1.7.0</Version>` | версия сборки (assembly) |
| `AbizRecorder/AbizRecorder.csproj:15` | `<Version>1.2.0</Version>` | служба |
| `installer/msi/Product.wxs:5` | `Version="1.5.0.0"` | MSI АБИЗ |
| `installer/admin/Product.wxs:6` | `Version="1.2.0.0"` | MSI АБИЗ-Админ |
| `installer/bundle/Bundle.wxs:8` | `Version="1.3.0.0"` | итоговый AbizSetup.exe |
| `AbizShell/RemoteControlClient.cs:21` | `AppVersion = "3.8"` | **именно эта строка** уходит на сервер в heartbeat, используется Updater-ом для сравнения версий и добавляется в User-Agent (`ABIZ/3.8`) |
| `AbizShell/MainWindow.xaml:101` | `"АБИЗ Shell v3.6"` | надпись на экране входа (киоск) |
| `AbizShell/MainWindow.xaml.cs:58` | `Edition.Name + " v3.2"` | надпись на экране входа в АБИЗ-Админ |

Вывод: в коде одновременно живут четыре «версии программы» (3.10 в VERSION.txt, 3.8 в AppVersion, 3.6 и 3.2 в UI).
`AppVersion` не был поднят до 3.10 — см. раздел «Замечания».

#### 0.2. Отличия `desktop-app/` (репозиторий) от архива v22

Сравнение по имени, размеру и MD5 всех файлов (включая `Extensions/**`).

Репозиторий: `desktop-app/VERSION.txt` = `ABIZ project version 20 (program 3.8)` — т.е. в репозитории лежит **v20**.

**Есть только в архиве (нет в репозитории):**
- `AbizShell.sln`
- `AbizShell/GateBridge.cs` (781 строка)

**Есть только в репозитории:** нет.

**Отличаются по содержимому:**

| Файл | zip (байт) | repo (байт) | Суть различия |
|---|---|---|---|
| `VERSION.txt` | 402 | 237 | v22 vs v20 |
| `AbizShell/AbizShell.csproj` | 3288 | 3288 | `Version` 1.7.0 vs 1.5.0 |
| `AbizShell/RecorderService.cs` | 3807 | 3721 | в v22 добавлены `GateBridge.EnsureStarted/StopAll` |
| `AbizRecorder/AbizRecorder.csproj` | 1409 | 1337 | `Version` 1.2.0 vs 1.0.0; добавлена ссылка `..\AbizShell\GateBridge.cs` |
| `AbizRecorder/Program.cs` | 3475 | 3312 | служба теперь запускает и `GateBridge` |
| `installer/msi/Product.wxs` | 7852 | 7852 | `Version` 1.5.0.0 vs 1.3.0.0 |
| `installer/bundle/Bundle.wxs` | 2586 | 2586 | `Version` 1.3.0.0 vs 1.1.0.0 |

Все остальные файлы (включая `SkudRecorder.cs`, все окна, расширения) — побайтно совпадают.
Важно: в репозитории `RecorderService.cs` уже не ссылается на `GateBridge`, а самого файла нет — т.е. код
из репозитория в текущем виде **собирается** (v20), а при копировании отдельных файлов из v22 без `GateBridge.cs`
сборка сломается.

Также в `public/downloads/` лежат: `ABIZ-Admin-v18-win64.zip`, `ABIZ-v18-win64.zip`, `AbizShell-v18.zip`,
`AbizShell-v20.zip`, `AbizShell-v22.zip`.

---

### 1. Обзор

#### 1.1. Состав решения

```
AbizShell.sln                 — решение VS (проект AbizShell, конфигурации Debug/Release/DebugAdmin/ReleaseAdmin, x64)
AbizShell/                    — WPF-приложение (две редакции из одного кода)
AbizRecorder/                 — Worker-служба Windows «AbizRecorder»
installer/msi/                — WiX 5 MSI «АБИЗ» (киоск + служба)
installer/admin/              — WiX 5 MSI «АБИЗ-Админ»
installer/bundle/             — WiX 5 Burn-бандл AbizSetup.exe (.NET 8 + WebView2 + MSI)
installer/redist/             — сюда скачиваются redistributable-файлы
build-installer.ps1           — сборка всего в один клик
README.md, НАЧАЛО-РАБОТЫ-VS2026.md, СБОРКА-ИНСТАЛЛЯТОРА.md — пользовательские инструкции
```

#### 1.2. Редакции (`AbizShell/Edition.cs`)

Выбор — константой компиляции `ABIZ_ADMIN` (ставится конфигурациями `DebugAdmin`/`ReleaseAdmin`).

| Свойство | АБИЗ (киоск) | АБИЗ-Админ |
|---|---|---|
| `Edition.Admin` / `Kiosk` | false / true | true / false |
| `Edition.Name` | «АБИЗ» | «АБИЗ-Админ» |
| `Edition.MutexName` | `AbizShell_SingleInstance_8F2A1C` | `AbizAdmin_SingleInstance_5C1D9E` |
| AssemblyName / exe | `AbizShell.exe` | `AbizAdmin.exe` |
| Манифест | `app.manifest` | `app.admin.manifest` |
| Окна | без рамки на весь экран (`ScreenArea.CoverScreen`) | обычные окна с рамкой, в панели задач |
| Панель задач Windows | скрывается (`TaskbarManager.Hide`) | не трогается |
| Блокировка Win / Alt+F4 | да (`KeyboardHook.BlockSystemKeys = true`) | нет |
| Закрытие крестиком | запрещено (`Closing → Cancel`) | закрывает программу |
| Автозапуск | задача Планировщика (ставит MSI) | нет |
| `edition` в `check_update` | `"abiz"` | `"admin"` |

Обе редакции на одном ПК могут работать одновременно (разные мьютексы).

#### 1.3. Сборка (`AbizShell/AbizShell.csproj`)

- `OutputType=WinExe`, `TargetFramework=net8.0-windows10.0.19041.0` (нужна версия Windows SDK — иначе
  WebView2 падает на `Microsoft.Windows.SDK.NET`), `SupportedOSPlatformVersion=10.0.17763.0`.
- `UseWPF=true`, `Nullable=enable`, `PlatformTarget=x64`, `StartupObject=AbizShell.App`,
  `EnableDefaultApplicationDefinition=false` (App.xaml исключён — запуск из `Main`).
- `Company=Rassvet`, `ApplicationIcon=abiz.ico`.
- `Extensions\**\*` копируются в вывод и публикацию (`PreserveNewest`).
- Пакеты: `Microsoft.Web.WebView2 1.0.4258.31`, `System.Drawing.Common 8.0.8` (скриншоты),
  `System.Security.Cryptography.ProtectedData 8.0.0` (DPAPI).
- Используется `Microsoft.VisualBasic.FileIO` (удаление в корзину в проводнике) — из общего фреймворка.

**Манифесты.** Оба манифеста — `requestedExecutionLevel level="asInvoker" uiAccess="false"`, PerMonitorV2 DPI,
supportedOS Windows 10/11. Права администратора **не запрашиваются** (README в архиве устарел: в таблице
структуры написано «Запрос прав администратора»; фактически — asInvoker, `app.manifest:10`).

**AbizRecorder.csproj**: SDK `Microsoft.NET.Sdk.Worker`, `net8.0-windows`, x64, пакет
`Microsoft.Extensions.Hosting.WindowsServices 8.0.1`, линкует `..\AbizShell\SkudRecorder.cs` и
`..\AbizShell\GateBridge.cs`, копирует `install-service.cmd`/`uninstall-service.cmd` в вывод.

#### 1.4. `build-installer.ps1` — шаги

0. Создаёт `installer\redist`, если нет файлов — скачивает:
   `MicrosoftEdgeWebview2Setup.exe` (`https://go.microsoft.com/fwlink/p/?LinkId=2124703`) и
   `windowsdesktop-runtime-8.0-win-x64.exe` (`https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe`).
1. `dotnet publish AbizShell.csproj -c Release -r win-x64 --self-contained false -o AbizShell\bin\publish`;
   проверка наличия `Microsoft.Windows.SDK.NET.dll` в выводе (иначе ошибка).
   Затем `dotnet publish AbizRecorder.csproj ... -o AbizRecorder\bin\publish`.
2. `dotnet build installer\msi\AbizInstaller.wixproj -c Release` → `installer\out\AbizSetup.msi`.
3. `dotnet build installer\bundle\AbizBundle.wixproj -c Release` → `installer\out\AbizSetup.exe`.
4. `dotnet publish ... -c ReleaseAdmin ... -o AbizShell\bin\publish-admin`.
5. `dotnet build installer\admin\AbizAdminInstaller.wixproj -c Release` → `installer\out\AbizAdminSetup.msi`.

Итог: `AbizSetup.exe` — для ПК сотрудников, `AbizAdminSetup.msi` — для ПК директора/администратора.
Скрипт пишет «Шаг N из 5», при ошибке отсылает к `СБОРКА-ИНСТАЛЛЯТОРА.md`, часть 6.

#### 1.5. Установщик АБИЗ (`installer/msi/Product.wxs`, WiX 5, `WixToolset.UI/Util.wixext 5.0.2`)

- `Scope="perMachine"`, Language 1049, `MajorUpgrade` (запрет даунгрейда), cab встроен, UI `WixUI_Minimal` + `License.rtf`.
  ICE38/43/57/64/91 подавлены (`AbizInstaller.wixproj:12`).
- **Куда ставится:**
  - `C:\Program Files\AnodBiz\AbizShell\` — всё из `AbizShell\bin\publish` (папку выбрать нельзя: путь зашит в задаче).
  - `C:\Program Files\AnodBiz\AbizShell\Recorder\` — всё из `AbizRecorder\bin\publish`.
  - `C:\Program Files\AnodBiz\AbizShell\AbizShell-task.xml` — описание задачи Планировщика.
  - Ярлык «АБИЗ» на рабочем столе и в меню «Пуск» → `АБИЗ\`.
- **Реестр:** `HKCU\Software\AnodBiz\AbizShell` — `DesktopShortcut=1`, `StartMenuShortcut=1` (KeyPath ярлыков).
- **Custom actions** (все `WixQuietExec`, deferred, `Impersonate="no"` — т.е. от SYSTEM, `Return="ignore"`):

| Действие | Команда | Когда |
|---|---|---|
| `GrantAppDirWrite` | `icacls "[APPDIR]." /grant *S-1-5-32-545:(OI)(CI)M /T /Q` — **Users: Modify** на папку программы | после InstallFiles |
| `RemoveOldRunKeys` | `reg delete HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run /v AbizShell /f` | после GrantAppDirWrite |
| `CreateAbizTask` | `schtasks /Create /F /TN "AbizShell" /XML "[APPDIR]AbizShell-task.xml"` | после RemoveOldRunKeys |
| `InstallRecorderSvc` | `cmd /c "[RECORDERDIR]install-service.cmd"` | после CreateAbizTask |
| `RemoveRecorderSvc` | `sc stop`, `taskkill /F /IM AbizRecorder.exe`, `sc delete AbizRecorder` | перед RemoveFiles при `REMOVE="ALL"` |
| `DeleteAbizTask` | `schtasks /Delete /F /TN "AbizShell"` | при удалении, не при апгрейде |

- **Автозапуск** (`installer/msi/AbizShell-task.xml`, UTF-16): задача `\AbizShell`, `LogonTrigger` с задержкой `PT3S`,
  принципал — группа `S-1-5-32-545` (Users), `RunLevel=LeastPrivilege`, `MultipleInstancesPolicy=IgnoreNew`,
  без лимита времени, запуск `"%ProgramFiles%\AnodBiz\AbizShell\AbizShell.exe"`.
- **Замена оболочки Explorer (`Winlogon\Shell`) НЕ выполняется.** Explorer продолжает работать; «киоск» достигается
  полноэкранными окнами, скрытием панели задач, рабочей областью экрана и хуком клавиатуры.

#### 1.6. Служба `AbizRecorder` (`AbizRecorder/install-service.cmd`)

1. Создаёт `%ProgramData%\AnodBiz\recorder`, даёт Users Modify (`icacls ... *S-1-5-32-545:(OI)(CI)M`).
2. `sc stop/delete AbizRecorder` (переустановка), пауза.
3. `sc create AbizRecorder binPath= "...\AbizRecorder.exe" start= auto DisplayName= "ABIZ Recorder"` (LocalSystem по умолчанию).
4. `sc description ...`, `sc failure ... reset= 86400 actions= restart/10000/restart/30000/restart/60000`.
5. `sc sdset AbizRecorder D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CC...WDWO;;;BA)(A;;CCLCSWRPWPLOCRRC;;;BU)` —
   обычные пользователи (BU) могут **запускать/останавливать** службу (RP/WP), но не менять/удалять.
6. `sc start AbizRecorder`.

`uninstall-service.cmd`: `sc stop`, пауза, `taskkill /F`, `sc delete`.

#### 1.7. Установщик АБИЗ-Админ (`installer/admin/Product.wxs`)

- `C:\Program Files\AnodBiz\AbizAdmin\` (из `publish-admin`), ярлыки «АБИЗ-Админ» (рабочий стол и Пуск),
  `HKCU\Software\AnodBiz\AbizAdmin\DesktopShortcut|StartMenuShortcut=1`.
- Единственное custom action — `GrantAppDirWrite` (Users: Modify), чтобы работало автообновление без UAC.
- Без задачи Планировщика, без службы.

#### 1.8. Бандл `AbizSetup.exe` (`installer/bundle/Bundle.wxs`)

- `WixStandardBootstrapperApplication`, тема `rtfLicense`, `SuppressOptionsUI`.
- Поиск: `DotNetCoreSearch` (desktop, x64, major 8) → `DotNetDesktop8Version`;
  `RegistrySearch HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\pv` (32-бит) → `WebView2Version`.
- Цепочка: .NET 8 Desktop Runtime (`/install /quiet /norestart`, Permanent) → WebView2 (`/silent /install`, Permanent) → `AbizSetup.msi`.

---

### 2. Поток запуска (`AbizShell/App.xaml.cs`)

1. `Main()` (STA): `new Mutex(true, Edition.MutexName, out isNew)`; если не новый — **тихий выход** (второй экземпляр
   ничего не показывает и не активирует первый). Мьютекс хранится в статическом поле до конца процесса.
2. `new App { ShutdownMode = OnExplicitShutdown }.Run()` — приложение живёт, пока явно не вызван `Shutdown()`
   (переходы между окнами MainWindow ↔ ShellWindow ↔ CameraWindow не завершают процесс).
3. `OnStartup`: подписка `DispatcherUnhandledException` → `OnUnhandled` (`e.Handled = true`, MessageBox «Произошла ошибка… Программа
   продолжит работу»); `AppDomain.ProcessExit += TaskbarManager.Restore()`; `new MainWindow().Show()`.
4. `OnExit`: `SkudRecorder.StopAll()`, `TaskbarManager.Restore()`.

Исключения в фоновых потоках (`TaskScheduler.UnobservedTaskException`, `AppDomain.UnhandledException`) не обрабатываются,
но почти все async-методы обёрнуты в `try/catch {}`. Восстановление панели задач при аварийном завершении (kill/краш
вне диспетчера) не гарантируется — `ProcessExit` при `TerminateProcess` не вызывается.

Автозапуск самим приложением больше не делается (комментарий `App.xaml.cs:10`) — только задача Планировщика.

---

### 3. Классы и окна

#### 3.1. Адреса backend-функций

| Константа | Функция (`backend/func2url.json`) | Где используется |
|---|---|---|
| `AnodBizClient.AuthApiUrl` `0cc75331-…` | **auth-api** | ping, register_device, device_status, device_signin, request_login_link |
| `AnodBizClient.DataApiUrl` `e40aca0d-…` | **data-api** | CRUD (`kiosk_buttons`, `profiles`, `collection_data`) с заголовком `X-Authorization` |
| `RemoteControlClient.ControlApiUrl`, `Updater.ControlApiUrl` `f01f3da3-…` | **device-control** | heartbeat, command_result, chat_unread, chat_mark_read, device_log, check_update |
| `CamerasClient.CamerasApiUrl` `246cb9d5-…` | **cameras-api** | list, live, live_all (сейчас из UI не вызывается — см. 3.15) |
| `RecorderService.SkudApiUrl` `150e30dd-…` | **skud-api** | rec_key (также SkudRecorder/GateBridge) |

Сайт: `https://anod.saou.ru/` (`ShellWindow.HomePage`).

#### 3.2. `AnodBizClient` (`AnodBizClient.cs`)

HTTP-клиент. Экземпляр (`new AnodBizClient(apiToken)`) — HttpClient 15 с, заголовок `X-Authorization: <api_token>`.

| Метод | Запрос | Ответ / обработка |
|---|---|---|
| `static CheckNetworkAsync()` | POST auth-api `{"action":"ping"}`, таймаут 8 с, 2 попытки с паузой 1 с | **любой** HTTP-ответ = online; исключение = offline |
| `static DeviceSignInAsync(token, password)` | POST auth-api `{action:"device_signin", api_token, password}` | 200 → `Ok` + `full_name`; 403 → `DeviceRevoked`; другое → `WrongPassword`; исключение → `NoNetwork` |
| `QueryAsync(body)` | POST data-api, тело как есть (`table`, `op`, `filters`, `order`, `payload`, `limit`) | `JsonElement` (ожидается `{data:[...]}`) |
| `SearchEmployeesAsync(q)` | `{table:"profiles", op:"select", filters:[{col:"full_name", op:"ilike", value:"%q%"}]}` | список (`full_name`, `role`, `department`) |
| `static RegisterDeviceAsync(hostname)` | `{action:"register_device", hostname}` | `device_code` (9 цифр) или исключение |
| `static CheckDeviceStatusAsync(code)` | `{action:"device_status", device_code}` | `(status, api_token)`; если в ответе есть `error` и нет `status` → `"notfound"` |
| `static RequestLoginLinkAsync(token)` | `{action:"request_login_link", api_token}` | `code` одноразового автовхода или null |

#### 3.3. `DeviceManager` (`DeviceManager.cs`)

Хранение в **`HKCU\Software\AbizShell`** (в открытом виде, без DPAPI): `DeviceCode`, `ApiToken`.

- `GetDeviceCode/SaveDeviceCode`, `GetApiToken/SaveApiToken`, `ClearApiToken` (пишет пустую строку).
- `InitializeDeviceAsync()` — если код сохранён, возвращает его; иначе `RegisterDeviceAsync(MachineName)`, сохраняет; без
  сети — `""` (выдуманный код больше не сохраняется).
- `PollDeviceStatusAsync(code)` → `"linked"` (и сохраняет токен), `"reset"` (status `notfound`/`revoked`), `"pending"`, `"error"`.
- `ResetDeviceAsync()` — очищает токен и код, регистрирует заново.
- `FormatCode` → `123-456-789`.

Поскольку ключ в HKCU, привязка **на пользователя Windows**: под другой учётной записью ПК получит новый код.

#### 3.4. `MainWindow` — экран входа (`MainWindow.xaml(.cs)`)

Элементы: заголовок, поле пароля, кнопка «Камера Зал», метка кода устройства, кнопка «Выход в Windows» (с паролем),
оверлей привязки (код крупно, «Проверить сейчас», «Новый код», поле пароля администратора), оверлей «Сеть недоступна!»
(«Повторить», «Вызвать администратора»).

Таймеры:
- `_spinnerTimer` 50 мс — вращение индикатора.
- `_devicePollTimer` 3 с — `PollDeviceAsync` (только пока не привязано).
- `_networkTimer` 10 с — `CheckNetworkAsync`; оверлей офлайна после 2 неудач подряд.

`MainWindow_Loaded`: токен из реестра → `EnsureDeviceCodeAsync` → UI → таймеры → `CheckNetworkAsync` → `PollDeviceAsync`
→ `StartRemoteAgent()` (presence `login`) → `RecorderService.Start(token)` → если есть staged-обновление — `ApplyUpdateNow()`.

Колбэки RemoteAgent на экране входа: `OnReload` (перечитать токен), `OnRemoteLogin` (лог `signin` + `OpenShell`),
`OnUpdateReady` → `ApplyUpdateNow` (сразу), `OnRevoked` → очистка токена, новый код, опрос привязки.

`OpenShell(isAdmin, fullName)` — останавливает таймеры/агента, создаёт `ShellWindow{IsAdmin, ApiToken, DeviceCode, EmployeeName}`;
при ошибке — `TaskbarManager.Restore()` и подсказка про `exit:`.

`ExitToWindows()` — стоп всего, `TaskbarManager.Restore()`, `ForceCloseForExit()` всех ShellWindow, `Shutdown()`.

#### 3.5. `ShellWindow` — рабочий стол (`ShellWindow.xaml(.cs)`)

Свойства: `IsAdmin`, `ApiToken`, `DeviceCode`, `EmployeeName`. Окно `Topmost=False`, в киоске занимает экран под
верхней панелью (`FitToWorkArea`: Top = 60, Height = экран − 60).

Таймеры (создаются в конструкторе):
- `_networkTimer` 15 с — `CheckNetworkAsync` (оверлей офлайна после 2 неудач, можно скрыть до восстановления; точка статуса в панели).
- `_remoteDesktopTimer` 10 с — `AutoAcceptRemoteDesktop`.
- `_notificationTimer` 20 с — `CheckNotificationsAsync`.
- Разовые: уведомление скрывается через 8 с; принудительное обновление — через 5 с.

Локальные файлы:
- `%APPDATA%\AbizShell\notes.json` — заметки календаря `{ "yyyy-MM-dd": "текст" }` (открытым текстом, сохраняется на каждое изменение).
- `%LOCALAPPDATA%\AbizShell\WebView2\` — профиль браузера (cookies, кэш, расширения).

Публичные методы: `ForceCloseForExit`, `FitToWorkArea`, `NavigateBrowser(url)`, `GoHome/GoBack/GoForward/ReloadPage`,
`PrintPage`, `CurrentUrl`, `OpenCurrentPageInEdge` (`msedge.exe <url>`), `ToggleMenu`, `OpenExplorer`, `ImportPasswords`,
`ClearPasswords`, `OpenWindowsExplorer` (`explorer.exe`), `OpenCamerasSection`, `LockScreen`, `ShutdownPc` (`shutdown /s /t 0`),
`ExitToWindows`, `ToggleCalendar`, `ShowAdminMenu`, свойство `Browser`.

Браузер (`InitBrowserAsync`):
- `CoreWebView2Environment.CreateAsync(null, %LOCALAPPDATA%\AbizShell\WebView2, {AreBrowserExtensionsEnabled=true})`.
- Настройки: контекстное меню включено, **DevTools только для IsAdmin** (`ShellWindow.xaml.cs:294`), zoom включён,
  статус-бар выключен, `AreBrowserAcceleratorKeysEnabled=true`, UA += ` ABIZ/3.8`.
- `NewWindowRequested` → открыть в этом же окне.
- `SourceChanged` → если URL содержит `/chat` → `chat_mark_read`.
- `PasswordVault.AttachAsync`, `ExtensionsService.InstallAllAsync`, `LoadButtonsAsync`, `AutoLoginAndNavigateAsync`.

Автовход на сайт: `request_login_link` → `https://anod.saou.ru/device-login?code=<code>` (или главная). Для разделов —
`device-login?code=...&next=/cameras`.

Боковая панель (календарь): выбор даты, заметки, быстрые ссылки `schedule`, `salary`, `collection`, `documents`, `chat`.

Код ПК в панели: тройной клик (в течение 2 с) — у администратора `RegisterDeviceAsync` и сохранение нового кода
(токен не сбрасывается!), у сотрудника — сообщение «только администратор».

Меню администратора (`ShowAdminMenu`, кнопка ⚙ видна только IsAdmin): пароли сайтов (импорт CSV / удалить все),
«Изменить кнопки меню», «Обновить кнопки с сервера», «Поиск сотрудников», «Список принтеров», «Проводник Windows»,
«Диспетчер задач», «Выйти в Windows» / «Закрыть программу».

Редактор кнопок: строки (название, цель, «Обзор» .exe/.lnk, цвет, тип Сайт/Программа, ↑ ↓ ✕), «Добавить», «Сохранить»
→ `KioskButtonsService.SaveAsync`. Валидация: непустые название и цель, цель ≠ `https://`.

#### 3.6. `TopBarWindow` — верхняя панель (`TopBarWindow.xaml(.cs)`)

Отдельное окно `Topmost=True`, `ShowInTaskbar=False`, высота `BarHeight = 60`. В киоске — на `SourceInitialized`
вызывает `RegisterAppBar()`: хук `WndProc` (на `WM_DISPLAYCHANGE` пересчитывает позицию), `MoveWindow(0,0,ширина,высота·DPI)`,
`ScreenArea.ReserveTop(px)` (рабочая область Windows = экран минус полоса сверху), событие `WorkAreaChanged`.
Настоящая регистрация AppBar (`ABM_NEW`) не делается — область задаётся `SPI_SETWORKAREA`.
В АБИЗ-Админ панель — owned-окно, «приклеено» к верху ShellWindow через `PlaceInside`.

Таймер `_clock` 1 с: часы `HH:mm`, дата (ru-RU), каждые 5 с — иконка громкости, **каждую секунду** — `WindowSwitcher.GetWindows()`
для счётчика «Окна (N)».

Кнопки (по порядку в XAML) и действия:

| Кнопка | Действие |
|---|---|
| точка статуса | зелёная/красная по `SetOnline` |
| Меню | `ToggleMenu` (плитки) |
| Окна (N) | попап: «АБИЗ — браузер» + окна других процессов (активировать / ✕ = `WM_CLOSE`) |
| Главная / Назад / Вперёд / Обновить | навигация WebView2 |
| Проводник | `ExplorerWindow` |
| Печать | `ShowPrintUI(System)` |
| 🧩 Расширения | попап с чекбоксами 4 расширений + «Открыть в Edge» |
| Камеры | `OpenCamerasSection` → `/cameras` сайта |
| Календарь | боковая панель |
| Сеть | попап: адаптеры (Wi-Fi/кабель, IPv4, скорость), проверка сервера, «Wi-Fi сети» (`ms-availablenetworks:`), «Параметры сети» (`ms-settings:network-status`), «Сетевые адаптеры» (`ncpa.cpl`, только админ) |
| Громкость | попап: ползунок 0–100, пресеты (Tag), Mute |
| RU/EN | `LoadKeyboardLayout("00000419"/"00000409")` + broadcast `WM_INPUTLANGCHANGEREQUEST` |
| ⚙ | меню администратора (только IsAdmin) |
| 🔒 Блокировать | `LockScreen` → новый MainWindow |
| Выключить | `ShutdownPc` |

#### 3.7. `ExplorerWindow` — собственный проводник

Owned-окно ShellWindow; закрытие = `Hide()` (повторно открывается быстро). Слева: Документы, Загрузки, Рабочий стол,
Изображения + все готовые диски (флешки, сетевые, CD). Список скрывает Hidden/System. Навигация: история «Назад», «Вверх»,
обновление, ввод пути (с `%ENV%`). Действия: открыть (`AppLauncher.Launch` → ShellExecute), печать выбранных (выбор
принтера `PrintService.AskPrinter` → `PrintFiles`), новая папка, переименование, удаление в корзину. Клавиши: Enter,
Backspace, Delete, F5, Ctrl+P. Ограничений на пути нет — доступен весь диск.

#### 3.8. `RemoteAgent` / `RemoteControlClient` / `RemoteOverlayWindow` / `ScreenCapture`

См. раздел 4.4. `RemoteOverlayWindow` — `Topmost=True`, на весь экран; режим «сообщение» (можно закрыть) или «блокировка»
(`Closing` отменяется, пока не вызван `Release()`). `ScreenCapture.CaptureJpegBase64()` — GDI `CopyFromScreen` основного
монитора, масштаб до ширины ≤1280, JPEG качество 55, возвращает `data:image/jpeg;base64,...`.

#### 3.9. `Updater`

См. 4.6. Рабочая папка `%LOCALAPPDATA%\AbizShell\Update\` (`abiz-<ver>.zip`, `v<ver>\`, `backup\`, `apply.ps1`, `update.log`).

#### 3.10. `PasswordVault` — пароли сайтов (DPAPI)

- Файл `%LOCALAPPDATA%\AbizShell\vault.bin` = `ProtectedData.Protect(JSON[List<Entry{Host,Url,Username,Password}>],
  entropy="AnodBiz-ABIZ-vault-v1", DataProtectionScope.CurrentUser)`.
- `ImportCsv(path)` — CSV экспорта Яндекс/Chrome/Edge (колонки url|origin|website|адрес|сайт, username|login|логин,
  password|пароль; разделители `,` и `;`), merge по (host, username), возвращает (добавлено, обновлено).
  После импорта предлагается удалить CSV; в журнал ПК пишется `device_log kind=note`.
- `AttachAsync(core)`: скрипт на каждый документ (`AddScriptToExecuteOnDocumentCreatedAsync`) ищет `input[type=password]`,
  шлёт `postMessage({abizVault:'need'})`; C# по `e.Source` находит записи (`ForHost`) и отвечает
  `{abizVaultFill:true, items:[{u,p}]}`; скрипт подставляет (1 запись — сразу, несколько — выпадающий выбор при фокусе),
  MutationObserver для SPA.
- `Clear()` — удаляет файл.

#### 3.11. `ExtensionsService` — расширения браузера

`Known`: CryptoProCades (`pfhgbfnnjiafkhfdkmpiflachepdcjod`), SYTools/СБИС (`pbcgcpeifkdjijdjambaakmhhpkfgoec`),
RutokenPlugin (`ohedcglhbbfdgaogjhcclacoccbagkjg`), RutokenConnect (`acbchkahfmndkenefkcklofjmipghjjp`).
Папки — `<папка программы>\Extensions\<Folder>`. `InstallAllAsync(profile)` — при каждом старте браузера
`AddBrowserExtensionAsync` для отсутствующих и `EnableAsync` согласно состоянию. Состояние вкл/выкл —
`%LOCALAPPDATA%\AbizShell\extensions.json` (`{id: bool}`). `SetEnabledAsync` — из попапа панели, после успеха страница перезагружается.

#### 3.12. `KioskButton` / `KioskButtonsService`

Модель: `Id, Text, Color (#hex), Action ("web"|"app"), Target, OrderIndex` — таблица `kiosk_buttons`.
- `LoadAsync`: data-api `{table:"kiosk_buttons", op:"select", order:{col:"order_index", ascending:true}}`; пусто/ошибка → `DefaultButtons()`
  (Word, Excel, Престо:СБИС, Документы:СБИС, СберБизнес, ДобрыйМаркет, Почта.Я, MAX, RuDesktop, SabyPlugin, Отзывы).
- `SaveAsync`: `{op:"delete", filters:[{col:"order_index", op:"gte", value:0}]}`, затем `{op:"insert", payload:[...]}`.
  Не атомарно: при обрыве между запросами список кнопок на сервере окажется пустым (клиенты покажут дефолтные).

#### 3.13. `AppLauncher`

`Launch(target)` → `Resolve`: URL (`://`) как есть; полный/относительный путь с `%ENV%`; App Paths в HKLM/HKCU;
`PATH` + System32 + Windows; поиск на глубину 3 в `%LOCALAPPDATA%`, Program Files, Program Files (x86),
`%LOCALAPPDATA%\Programs`. Запуск через ShellExecute; отказ UAC (1223) — молча. Затем таймер 500 мс × до 30 попыток
ищет окно (MainWindowHandle или новое окно / окно с тем же именем процесса) и выводит его вперёд.

#### 3.14. `WindowSwitcher`, `NativeMethods`, `ScreenArea`, `TaskbarManager`, `AudioManager`, `PrintService`, `InputDialog`

- `WindowSwitcher.GetWindows()` — EnumWindows: видимые, без владельца, не ToolWindow, не cloaked (DWM), не
  Progman/WorkerW/Shell_TrayWnd/Shell_SecondaryTrayWnd/CoreWindow, с заголовком, не свой процесс. `BringToFront`
  (Restore/Show + BringWindowToTop + SetForegroundWindow), `Close` (`WM_CLOSE`).
- `NativeMethods` — P/Invoke user32/shell32/dwmapi; `IsOwnProcessForeground()`.
- `ScreenArea` — `ReserveTop(px)` / `Reset()` через `SystemParametersInfo(SPI_SETWORKAREA, SPIF_SENDCHANGE)`;
  `CoverScreen(window)` — без рамки, 0,0, размер основного экрана.
- `TaskbarManager.Hide()` — запоминает состояние (`ABM_GETSTATE`), ставит `ABS_AUTOHIDE`, `ShowWindow(Shell_TrayWnd, SW_HIDE)`.
  `Restore()` — `ScreenArea.Reset()`, показ трея, исходное состояние. Только основной монитор (`Shell_SecondaryTrayWnd` не скрывается).
- `AudioManager` — Core Audio COM (`IMMDeviceEnumerator` → устройство по умолчанию eRender/eMultimedia →
  `IAudioEndpointVolume`): `GetVolume` (−1 если устройства нет), `SetVolume`, `GetMute`, `SetMute`, `IsAvailable`.
- `PrintService` — `PrintSystemDialog(core)` (системный диалог WebView2); `GetInstalledPrinters`, `GetDefaultPrinter`,
  `AskPrinter` (модальный выбор), `PrintFiles`: картинки (jpg/png/bmp/gif/tif) — `PrintVisual` с вписыванием и полями 30;
  текст (txt/log/csv/xml/json/ini) — FlowDocument Consolas 11; прочее — shell verb `printto "<принтер>"` или `print`.
- `InputDialog.Show(title, prompt, ok, initial, isPassword)` — модальное `Topmost` окно ввода.

#### 3.15. `CameraWindow` / `CamerasClient`

- `CameraWindow(apiToken)` — открывается кнопкой «Камера Зал» на экране входа. Отдельный профиль WebView2
  `%LOCALAPPDATA%\AbizShell\WebView2Cam`, контекстное меню и DevTools выключены, новые окна блокируются.
  Открывает `https://anod.saou.ru/cam-view?name=Зал#t=<api_token>` (токен во фрагменте — не уходит на сервер в запросе,
  но доступен JS страницы). При ошибке навигации — повтор через 5 с. В киоске закрывается только кнопкой «ВХОД»
  (возврат на `MainWindow`), в Admin — крестик закрывает программу.
- `CamerasClient` (cameras-api, `X-Authorization`): `ListAsync` (`action:"list"` → `cameras[{id,name,is_default,order_index}]`),
  `LiveByNameAsync(prefix)`, `LiveAsync(id, fresh, quality="sd")` (`action:"live"` → `url`, 2 попытки),
  `LiveAllAsync` (`action:"live_all"` → `streams{id:{url}}`), `IsTrustedStreamUrl` (https и `*.bcloud365.net`).
  **В v22 ни один метод CamerasClient не вызывается** — камеры показывает сайт (`/cameras`, `/cam-view`). README
  упоминает `VideoEngine.cs` (VLC) — такого файла в архиве нет.

#### 3.16. `RecorderService`, `SkudRecorder`, `GateBridge`

- `RecorderService.Start(apiToken)`: если служба установлена (`HKLM\SYSTEM\CurrentControlSet\Services\AbizRecorder`
  существует) — останавливает внутрипроцессные `SkudRecorder`/`GateBridge` и один раз (на токен) запрашивает
  ключ: POST skud-api `{action:"rec_key"}` с `X-Authorization: <api_token>` → `{key}`; пишет его в
  `C:\ProgramData\AnodBiz\recorder\key` (если изменился). До 20 попыток с паузой 30 с; на 401 — прекращает.
  Если службы нет — запускает `SkudRecorder.EnsureStarted(token)` и `GateBridge.EnsureStarted(token)` в процессе АБИЗ.
- `SkudRecorder` (документирован отдельно): `EnsureStarted`, `StopAll`, `StatusPrefix`; данные в
  `C:\ProgramData\AnodBiz\SkudVideo`, ffmpeg в `C:\ProgramData\AnodBiz\ffmpeg`; обращается к skud-api и cameras-api.
- `GateBridge` (документирован отдельно): `EnsureStarted`, `StopAll`; данные в `C:\ProgramData\AnodBiz\gate`; skud-api.

#### 3.17. `AbizRecorder` (служба, `AbizRecorder/Program.cs`)

`Host.CreateDefaultBuilder().UseWindowsService(ServiceName="AbizRecorder").AddHostedService<RecorderWorker>()`.
`RecorderWorker.ExecuteAsync`: `SkudRecorder.StatusPrefix = "служба · "`, `PrepareDir()` (создаёт
`%ProgramData%\AnodBiz\recorder` и даёт BuiltinUsers Modify), затем цикл каждые 30 с: читает `key`, принимает только
строки, начинающиеся с `rec_`; при смене ключа — `SkudRecorder.EnsureStarted(key)` и `GateBridge.EnsureStarted(key)`.
При остановке — `StopAll()` обоих.

---

### 4. Потоки

#### 4.1. Первый запуск и привязка устройства (9-значный код)

1. MainWindow: в `HKCU\Software\AbizShell\DeviceCode` пусто → `register_device {hostname: MachineName}` → сервер выдаёт
   `device_code` (9 цифр) → сохраняется в реестр. Без сети код не выдумывается, повторяется каждые 3 с.
2. Показывается оверлей привязки: код `XXX-XXX-XXX`, имя ПК, подсказка «Сотрудники → Устройства → Привязать».
3. Каждые 3 с `device_status {device_code}`:
   - `linked` + `api_token` → токен в `HKCU\Software\AbizShell\ApiToken`, `RecorderService.Start`, оверлей скрывается;
   - `notfound`/`revoked` → `ResetDeviceAsync` (новый код, «передайте директору»);
   - иначе — «ожидание».
4. «Новый код» — подтверждение и `ResetDeviceAsync`. Пароль администратора в оверлее открывает рабочий стол без привязки.
5. RemoteAgent стартует только при наличии токена; при уже привязанном ПК стартует сразу на экране входа.
   Замечание: при привязке через опрос (`case "linked"`) `StartRemoteAgent()` не вызывается повторно — агент начнёт
   работать только после следующего открытия экрана входа.

#### 4.2. Вход

- **Сотрудник** — Enter в `PasswordBox`: если устройство не привязано — отказ; иначе `device_signin {api_token, password}`.
  `Ok` → `OpenShell(false, full_name)`; `DeviceRevoked` (403) → сброс токена, новый код; нет сети → сообщение; иначе
  «Неверный пароль». Ограничения числа попыток на клиенте нет.
- **Администратор** — пароль сравнивается **локально** с константой `AdminPassword = "<пароль-администратора>"`
  (`MainWindow.xaml.cs:17`) → `OpenShell(true, "")` (работает без сети и без привязки).
- **`exit:<пароль-администратора>`** в поле пароля — аварийный выход в Windows с экрана входа.
- Кнопка «Выход в Windows» — `InputDialog` с паролем администратора.
- **Удалённый вход** с сайта — команды `login_user` / `login_admin` (см. 4.4).
- В ShellWindow при старте: `device_log {kind:"signin", message:"Вход в систему: <ФИО|администратор|сотрудник>"}`;
  при закрытии — `kind:"signout"`.

#### 4.3. Оболочка (киоск)

1. `ShellWindow_Loaded`: создаётся `TopBarWindow`; в киоске `TaskbarManager.Hide()`, панель резервирует 60 px сверху,
   ShellWindow подгоняется под оставшуюся область.
2. Хук клавиатуры (раздел 5), плитки по умолчанию, инициализация WebView2, расширения, пароли, кнопки с сервера,
   автовход на сайт.
3. **Меню** (Tab при открытом меню / двойной пробел < 450 мс / кнопка «Меню») — полупрозрачный `OverlayGrid` с плитками.
   Клик по плитке: `app` → `AppLauncher.Launch` (окно программы выводится поверх, ShellWindow не Topmost);
   `web` → навигация во встроенном браузере. Esc закрывает меню/боковую панель. Клик по фону — закрыть.
4. **Переключение окон** — попап «Окна» на панели (вместо Alt+Tab; при этом Alt+Tab фактически НЕ заблокирован, см. 5).
5. **Проводник** — собственный `ExplorerWindow`; «Проводник Windows» (`explorer.exe`) — только из меню администратора.
6. **Печать** — страница: системный диалог WebView2; файлы — из проводника.
7. **Звук, сеть, раскладка, календарь** — попапы панели (3.6).
8. **Уведомления** (каждые 20 с, только если есть `_client`): сначала `chat_unread`; затем data-api
   `{table:"collection_data", op:"select", filters:[{col:"status", op:"eq", value:"pending"}], limit:1}` →
   «Есть незакрытые смены инкассации» (один раз до закрытия).
9. **RuDesktop автопринятие** (каждые 10 с): для процессов `RuDesktop` с заголовком, содержащим `2364029` или «вход»,
   в главное окно постятся `WM_KEYDOWN/WM_KEYUP VK_RETURN` — т.е. программно нажимается Enter.
10. **Блокировка** (🔒) — `LockScreen`: новый MainWindow, ShellWindow закрывается (агент останавливается, лог signout,
    хук снят, панель закрыта). Панель задач при этом **остаётся скрытой** (MainWindow во весь экран).
11. **Выключение** — подтверждение, `shutdown /s /t 0`.
12. **Выход в Windows** — только меню администратора: подтверждение, `TaskbarManager.Restore()`, `Shutdown()`.

#### 4.4. Удалённое управление

`RemoteAgent` — `DispatcherTimer` **4 с**; работает и на экране входа (`presence:"login"`), и в оболочке (`presence:"working"`).
Повторный вход в тик блокируется флагом `_busy`.

**Heartbeat** — POST device-control:
```json
{"action":"heartbeat","api_token":"…","presence":"login|working","user_name":"ФИО|Администратор|",
 "app_version":"3.8","update_status":"<Updater.Status>"}
```
Ответ: `401` + `revoked:true` → `OnRevoked`; иначе `ok`, `remote_lock` (bool), `lock_message`, `commands:[{id, command, payload}]`.

- `remote_lock=true` → показать окно блокировки (если ещё нет), `false` → снять. Это «стойкое» состояние, команды `lock`/`unlock` сами ничего не делают.
- Раз в 10 минут (и сразу при первом тике) — `Updater.CheckAndDownloadAsync`.
- Первым стартом процесса (`_installLogSent`) — `device_log kind:"note"` с версией и 3 последними строками `update.log`.

**Команды** (`HandleCommandAsync`), результат — `command_result {api_token, command_id, result[, screenshot]}`:

| command | payload | Выполнение | result |
|---|---|---|---|
| `message` | `{message}` | полноэкранное окно «Сообщение от руководства» (одно, текст обновляется) | `ok` |
| `screenshot` | — | `ScreenCapture.CaptureJpegBase64()` | «снимок сделан» + `screenshot` (data URL) / «не удалось…» |
| `rudesktop` | — | запуск `RuDesktop.exe` из Program Files / x86 / `%LOCALAPPDATA%\RuDesktop` / PATH | текст |
| `reload` | — | вход: перечитать токен; оболочка: `Browser.Reload()` | `ok` |
| `logout` | — | оболочка: `LockScreen()` (на экране входа — нет обработчика) | `ok` |
| `login_user` | `{full_name}` | только на экране входа: `OpenShell(false, full_name)` | `ok` / «сотрудник уже в системе» |
| `login_admin` | — | только на экране входа: `OpenShell(true)` | `ok` / «уже выполнен вход» |
| `update` | — | сразу отчёт «проверка обновления запущена (сейчас 3.8)», затем `ForceUpdateAsync` → `OnForceUpdate` (оболочка: уведомление и перезапуск через 5 с) или `OnUpdateReady` (вход: сразу) | см. текст |
| `lock` / `unlock` | — | ничего (состояние из `remote_lock`) | `ok` |
| любая другая | — | игнор | `ok` |

Исключение при выполнении → `"ошибка: <message>"`.

`RemoteAgent.Stop()` — останавливает таймер, снимает окно блокировки и сообщения. Т.к. агент пересоздаётся при каждом переходе
экран входа ↔ оболочка, окно блокировки на долю секунды пропадает и показывается снова на следующем heartbeat.

#### 4.5. Снимки экрана

Только по команде `screenshot`: основной монитор целиком (включая чужие окна), ≤1280 px, JPEG q55, base64 data URL в
`command_result.screenshot`. Пользователь никак не уведомляется. Логические размеры `SystemParameters.PrimaryScreen*` при
PerMonitorV2 могут не совпадать с физическими — на мониторах с масштабом >100% снимок может быть обрезан.

#### 4.6. Чат: непрочитанные

`chat_unread {api_token}` → `{count, last:{id, sender_name, content}}`. Если `count>0`, `last.id` ≠ последнему показанному
и чат не открыт — всплывающее уведомление (текст обрезается до 120 символов), скрывается через 8 с.
Если текущий URL содержит `/chat` — на каждую смену адреса `chat_mark_read {api_token}`.

#### 4.7. Камеры

- Экран входа → «Камера Зал» → `CameraWindow` → сайт `/cam-view?name=Зал#t=<api_token>`; кнопка «ВХОД» → снова экран входа.
  При открытии камеры RemoteAgent экрана входа **останавливается** и не работает, пока окно камеры открыто.
- В оболочке кнопка «Камеры» → `/cameras` сайта (через автовход, если текущая страница не сайт или страница логина).
- Сайт распознаёт программу по UA `ABIZ/3.8` и включает свой плеер.

#### 4.8. Автообновление (`Updater.cs`)

1. **Проверка** (`CheckAndDownloadAsync`, не параллельно — `Interlocked`): device-control
   `{action:"check_update", api_token, edition:"abiz"|"admin"}` → `{version, url, sha256}`. Нет `version` или не новее
   `AppVersion` (сравнение по 4 числовым компонентам) → `Status=""`, выход. Уже скачана та же версия → true.
2. **Скачивание** в `%LOCALAPPDATA%\AbizShell\Update\abiz-<ver>.zip`: если `url` вида `шаблон|N` — N частей
   (`{n:03d}` → `001…`), по 4 параллельно, до 6 попыток с нарастающей паузой, прогресс в `Status`; иначе — один GET.
3. **Проверка SHA-256**: если сервер прислал `sha256` и хэш не совпал — удалить, `Status="ошибка … архив повреждён"`.
   Если `sha256` пустой — проверка **пропускается**.
4. **Распаковка** в `Update\v<ver>\`, zip удаляется, ищется файл с именем текущего exe (`AbizShell.exe`/`AbizAdmin.exe`)
   рекурсивно; нет — ошибка «выпуск не для этой программы». `StagedDir` = папка exe, `StagedVersion`, `Status="готово к установке"`.
5. **Когда ставится:** на экране входа — сразу; в оболочке — уведомление, установка при выходе на экран входа (MainWindow_Loaded
   проверяет `StagedDir`); по команде `update` — принудительно через 5 с.
6. **Установка** (`ApplyAndRestart`): проверка записи в папку программы (`.abiz-write-test`); генерируется
   `Update\apply.ps1` (UTF-8 BOM) и запускается `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File …`
   (если папка не записываема — `Verb=runas`, будет UAC). Скрипт:
   ждёт выхода PID (≤40 с) → убивает оставшиеся процессы с тем же именем → `sc stop AbizRecorder` → robocopy папки программы
   в `Update\backup` → до 8 попыток robocopy staged → папка программы → `sc start AbizRecorder` → запуск нового exe →
   через 40 с, если процесс завершился — откат из backup и запуск старой версии. Журнал — `Update\update.log`.
7. Вызывающая сторона после `true` закрывает программу (`ExitToWindows` / `ForceCloseForExit` + `Shutdown`).

Т.к. robocopy копирует всё содержимое папки, обновляется и служба (`Recorder\` внутри папки программы) — её поэтому и
останавливают (`sc stop` разрешён обычным пользователям через `sc sdset`).

#### 4.9. Расширения браузера

При каждой инициализации WebView2 — `InstallAllAsync`: распакованные расширения из `Extensions\` добавляются в профиль
(ID совпадают с Chrome Web Store, поэтому системные native-host’ы КриптоПро/Рутокен/СБИС их узнают). Состояние вкл/выкл —
`extensions.json`. Попап 🧩 позволяет включать/выключать (любому пользователю, не только админу) и открыть страницу в Edge
как запасной путь для подписи.

#### 4.10. Служба видеорегистратора

1. MSI ставит службу (LocalSystem, автозапуск, авто-рестарт).
2. АБИЗ при наличии токена (экран входа и после привязки) → `RecorderService.Start` → `rec_key` → файл
   `C:\ProgramData\AnodBiz\recorder\key` (`rec_…`).
3. Служба каждые 30 с читает ключ и запускает `SkudRecorder` + `GateBridge` с ним — работает без входа сотрудника.
4. Нет службы → запись и мост работают внутри процесса АБИЗ (только пока программа запущена).

---

### 5. Хук клавиатуры (`KeyboardHook.cs`, использование — `ShellWindow.xaml.cs:154-188`)

`SetWindowsHookEx(WH_KEYBOARD_LL)` — ставится только в ShellWindow (на экране входа и в окне камеры хука нет).

**Блокируется всегда при `BlockSystemKeys` (только киоск), независимо от активного окна:**
- `VK_LWIN` / `VK_RWIN` (Win и все Win+… сочетания, т.к. проглатывается сама Win);
- `Alt+F4` (`VK_F4` при `WM_SYSKEYDOWN`) — глобально, т.е. и в Word/Excel.

**Не блокируется:** `Alt+Tab` (намеренно, `KeyboardHook.cs:74-76`), `Ctrl+Esc`, `Ctrl+Shift+Esc`, `Ctrl+Alt+Del`, `Alt+Esc`,
`PrintScreen`. Комментарий в `WindowSwitcher.cs:11` («Alt+Tab заблокирован») и README («перехват Win, Alt+Tab…») устарели.

**Горячие клавиши (только если активно окно процесса АБИЗ — `IsOwnProcessForeground`):**
- `Esc` — закрыть меню плиток или боковую панель (проглатывается только если было что закрыть);
- `Tab` (без Alt) при открытом меню — закрыть меню;
- двойной `Пробел` (< 450 мс) — открыть/закрыть меню (второй пробел проглатывается, первый уходит в страницу).

**Комбинации выхода администратора** (специальной клавиатурной комбинации нет):
- на экране входа: ввести `exit:<пароль-администратора>` + Enter, или кнопка «Выход в Windows» + пароль `<пароль-администратора>`;
- в оболочке: войти паролем `<пароль-администратора>` → ⚙ → «Выйти в Windows»;
- при отладке — Shift+F5 в Visual Studio.

---

### Замечания по безопасности и ограничения

1. **Жёстко зашитый пароль администратора** `<пароль-администратора>` — `AbizShell/MainWindow.xaml.cs:17`, используется в строках 290, 341, 348, 434;
   опубликован в `README.md` (раздел «Как открыть», п.5). Он одинаков на всех ПК, не меняется без пересборки, проверяется локально,
   легко извлекается из .NET-сборки (ildasm/dnSpy). Дает: рабочий стол админа, DevTools, проводник Windows, диспетчер задач, выход в Windows.
2. **Сброс привязки ПК/вход админа без сети.** Пароль админа работает и без привязки (`MainWindow.xaml.cs:287-297`).
3. **`api_token` хранится открытым текстом** в `HKCU\Software\AbizShell\ApiToken` (`AbizShell/DeviceManager.cs:12-56`), без DPAPI.
   Любой процесс пользователя может его прочитать и вызывать data-api/device-control/cameras-api/skud-api от имени ПК.
4. **Токен в URL камеры**: `AbizShell/CameraWindow.xaml.cs:93` — `#t=<api_token>` во фрагменте; доступен любому JS на странице
   `cam-view` и истории браузера (профиль `WebView2Cam`).
5. **Клиент data-api может удалять/перезаписывать `kiosk_buttons` целиком** (`AbizShell/KioskButtonsService.cs:89-106`) — защита
   полностью на стороне сервера; клиент проверяет только `IsAdmin` в UI (кнопка ⚙). Если data-api пускает любой токен устройства —
   любой сотрудник с токеном из реестра может переписать кнопки всех ПК (в т.ч. подменить `target` на произвольный .exe).
   Аналогично `SearchEmployeesAsync` — `profiles` `ilike` (`AnodBizClient.cs:96-104`).
6. **Неатомарное сохранение кнопок** — delete затем insert (`KioskButtonsService.cs:89-106`); при сбое — пустая таблица.
7. **Users: Modify на `C:\Program Files\AnodBiz\AbizShell` (рекурсивно)** — `installer/msi/Product.wxs:93-94` (и `installer/admin/Product.wxs:56-57`).
   Любой пользователь может подменить `AbizShell.exe`/DLL, а также `Recorder\AbizRecorder.exe` — **исполняемый файл службы,
   работающей от LocalSystem** (`installer/msi/Product.wxs:26,40-41`; `AbizRecorder/install-service.cmd:9`). В сочетании с
   правом BU на stop/start службы (`install-service.cmd:13`) это прямое повышение привилегий до SYSTEM.
8. **`%ProgramData%\AnodBiz\recorder` с Modify для Users** (`AbizRecorder/install-service.cmd:5`, `AbizRecorder/Program.cs:70-84`) — любой
   пользователь может подменить `key` (служба примет любую строку `rec_*`, `Program.cs:63-64`).
9. **Автообновление**: SHA-256 проверяется только если сервер его прислал (`AbizShell/Updater.cs:90`); подписи архива нет — доверие
   целиком к ответу device-control и URL. Скрипт `apply.ps1` пишется в `%LOCALAPPDATA%` и запускается с `-ExecutionPolicy Bypass`
   (`Updater.cs:215-218`); при отсутствии прав — `runas` (`Updater.cs:224`) → UAC на ПК сотрудника. Откат — только если новый
   процесс завершился за 40 с (`Updater.cs:205-213`). Версия для сравнения — `AppVersion="3.8"` (`RemoteControlClient.cs:21`), тогда как
   проект уже 3.10 (`VERSION.txt:1`): если выпустить на сайте «3.9»/«3.10», ПК с этой сборкой будут бесконечно считать себя устаревшими
   и переустанавливать тот же архив, если в нём AppVersion тоже 3.8.
10. **Скрытые снимки экрана** по команде без уведомления пользователя (`AbizShell/RemoteAgent.cs:114-117`, `ScreenCapture.cs:19-25`);
    берётся только основной монитор, при DPI-масштабе возможна обрезка (логические, а не физические пиксели).
11. **Автонажатие Enter в RuDesktop** (`AbizShell/ShellWindow.xaml.cs:512-533`): любое окно процесса `RuDesktop`, заголовок которого содержит
    «вход» или `2364029`, получает Enter — входящее удалённое подключение принимается без участия сотрудника. Срабатывает только пока открыт
    ShellWindow.
12. **Киоск обходится штатными средствами**: Alt+Tab, Ctrl+Shift+Esc (диспетчер задач), Ctrl+Alt+Del не блокируются
    (`AbizShell/KeyboardHook.cs:73-79`); Explorer не заменяется (оболочка — обычное приложение, автозапуск задачей Планировщика
    `installer/msi/AbizShell-task.xml`); задачу/процесс пользователь может завершить сам (`LeastPrivilege`). Окно блокировки
    (`RemoteOverlayWindow`) — просто Topmost-окно (`RemoteOverlayWindow.xaml:5`), закрывается снятием процесса.
13. **Собственный проводник без ограничений** (`AbizShell/ExplorerWindow.xaml.cs:108-146, 204-207`) — доступ ко всем дискам, ввод пути,
    запуск любых файлов через ShellExecute (в т.ч. `cmd.exe`, `.ps1`, `.lnk`). Контроль «только администратору» из README (п.10) к этому
    окну не относится — кнопка «Проводник» на панели видна всем.
14. **Контекстное меню WebView2 включено для всех** (`ShellWindow.xaml.cs:293`), а `AreBrowserAcceleratorKeysEnabled=true` (`:297`) — Ctrl+P,
    Ctrl+S, Ctrl+O и т.п. доступны; `NewWindowRequested` открывает любые URL (`:302-306`), фильтра доменов нет.
15. **Расширения может отключать любой пользователь** (`AbizShell/TopBarWindow.xaml.cs:406-446`), не только админ.
16. **Хранилище паролей**: DPAPI CurrentUser + константная entropy (`AbizShell/PasswordVault.cs:23-25,36,48`) — защищает от другого
    пользователя/копирования файла, но не от любого процесса этой же учётной записи. Подбор хоста `ForHost` (`PasswordVault.cs:133`) —
    `e.Host.EndsWith("." + host)`: для страницы `example.com` будут выданы пароли от `sub.example.com`, а пароли от `example.com` — любому
    поддомену; скрипт отдаёт пароли в любой фрейм/страницу, где есть поле `password` (`PasswordVault.cs:145-155, 209-212`).
    Заметки календаря — открытым текстом (`ShellWindow.xaml.cs:71, 626-633`).
17. **Нет ограничения попыток ввода пароля** сотрудника/админа на клиенте (`MainWindow.xaml.cs:335-391`).
18. **Тройной клик по коду ПК у админа** регистрирует новый код, но не сбрасывает `ApiToken` (`ShellWindow.xaml.cs:809-829`) — локальный код
    расходится с привязкой на сервере.
19. **Агент не стартует после первой привязки** до повторного открытия экрана входа (`MainWindow.xaml.cs:240-247` — нет `StartRemoteAgent()`).
20. **Восстановление панели задач**: при `TerminateProcess`/краше вне диспетчера `ProcessExit` не вызывается (`App.xaml.cs:34`) — панель
    задач остаётся в автоскрытии/скрытой, рабочая область — урезанной на 60 px (`ScreenArea.ReserveTop`). `LockScreen` панель не возвращает
    (`ShellWindow.xaml.cs:562-567`). `OnExit` вызывает `SkudRecorder.StopAll()`, но не `GateBridge.StopAll()` (`App.xaml.cs:48`).
    Второй монитор не учитывается (`TaskbarManager.cs`, `ScreenArea.cs` — только основной экран).
21. **Второй экземпляр молча завершается** (`App.xaml.cs:20-21`) — если окно первого «потерялось», пользователь не получит обратной связи.
22. **Нагрузка**: `UpdateClock` каждую секунду вызывает `WindowSwitcher.GetWindows()` с `Process.GetProcessById` для каждого окна
    (`TopBarWindow.xaml.cs:129-136`).
23. **`CheckNetworkAsync` считает online любой HTTP-ответ**, включая 5xx (`AnodBizClient.cs:42-58`).
24. **Расхождения документации и кода**: README в архиве описывает HKLM-автозапуск, манифест с правами администратора, `VideoEngine.cs` (VLC),
    нижнюю панель и блокировку Alt+Tab — всего этого в v22 нет. Версии в UI (`MainWindow.xaml:101` «v3.6», `MainWindow.xaml.cs:58` «v3.2»)
    не совпадают ни с `AppVersion` 3.8, ни с VERSION.txt 3.10. `CamerasClient` — мёртвый код.
25. **Репозиторий отстаёт от опубликованного архива**: `desktop-app/` = v20, нет `GateBridge.cs` и `AbizShell.sln` (раздел 0.2).
