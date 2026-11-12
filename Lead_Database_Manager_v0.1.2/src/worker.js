import {
  buildConsentMessage,
  getPrivateUpdateContext,
  getUpdateType,
  isValidWebhookSecret,
  parseCommand,
  CONSENT_YES,
  CONSENT_NO,
} from './lib/telegram.js';

const VERSION = '0.1.2';
const WEBHOOK_PATH = '/api/telegram/webhook';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function callTelegram(env, method, payload = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('telegram_not_configured');

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('telegram_invalid_response');
  }
  if (!response.ok || !result?.ok) {
    // Do not include request URL or token in logs/errors.
    throw new Error(`telegram_${method}_failed`);
  }
  return result.result;
}

async function checkDatabase(env) {
  if (!env.DB) return { status: 'not_configured', leadsCount: null };
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM leads').first();
    return { status: 'connected', leadsCount: Number(row?.total ?? 0) };
  } catch {
    return { status: 'schema_missing_or_unavailable', leadsCount: null };
  }
}

async function health(request, env) {
  const database = await checkDatabase(env);
  const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET
    ? 'configured'
    : 'not_configured';
  const ok = database.status === 'connected';
  return json({
    ok,
    app: 'Lead Database Manager',
    version: VERSION,
    checks: {
      worker: 'ok',
      database: database.status,
      telegram,
      webhook: 'not_checked',
    },
    leads_count: database.leadsCount,
    checked_at: new Date().toISOString(),
  }, ok ? 200 : 503);
}

async function registerWebhook(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!env.SETUP_TOKEN || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.DB) {
    return json({ ok: false, error: 'missing_worker_configuration' }, 503);
  }
  const setupToken = request.headers.get('x-setup-token') || '';
  if (setupToken.length < 32 || setupToken !== env.SETUP_TOKEN) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!isValidWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET, env.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ ok: false, error: 'invalid_webhook_secret_format' }, 503);
  }
  const dbCheck = await checkDatabase(env);
  if (dbCheck.status !== 'connected') {
    return json({ ok: false, error: 'database_not_ready_apply_migration' }, 503);
  }

  try {
    const bot = await callTelegram(env, 'getMe');
    const webhookUrl = `${new URL(request.url).origin}${WEBHOOK_PATH}`;
    await callTelegram(env, 'setWebhook', {
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    return json({
      ok: true,
      message: 'Telegram webhook зарегистрирован.',
      bot_username: bot?.username || null,
      webhook_url: webhookUrl,
    });
  } catch (error) {
    console.error('telegram_webhook_setup_failed', error?.message || 'unknown');
    return json({ ok: false, error: 'telegram_connection_or_webhook_setup_failed' }, 502);
  }
}

async function claimUpdate(env, update) {
  const updateId = update?.update_id;
  if (!Number.isSafeInteger(updateId) || updateId < 0) return false;
  const receivedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO telegram_updates (update_id, update_type, status, received_at)
    VALUES (?, ?, 'received', ?)
  `).bind(updateId, getUpdateType(update), receivedAt).run();

  const claim = await env.DB.prepare(`
    UPDATE telegram_updates
       SET status = 'processing', processing_at = ?, error_code = NULL
     WHERE update_id = ?
       AND (
         status IN ('received', 'failed')
         OR (status = 'processing' AND julianday(processing_at) < julianday('now', '-2 minutes'))
       )
  `).bind(receivedAt, updateId).run();
  return Number(claim?.meta?.changes || 0) > 0;
}

async function markUpdate(env, updateId, status, errorCode = null) {
  const processedAt = status === 'processed' ? new Date().toISOString() : null;
  await env.DB.prepare(`
    UPDATE telegram_updates
       SET status = ?, processed_at = COALESCE(?, processed_at), error_code = ?
     WHERE update_id = ?
  `).bind(status, processedAt, errorCode, updateId).run();
}

async function recordConsent(env, context, updateId) {
  const now = new Date().toISOString();
  const leadId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO leads (
        id, telegram_id, username, first_name, last_name, source,
        quality, status, consent_status, consent_at, consent_source,
        last_interaction_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'telegram_bot', 'unclassified', 'new', 'granted', ?, 'telegram_bot:inline_consent', ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = COALESCE(excluded.username, leads.username),
        first_name = COALESCE(excluded.first_name, leads.first_name),
        last_name = COALESCE(excluded.last_name, leads.last_name),
        consent_status = 'granted',
        consent_at = excluded.consent_at,
        consent_source = excluded.consent_source,
        last_interaction_at = excluded.last_interaction_at,
        updated_at = excluded.updated_at
    `).bind(
      leadId, context.telegramId, context.user.username, context.user.firstName,
      context.user.lastName, now, now, now, now,
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO consent_events (id, lead_id, action, source, event_key, created_at)
      VALUES (?, (SELECT id FROM leads WHERE telegram_id = ?), 'granted', 'telegram_bot:inline_consent', ?, ?)
    `).bind(eventId, context.telegramId, `telegram:update:${updateId}:consent`, now),
  ]);
}

async function revokeConsent(env, context, updateId) {
  const existing = await env.DB.prepare('SELECT id FROM leads WHERE telegram_id = ?').bind(context.telegramId).first();
  if (!existing?.id) return false;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE leads
         SET consent_status = 'revoked', last_interaction_at = ?, updated_at = ?
       WHERE telegram_id = ?
    `).bind(now, now, context.telegramId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO consent_events (id, lead_id, action, source, event_key, created_at)
      VALUES (?, ?, 'revoked', 'telegram_bot:/stop', ?, ?)
    `).bind(crypto.randomUUID(), existing.id, `telegram:update:${updateId}:revoke`, now),
  ]);
  return true;
}

async function handleTelegramUpdate(env, update) {
  const context = getPrivateUpdateContext(update);
  if (!context) return;

  if (context.type === 'callback_query') {
    await callTelegram(env, 'answerCallbackQuery', { callback_query_id: context.callbackQueryId });
    if (context.callbackData === CONSENT_YES) {
      await recordConsent(env, context, update.update_id);
      await callTelegram(env, 'sendMessage', {
        chat_id: context.chatId,
        text: 'Согласие сохранено. Ваш профиль добавлен в базу. Вы можете отозвать согласие в любой момент командой /stop.',
      });
    } else if (context.callbackData === CONSENT_NO) {
      await callTelegram(env, 'sendMessage', {
        chat_id: context.chatId,
        text: 'Понял. Профиль не добавлен в базу. Вы можете вернуться и дать согласие позже командой /start.',
      });
    }
    return;
  }

  const command = parseCommand(context.text);
  if (command === 'start') {
    await callTelegram(env, 'sendMessage', {
      chat_id: context.chatId,
      ...buildConsentMessage(),
    });
  } else if (command === 'help') {
    await callTelegram(env, 'sendMessage', {
      chat_id: context.chatId,
      text: 'Команды: /start — ознакомиться с условиями и дать согласие; /stop — отозвать согласие; /help — помощь.',
    });
  } else if (command === 'stop') {
    const revoked = await revokeConsent(env, context, update.update_id);
    await callTelegram(env, 'sendMessage', {
      chat_id: context.chatId,
      text: revoked
        ? 'Согласие отозвано. Новые сообщения от этого бота отправляться не будут.'
        : 'Ваш профиль не найден в базе. Новые сообщения отправляться не будут.',
    });
  }
}

async function telegramWebhook(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: 'telegram_or_database_not_configured' }, 503);
  }
  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!isValidWebhookSecret(receivedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let update;
  try {
    const raw = await request.text();
    if (raw.length > 256_000) return json({ ok: false, error: 'payload_too_large' }, 413);
    update = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  if (!Number.isSafeInteger(update?.update_id)) {
    return json({ ok: false, error: 'invalid_update_id' }, 400);
  }

  try {
    const claimed = await claimUpdate(env, update);
    if (!claimed) return json({ ok: true, duplicate: true });
    await handleTelegramUpdate(env, update);
    await markUpdate(env, update.update_id, 'processed');
    return json({ ok: true, duplicate: false });
  } catch (error) {
    try { await markUpdate(env, update.update_id, 'failed', 'processing_failed'); } catch { /* keep the original failure */ }
    console.error('telegram_update_processing_failed', error?.message || 'unknown');
    return json({ ok: false, error: 'processing_failed' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return health(request, env);
    }
    if (pathname === '/api/setup/telegram-webhook') return registerWebhook(request, env);
    if (pathname === WEBHOOK_PATH) return telegramWebhook(request, env);

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
