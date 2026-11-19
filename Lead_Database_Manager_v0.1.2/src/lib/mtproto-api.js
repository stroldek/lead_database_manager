import { json } from './http.js';
import { isAdminAuthorized } from './auth.js';

export async function mtprotoRoutes(request, env, pathname) {
  if (!pathname.startsWith('/api/mtproto/')) return null;
  const auth = isAdminAuthorized(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.TELEGRAM_SESSION) return json({ ok: false, error: 'durable_object_binding_missing' }, 503);
  const id = env.TELEGRAM_SESSION.idFromName('primary-user-account');
  const stub = env.TELEGRAM_SESSION.get(id);
  const target = pathname.slice('/api/mtproto'.length) || '/status';
  return stub.fetch(new Request(new URL(target, 'https://mtproto-session.internal'), request));
}
