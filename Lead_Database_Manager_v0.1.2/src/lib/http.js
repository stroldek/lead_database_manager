export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function fail(error, status = 400, details = undefined) {
  return json({ ok: false, error, ...(details ? { details } : {}) }, status);
}

export async function readJson(request, maxBytes = 128_000) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('payload_too_large');
  const raw = await request.text();
  if (raw.length > maxBytes) throw new Error('payload_too_large');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new Error('invalid_json');
  }
}

export function safeText(value, maxLength = 255) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim().slice(0, maxLength);
  return result || null;
}

export function makeId() {
  return crypto.randomUUID();
}

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
