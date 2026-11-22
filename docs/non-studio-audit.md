# Non-Studio Platform Audit — Documents, PDF, Media, SQLite, API Keys, MCP, Collaboration

**Date:** 2026-11-22  
**Auditor:** independent QA/security pass  
**Scope:** everything outside Creative Studio: document/sheet/deck/PDF editors, Office/PDF export, upload/CDN serving, SQLite persistence, API keys, MCP tools, and the `/collab` WebSocket.  
**Environment:** disposable server on port `3000`, disposable SQLite database and uploads under `/tmp/cascade-nonstudio`, Node.js `v26.13.1`, Python parser venv `/tmp/cascade-pptx-venv` (`python-docx 1.2.0`, `openpyxl 3.1.5`, `python-pptx 1.0.2`, `pypdf 7.1.1`). Production `data/` and `.env` were never touched.

## Bottom line

Ten concrete behaviours were exercised end to end. Five defects were reproduced and fixed, each with a committed regression test:

1. **Critical — concurrent HTTP saves silently lost updates.** 20 PUTs at the same version all returned 200 and only one version increment occurred, so 19 authored edits vanished.
2. **High — PDF export crashed on non-WinAnsi text.** A PDF annotation containing `日本語` made export fail; the server logged `WinAnsi cannot encode "日"`.
3. **Medium — XLSX boolean `false` became the string `"false"`.** Export compatibility was wrong for boolean cells.
4. **Medium — non-ASCII upload filenames were mojibaked.** `✔ audit-pixel.png` was stored/returned as `â audit-pixel.png`.
5. **Medium — advertised MCP input schemas were not enforced.** Only required keys were checked; wrong types and unknown properties reached handlers.

After the fixes:

- DOCX, XLSX, PPTX and PDF exports were reopened with independent parsers and retain the authored text, structure, formulas, notes, transitions, images and formatting tested.
- Private media is byte-identical when authorized, `404` cross-user, and `401` anonymous; public bytes and `Content-Type` are correct.
- SQLite survived 50,000 bulk rows, eight concurrent writers (4,000 committed rows), and a 1,000-row uncommitted process crash with `integrity_check = ok` and no lost committed rows.
- API-key create/use/revoke, scopes, hashing and non-disclosure were exercised.
- All 21 MCP tools were called successfully; malformed inputs were rejected; read-only scope and CSRF checks held.
- Collaboration works directly and through the current preview proxy: two clients connected, an edit relayed, and the result persisted.
- `npm test`: **18 tests, 17 pass, 0 fail, 1 skipped**. The skip is the LibreOffice renderer check; LibreOffice is not installed and this environment denies privilege escalation (`sudo` is blocked by `no_new_privs`).

## Defects fixed

### 1. Concurrent HTTP document saves lost edits — Critical

**Reproduction (pre-fix):** create a doc, read version `N`, then send 20 simultaneous `PUT /api/workspace/docs/:id` requests with distinct HTML and `version: N`.

**Observed:** all 20 returned `200`; the document moved from version 2 to 3; 19 authored edits were silently overwritten. The route read the version and then wrote `file.version + 1` without a compare-and-swap.

**Expected:** exactly one write at version `N` succeeds; every other writer gets `409` with the latest content.

**Fix:** `src/workspace.js` now performs a single `UPDATE ... WHERE id = ? AND version = ?` with `version = version + 1` (the same CAS model already used by MCP `update_document`). The restore route uses the same protection.

**Verification after fix:** 20 simultaneous writes produced `1 × 200`, `19 × 409`, exactly one version increment, and the winning content was the persisted content. Also repeated under a 54,000-row SQLite database with 100 concurrent document creates (`100 × 200`).

**Regression test:** `test/security.test.mjs`, “real HTTP security matrix…”, asserts one winner, nineteen 409s, one version bump and winning-content persistence.

### 2. PDF export crashed on Unicode annotation text — High

**Reproduction:** create a PDF document, save a text annotation `QA PDF MARKER — café 日本語`, request `/export/:id` or `/download/:id`.

**Observed:** export did not produce a PDF; the server logged `[cascade] WinAnsi cannot encode "日" (0x65e5)`. The route embeds `StandardFonts.Helvetica`, which is WinAnsi-only.

**Expected:** export succeeds and the annotation text is extractable by a third-party PDF parser.

**Fix:** added `@pdf-lib/fontkit` and an OFL-licensed `assets/fonts/NotoSansJP-Regular.ttf` (plus `assets/fonts/OFL.txt`). PDF annotations now embed a subset of that Unicode font. Glyphs the font truly lacks (for example colour emoji) are replaced with `?` rather than crashing the whole export.

**Verification after fix:** `pypdf` opened the exported PDF (1 page) and extracted exactly `QA PDF MARKER — café 日本語`; `café` and CJK both survived. The regression test in `test/security.test.mjs` runs this extraction when `pypdf` is available.

### 3. XLSX booleans downgraded to strings — Medium

**Reproduction:** save a sheet cell `{ "v": false }`, export `/export/:id`, open with `openpyxl`.

**Observed:** the cell value was the string `"false"`, not boolean `False` (the export code stringified everything except numbers).

**Expected:** boolean cells remain booleans.

**Fix:** `src/office.js` preserves both number and boolean values; other values are still stringified.

**Verification after fix:** `openpyxl` reads `C1 = False` and `C2 = True`; formulas and sheet names still read back correctly.

**Regression test:** `test/office.test.mjs` now includes both boolean cells.

### 4. UTF-8 upload filename corruption — Medium

**Reproduction:** multipart-upload a file named `✔ audit-pixel.png`.

**Observed:** the upload response and stored filename were `â audit-pixel.png` — UTF-8 bytes decoded as latin1 by multer/busboy.

**Expected:** the exact UTF-8 filename is stored and returned.

**Fix:** `src/server.js` decodes the multipart filename from latin1 to UTF-8 only when the result is valid UTF-8, so genuine latin1 names and path-traversal handling keep their existing behaviour.

**Verification after fix:** response filename and stored name are exactly `✔ audit-pixel.png`; the existing traversal test still returns only `escape.txt` and writes only the generated ID path.

**Regression test:** `test/security.test.mjs` uploads `café-✔-owner.png` and asserts the exact filename.

### 5. MCP input schemas were advisory, not enforced — Medium

**Reproduction (pre-fix, verified by source inspection):** `callTool` only checked `required`; `additionalProperties: false`, JSON types, `minLength`, `minimum` and `enum` were not enforced. Requests such as `get_document({id: 123})` or `whoami({extra: true})` reached handlers.

**Expected:** malformed/untrusted arguments are rejected as tool errors before any handler runs, while normal clients and documented clamping (`limit: 1000` → 100) keep working.

**Fix:** `src/mcp.js` adds `validateToolInput`, checking object shape, required keys, unknown keys when `additionalProperties: false`, primitive/integer/object/array types, string bounds, numeric minima and enums. Upper bounds are intentionally left to the handlers’ existing clamp behaviour for backward compatibility.

**Verification after fix:** all 21 tools were called with valid input. Each tool was also called with a malformed case and returned `isError: true`:
`whoami`, `list_documents`, `get_document`, `list_versions`, `get_version`, `create_document`, `update_document`, `list_folders`, `create_folder`, `update_document_metadata`, `restore_version`, `duplicate_document`, `delete_document`, `search_documents`, `list_templates`, `studio_list_projects`, `studio_get_scene`, `studio_list_commands`, `studio_queue_command`, `studio_create_snapshot`, `list_form_responses`.

**Regression tests:** `test/security.test.mjs` asserts a non-string `id` and an undeclared `whoami` argument are rejected; `test/mcp-sdk.test.mjs` continues to exercise the official MCP SDK, including clamping `limit: 1000` and typed content rejection.

## Verified end-to-end results

### Documents, sheets, presentations and PDF

Created through `POST /api/workspace/docs`, saved through `PUT`, reloaded through `GET`, and exported through `/export/:id`:

| Artifact | Round trip | Independent parser result |
|---|---|---|
| DOCX | 548-byte editor JSON → version 2, exact HTML/header/footer reload | `python-docx`: heading/paragraphs, bold, italic, 3×2 table, header `QA header — Ω`, footer `QA footer — ✓`, embedded `word/media/image1.png`; UTF-8 `Café — 日本語 — 🔥` intact |
| XLSX | 434-byte editor JSON → version 2, exact reload | `openpyxl`: sheets `Q1 Numbers` and `Second`; `Café ☕`, `Unicode ✓ and <tag>`, number `12.5`, formula `=SUM(B2:B2)`, boolean `False`, bold header |
| PPTX | 538-byte editor JSON → version 2, exact reload | `python-pptx`: 2 slides, `Cascade audit — 日本語`, line break/text, notes `Presenter note — café`, native `fade` and `push` transitions, 13.333×7.5in |
| PDF | template PDF + text annotation → version 2 | `pypdf`: 1 page, extracted `QA PDF MARKER — café 日本語`; exported bytes begin `%PDF-` |
| Large DOCX | 2,262,831-byte HTML → version 2 | exact reload; export 46,400 bytes |

Exact authored JSON was compared after reload; no truncation or encoding loss occurred for these fixtures.

### Media, private access and CDN

- Uploaded a 70-byte PNG and a 5 MB random binary through `/api/upload`.
- Authorized owner `/f/:id/raw`: `200`, correct stored bytes, `image/png` / `application/octet-stream`.
- Cross-user `/f/:id/raw`: `404` (non-disclosing).
- Anonymous `/f/:id/raw`: `401`.
- Private `/raw/:slug` before sharing: `404`.
- After owner shares: `/raw/:slug` is `200`, byte-identical, `image/png`, `Cache-Control: public, max-age=300, must-revalidate`.
- 5 MB upload: 79 ms; 5 MB authorized download: 50 ms; SHA/byte comparison exact.

### SQLite stress (disposable DB)

- Bulk: 50,000 rows committed in 0.718 s.
- Concurrency: 8 processes × 500 rows (batched `BEGIN IMMEDIATE` transactions) all committed; 4,000 rows, 0.146 s.
- Interrupted write: a child inserted 1,000 rows in an open transaction and `os._exit(9)` before commit. After recovery the 1,000 uncommitted rows were absent, all 54,000 committed rows remained, and `PRAGMA integrity_check = ok`; `foreign_key_check` returned no rows.
- HTTP layer: 100 concurrent document creates on that 54,000-row database all returned `200`; 20 concurrent same-version updates produced exactly one commit (see defect 1).
- Database path was `/tmp/cascade-sqlite-stress/db.sqlite`; production was not opened.

### API keys

- Created full, write and read keys for `qaowner`; each was used successfully against `/api/me`.
- Read scope: HTTP POST returned `403`; MCP mutation returned an `isError` read-only result; write scope could create a document but admin access returned `403`.
- Revoked read key: subsequent `/api/me` returned `401`.
- Database check: each record stores a 64-character SHA-256 hash, never the raw key. A later admin page load contained only the 12-character prefix, not the raw key.
- Server logs did not contain raw keys.
- No rotate endpoint exists; rotation is create-new + revoke-old, which was exercised.

### MCP server

- `initialize` returned protocol `2025-06-18`, `cascade-workspace` 1.1.0, and `Cache-Control: private, no-store`.
- `tools/list` returned 21 tools; read-only scope listed only the read tools.
- Every tool returned a valid result for a valid call, including folder/document CRUD, version restore, duplicate/delete, search, templates, Studio project/scene/command/snapshot and form responses.
- Every malformed call above returned a tool error, not a crash.
- Foreign `Origin` with a cookie or API key returned `403`; foreign-origin cookie mutation on `/api/workspace/docs` returned `403`.
- Cross-user `get_document` and `resources/read` remained non-disclosing (`isError` / `-32602`, no marker leak).

### Collaboration WebSocket and the previous 502

- Direct app `ws://127.0.0.1:3000/collab?token=…`: two authenticated clients connected; client B received client A’s Yjs binary update (84 bytes); a save acknowledgement arrived; `GET` returned the collaborator’s `COLLAB … café 日本語` HTML.
- Current preview proxy, `wss://pv-…style.dev/collab?token=…`, through the authenticated Cloud browser: two clients connected, the same Yjs update relayed (84 bytes), and the edit persisted (`version 17`, `persisted: true`).
- The historical proxy `502` was **not reproduced**. The app’s upgrade path and the preview proxy both work in this environment; the old 502 should be treated as a transient proxy/tunnel failure unless it recurs with matching proxy logs. No app-side cause was found.

### Performance observations

- 2.26 MB document: save 181 ms, load 45 ms, DOCX export 2,544 ms, exact reload.
- 100 concurrent reads of that document: all `200`; 4.0 s first burst, 2.6 s second burst.
- Server RSS: 128 MB baseline; after the concurrent large reads it reported 528 MB → 982 MB and remained ~978 MB after 12 s idle; a second burst settled at ~797 MB. Peak `VmHWM` was 1.05 GB. This is a **real scalability risk** for concurrent large-document reads (Node/V8 retains the heap), not proof of an unbounded leak. It was not fixed in this pass; an authenticated user can trigger it with concurrent large reads.

## Remaining gaps and suspected issues

- **LibreOffice external render check still skipped.** `soffice` is absent, `sudo` is blocked by `no_new_privs`, and no renderer was installed. DOCX/XLSX/PPTX were therefore verified with independent parsers, not rendered by LibreOffice. This is the one skipped test in `npm test`.
- **PDF unsupported glyphs:** the embedded Noto Sans JP font does not contain colour emoji; `pdfSafeText` replaces missing glyphs with `?` instead of crashing. CJK, Latin-1, Greek/Cyrillic-like text covered by the font survive. This is a known limitation, not silent truncation of supported text.
- **MCP upper bounds:** the advertised `maximum` for `limit` is still treated as a clamp target rather than a rejection to preserve existing SDK/client behaviour. Non-numeric and below-minimum limits are rejected.
- **API-key last-used writes:** `authenticateApiKey` writes `lastUsedAt` on every authenticated request. This was not measured under high QPS; it could add SQLite write contention. Suspected, not reproduced.
- **Large-read memory:** see the RSS numbers above. No rate limit or streaming path was added; this remains a performance/availability risk.
- **Historical preview 502:** not reproducible now. If it returns, capture whether the proxy rejects the upgrade before the app (proxy logs / HTTP 502 at the tunnel) versus the app closing with `4003` (token/authorization).

## Commands used (disposable environment)

```bash
# Server
PORT=3000 HOST=0.0.0.0 SERVER_MODE=main SESSION_SECRET=… \
  DB_PATH=/tmp/cascade-nonstudio/db.sqlite STORAGE_DIR=/tmp/cascade-nonstudio/uploads \
  HEALTHCHECK_INTERVAL_MS=3600000 node src/index.js

# Full suite
PYTHON_BIN=/tmp/cascade-pptx-venv/bin/python npm test
# 18 tests, 17 pass, 0 fail, 1 skipped (LibreOffice render)

# Independent export parsers
/tmp/cascade-pptx-venv/bin/python /tmp/cascade-nonstudio/parse_exports.py

# SQLite stress
python3 artifacts/audit-nonstudio/sqlite-stress.py /tmp/cascade-sqlite-stress/db.sqlite

# MCP/API-key matrix
BASE=http://127.0.0.1:3000 node artifacts/audit-nonstudio/mcp-api-audit.mjs

# Direct collaboration relay
BASE=http://127.0.0.1:3000 node artifacts/audit-nonstudio/collab-probe.mjs <doc-id>
```

The audit helper scripts live under ignored `artifacts/audit-nonstudio/` and are not part of the committed application; the regression assertions they found are committed in `test/security.test.mjs` and `test/office.test.mjs`.
