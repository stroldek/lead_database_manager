import { fail, json, readJson } from './http.js';

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

export function isValidAdminToken(candidate, expected) {
  if (typeof expected !== 'string' || expected.length < 32 || expected.length > 256) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(expected)) return false;
  return constantTimeEqual(candidate, expected);
}

export async function authRoutes(request, env, pathname) {
  if (pathname === '/api/auth/config' && request.method === 'GET') {
    return json({ ok: true, admin_token_configured: Boolean(env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 32) });
  }

  if (pathname === '/api/auth/verify' && request.method === 'POST') {
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
      return fail('admin_token_not_configured', 503);
    }
    let body;
    try { body = await readJson(request, 4096); } catch (error) {
      return fail(error.message, error.message === 'payload_too_large' ? 413 : 400);
    }
    if (!isValidAdminToken(body.token, env.ADMIN_TOKEN)) return fail('invalid_admin_token', 401);
    return json({ ok: true });
  }
  return null;
}

export function isAdminAuthorized(request, env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) return { ok: false, status: 503, error: 'admin_token_not_configured' };
  const token = request.headers.get('x-admin-token') || '';
  if (!isValidAdminToken(token, env.ADMIN_TOKEN)) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true };
}
