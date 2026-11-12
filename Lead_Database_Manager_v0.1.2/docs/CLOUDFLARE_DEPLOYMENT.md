# Cloudflare deployment — v0.1.2

## Проверка GitHub

В верхнем уровне репозитория, не внутри дополнительной папки, должны лежать `wrangler.jsonc` и `package.json`. Каталоги `public`, `src` и `migrations` также должны быть на этом же уровне.

## Workers Builds settings

- Root directory: `/` (корень репозитория).
- Build command: пусто.
- Deploy command: `npx wrangler deploy --config ./wrangler.jsonc`.

## Что делает Wrangler config

- `main` → `./src/worker.js`.
- `assets.directory` → `./public/`.
- `assets.binding` → `ASSETS`.
- Пути `/api/*` сначала направляются в Worker.
- Остальные запросы обслуживаются статическими файлами.

## D1

D1 пока намеренно не объявлена в конфигурации, чтобы стартовая публикация не зависела от ID базы, которую ещё не создали. После первой публикации создадим D1, применим миграцию из `migrations/0001_stage1_prototype.sql` и добавим реальный D1 binding в `wrangler.jsonc`.
