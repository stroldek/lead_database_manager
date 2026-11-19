import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

const QR_TTL_MS = 55_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function encrypt(value, secret) {
  const keyBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error('MTProto_SESSION_KEY must be base64 for exactly 32 bytes');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
}

async function decrypt(payload, secret) {
  const keyBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error('invalid_session_key');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(payload.iv) }, key, new Uint8Array(payload.ciphertext));
  return new TextDecoder().decode(plain);
}

/**
 * One Durable Object instance owns one Telegram account session.
 * GramJS clients are process-local; only the encrypted StringSession is durable.
 */
export class TelegramSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.client = null;
    this.loginTask = null;
    this.qr = null;
    this.state = 'disconnected';
  }

  async getClient(session = '') {
    if (this.client?.connected) return this.client;
    if (!this.env.TELEGRAM_API_ID || !this.env.TELEGRAM_API_HASH) throw new Error('telegram_api_credentials_missing');
    const client = new TelegramClient(new StringSession(session), Number(this.env.TELEGRAM_API_ID), this.env.TELEGRAM_API_HASH, {
      connectionRetries: 3,
      useWSS: true,
      timeout: 15,
    });
    await client.connect();
    this.client = client;
    return client;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/status' && request.method === 'GET') {
      const saved = await this.ctx.storage.get('session');
      return json({ ok: true, state: saved ? 'session_saved' : this.state, qr_url: this.qr?.url || null, qr_expires_at: this.qr?.expiresAt || null });
    }
    if (url.pathname === '/qr/start' && request.method === 'POST') {
      if (this.loginTask) return json({ ok: false, error: 'authorization_already_running' }, 409);
      if (await this.ctx.storage.get('session')) return json({ ok: false, error: 'session_already_exists_disconnect_first' }, 409);
      try {
        const client = await this.getClient('');
        this.state = 'qr_pending';
        this.qr = null;
        this.loginTask = client.signInUserWithQrCode(
          { apiId: Number(this.env.TELEGRAM_API_ID), apiHash: this.env.TELEGRAM_API_HASH },
          {
            onError: async error => {
              this.state = 'authorization_failed';
              console.error('mtproto_qr_error', error?.message || 'unknown');
              return true;
            },
            onUpdate: async update => {
              if (update?.token) {
                const token = update.token;
                const token64 = btoa(String.fromCharCode(...token)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
                this.qr = { url: `tg://login?token=${token64}`, expiresAt: new Date(Date.now() + QR_TTL_MS).toISOString() };
                this.state = 'qr_pending';
              }
            },
          },
        ).then(async () => {
          const me = await client.getMe();
          const encrypted = await encrypt(client.session.save(), this.env.MTPROTO_SESSION_KEY);
          await this.ctx.storage.put('session', encrypted);
          await this.ctx.storage.put('account', { id: String(me.id), username: me.username || null, firstName: me.firstName || null });
          this.state = 'authorized';
          this.qr = null;
        }).catch(error => {
          this.state = 'authorization_failed';
          console.error('mtproto_login_failed', error?.message || 'unknown');
        }).finally(() => { this.loginTask = null; });
        return json({ ok: true, state: this.state, note: 'QR generation is asynchronous; poll GET /status.' }, 202);
      } catch (error) {
        this.state = 'error';
        return json({ ok: false, error: error?.message || 'mtproto_start_failed' }, 503);
      }
    }
    if (url.pathname === '/account' && request.method === 'GET') {
      const account = await this.ctx.storage.get('account');
      return account ? json({ ok: true, account }) : json({ ok: false, error: 'not_authorized' }, 401);
    }
    if (url.pathname === '/session/reconnect' && request.method === 'POST') {
      const encrypted = await this.ctx.storage.get('session');
      if (!encrypted) return json({ ok: false, error: 'not_authorized' }, 401);
      try {
        const saved = await decrypt(encrypted, this.env.MTPROTO_SESSION_KEY);
        const client = await this.getClient(saved);
        const me = await client.getMe();
        this.state = 'authorized';
        return json({ ok: true, state: this.state, account: { id: String(me.id), username: me.username || null } });
      } catch (error) {
        this.state = 'reconnect_failed';
        return json({ ok: false, error: error?.message || 'reconnect_failed' }, 502);
      }
    }
    if (url.pathname === '/disconnect' && request.method === 'POST') {
      try { if (this.client) await this.client.disconnect(); } catch { /* best effort */ }
      this.client = null;
      this.loginTask = null;
      this.qr = null;
      await this.ctx.storage.deleteAll();
      this.state = 'disconnected';
      return json({ ok: true, state: this.state });
    }
    return json({ ok: false, error: 'not_found' }, 404);
  }
}
