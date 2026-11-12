# Проверка инфраструктуры Cloudflare

**Дата проверки:** 12.11.2026

## 1. Рекомендуемая конфигурация

- **Cloudflare Workers** — REST API и webhook.
- **Workers Static Assets** — frontend и общие статические файлы в одной публикации с Worker.
- **Cloudflare D1** — основная реляционная база.
- **R2** — не нужен в первой версии; может пригодиться для временных файлов большого экспорта.
- **Queues / Durable Objects** — не добавлять заранее; оценить, когда появятся долгие/повторяемые фоновые задачи.

## 2. Актуальные лимиты Free на дату проверки

| Компонент | Подтверждённый лимит Free | Влияние |
|---|---:|---|
| D1 databases per account | 10 | Достаточно для dev/test/production на старте, если экономно использовать базы |
| D1 max size per database | 500 MB | Основной риск при росте объёма и истории |
| D1 account storage | 5 GB | Общий лимит аккаунта |
| D1 read subrequests per Worker invocation | 50 | Использовать `batch()` и объединённые запросы |
| D1 bound parameters per query | 100 | Не делать огромные `IN (...)`; дробить пакеты |
| D1 query duration | 30 sec | Большие обновления/удаления дробить на пачки |
| Workers requests | 100,000/day | Учитывать API-поллинг интерфейса и webhook-трафик |
| Workers CPU time per HTTP request | 10 ms | Не выполнять тяжёлые CSV/XLSX операции в одном HTTP-запросе |
| Workers memory | 128 MB | Не держать большую выборку/файл целиком в памяти |

Лимиты меняются, поэтому перед запуском следующей крупной версии их нужно сверять повторно.

## 3. Достаточно ли D1 для 100 000 лидов?

Количество строк само по себе не лимитировано D1, однако бесплатная база ограничена 500 MB. Для записи с короткими текстовыми полями 100 000 лидов выглядят реалистичной целью для тестирования, но подтвердить фактический объём можно только после наполнения синтетическим набором и измерения реального размера таблиц и индексов.

Практические меры:

- минимизировать объём полей и не хранить Telegram message history без отдельной цели;
- тяжёлые и редко используемые данные держать в JSON или отдельной таблице, только если это обосновано;
- индексировать поля поиска по результатам тестирования;
- пагинировать сервером по cursor/keyset, а не `OFFSET` на глубоких страницах;
- использовать `batch()` и небольшие пакеты;
- большие экспорты формировать потоково/фоново, с временным файлом в R2 только если потребуется;
- предусмотреть экспорт резервной копии.

D1 single-threaded на одну базу; суммарную пропускную способность надо тестировать на реальных запросах. В документации Cloudflare отдельно рекомендуется уменьшать число запросов и применять `batch()`.

## 4. Принцип: никаких установок на компьютере пользователя

Сборка поставляется в двух режимах:

- **Локальный предпросмотр:** `START_HERE.html` открывается двойным щелчком в браузере. Не требует Node.js, Python, Docker, Wrangler, Git или локального сервера. В этом режиме показывается интерфейс, а реальные подключения честно помечаются как недоступные.
- **Полная публикация:** пользователь работает через сайт GitHub и Cloudflare Dashboard. Репозиторий подключается к Cloudflare Workers Builds; облачная сборочная среда устанавливает/запускает Wrangler сама. Никакие инструменты разработки на пользовательский ПК не устанавливаются.

Для конфигурации через GitHub Web Editor нужно заменить `REPLACE_WITH_D1_DATABASE_ID` в `wrangler.jsonc` на ID созданной D1-базы. Если Cloudflare Dashboard просит build command для Workers Build, используется `npm run deploy`; выполнение происходит в облачной среде Cloudflare, а не на ПК пользователя. SQL миграция применяется копированием содержимого `migrations/0001_stage1_prototype.sql` в D1 → SQL Console.

Сценарий с локальным терминалом/Wrangler не является обязательным и в пользовательских инструкциях не предлагается.

## 5. D1 binding

Имя binding в коде — `DB`.

В Worker Dashboard:

1. Открыть Worker → **Bindings**.
2. Нажать **Add binding**.
3. Выбрать **D1 database**.
4. Variable name: `DB`.
5. Выбрать базу `lead-database-manager`.
6. Сохранить и повторно развернуть Worker.

## 6. Secrets

В Worker → **Settings / Variables and Secrets** создать secrets:

| Имя | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота, полученный от BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Секрет webhook, 32+ символа, только A-Z, a-z, 0-9, `_`, `-` |
| `SETUP_TOKEN` | Отдельный длинный пароль для однократной/повторной регистрации webhook |

Не создавайте обычные переменные для секретных значений и не передавайте bot token браузеру.

## 7. Применение первой миграции

1. Открыть Cloudflare Dashboard → **Storage & databases** → **D1 SQL Database**.
2. Открыть `lead-database-manager`.
3. Открыть SQL Console.
4. Скопировать и выполнить целиком файл `migrations/0001_stage1_prototype.sql`.
5. В списке таблиц должны появиться `leads`, `consent_events`, `telegram_updates`, `schema_migrations`.
6. В `schema_migrations` должна быть строка `0001_stage1_prototype`.

Не запускать `docs/FUTURE_SCHEMA.sql` — это справочная схема, не миграция. В папке `migrations/` оставлены только пронумерованные файлы, предназначенные для миграционного механизма.

## 8. Прототип endpoint-ов

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | Проверка Worker, binding D1 и настроек Telegram |
| POST | `/api/setup/telegram-webhook` | Проверка SETUP_TOKEN и регистрация webhook через Telegram `getMe` + `setWebhook` |
| POST | `/api/telegram/webhook` | Получение Telegram updates; требует секретный заголовок Telegram |

## 9. Официальные источники

- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Static Assets: https://developers.cloudflare.com/workers/static-assets/
- D1 getting started (Dashboard + CLI): https://developers.cloudflare.com/d1/get-started/
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- D1 remote development: https://developers.cloudflare.com/d1/best-practices/remote-development/
