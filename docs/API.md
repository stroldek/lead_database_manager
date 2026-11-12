# REST API v0.2.0

Все защищённые endpoints требуют заголовок `X-Admin-Token: <ADMIN_TOKEN>`. Исключения: `/api/health`, `/api/auth/config`, `/api/auth/verify`, Telegram webhook и webhook setup (у setup отдельный `SETUP_TOKEN`).

## Диагностика и вход

- `GET /api/health` — Worker, D1, admin auth, Telegram configuration.
- `GET /api/auth/config` — сообщает только, настроен ли ADMIN_TOKEN; секрет не возвращается.
- `POST /api/auth/verify` — JSON `{ "token": "..." }`.

## Dashboard

- `GET /api/dashboard` — counts, quality distribution, top segments, recent activity.

## Leads

- `GET /api/leads?page=1&page_size=25&q=term&status=new&quality=high&segment_id=...`
- `POST /api/leads` — create or upsert by Telegram ID. Required: numeric `telegram_id`.
- `GET /api/leads/:id` — card + assigned segments.
- `PATCH /api/leads/:id` — update allowed fields.
- `DELETE /api/leads/:id` — delete record.
- `POST /api/leads/bulk` — `{ ids, action, value?, segment_id? }`; max 200 IDs per call.

Allowed statuses: `new`, `in_progress`, `processed`, `qualified`, `rejected`, `blocked`.

Allowed qualities: `high`, `medium`, `low`, `unclassified`.

## Segments

- `GET /api/segments` — sections and lead counts.
- `POST /api/segments` — `{ name, description, color }`.
- `PATCH /api/segments/:id` — rename/update description/color.
- `DELETE /api/segments/:id` — deletes section and links, never deletes leads.
- `POST /api/segments/:id/members` — `{ operation: "add"|"remove", lead_ids: [...] }`; max 200 IDs.

## Activity

- `GET /api/activity?page=1` — latest 30 operation records.

## Response shape

Success responses contain `ok: true` and a resource-specific field (`item`, `items`, `totals`, `pagination`, etc.). Failures contain `ok: false` and a machine-readable `error` code. The browser UI maps common error codes to Russian explanations.
