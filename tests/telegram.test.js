import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConsentMessage,
  getPrivateUpdateContext,
  getUpdateType,
  isValidWebhookSecret,
  parseCommand,
  CONSENT_YES,
  CONSENT_NO,
} from '../src/lib/telegram.js';

const privateMessage = (text = '/start') => ({
  update_id: 101,
  message: {
    message_id: 1,
    text,
    chat: { id: 123456789, type: 'private' },
    from: { id: 123456789, is_bot: false, username: 'sample_user', first_name: 'Sample', last_name: 'Person' },
  },
});

test('classifies Telegram updates', () => {
  assert.equal(getUpdateType(privateMessage()), 'message');
  assert.equal(getUpdateType({ callback_query: {} }), 'callback_query');
  assert.equal(getUpdateType({ update_id: 1 }), 'other');
});

test('accepts only private human messages', () => {
  const context = getPrivateUpdateContext(privateMessage());
  assert.equal(context.telegramId, '123456789');
  assert.equal(context.chatId, '123456789');
  assert.equal(context.user.username, 'sample_user');
  assert.equal(getPrivateUpdateContext({
    message: { chat: { type: 'group', id: -100 }, from: { id: 2, is_bot: false }, text: '/start' },
  }), null);
  assert.equal(getPrivateUpdateContext({
    message: { chat: { type: 'private', id: 2 }, from: { id: 2, is_bot: true }, text: '/start' },
  }), null);
});

test('parses only supported commands', () => {
  assert.equal(parseCommand('/start'), 'start');
  assert.equal(parseCommand('/START@sample_bot payload'), 'start');
  assert.equal(parseCommand('/stop'), 'stop');
  assert.equal(parseCommand('/help'), 'help');
  assert.equal(parseCommand('/startled'), null);
  assert.equal(parseCommand('hello'), null);
  assert.equal(parseCommand(null), null);
});

test('validates webhook secret format and exact match', () => {
  const secret = 'A'.repeat(40) + '_-9';
  assert.equal(isValidWebhookSecret(secret, secret), true);
  assert.equal(isValidWebhookSecret('wrong', secret), false);
  assert.equal(isValidWebhookSecret('short', 'short'), false);
  assert.equal(isValidWebhookSecret('bad secret with spaces', 'bad secret with spaces'), false);
  assert.equal(isValidWebhookSecret(secret, undefined), false);
});

test('consent message explicitly describes data and includes opt-in/out buttons', () => {
  const message = buildConsentMessage();
  assert.match(message.text, /Telegram ID/);
  assert.match(message.text, /\/stop/);
  assert.equal(message.reply_markup.inline_keyboard[0][0].callback_data, CONSENT_YES);
  assert.equal(message.reply_markup.inline_keyboard[0][1].callback_data, CONSENT_NO);
});
