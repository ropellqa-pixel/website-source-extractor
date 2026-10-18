# Техническое задание и техническое описание системы «АнодБИЗ»

Версия документа: 1.0 · Дата: 18.10.2026
Назначение: полное описание системы для разработчика — состав, архитектура, функции, база данных, серверные функции, программы для ПК, оборудование, правила доступа, требования к доработке и сопровождению.

---

## Содержание

1. Общие сведения
2. Назначение и цели системы
3. Пользователи и роли
4. Архитектура
5. Технологический стек
6. Структура репозитория и файлов
7. Авторизация, сессии, токены
8. Модель прав доступа (разделы и действия)
9. Функциональные требования по разделам сайта
10. Серверные функции (backend) — полный перечень действий
11. База данных — все таблицы и поля
12. Миграции
13. Программы для Windows (АБИЗ-Киоск, АБИЗ-Админ, АБИЗ-Рекордер)
14. СКУД: оборудование, протокол, логика
15. Видеонаблюдение
16. Интеграции (ВКонтакте, СберБизнес, S3, облако камер)
17. Фоновые и периодические процессы
18. Секреты и переменные окружения
19. Нефункциональные требования
20. Безопасность
21. Тестирование и приёмка
22. Развёртывание и сопровождение
23. Известные ограничения и технический долг
24. Глоссарий

---

## 1. Общие сведения

| Параметр | Значение |
|---|---|
| Наименование | АнодБИЗ (сокращённо АБИЗ) |
| Тип | Веб-приложение (SPA) + облачные функции + PostgreSQL + S3 + программы для Windows |
| Рабочий домен | anod.saou.ru (сайт), functions.poehali.dev (серверные функции) |
| Платформа | poehali.dev (хостинг фронтенда, облачные функции Python 3.11, управляемый PostgreSQL, S3-хранилище) |
| Основной язык интерфейса | Русский |
| Объём кода | Фронтенд ≈ 22 200 строк TS/TSX; backend ≈ 8 000 строк Python; программы Windows — C# (.NET, WPF), WiX-установщики |
| Схема БД | `t_p59581145_website_source_extra` (переменная `MAIN_DB_SCHEMA`) |

Система — внутренний «цифровой офис» небольшой компании (розничные точки/склад): табель смен, зарплата, инкассация, бухгалтерия, оплаты через СберБизнес, документы, чат, камеры, СКУД склада, управление рабочими компьютерами в режиме киоска.

---

## 2. Назначение и цели системы

1. Вести график смен (табель) с автоматической генерацией по правилам компании.
2. Считать зарплату по настраиваемым формулам и рассылать расчётные листки в ВК.
3. Учитывать инкассацию по сменам с загрузкой данных из СБИС.
4. Вести управленческую бухгалтерию: доходы/расходы, прибыль, ДДС, бюджет план-факт, контрагенты, начисления и выплаты зарплаты, закрытие месяцев.
5. Готовить и оплачивать платёжные поручения через API СберБизнес (с подписью директора), импортировать выписку.
6. Хранить документы, базу файлов, шаблоны ДТО.
7. Общаться во внутреннем чате с уведомлениями.
8. Смотреть камеры видеонаблюдения (живое видео и архив).
9. Контролировать доступ на склад (СКУД Gate-4000-Ethernet): ключ-карты, журнал, посещения с видео, тревоги в ВК, сроки действия карт.
10. Управлять рабочими ПК сотрудников (киоск, блокировка, сообщения, снимки экрана, обновления).

---

## 3. Пользователи и роли

| Роль (код) | Название | Описание прав по умолчанию |
|---|---|---|
| `director` | Директор | Все разделы, все просмотровые права + инкассация, оплата и синхронизация Сбера. Первый зарегистрированный пользователь (`auth_users.is_admin = true`) всегда директор. |
| `deputy_director` | Заместитель директора | Флаг `is_deputy`: обходит все проверки прав, видит всё, единственный имеет доступ к `/admin` и `/devices`. |
| `senior_employee` | Старший сотрудник | Базовые разделы + `/sber` (просмотр и создание заявок) + `/skud` (карты: запись, перезапись). |
| `employee` | Сотрудник | Главная, документы, база, ДТО, чат, камеры, табель, зарплата (своя строка), инкассация, настройки. |

Права могут переопределяться должностью (`positions`): у должности свой набор разделов и действий; если сотруднику назначена должность — используются её права (плюс обязательные добавки по роли, см. §8).

---

## 4. Архитектура

```
Браузер (React SPA)  ──HTTP/JSON──►  Облачные функции (Python 3.11)  ──►  PostgreSQL
        │                                   │  ├──► S3 (bucket.poehali.dev, bucket "files")
        │                                   │  ├──► VK API
        │                                   │  ├──► СберБизнес API (OAuth2 + mTLS)
        │                                   │  └──► Облако камер JFTech/XMeye
        │
Программы Windows (C#) ──HTTP/JSON──► те же функции (auth-api, data-api, device-control, cameras-api, skud-api)
        │
        └── GateBridge (внутри АБИЗ) ──TCP:5000──► контроллер Gate-4000-Ethernet (локальная сеть склада)
        └── SkudRecorder/AbizRecorder ──RTSP──► камеры склада → нарезка → загрузка на сервер
```

Принципы:
- Фронтенд никогда не обращается к БД напрямую, только через функции. Адреса функций — `backend/func2url.json` (генерируется платформой).
- Каждая функция — отдельный каталог `backend/<name>/index.py` с `handler(event, context)`.
- Все запросы — POST с JSON-телом `{ "action": "...", ...параметры }` (кроме `data-api`, у которого свой формат, и `vk-webhook`).
- Заголовок авторизации с фронта — `X-Authorization` (платформа вырезает `Authorization`).
- Изменения схемы БД — только миграциями `db_migrations/V{n}__*.sql`, только вперёд.
- Только Simple Query протокол psycopg2, параметры через `%s` на стороне драйвера.

---

## 5. Технологический стек

**Фронтенд:** Vite, React 18, TypeScript (strict), React Router, TanStack Query, Tailwind CSS, shadcn/ui (Radix), lucide-react (через обёртку `@/components/ui/icon`), hls.js, собственный WASM-декодер HEVC (`public/hevc/`), шрифты Unbounded (заголовки) и Inter (текст).

**Backend:** Python 3.11, psycopg2-binary, requests, boto3, pydantic (где нужно), cryptography (Fernet — шифрование секретов Сбера), openpyxl/xlrd (импорт Excel-выписок).

**Windows:** C# .NET (WPF), WiX Toolset (MSI + Bundle), ffmpeg (скачивается автоматически), Windows DPAPI для хранения ключей.

**Оборудование:** контроллер Gate-4000-Ethernet, считыватель EM-Marine (Wiegand-26), настольный USB-считыватель TS-RDR-USB-EM, IP-камеры XMeye/iCSee.

---

## 6. Структура репозитория и файлов

```
/
├── index.html, vite.config.ts, tailwind.config.ts, tsconfig.json, package.json
├── API.md                      — памятка по API для десктоп-приложения
├── docs/TZ-AnodBIZ.md          — этот документ
├── backend/
│   ├── func2url.json           — карта «имя функции → URL»
│   ├── accounting-api/         — бухгалтерия (index.py, access.py, bank.py, formulas.py, salary_weekly.py)
│   ├── admin-api/              — админ-панель, права, формулы (index.py, access.py, formulas.py)
│   ├── auth-api/               — вход, сессии, PIN, токены, устройства
│   ├── cameras-api/            — камеры, живое видео, архив
│   ├── data-api/               — универсальный CRUD по белому списку таблиц
│   ├── device-control/         — управление ПК, команды, релизы программы
│   ├── file-upload/            — загрузка файлов в S3
│   ├── sber-api/               — СберБизнес (index.py, sber.py, products.py, ca_bundle.py, bank.py, access.py, formulas.py, salary_weekly.py)
│   ├── skud-api/               — СКУД (index.py, alerts.py, visits.py, recorder.py)
│   ├── vk-api/                 — привязка ВК, рассылки
│   └── vk-webhook/             — Callback API ВКонтакте
├── db_migrations/V0001…V0043   — миграции схемы
├── desktop-app/
│   ├── AbizShell/              — программа АБИЗ (киоск/админ), C# WPF
│   ├── AbizRecorder/           — служба Windows для видеозаписи склада
│   ├── installer/              — WiX: msi/, admin/, bundle/
│   ├── build-installer.ps1, README.md, НАЧАЛО-РАБОТЫ-VS2026.md, СБОРКА-ИНСТАЛЛЯТОРА.md, VERSION.txt
├── public/
│   ├── downloads/              — архивы установщиков и исходников (ABIZ-v18, ABIZ-Admin-v18, AbizShell-v22.zip …)
│   ├── hevc/                   — hevc-decode.js + .wasm (декодер H.265 в браузере)
│   ├── sounds/notification.mp3 — звук уведомления чата
│   ├── skud-gate4000-scheme.png — схема подключения контроллера
│   └── favicon.svg, robots.txt, placeholder.svg
└── src/
    ├── App.tsx                 — маршруты, ProtectedRoute, провайдеры
    ├── main.tsx, index.css     — точка входа, CSS-переменные темы
    ├── lib/                    — API-клиенты и общая логика
    ├── hooks/                  — useChatNotifications, use-toast, use-mobile
    ├── pages/                  — страницы (25 файлов)
    └── components/
        ├── shell/              — AppShell, SideNav, BottomNav, SkudNotices
        ├── dashboard/          — MonthSlab, StatsRow
        ├── accounting/         — EntriesTab, ProfitTab, DdsTab, BudgetTab, CounterpartiesTab, SalaryTab, Payslip, PeriodsBar, BankImport, csv.ts
        ├── admin/              — PositionsTab, FormulasTab, FieldsTab, GeneralTab, DirectoriesTab, SberTab, SberSection, SberProductPanel, types.ts
        ├── cameras/            — HlsPlayer, WasmHevcPlayer, SnapshotView, ArchiveBar, CameraManager
        ├── devices/            — ReleasePanel
        ├── salary/             — SalaryGrid
        ├── sber/               — BankCard, CounterpartyForm, CounterpartyPicker, PayDialog
        ├── settings/           — SettingsAccountTabs, SettingsWorkTabs, SettingsSystemTabs, SettingsDialogs, types.ts
        ├── skud/               — CardsPanel, AccessPanel, ControllerPanel, EventsTable, VisitCard
        ├── Employee*Settings.tsx, RotationSettings.tsx, AnodBizLogo.tsx
        └── ui/                 — компоненты shadcn/ui (+ icon.tsx — обёртка иконок)
```

### 6.1 Модули `src/lib`

| Файл | Назначение |
|---|---|
| `sdk.ts` | Клиент `auth-api` и `data-api` (аналог supabase-подобного API: `from(table).select().eq()…`), хранит токен `anod_session_token`. |
| `auth.tsx` | `AuthProvider`, `useAuth()`: вход/выход, `resolveUserRole`, `refreshRoles`, объект пользователя (`id, email, role, fullName, profileId, department`). |
| `access.tsx` | `AccessProvider`, `useAccess()`: загрузка `admin-api/my_access`, `can(action)`, `canSee(path)`, формулы и поля. |
| `navigation.ts` | Пункты меню `NAV_ITEMS`, подписи ролей, `visibleNav(role, sections)`, приоритетные пункты нижнего меню. |
| `pinAdpods.ts` | Список «АдПодов» — адресов входа только по PIN (`/pin-cod-*`). |
| `devices.ts` | Клиент `device-control` (статусы ПК, команды, релизы). |
| `chatRoom.ts`, `chatUnread.ts` | Комнаты чата, подсчёт непрочитанных. |
| `vkBinding.ts` | Клиент `vk-api` (код привязки, статус, рассылка). |
| `scheduleSolver.ts` | Генератор табеля (эвристический перебор вариантов). |
| `mobileTables.ts` | Помощники для адаптивных таблиц. |
| `camerasApi.ts` | Клиент `cameras-api`. |
| `accountingApi.ts` | Клиент `accounting-api`. |
| `sberApi.ts` | Клиент `sber-api`. |
| `skudApi.ts` | Клиент `skud-api`, типы `SkudEvent/SkudCard/SkudController/SkudVisit/SkudSchedule`, форматирование дат (МСК). |
| `hevc/` | Обвязка WASM-декодера H.265. |
| `utils.ts` | `cn()` и мелкие утилиты. |

---

## 7. Авторизация, сессии, токены

### 7.1 Способы входа
| Способ | Страница | Действие `auth-api` | Описание |
|---|---|---|---|
| E-mail + пароль | `/login` | `signin` | Возвращает токен сессии (30 дней, таблица `auth_sessions`). |
| Регистрация компании | `/register` | `signup` | Создаёт `auth_users`, `profiles`, `companies`. Первый пользователь — `is_admin`. |
| PIN + пароль | `/pin-login` → `/pin-auth` | `pin_lookup` → `signin` | По 4-значному PIN находится e-mail, затем ввод пароля. |
| Только PIN (АдПод) | `/pin-cod-*` | `pin_signin` | Вход без пароля на закреплённом адресе (`pin_codes.adpod_slug`). |
| Одноразовая ссылка с ПК | `/device-login?code=` | `redeem_login_link` | Программа АБИЗ получает код (`request_login_link`) и открывает браузер уже авторизованным. Код одноразовый, с истечением (`login_links`). |
| Вход сотрудника на ПК | программа | `device_signin` | Проверка пароля сотрудника на сервере, привязка к ПК. |

Пароли — PBKDF2-SHA256, 150 000 итераций, соль. Выход — `signout` (удаление сессии).

### 7.2 Токены
| Токен | Где хранится | Для чего |
|---|---|---|
| Сессия сайта | `localStorage.anod_session_token`; сервер — `auth_sessions` | Все запросы сайта (`X-Authorization`). |
| API-токен сотрудника | `api_tokens` (`anod_…`) | Ручная настройка десктоп-программы. Выдача/отзыв — `get_api_token`/`revoke_api_token`. |
| Токен устройства (ПК) | `api_tokens.device_code`; на ПК — DPAPI | Выдаётся после привязки 9-значного кода (`register_device` → `link_device` директором → `device_status`). Отзыв — `revoke_device`. |
| Ключ рекордера | `recorder_keys`; на ПК — `C:\ProgramData\AnodBiz\recorder\key` | Только загрузка видео СКУД (`rec_*`), без доступа к данным. |
| Ключ моста СКУД | `skud_controllers.secret` (заголовок `X-Skud-Key`) | Обмен GateBridge ↔ skud-api (`bridge_*`). |
| Токен для камеры в программе | `sessionStorage.abiz_device_token` | Страница `/cam-view` во встроенном браузере. |

### 7.3 Определение роли (`resolveUserRole`)
1. `auth-api/get_roles` содержит `admin` → директор.
2. Иначе профиль по `profiles.user_id`, затем по e-mail (без учёта регистра).
3. Нет профиля → `employee`.

На сервере аналогичная функция `current_user()` в `access.py` / `_site_user()` в `skud-api`.

---

## 8. Модель прав доступа

### 8.1 Разделы (`SECTIONS`)
`/dashboard` Главная · `/documents` Документация · `/base` База документов · `/dto` ДТО · `/chat` Чат · `/cameras` Камеры · `/skud` СКУД · `/schedule` Табель · `/salary` Зарплата · `/collection` Инкассация · `/accounting` Бухгалтерия · `/sber` СБЕР (оплаты) · `/employees` Сотрудники · `/settings` Настройки. Разделы `/admin` и `/devices` — только заместитель директора.

### 8.2 Действия (`ACTIONS`)
| Ключ | Группа | Описание |
|---|---|---|
| accounting.view_entries | Бухгалтерия | Видеть доходы и расходы |
| accounting.edit_entries | Бухгалтерия | Добавлять и изменять операции |
| accounting.delete_entries | Бухгалтерия | Удалять операции |
| accounting.view_reports | Бухгалтерия | Видеть прибыль и ДДС |
| accounting.view_budget / edit_budget | Бухгалтерия | Видеть / составлять бюджет |
| accounting.view_counterparties / edit_counterparties | Бухгалтерия | Контрагенты и документы |
| accounting.view_salary / edit_salary | Бухгалтерия | Зарплата, долги, листки / начисления и выплаты |
| accounting.close_month | Бухгалтерия | Закрывать / открывать месяц |
| sber.view | СБЕР | Видеть заявки и выписку |
| sber.request | СБЕР | Создавать заявки |
| sber.pay | СБЕР | Оплачивать через СберБизнес |
| sber.edit_requisites | СБЕР | Менять реквизиты контрагентов |
| sber.sync | СБЕР | Обновлять выписку |
| salary.view_full | Зарплата | Видеть полную таблицу |
| salary.edit | Зарплата | Вносить часы, выручку, удержания |
| salary.manage_rows | Зарплата | Добавлять/удалять сотрудников |
| salary.lock | Зарплата | Сохранять/блокировать |
| salary.broadcast | Зарплата | Рассылка в ВК |
| collection.edit | Инкассация | Вносить факт и статусы |
| collection.import | Инкассация | Загружать файл СБИС |
| collection.unlock | Инкассация | Разблокировать закрытый месяц |

### 8.3 Правила вычисления
- Заместитель: `is_deputy = true`, всё разрешено.
- Есть должность с заданными правами → разделы/действия должности (без `/admin`).
- Иначе — `ROLE_SECTIONS[role]`, `ROLE_ACTIONS[role]`.
- Старшему всегда добавляются `sber.view`, `sber.request`, разделы `/sber`, `/skud`.
- Директору всегда добавляются `sber.view/request/pay/sync`, раздел `/sber`.
- `/dashboard` всегда первым.
- Файл `access.py` **дублируется** в `admin-api`, `accounting-api`, `sber-api` — при изменении править все три копии одинаково.
- СКУД проверяет права собственной логикой: `MANAGER_ROLES = {director, deputy_director}` — всё; `CARD_ROLES` (+ `senior_employee`) — только `CARD_ACTIONS` (overview, cards, card_save, card_rewrite, card_check, enroll_start, enroll_poll, events, visits); прочие — только `notices`/`notice_dismiss`.

---

## 9. Функциональные требования по разделам сайта

### 9.1 Каркас (AppShell)
- Сетка `app-grid`: слева меню (`SideNav`, ≥ lg), сверху строка-объявление, по центру контент, снизу на мобильных `BottomNav` (4 приоритетных пункта + «Ещё» → боковое меню в `Sheet`).
- На всех защищённых страницах: глобальные уведомления чата (`useChatNotifications`: опрос непрочитанных, звук `notification.mp3`, системные уведомления) и плашки СКУД о сроке карт (`SkudNotices`, опрос каждые 10 минут, закрытие крестиком — `notice_dismiss`).
- `ProtectedRoute`: ждёт загрузку, без пользователя → `/login`, проверка `canSee(path)` или `directorOnly` / `deputyOnly`.

### 9.2 Вход и регистрация
`/login`, `/register`, `/pin-login`, `/pin-auth`, `/pin-cod-*`, `/device-login` — см. §7. Требования: сообщения об ошибках на русском, блокировка кнопки во время запроса, после входа — `/dashboard`.

### 9.3 Главная (`/dashboard`)
Плита месяца (`MonthSlab`) со статусом табеля и сменами, строка показателей (`StatsRow`), сетка ссылок на доступные разделы.

### 9.4 Табель (`/schedule`, ~845 строк)
- Таблица «сотрудник × день месяца», смены: **Д** (день), **Н** (ночь), **Дп** (день-подработка/второй пост), **Нп** (ночь второй пост).
- Данные: `schedule_data` (shifts JSON по профилю и месяцу), `schedule_config` (настройки сотрудника: статус СТ/МЛ, запреты дней/ночей, перерыв, приоритет, преференции, задержки, недоступные даты, исключение), `employee_schedule_settings` (помесячные задержки/недоступность), `schedule_settings` (блокировка месяца, ответственный), `employee_rotation` (ротация по точкам).
- **Генератор** (`scheduleSolver.ts`): каждый день ровно 4 смены (Д, Н, Дп, Нп), один человек — не более одной смены в день; соблюдение запретов и недоступных дат; преференции (работа только в паре из списка). Правила: СТ — «Д», затем «Н», затем отдых ≥ 1 дня (или перерыв из настроек); МЛ с перерывом 0 — «Дп» подряд 3–6 дней, серия заканчивается «Нп», затем 2 дня отдыха; остальные — перерыв из настроек. Выравнивание количества смен внутри групп. Перебираются сотни вариантов, выбирается лучший по штрафам (RULE=100, EMPTY=5000, вес баланса и штраф ночи настраиваются).
- Ручное редактирование, блокировка месяца, экспорт картинкой, рассылка в ВК (`vk-api/broadcast`).
- Настройки сотрудника — модальные окна `EmployeeSettingsModal`, `EmployeePermanentSettings`, `EmployeeVariableSettings`, `EmployeePreferencesAndExclude`, `RotationSettings`.

### 9.5 Зарплата (`/salary`, ~828 строк)
- Таблицы сотрудников (`salary_data`) и менеджеров (`manager_data`) за месяц; параметры месяца (`salary_settings`: процент, выручка, дней в месяце, блокировка; `manager_settings`: процент менеджера).
- Часы подтягиваются из табеля (`schedule_data`), колонки и формулы — из `admin-api` (`fields`, `formulas`).
- Формулы по умолчанию:
  - `rate = revenue / (days * 24) * percent / 100`
  - `total = (rate * hours + vacation) - non_cash - overtime - tax + underpayment`
  - `week = total / 4`
  - `manager_rate = rate * (1 + manager_percent / 100)`
  - `manager_total = ((osn_hours * manager_rate) + vacation) - non_cash + doplaty + dop_hours * rate + underpayment`
  - `manager_week = manager_total / 4`
- Вычисление на сервере безопасным разбором AST (`formulas.py: safe_eval`), допустимы `+ - * / ( )`, `min`, `max`, `abs`, переменные полей.
- Сотрудник без `salary.view_full` видит только свою строку. Рассылка расчёта в ВК (`salary.broadcast`).

### 9.6 Инкассация (`/collection`, ~812 строк)
- По сменам месяца: значение СБИС (`sbis_value`), факт (`fact_value`), статус, ответственный, блокировка месяца, доп. поля (`extra` JSON по конфигурации полей).
- Импорт файла СБИС (`collection.import`), разблокировка закрытого месяца (`collection.unlock`).

### 9.7 Бухгалтерия (`/accounting`)
Вкладки по правам:
- **Операции** (`EntriesTab`): доходы/расходы, категория, контрагент, комментарий; источники: ручные, зарплата, инкассация, банк (`source`, `source_key`), «аннулированные» (`void`).
- **Прибыль** (`ProfitTab`) и **ДДС** (`DdsTab`) — по категориям и месяцам.
- **Бюджет** (`BudgetTab`) — план по категориям vs факт.
- **Контрагенты** (`CounterpartiesTab`) — реквизиты, документы (`acc_cp_docs`), долги (получили/отдали).
- **Зарплата** (`SalaryTab`) — сотрудники бухгалтерии (`acc_staff`), начисления (`acc_accruals`), выплаты (`acc_payments`), долг на начало, расчётные листки (`Payslip`).
- **Периоды** (`PeriodsBar`): синхронизация месяца с «Зарплатой» и «Инкассацией» (отпечаток `fingerprint` для отслеживания изменений), закрытие/открытие месяца, снимок `snapshot`.
- **Импорт выписки** (`BankImport`): формат 1С (`kl_to_1c.txt`, 1CClientBankExchange) и Excel Сбера; предпросмотр, поиск дублей, автокатегоризация (`bank.guess_category`), журнал импортов (`acc_bank_imports`).
- **Еженедельная зарплата** (`salary_weekly.py`): каждое воскресенье начисляется сумма «НЕДЕЛЯ», в последний день месяца — остаток до «ИТОГО».
- Журнал действий — `acc_log`.

### 9.8 СБЕР (`/sber`)
- Заявки на оплату (`sber_requests`): контрагент, сумма, назначение, НДС, неделя, статус (черновик → отправлена директору → оплачена/отклонена), снимок реквизитов и хеш (защита от подмены реквизитов).
- Подключения к банку (`sber_connections`, несколько счетов/организаций), выписка, баланс (`BankCard`).
- Оплата: директор формирует платёжку через API, получает ссылку подписи (`sign_links`) в СберБизнес; ограничение попыток (`sber_pay_attempts`).
- Уведомления директору в ВК о новых заявках/решениях (`notify_save`, `notify_test`).
- Каталог «продуктов» Сбера (`products.py`) — настройка нескольких продуктов API (ключи, сертификаты) из админ-панели.

### 9.9 Документы (`/documents`), База (`/base`), ДТО (`/dto`)
- Документы: заголовок, текст, автор, теги (`documents`).
- База: дерево папок (`folders`), файлы (`base_files`: имя, тип, размер, URL в S3, защищённый), загрузка через `file-upload`.
- ДТО: категории (`dto_categories`) и шаблоны (`dto_templates`, счётчик использования).

### 9.10 Чат (`/chat`)
Комнаты (`chat_rooms`), сообщения (`chat_messages`), отметки прочтения (`chat_reads`). Опрос новых сообщений, звук, счётчик непрочитанных в меню. На ПК — `device-control/chat_unread`, `chat_mark_read`.

### 9.11 Камеры (`/cameras`, `/cam-view`)
Список камер, «всё живое» (`live_all`), живое видео (HLS через hls.js; H.265 — WASM-декодер), снимок, архив по дате (`records`, `playback`, `ArchiveBar`), управление камерами (`CameraManager`: добавить/изменить/удалить/по умолчанию/порядок). Логины камер хранятся только на сервере.

### 9.12 СКУД (`/skud`)
- Вкладки: «Посещения с видео» (карточки `VisitCard`: открытия двери, отметки, клипы с камер «Склад» и «Склад-ВН») и «Журнал» (`EventsTable`).
- Фильтры: даты, сотрудник, тип (все/проходы/тревоги), экспорт CSV.
- Показатели дня: входов, тревог, активных карт.
- Кнопка «Открыть дверь» (только директор/заместитель).
- **Ключ-карты** (`CardsPanel`): запись карты (USB-считыватель TS-RDR-USB-EM «печатает» номер, или считывание на двери — `enroll_start/poll`), тип «Сотрудника» / «Гостевая», привязка к сотруднику, подпись, срок для гостевой, расписание доступа и 6-значный код (только руководство), «Перезаписать», блокировка/удаление (руководство).
- **Доступ и тревоги** (`AccessPanel`, руководство): до 7 расписаний (дни недели + время), переключатель запрета повторного прохода, дополнительные выходы (на Gate-4000-Ethernet фактически недоступны — одно реле, см. §14), настройка рассылки тревог простым сотрудникам.
- **Контроллер** (`ControllerPanel`): адрес, порт, время открытия, камеры, ПК-рекордер, качество записи, аварийное открытие, синхронизация часов и карт.
- **Правила срока карт сотрудников:** действует 1 месяц от `written_at`; затем 5 резервных дней; через 1 мес. + 5 дн. карта удаляется. Предупреждение — с даты «конец месяца − 5 дней»: плашка на всех страницах (зам. директора и старшему — по всем картам; сотруднику — по своей), ежедневное сообщение в ВК; закрывается крестиком до следующего цикла; перезапись (`card_rewrite`/`card_save` с `rewrite`) сбрасывает цикл.
- **Выход по кнопке:** к событию записывается «На складе были: …» (вошедшие по картам в текущем посещении) и счётчик людей.

### 9.13 Сотрудники (`/employees`, ~1247 строк; директор/заместитель)
Профили (ФИО, e-mail, роль, отдел, должность, статус, доступ в систему), PIN-коды и АдПоды, пароль сотрудника (`set_employee_password`), привязка ВК (код), список ПК и привязка 9-значного кода.

### 9.14 Админ-панель (`/admin`; заместитель)
Вкладки: Должности (`PositionsTab`: разделы и действия), Формулы (`FormulasTab`: редактирование, проверка `formula_test`), Поля (`FieldsTab`: колонки зарплаты/менеджеров/инкассации), Общие (`GeneralTab`: начало учёта, часы смен), Справочники (`DirectoriesTab`: категории, контрагенты), Сбер (`SberTab`/`SberSection`/`SberProductPanel`: ключи, сертификаты .p12, продукты, диагностика).

### 9.15 Управление ПК (`/devices`; заместитель)
Список ПК с присутствием (на экране входа / работает / офлайн), текущий пользователь, версия, снимок экрана; команды: заблокировать/разблокировать, сообщение, снимок, RuDesktop, перезагрузить программу, выйти; журнал (`device_logs`); релизы программы (`ReleasePanel`: загрузка частями, публикация, активация, удаление, «обновить все»).

### 9.16 Настройки (`/settings`, ~483 строки)
Аккаунт (имя, пароль), ВК (привязка), PIN, рабочие настройки (смены, ответственные за месяцы), система (рабочее место, токен для программы).

---

## 10. Серверные функции — полный перечень

Общие правила: метод POST (OPTIONS — CORS-ответ 200), JSON-тело, ответы JSON, `Access-Control-Allow-Origin: *`, ошибки — `{"error": "текст по-русски"}` с кодом 400/401/403/404. Таймаут по умолчанию 5 с (длинные операции — увеличивать в настройках функции).

### 10.1 auth-api
`ping`, `signup`, `signin`, `pin_lookup`, `pin_signin`, `session`, `signout`, `get_roles`, `get_api_token`, `revoke_api_token`, `register_device`, `device_status`, `list_devices`, `link_device`, `revoke_device`, `request_login_link`, `redeem_login_link`, `set_employee_password`, `device_signin`, `api_verify`.
Таблицы: `auth_users`, `auth_sessions`, `profiles`, `companies`, `pin_codes`, `api_tokens`, `devices`, `login_links`.

### 10.2 data-api
Универсальный CRUD: `{ table, op: select|insert|update|delete, filters:[{col,op,value}], order, limit, single_mode, payload }`. Белый список таблиц: companies, profiles, pin_codes, schedule_config, employee_schedule_settings, schedule_data, schedule_settings, salary_data, salary_settings, manager_data, manager_settings, employee_rotation, collection_data, documents, folders, base_files, dto_categories, dto_templates, chat_rooms, chat_messages, devices, kiosk_buttons. Имена колонок проверяются регуляркой. Требуется токен.

### 10.3 file-upload
Загрузка файла base64 в S3 (`bucket "files"`), ответ — CDN-URL `https://cdn.poehali.dev/projects/{AWS_ACCESS_KEY_ID}/bucket/...`.

### 10.4 admin-api
`my_access`, `overview`, `general_save`, `position_save`, `position_delete`, `person_save`, `formulas_save`, `formula_test`, `fields_save`, `reset`, `category_save`, `counterparty_save`. Таблицы: `positions`, `profiles`, `app_settings` (формулы, поля, общие), `acc_categories`, `acc_counterparties`.

### 10.5 accounting-api
Чтение: `me`, `periods`, `entries`, `profit`, `dds`, `budget`, `counterparties`, `cp_history`, `salary`, `payslip`, `salary_due`.
Запись: `entry_save`, `entry_delete`, `category_save`, `period_sync`, `period_close`, `period_open`, `bank_preview`, `bank_import`, `budget_save`, `counterparty_save`, `cp_doc_save`, `cp_doc_delete`, `staff_save`, `accrual_save`, `accrual_delete`, `payment_save`, `payment_delete`, `settings_save`.
Таблицы: все `acc_*`, `salary_*`, `manager_*`, `collection_data`, `app_settings`.

### 10.6 sber-api
`overview`, `products`, `product_save`, `product_cert_upload`, `product_cert_delete`, `product_keys_delete`, `scopes_save`, `tokens_save`, `diagnose`, `notify_save`, `notify_test`, `connection_update`, `connection_delete`, `cert_upload`, `cert_delete`, `connect`, `disconnect`, `bank_settings`, `sync`, `counterparty_save`, `request_save`, `request_delete`, `send_week`, `reject`, `pay`, `sign_links`; GET-обработчик возврата OAuth (`code`, `state`).
Модуль `sber.py`: окружение (боевое `fintech.sberbank.ru` / `sbi.sberbank.ru`, тестовое `iftfintech.testsbi.sberbank.ru` / `sbi-test.sberbank.ru`), mTLS по сертификату .p12, шифрование токенов Fernet (`sber_vault`), `authorize_url`, `exchange_code`, `refresh`, `payment_body`, `sign_url`, проверки ИНН и счёта по БИК.
Таблицы: `sber_connections`, `sber_oauth`, `sber_requests`, `sber_pay_attempts`, `sber_vault`, `acc_counterparties`, `acc_entries`, `app_settings`.

### 10.7 cameras-api
`list`, `live_all`, `snapshot`, `live`, `records`, `playback`, `add`, `update`, `delete`, `set_default`, `reorder`. Облако JFTech/XMeye (режим RPS), кэш ссылок живого видео (`live_url_sd/hd`, `*_at`), токен облака (`cloud_token`, `cloud_token_expires`). Параллельные запросы через ThreadPoolExecutor.

### 10.8 device-control
ПК: `heartbeat` (присутствие, пользователь, версия; ответ — команды), `command_result`, `device_log`, `chat_unread`, `chat_mark_read`, `check_update`.
Сайт: `devices_status`, `send_command`, `device_logs`, `release_list`, `release_upload_part`, `release_publish`, `release_activate`, `release_delete`, `update_all`.
Таблицы: `devices`, `device_commands`, `device_logs`, `app_releases`, `chat_*`.

### 10.9 vk-api / vk-webhook
`status`, `bindings_list`, `generate_code`, `unbind`, `broadcast`. Webhook принимает `confirmation` (строка `VK_CALLBACK_CONFIRMATION`) и `message_new`: сотрудник пишет боту код → `vk_bindings.status = confirmed`, сохраняется `vk_user_id`. Отправка — `messages.send` с `VK_GROUP_TOKEN`.

### 10.10 skud-api
Сайт: `overview`, `events`, `cards`, `visits`, `devices`, `clip_retry`, `card_save`, `card_rewrite`, `card_status`, `card_delete`, `card_check`, `enroll_start`, `enroll_poll`, `controller_save`, `open_door`, `schedule_save`, `schedule_delete`, `notify_save`, `antipassback`, `outputs_save`, `output`, `emergency`, `sync_clock`, `gate_info`, `sync_cards`, `notices`, `notice_dismiss`.
Мост (заголовок `X-Skud-Key`): `bridge_push` (события), `bridge_poll` (команды, карты, расписания, настройки двери), `bridge_ack` (результаты, `cards_synced`).
Рекордер (ключ рекордера): `rec_key`, `rec_poll`, `rec_part`, `rec_done`.
Модули: `alerts.py` (сроки карт, плашки, ВК), `visits.py` (движок посещений/открытий/клипов), `recorder.py` (задания на видео).

---

## 11. База данных

Схема `t_p59581145_website_source_extra`. Идентификаторы — `text` (md5/uuid) или `bigserial`. Время — `timestamptz`.

### 11.1 Пользователи и компания
| Таблица | Поля |
|---|---|
| auth_users | id, email, password_hash, is_admin, created_at |
| auth_sessions | id, user_id, token, created_at, expires_at |
| profiles | id, user_id, full_name, email, role, department, status, has_system_access, vk_id, vk_link, created_at, position_id |
| positions | id, name, sections (jsonb), actions (jsonb), created_at |
| companies | id, name, inn, ogrn, type, created_at |
| pin_codes | id, user_id, pin, email, shortcut_code, created_at, adpod_slug |
| api_tokens | id, user_id, token, label, created_at, last_used_at, revoked_at, device_code |
| login_links | id, code, user_id, created_at, expires_at, used_at |
| app_settings | key, value (jsonb), updated_by, updated_at — ключи: формулы/поля/общие настройки, `skud_notify`, настройки Сбера и т.п. |

### 11.2 Табель, зарплата, инкассация
| Таблица | Поля |
|---|---|
| schedule_config | id, profile_id, no_day, no_night, break_days, priority, status, preferences, excluded, st_no_day, st_no_night, ml_no_day, ml_no_night, delays, unavailable, created_at |
| schedule_data | id, month_year, profile_id, shifts (jsonb), user_id, created_at |
| schedule_settings | id, month_year, is_locked, responsible_profile_id, created_at |
| employee_schedule_settings | id, profile_id, month_year, delay, unavailable, created_at |
| employee_rotation | id, profile_id, position, store_name, active, created_at |
| salary_data | id, profile_id, hours_worked, revenue, days_in_month, vacation_pay, non_cash, overtime, tax, underpayment, month_year, responsible_user_id, user_id, created_at, extra (jsonb) |
| salary_settings | id, month_year, percent, is_locked, responsible_profile_id, revenue, days_in_month, created_at |
| manager_data | id, profile_id, osn_hours, dop_hours, doplaty, vacation_pay, non_cash, underpayment, hourly_rate, month_year, user_id, created_at, extra |
| manager_settings | id, month_year, manager_percent, is_locked, responsible_profile_id, created_at |
| collection_data | id, shift_date, shift_type, sbis_value, fact_value, status, responsible_person, month_year, locked, created_at, extra |

### 11.3 Бухгалтерия
| Таблица | Поля |
|---|---|
| acc_categories | id, kind (income/expense), name, archived, created_at |
| acc_counterparties | id, name, kind, inn, phone, comment, archived, created_at, default_category_id, kpp, account, bank_bic, bank_name, corr_account, default_purpose, vat_rate, requisites_hash, requisites_updated_at, requisites_updated_by |
| acc_cp_docs | id, counterparty_id, direction, doc_date, amount, category_id, comment, created_by, created_at |
| acc_entries | id, kind, entry_date, amount, category_id, comment, payment_id, created_by, created_at, updated_at, source, source_key, period, counterparty_id, void, bank_purpose, bank_connection_id |
| acc_budget | period, category_id, amount |
| acc_periods | period, closed, closed_at, closed_by, synced_at, snapshot (jsonb), fingerprint |
| acc_staff | id, name, profile_id, position, pay_type, rate, active, created_at |
| acc_accruals | id, staff_id, period, pay_type, rate, base, bonus, amount, comment, created_by, created_at, source_key, details (jsonb), void |
| acc_payments | id, staff_id, pay_date, amount, period, comment, created_by, created_at, source_key |
| acc_bank_imports | id, file_name, account, date_from, date_to, added, skipped, created_by, created_at |
| acc_access | profile_id, can_entries, can_profit, can_salary, updated_at (устаревшая, заменена должностями) |
| acc_log | id, user_name, action, details, created_at |

### 11.4 СберБизнес
| Таблица | Поля |
|---|---|
| sber_connections | id, title, org (jsonb), account, is_default, active, last_sync, last_sync_result, last_error, created_by, created_at |
| sber_oauth | state, nonce, user_id, used, created_at, origin |
| sber_requests | id, counterparty_id, amount, purpose, vat_rate, week_start, status, requisites (jsonb), requisites_hash, created_by, created_by_user, created_at, sent_at, decided_by, decided_at, reject_reason, external_id, bank_status, bank_comment, bank_checked_at, entry_id, category_id, connection_id, period |
| sber_pay_attempts | id, user_id, ok, created_at |
| sber_vault | key, value (зашифровано), updated_at |

### 11.5 Документы, чат
| Таблица | Поля |
|---|---|
| documents | id, title, content, author, tags, created_at, updated_at |
| folders | id, name, parent_id, created_at |
| base_files | id, name, type, size, folder_id, uploaded_by, uploaded_at, is_protected, url |
| dto_categories | id, name, created_at |
| dto_templates | id, name, category_id, content, description, created_at, usage_count |
| chat_rooms | id, name, type, participants (jsonb), created_at |
| chat_messages | id, room_id, sender_id, sender_name, content, read, created_at |
| chat_reads | user_id, room_id, last_read_at |

### 11.6 Устройства, камеры, ВК
| Таблица | Поля |
|---|---|
| devices | id, device_code, hostname, profile_id, status, created_at, linked_at, last_seen_at, presence, heartbeat_at, current_user_name, app_version, screenshot_url, screenshot_at, remote_lock, lock_message, update_status |
| device_commands | id, device_code, command, payload, created_by, created_by_name, created_at, delivered_at, done_at, result |
| device_logs | id, device_code, kind, message, actor_name, created_at |
| app_releases | id, edition, version, url, sha256, size_bytes, notes, is_active, created_by, created_at |
| kiosk_buttons | id, text, color, action, target, order_index, created_at, updated_at |
| recorder_keys | key, device_code, created_at, last_used_at, revoked_at |
| cameras | id, name, serial, username, password, network_mode, order_index, is_default, cloud_token, cloud_token_expires, created_at, updated_at, live_url_sd, live_url_sd_at, live_url_hd, live_url_hd_at |
| vk_bind_codes | id, profile_id, code, status, created_at |
| vk_bindings | id, profile_id, vk_user_id, vk_link, status, message, created_at, updated_at |

### 11.7 СКУД
| Таблица | Поля |
|---|---|
| skud_controllers | id, name, serial, model, secret, camera_id, open_seconds, last_seen_at, last_ip, fw_version, conn_fw, door_open, active, created_at, inside_camera_id, pre_seconds, post_seconds, recorder_device, recorder_quality, recorder_status, recorder_seen_at, gate_host, gate_port, gate_address, gate_status, gate_seen_at, emergency_open, antipassback, outputs |
| skud_cards | id, card_number (UNIQUE, «ГГГ,ННННН»), profile_id, label, status (active/blocked), valid_from, valid_to, synced, created_by, created_at, updated_at, card_type (employee/guest), pin_code, schedule_id, written_at, written_by |
| skud_schedules | id, name, days (битовая маска Пн=1…Вс=64), time_from, time_to, created_at — не более 7 |
| skud_events | id, controller_id, event_time, received_at, event_code, event_kind, direction, granted, card_number, profile_id, person_name, note, source, raw, processed; UNIQUE(controller_id, event_time, event_code, card_number) |
| skud_visits | id, controller_id, status, started_at, ended_at, inside, entries, exits, people (JSON-список вошедших), alarm, note, inside_until, created_at |
| skud_openings | id, visit_id, controller_id, status, opened_at, last_open_at, closed_at, closed_assumed, held, marks (JSON) |
| skud_clips | id, visit_id, opening_id, camera_id, mode (door/inside), part_no, clip_from, clip_to, status, attempts, taken_at, url, size_bytes, error, created_at, done_at, parts, duration_sec |
| skud_commands | id, controller_id, operation (open_door, emergency, sync_clock, gate_info, output…), payload, created_by, created_at, sent_at, done_at, result |
| skud_enroll | id(=1), until_at, card_number, captured_at — режим «поднесите карту к двери» |
| skud_notice_dismiss | user_id, card_id, cycle, dismissed_at |
| skud_vk_sent | key, sent_at — защита от повторной отправки (ключи `alarm:*`, `expiry:*:день`, `removed:*`, `daily:день`) |

Типы событий `event_kind`: entry, exit, exit_button, remote_open, denied, denied_blocked, forced, held_open, door_closed, other.

---

## 12. Миграции

`db_migrations/V0001…V0043`. Ключевые:
- V0001 — привязка ВК; V0002 — основная схема; V0003 — демо-данные; V0004–V0006 — АдПоды, чат.
- V0007–V0008 — API-токены; V0010–V0012 — устройства, ссылки входа, кнопки киоска; V0013 — камеры; V0014–V0015 — удалённое управление, кэш ссылок; V0016 — релизы; V0018 — прочтения чата; V0019 — статус обновления.
- V0020–V0028 — СКУД (контроллеры, карты, события, посещения, клипы, ключи рекордера).
- V0029–V0040 — бухгалтерия, должности, импорт банка, СберБизнес, категории, недельная зарплата.
- V0041 — подключение Gate по TCP; V0042 — сроки карт, расписания, гостевые, тревоги; V0043 — список людей в посещении.

Правила: только новые файлы, без изменения старых; без `DROP` данных без согласования; применение — инструментом платформы `migrate_db`.

---

## 13. Программы для Windows

### 13.1 АБИЗ (AbizShell), редакции «Киоск» и «Админ» (`Edition.cs`)
- **Киоск:** полноэкранная оболочка вместо рабочего стола, скрыта панель задач (`TaskbarManager`), перехват клавиш Win/Alt+Tab (`KeyboardHook`), область экрана (`ScreenArea`), верхняя панель (`TopBarWindow`), переключение окон (`WindowSwitcher`).
- **Админ:** обычное окно.
- Экран входа (`MainWindow`): пароль сотрудника проверяется на сервере (`device_signin`), пароль администратора — локально (работает без интернета), индикатор сети.
- Привязка ПК (`DeviceManager`): 9-значный код, ожидание привязки директором, получение токена; хранение в DPAPI (`PasswordVault`).
- Кнопки киоска (`KioskButtonsService`, `AppLauncher`): запуск программ и сайтов, порядок из `kiosk_buttons`.
- Удалённое управление (`RemoteAgent`, `RemoteControlClient`): heartbeat каждые ~4 с, команды lock/unlock/message/screenshot/rudesktop/reload/logout, оверлей (`RemoteOverlayWindow`), снимки (`ScreenCapture`).
- Камеры (`CamerasClient`, `CamerasWindow`, `CameraWindow`).
- Проводник/печать/звук (`ExplorerWindow`, `PrintService`, `AudioManager`), расширения (`ExtensionsService`).
- Обновление (`Updater`): проверка `check_update`, загрузка релиза, установка при выходе.
- СКУД: `GateBridge.cs` (мост к контроллеру), `SkudRecorder.cs` / `RecorderService.cs` (видеозапись).
- Актуальные исходники: `public/downloads/AbizShell-v22.zip` (программа 3.10, `AbizShell.csproj` 1.7.0). В репозитории `desktop-app/` может лежать предыдущая версия — при доработке брать архив v22 как эталон.

### 13.2 АБИЗ-Рекордер (AbizRecorder)
Служба Windows, стартует до входа пользователя, свой ключ `recorder_key`; круглосуточная запись камер «Склад»/«Склад-ВН» минутными кусками (хранение ~3 ч), по заданиям сервера склейка/обрезка, перекодирование в H.264, загрузка частями по 1 МБ (`rec_part`, `rec_done`). Установка — `install-service.cmd`.

### 13.3 Установщики
WiX: `installer/msi/Product.wxs` (киоск), `installer/admin/Product.wxs`, `installer/bundle/Bundle.wxs`; сборка — `build-installer.ps1`, инструкция — `СБОРКА-ИНСТАЛЛЯТОРА.md`, начало работы — `НАЧАЛО-РАБОТЫ-VS2026.md`.

---

## 14. СКУД: оборудование, протокол, логика

### 14.1 Оборудование
- **Контроллер Gate-4000-Ethernet:** питание 12 В/100 мА; один вход считывателя Wiegand-26/48; одно реле (NO/NC/COM, 24 В/5 А) + дублирующий транзисторный выход LOCK; 8000 ключей, 4000 событий; Ethernet, порт 5000; заводской IP 192.168.0.66, admin/admin; джамперы A (веб), E (сброс), F (UNBLK).
- **Колодки:** XP2 питание (GND, +12V); XP5 считыватель (GND, DATA0, DATA1, +12R, LED); XP4 реле (COM, NO, NC); XP3 (GND, RES, DOOR — геркон, UNBLK — пожарная разблокировка, EXIT — кнопка, GND, LOCK-, +12V).
- **Карты:** EM-Marine 125 кГц, номер «серия,номер» `ГГГ,ННННН`.
- Схема подключения — `public/skud-gate4000-scheme.png`.
- **Ограничения модели:** нет второго считывателя → нет считывания на выход, анти-passback неработоспособен; нет свободных выходов для сирены/света.

### 14.2 GateBridge (протокол)
- Работает внутри АБИЗ на ПК склада, связь с контроллером по TCP (протокол Gate: команды чтения/записи памяти, открыть дверь `07h`, управление выходами `0Eh`, временные зоны по адресу `0078h` банков 1 и 2, ключи с `00C0h`).
- Блок ключа 8 байт: 1–6 — номер (при «карта+код» первые 3 байта — код в BCD), байт 7 — признаки (бит 7 — APB, бит 3 — гость, бит 1 — карта с кодом), байт 8 — маска временных зон (80h — всегда).
- Цикл: `bridge_poll` → команды + при изменениях список карт и расписаний → запись в контроллер → `bridge_ack`; чтение событий → `bridge_push`.

### 14.3 Логика на сервере
- `_save_event`: нормализация карты, владелец, заблокированная → `denied_blocked`, гостевая → отметка «Гостевая карта», незнакомая карта в режиме записи → `skud_enroll`.
- Тревоги (`forced`, `held_open`, `denied_blocked`) → ВК директору, заместителю, старшему (+ сотрудникам, если включено), без повторов.
- Движок посещений (`visits.py`): «открытие» — от первого срабатывания до закрытия (по геркону или таймеру замка); «посещение» — от первого входа до момента, когда счётчик людей = 0; выход по кнопке без людей в течение 30 мин дописывается к прошлому посещению; висящие > 12 ч закрываются автоматически; задания на клипы (дверь: от `pre` до `post` секунд; внутри — части по 10 минут).
- Карты для контроллера: только активные, в сроке, сотрудники — не позже `written_at + 1 мес + 5 дн`.

---

## 15. Видеонаблюдение
- Камеры XMeye/iCSee через облако JFTech (RPS), сервер получает и кэширует ссылки HLS (SD/HD).
- Браузер: hls.js; для H.265 — WASM-декодер.
- Архив: список записей за дату, воспроизведение отрезка.
- СКУД-клипы хранятся в S3, ссылки — `skud_clips.url`.

---

## 16. Интеграции
| Интеграция | Где | Детали |
|---|---|---|
| ВКонтакте | vk-api, vk-webhook, sber-api, skud-api | Сообщество-бот, `messages.send` v5.199, Callback API, привязка по коду. |
| СберБизнес | sber-api | OAuth2 (authorization code + refresh), mTLS-сертификат .p12, выписка, платёжные поручения, ссылки подписи. Боевой и тестовый контуры. |
| S3 | file-upload, device-control, skud-api | `endpoint https://bucket.poehali.dev`, bucket `files`, CDN `cdn.poehali.dev/projects/{AWS_ACCESS_KEY_ID}/bucket/...`. |
| Облако камер | cameras-api | JFTech/XMeye: `rds-viot.bcloud365.net`, `tks-iot.xmeye.net`. |
| СБИС | collection (импорт файла) | Загрузка выгрузки вручную. |

---

## 17. Фоновые и периодические процессы
Отдельного планировщика нет; периодические задачи запускаются «по первому обращению»:
- **СКУД ежедневно** (`alerts.daily_once`, при `bridge_poll` или `notices`): ВК-напоминания о картах, удаление карт после резерва, удаление просроченных гостевых, очистка `skud_vk_sent` старше 60 дней.
- **Движок посещений** — при каждом `bridge_push` и опросе.
- **Недельная зарплата** — при синхронизации периода.
- **Синхронизация Сбера** — по кнопке или при обращении (`sync`).
- **ПК** — heartbeat от программы.

---

## 18. Секреты и переменные окружения
| Имя | Назначение |
|---|---|
| DATABASE_URL | Подключение к PostgreSQL |
| MAIN_DB_SCHEMA | Имя схемы |
| AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY | S3 |
| VK_GROUP_TOKEN, VK_GROUP_ID, VK_CALLBACK_CONFIRMATION | Бот ВКонтакте |
| SBER_CLIENT_ID, SBER_CLIENT_SECRET, SBER_REDIRECT_URI, SBER_CERT_PASSWORD | СберБизнес |

Секреты доступны только функциям (`os.environ`), во фронтенд не попадают и не логируются.

---

## 19. Нефункциональные требования
- **Адаптивность:** корректная работа от 360 px (мобильное меню, таблицы с горизонтальной прокруткой) до широких экранов.
- **Производительность:** ответы функций < 1–2 с; укладываться в таймаут (5 с по умолчанию); избегать N+1 запросов; пакетные вставки.
- **Время:** все даты отображаются по Москве (UTC+3), в БД — `timestamptz`.
- **Надёжность:** идемпотентная запись событий СКУД (уникальный ключ); повторная отправка команд и клипов; программы работают при кратковременной потере сети.
- **Язык:** все тексты интерфейса и ошибок — русский, понятный нетехническому пользователю.
- **Стиль кода:** TS strict, небольшие переиспользуемые компоненты, цвета через CSS-переменные (`index.css`, `tailwind.config.ts`), иконки через `Icon`, без комментариев «для очевидного».

---

## 20. Безопасность
- Пароли — PBKDF2 (150 000 итераций); токены — случайные, отзываемые.
- Проверка прав на сервере в каждой функции (фронтенд-скрытие не считается защитой).
- `data-api`: белый список таблиц и проверка имён колонок. **Риск:** права по строкам не проверяются — любой авторизованный токен может читать/писать таблицы белого списка. Требование к доработке: перенести чувствительные операции в профильные функции с проверкой роли.
- Сбер: секреты в `sber_vault` шифруются Fernet; хеш реквизитов в заявке, ограничение попыток оплаты; подпись платежа — только в интерфейсе банка.
- СКУД: ключ моста на контроллер, отдельный ключ рекордера; коды карт (`pin_code`) не отдаются на сайт (только признак `has_pin`).
- Камеры: логины/пароли только на сервере.

---

## 21. Тестирование и приёмка
- Каждая функция содержит `tests.json` (OPTIONS 200, GET 405, без входа 401, ключевые отказы). Все тесты должны проходить при развёртывании.
- Перед выпуском: сборка фронтенда без ошибок TS/ESLint; ручная проверка ролей (директор, заместитель, старший, сотрудник) по матрице разделов §8.
- СКУД на объекте: проход по карте, отказ по заблокированной, выход по кнопке, взлом/дверь не закрыта (сообщения в ВК), запись и перезапись карты, расписание, синхронизация часов, клипы видео.
- Программы Windows: установка MSI, привязка кода, вход сотрудника, команды с сайта, обновление.

---

## 22. Развёртывание и сопровождение
- Фронтенд и функции разворачиваются платформой poehali.dev; функции — синхронизация каталога `backend/`; адреса фиксируются в `func2url.json`.
- Схема БД — только миграциями.
- Код можно выгрузить: «Скачать → Скачать код» или подключить GitHub. GitHub Actions в репозитории не используются.
- Релиз программы: собрать установщик (`build-installer.ps1`), загрузить в «Управление ПК → Релизы», активировать, при необходимости «Обновить все».
- Таймауты длинных функций (Сбер, видео) — в настройках функции на платформе.

---

## 23. Известные ограничения и технический долг
1. `access.py`, `formulas.py`, `bank.py`, `salary_weekly.py` продублированы в нескольких функциях — нужна синхронная правка (или общий генератор).
2. `data-api` без построчных прав (см. §20).
3. Таблица `acc_access` устарела (заменена должностями).
4. Нет фонового планировщика — ежедневные задачи зависят от обращений.
5. Gate-4000-Ethernet: один считыватель и одно реле — APB и доп. выходы в интерфейсе есть, но на этой модели не работают; рекомендуется скрыть или заменить контроллер на модель с двумя считывателями.
6. Кто нажал кнопку выхода — не определяется (только список находящихся внутри).
7. Уведомления ВК доходят только сотрудникам с подтверждённой привязкой.
8. Исходники программы в `desktop-app/` и в архиве v22 могут расходиться — эталон архив.

---

## 24. Глоссарий
| Термин | Значение |
|---|---|
| СТ / МЛ | Статусы сотрудников в табеле (старший / младший пост) |
| Д, Н, Дп, Нп | Смены: день, ночь, день второго поста, ночь второго поста |
| АдПод | Закреплённый адрес входа только по PIN |
| ДДС | Движение денежных средств |
| ДТО | Шаблоны документов/требований компании |
| СКУД | Система контроля и управления доступом |
| Геркон | Датчик открытия двери |
| APB | Anti-passback — запрет повторного прохода |
| Wiegand-26 | Протокол передачи номера карты от считывателя |
| EM-Marine | Бесконтактные карты 125 кГц |
| Мост (GateBridge) | Модуль программы АБИЗ, связывающий контроллер и сайт |
| Рекордер | Служба записи видео склада |
