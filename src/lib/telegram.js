export const CONSENT_YES = 'consent:yes';
export const CONSENT_NO = 'consent:no';

export function getUpdateType(update) {
  if (update?.message) return 'message';
  if (update?.callback_query) return 'callback_query';
  return 'other';
}

function cleanOptional(value, max = 128) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, max);
  return cleaned || null;
}

export function getPrivateUpdateContext(update) {
  if (update?.message) {
    const message = update.message;
    if (message?.chat?.type !== 'private' || !message?.from || message.from.is_bot) return null;
    const telegramId = message.from.id;
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return null;
    return {
      type: 'message',
      telegramId: String(telegramId),
      chatId: String(message.chat.id),
      user: {
        username: cleanOptional(message.from.username, 64),
        firstName: cleanOptional(message.from.first_name),
        lastName: cleanOptional(message.from.last_name),
      },
      text: typeof message.text === 'string' ? message.text.slice(0, 4096) : '',
      callbackQueryId: null,
      callbackData: null,
    };
  }

  if (update?.callback_query) {
    const callback = update.callback_query;
    const message = callback.message;
    if (message?.chat?.type !== 'private' || !callback?.from || callback.from.is_bot) return null;
    const telegramId = callback.from.id;
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return null;
    return {
      type: 'callback_query',
      telegramId: String(telegramId),
      chatId: String(message.chat.id),
      user: {
        username: cleanOptional(callback.from.username, 64),
        firstName: cleanOptional(callback.from.first_name),
        lastName: cleanOptional(callback.from.last_name),
      },
      text: '',
      callbackQueryId: cleanOptional(callback.id, 256),
      callbackData: cleanOptional(callback.data, 64),
    };
  }

  return null;
}

export function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^\/(start|help|stop)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i);
  return match ? match[1].toLowerCase() : null;
}

export function isValidWebhookSecret(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  if (expected.length < 32 || expected.length > 256) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(expected)) return false;
  return received === expected;
}

export function buildConsentMessage() {
  return {
    text: 'Чтобы добавить ваш Telegram-профиль в базу, нужно отдельное согласие. После нажатия «Согласен» мы сохраним ваш Telegram ID, username (если указан), имя и фамилию (если доступны) и сможем отправлять вам сообщения от этого бота. Вы можете отозвать согласие командой /stop. Без согласия профиль в базу не добавляется.',
    reply_markup: {
      inline_keyboard: [[
        { text: 'Согласен', callback_data: CONSENT_YES },
        { text: 'Не согласен', callback_data: CONSENT_NO },
      ]],
    },
  };
}
