# MTProto on Cloudflare — technical spike

This is an experimental integration, not a production-ready Telegram connector.

## API

All endpoints require the existing `x-admin-token` header.

- `GET /api/mtproto/status` — current authorization state and QR deep link (when available).
- `POST /api/mtproto/qr/start` — starts QR authorization; poll status every 1–2 seconds.
- `GET /api/mtproto/account` — returns the authorized account identity.
- `POST /api/mtproto/session/reconnect` — restores the saved StringSession and calls getMe.
- `POST /api/mtproto/disconnect` — disconnects and deletes the encrypted session.

The Telegram page in the application renders the returned deep link as a QR code in the browser and polls status while authorization is pending. The deep link is also shown as a fallback.

## Cloudflare secrets and bindings

Set these Worker Secrets/Variables before testing:

- `TELEGRAM_API_ID` — API ID from https://my.telegram.org
- `TELEGRAM_API_HASH` — API hash from https://my.telegram.org (secret)
- `MTPROTO_SESSION_KEY` — base64 encoding of 32 cryptographically random bytes (AES-256-GCM key)
- Existing `ADMIN_TOKEN`

The Durable Object binding and SQLite class migration are declared in wrangler.jsonc. Deploy from the existing Workers Builds root directory `Lead_Database_Manager_v0.1.2`.

## Important runtime question

GramJS is Node/browser-oriented. This spike enables Cloudflare `nodejs_compat` and uses Durable Objects to own the live client, but a successful bundle/deploy does NOT prove reliable MTProto transport, long-running socket survival, or production compatibility. Those are explicit acceptance tests below. Durable Objects can be evicted; the code persists only the encrypted StringSession and must reconnect from it. The login-in-progress QR flow is in-memory and must be restarted if the object is evicted before login completes.

The session key must never be stored in D1, Git, frontend storage, request logs, or returned by an API. The encrypted session is stored in Durable Object storage. Disconnect deletes the locally persisted session; revoke the device separately in Telegram → Settings → Devices to test server-side revocation.

## Acceptance checklist

### A. Build and deploy
- [ ] Cloudflare Workers Builds installs `telegram` dependency and deploys the Worker.
- [ ] Durable Object migration completes without affecting existing D1 data.
- [ ] Worker starts with all three MTProto secrets present.
- [ ] `GET /api/mtproto/status` returns 200 with `state=disconnected`.

### B. QR lifecycle
- [ ] `POST /api/mtproto/qr/start` returns 202.
- [ ] Status exposes a valid `tg://login?token=...` deep link within 10 seconds.
- [ ] The Telegram page displays the QR code and fallback deep link.
- [ ] QR can be scanned by Telegram on a second, already-authorized device.
- [ ] Telegram confirmation completes without entering a phone code.
- [ ] Status changes to `authorized`; account endpoint returns the expected account.
- [ ] Expired QR is replaced by a fresh token; scanning an expired token does not authorize.
- [ ] Repeated start requests do not create parallel login flows.

### C. Session persistence and recovery
- [ ] After authorization, redeploy the Worker and call reconnect; no QR re-login is requested.
- [ ] Wait through an idle period and verify the session remains recoverable.
- [ ] Force a Durable Object restart/eviction; reconnect restores the same Telegram account.
- [ ] Simulate Telegram/network disconnect; reconnect recovers without corrupting the saved session.
- [ ] Restart during QR authorization; the stale QR is discarded and a new QR can be issued.
- [ ] Telegram-side device revocation is detected as an authorization failure, not silently treated as connected.

### D. Security
- [ ] Every endpoint rejects missing/invalid ADMIN_TOKEN.
- [ ] Session ciphertext in DO storage is not plaintext and changes when re-encrypted.
- [ ] Session key is absent from repository, D1, browser storage, logs, and API responses.
- [ ] Disconnect deletes local session; separately revoke the session from Telegram Devices.
- [ ] No API route exposes Telegram account deletion or arbitrary destructive account methods.

### E. Reliability evidence
- [ ] Run 10 consecutive fresh QR authorizations.
- [ ] Run 10 reconnect cycles after Worker/DO restarts.
- [ ] Keep a session active for at least 24 hours, then 72 hours.
- [ ] Record reconnect success rate, reconnect duration, unexpected re-auth count, and DO/socket errors.
- [ ] Repeat tests under transient network failures and after a deployment.
- [ ] Only call the Cloudflare hosting path reliable if all critical tests pass; otherwise move the MTProto client to a persistent Node service and retain Cloudflare for UI/API/D1.

## Known prototype limitations

- QR flow is experimental; no manual phone-code/2FA fallback in this spike.
- QR rendering uses the qrcodejs browser library loaded from cdnjs; if the CDN is unavailable, the direct Telegram deep link remains available.
- This spike does not yet monitor chats or process updates.
- Durable Object eviction during QR login interrupts that in-memory flow.
- The live GramJS connection may not survive Cloudflare runtime constraints; passing build tests is not enough.
