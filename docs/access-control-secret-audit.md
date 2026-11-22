# Access-Control and Secret-Handling Audit

- **Date:** 2026-11-22
- **Scope:** anonymous access, cross-user/cross-workspace access, CSRF, uploads, public sharing, SQLite query boundaries, API keys, Node storage, and the MCP surface.
- **Environment:** real local `main` server on `127.0.0.1:3000` with SQLite and two ordinary test accounts (`sec-a`, `sec-b`) plus admin; a second isolated server was used by the automated test. Test files were created through the real workspace API. No production data was touched.
- **Automated regression:** `test/security.test.mjs` spawns the real server on an isolated temporary SQLite/storage directory and makes real HTTP requests. It is part of `npm test`.

## Verdict

The tested app routes now fail closed: anonymous API/export/media/API-key requests are `401`; authenticated non-owners receive `404` for documents, spreadsheets, presentations, PDFs, media, versions and exports; public sharing is the only anonymous content path. Two confirmed vulnerabilities were found and fixed: session-cookie CSRF and stored XSS via inline uploaded HTML. API keys are SHA-256-hashed, scoped, revocable, non-enumerable and absent from list responses/logs. No SQL injection or filesystem traversal was reproduced.

There is **no MCP endpoint in this repository**: `/mcp` returns `404` both anonymously and with a valid session, so an MCP auth/scoping claim cannot be verified here.

## Executed access matrix

All requests were sent to the live server; redirects were not followed.

| Caller / target | Observed result |
|---|---|
| Anonymous `GET /api/workspace/docs/:id` | **401** `{"error":"login required"}` |
| Anonymous `GET /download/:id` | **401** `login required` |
| Anonymous `GET /export/:id` | **401** `login required` |
| Anonymous `GET /f/:id/raw` | **401** `login required` |
| Anonymous `GET /api/files/:id` and `/api/files` | **401** |
| Anonymous `GET /admin/api-keys` | **401** |
| Anonymous `GET /api/images/search` and `/api/images/proxy` | **401** (previously redirected to login; corrected) |
| Authenticated non-owner reads of doc/sheet/deck/PDF APIs, versions, download, export and edit | **404** for every id; no marker text in any response |
| Authenticated non-owner `GET /f/:id`, `/f/:id/raw`, `/api/files/:id`, `/api/files/:id/text` | **404** |
| Non-owner `POST /api/files/:id/share`, rename, delete; `PUT` doc, heartbeat, restore, template | **404**; target remained unchanged |
| Anonymous `GET /c/:publicSlug` and `/c/:publicSlug/export` | **200** (intentional share) |
| Anonymous `GET /c/:privateSlug` or `/c/:privateSlug/export` | **404** |
| Anonymous random slug / random file id / `../etc/passwd` id | **404** |
| Anonymous `GET /c/:slug/asset/:id` for an image owned by the shared document owner | **200** |
| Same route using an image owned by another user | **404** |
| Revoked public file `GET /raw/:slug` after `isPublic:false` | **404** |
| Authenticated `GET /mcp` or anonymous `/mcp` | **404** — no MCP route exists |

The API file list stayed owner-scoped (`?all=1` is admin-only). Search for `' OR 1=1--` as another user returned no owner data. A malicious `limit=1 OR 1=1` value stayed a bounded integer. The only raw SQL in the app is the fixed `PRAGMA`/`ALTER` schema migration; user input reaches Sequelize parameterized `where`/`findByPk` calls.

## Confirmed vulnerabilities and fixes

### 1. Session-cookie CSRF — High

**Reproduction before fix:** with a logged-in `sec-a` cookie, a cross-origin JSON POST to `/api/workspace/docs` and `/api/files/:id/share` with `Origin: https://evil.example` returned **200**, created a document, and published an image. The session cookie had no explicit `SameSite` attribute.

**Fix:**
- Session cookies now use `HttpOnly` and `SameSite=Lax`.
- Cookie-authenticated unsafe methods require an `Origin` (or `Referer`) whose host/protocol matches the request host/protocol; API-key clients bypass this because they authenticate with a header.
- Cross-origin requests return **403** `cross-origin request rejected`; same-origin POST remains **200**.

### 2. Stored XSS through inline uploaded HTML — High

**Reproduction before fix:** `POST /api/upload` accepted `active.html` with `text/html`; `GET /f/:id/raw` returned **200** with `Content-Type: text/html` and `Content-Disposition: inline`, executing user-controlled HTML/JS on the app origin.

**Fix:**
- Upload MIME is derived from the filename extension; client multipart type is ignored for known extensions. A disguised `evil.png` sent as `text/html` is stored and served as `image/png`.
- Active HTML/SVG/XML/JS types are served with `Content-Disposition: attachment`, `Content-Security-Policy: default-src 'none'; sandbox`, and `X-Content-Type-Options: nosniff`.
- Public document assets get the same protection.
- Upload filenames are never used as filesystem paths; arbitrary paths are reduced to a generated id. `../../escape.txt` was stored under `data/uploads/<generated-id>`, not outside the storage directory.
- Board SVGs and deck previews now sanitize colors/geometry and escape text, and receive CSP sandboxing. Crafted malicious colors containing `<script>` rendered as safe fallback markup; this hardening was verified structurally, not by executing a browser.

### 3. Unscoped API keys — Medium (least-privilege gap)

**Fix:** API keys now have `read`, `write`, or `full` scope, selected in the admin UI and stored in a new `api_keys.scope` column. Existing databases are migrated to `full` for compatibility.
- `read`: all GET/HEAD reads, no mutations.
- `write`: mutations allowed, `/admin` denied.
- `full`: historical owner behavior.

Verified: read key `GET /api/me` **200**, `POST /api/upload` **403**, `GET /admin/api-keys` **403**; write key upload **200**, admin **403**; non-owner key reading another owner's private document **404**.

### 4. Secret handling

- API keys remain `csk_` + 32 nanoid characters (about 192 bits of entropy), stored only as a 64-character SHA-256 hash plus a display prefix. The raw key is returned once on the admin creation response (marked `Cache-Control: no-store`) and is never in listings, DB rows, errors, URLs, or server logs.
- Revocation returns **401** on the next request and is immediate.
- If `SESSION_SECRET` is absent, the app now generates a random per-process secret instead of using a published default. Sessions therefore do not survive a restart without an explicit secret.
- Node mode generates its access key into `data/node-key.txt` with mode `0600`; it is no longer printed in logs. Missing node keys return **401**; encoded traversal paths return **404**. The automated test's server log and the live server log contained no `csk_` key.

## Other hardening

- Private `/api/*`, `/download/:id`, `/export/:id` and `/f/:id/raw` responses now carry `Cache-Control: private, no-store`; public CDN/share responses use a 5-minute revalidating cache rather than year-long immutable caching.
- Anonymous direct export/media requests now return **401** rather than a login redirect.
- Public board/deck rendering escapes/sanitizes user-controlled style values and adds CSP headers.
- No CORS policy is enabled, and cross-origin session mutations are rejected independently of CORS.

## Tests and commands run

```text
npm test
  4 passed, 1 skipped (external LibreOffice renderer opt-in)

node --test test/security.test.mjs
  1 passed

SOFFICE_BIN=/tmp/squashfs-root/AppRun ... npm test
  5/5 passed (the new security test plus the four office compatibility tests);
  office export code was not changed by this audit
```

The security test asserts:
- anonymous 401s and cross-user 404s for all four workspace formats plus media/exports;
- public share 200s, private/random slug 404s, owner-scoped public assets;
- CSRF 403 and `SameSite=Lax`/`HttpOnly` cookies;
- upload traversal containment, active-content headers, MIME normalization, and cache no-store;
- read-only/write/full-scope behavior, SHA-256 storage, no raw key in list/log, revocation return 401, and non-owner key isolation;
- SQL/filter probes and the absent `/mcp` surface.

## Residual / unverified risks

1. **MCP is not implemented in this repository.** `/mcp` is 404, so there is no MCP server whose auth/workspace scoping can be demonstrated. If an external MCP process is deployed separately, it needs its own audit.
2. **No external CDN or reverse proxy was tested.** Public cache lifetime was reduced to 5 minutes and origin revocation returns 404, but an upstream cache can still serve a previously cached public object until revalidation. This cannot be exercised without a CDN here.
3. **Uploads are memory-buffered.** The endpoint has a 1 GiB per-file cap and a 20-file field limit, but 20 concurrent large uploads can still pressure memory and quota checks are not atomic under concurrency. This is a suspected DoS/performance risk, not reproduced with a production-sized payload.
4. **No rate limiting** exists on login or API-key use; credential brute-force and key abuse rate limits were not tested.
5. **XSS tests are HTTP/header/structural, not browser-executed.** Board/deck/SVG hardening was verified by malicious payloads and CSP/attachment headers; no browser was available in this environment to prove script non-execution interactively.
6. **Session fixation and cookie `Secure` deployment behavior** were not penetration-tested. `SameSite=Lax`/`HttpOnly` are set; HTTPS-only cookie behavior depends on deployment configuration.
7. **The API-key raw value is deliberately shown once at creation.** It cannot be delivered without one response; that response is `no-store`, and the raw value never appears in later responses, logs, URLs, error messages, or the DB.
8. No load/stress or multi-node replication test was run beyond the Node key/traversal probe.
