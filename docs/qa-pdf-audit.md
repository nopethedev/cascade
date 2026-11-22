# PDF Access-Control and Editor Regression Audit

- **Date:** 2026-11-22
- **Baseline commit:** `cc517bf` (`feat: add a real PDF editor as the seventh workspace kind`)
- **Fix commit:** `790e1d4` (`fix: require boolean isPublic when creating or sharing files`)
- **Environment:** local `main` server on `127.0.0.1:3000` behind the running preview, SQLite test database, two real accounts plus an unauthenticated client.
- **Verdict:** No PDF-specific access-control divergence was reproduced. Private PDFs match private doc/sheet behavior request-by-request, public PDF sharing revokes correctly, the image-upload signature path works and appears in the downloaded PDF, and all six pre-existing editors still toggle their drawers and conflict bars and persist edits through reload. One shared API privacy defect was reproduced, fixed, and re-verified (Finding F1). No product regression from the global `[hidden]` rule was found.

## 1. Test setup

Two accounts were used so owner and non-owner results are distinguishable:

- `admin` — application admin, owner of the test records.
- `qa2` — ordinary user with no access to admin records.
- Anonymous requests — no session cookie.

Records created for this audit:

| Record | Kind | Visibility | Marker content |
|---|---|---|---|
| `privPdf` | PDF | private (`isPublic: false`) | text annotation `PRIVATE PDF SECRET` |
| `pubPdf` | PDF | public (`isPublic: true`) | text annotation `PUBLIC PDF OK` |
| `privDoc` | doc | private | `PRIVATE DOC SECRET` |
| `privSheet` | sheet | private | A1 `PRIVATE SHEET SECRET` |

Each record was created through the real create/API path, then its `isPublic` value was read back before testing. Test record IDs/slugs are local-only and intentionally omitted from this report.

Reproduction outline:

1. Start the app in `main` mode with the SQLite database and sign in as `admin`.
2. Create two PDFs and a private doc and sheet. Set the two private records with `POST /api/files/:id/share` using JSON `{"isPublic": false}`; set `pubPdf` with `{"isPublic": true}`.
3. Keep one cookie jar per identity. Fetch every endpoint below with `redirect: manual` so a 302 to `/login` is recorded instead of followed.
4. Compare the private PDF row against the private doc and sheet rows.

## 2. Access-control matrix

Status notation: `302>/login` is a redirect to the login page; `401` is the JSON/API auth failure; `404` is the app's non-disclosure response for a record the caller may not access.

Private records, all three sessions:

| Endpoint | anon PDF | anon doc | anon sheet | qa2 PDF | qa2 doc | qa2 sheet | admin PDF | admin doc | admin sheet |
|---|---|---|---|---|---|---|---|---|---|
| `GET /download/:id` | 302>/login | 302>/login | 302>/login | 404 | 404 | 404 | 200 | 200 | 200 |
| `GET /export/:id` | 302>/login | 302>/login | 302>/login | 404 | 404 | 404 | 200 | 200 | 200 |
| `GET /api/workspace/docs/:id` | 401 | 401 | 401 | 404 | 404 | 404 | 200 | 200 | 200 |
| `GET /api/workspace/docs/:id/versions` | 401 | 401 | 401 | 404 | 404 | 404 | 200 | 200 | 200 |
| `GET /api/files/:id` | 401 | 401 | 401 | 404 | 404 | 404 | 200 | 200 | 200 |
| `GET /c/:slug` | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /c/:slug/export` | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /raw/:slug` | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /f/:id` | 302>/login | 302>/login | 302>/login | 404 | 404 | 404 | 200 | 200 | 200 |
| `GET /edit/:id` | 302>/login | 302>/login | 302>/login | 404 | 404 | 404 | 200 | 200 | 200 |

The private PDF is **identical to both private controls in every cell**. The owner/admin can use the normal authenticated download, export, and editor routes, but the public-slug routes remain 404 even for the owner while the record is private.

Public PDF, compared with the public doc behavior:

| Endpoint | anon | qa2 | admin |
|---|---|---|---|
| `GET /c/:slug` | 200 | 200 | 200 |
| `GET /c/:slug/export` | 200, `application/pdf` | 200, `application/pdf` | 200, `application/pdf` |
| `GET /raw/:slug` | 302>/c/:slug | 302>/c/:slug | 302>/c/:slug |
| `GET /download/:id` | 302>/login | 404 | 200 |
| `GET /export/:id` | 302>/login | 404 | 200 |
| `GET /api/workspace/docs/:id` | 401 | 404 | 200 |
| `GET /f/:id` and `/edit/:id` | 302>/login | 404 | 200 |

Public doc behaves the same way: `/c/:slug` and `/c/:slug/export` are public, while authenticated editor/download/API routes still require the owner (or admin). A public PDF therefore does not expose an editable/API surface that a public doc does not.

### List, search, and create-page leakage checks

- `GET /api/files?all=1&limit=500` as `qa2`: **200**, returned 1 file (qa2's own split copy), and **did not contain** `privPdf`. Admin `?all=1` did contain it, as designed.
- `GET /search?q=PRIVATE PDF SECRET` as `qa2`: **200**, response contained **no** private record ID or marker text. The same query as admin did.
- `/create` for `qa2`: response contained **no** private record ID.
- API-key probe: created a key owned by `qa2` via the admin key form (`ownerId=qa2`). The key saw 1 file, not `privPdf`; `/api/workspace/docs/privPdf`, `/download/privPdf`, and `POST /api/files/privPdf/share` all returned **404**; public `GET /c/pubPdfSlug/export` returned **200**. The test key was revoked after the probe.

### Mutation attempts as `qa2`

| Request | Result |
|---|---|
| `POST /api/files/privPdf/share` `{"isPublic": true}` | 404 |
| `PUT /api/workspace/docs/privPdf` | 404 |
| `POST /api/workspace/docs/privPdf/heartbeat` | 404 |
| `POST /api/workspace/docs/privPdf/restore` | 404 |
| `POST /api/workspace/docs/privPdf/template` | 404 |
| `DELETE /api/files/privPdf` | 404 |
| `GET /edit/privPdf` | 404 |
| `POST /api/workspace/pdf` (split) | 200, created a **new** PDF owned by `qa2`; private record unchanged |
| `POST /api/workspace/merge` | 404 — merge is browser-local, there is no server merge/upload route |

Anonymous mutation attempts: `DELETE /api/files/privPdf` **401**, split **401**. After all attempts, the private PDF was still private, version 3, with its original text annotation.

### Share revocation on the PDF

1. Admin sets `{"isPublic": true}`: **200**, slug retained.
2. Anonymous `/c/{slug}` **200** and `/c/{slug}/export` **200 `application/pdf`**, size 21,564 bytes.
3. Admin sets `{"isPublic": false}`: **200**.
4. Anonymous `/c/{slug}` **404** and `/c/{slug}/export` **404**; owner `/edit/:id` still **200**.

The same sequence was repeated after adding signatures; results were unchanged.

## 3. Signature image upload and exported PDF

Path exercised in the browser on `privPdf`:

1. Open the PDF editor as admin and click **Signature → New signature**.
2. Build a 420 × 140 transparent PNG with a curved stroke and the word `uploaded`, wrap it in a `File`, assign it to `#sig-file` through `DataTransfer`, and dispatch `change`. This is the actual image-upload handler, not the draw path.
3. Click **Use signature**, then click page 1 at roughly 12% width / 82% height.
4. Open the dialog again, draw a separate zigzag on `#sig-pad` with pointer events, save it, and place it at roughly 55% width / 82% height.
5. Wait for autosave.

Observed live document state:

- Version bumped **3**.
- `content.signatures.length = 2`: uploaded image **465 × 114** after trimming, drawn image **337 × 90**.
- Two `type: "signature"` annotations on page 1, both 170 pt wide (42 pt and 45 pt high).
- Two overlay `<img>` elements rendered.
- Reloaded the editor: same version, signatures, annotations, and two overlay images persisted. Signature dialog closed and the history drawer remained `display: none`.

Exported and downloaded through the editor's download link as `QA-private-PDF.pdf` (21,562 bytes), then parsed with `pdf-lib`:

- 1 page.
- Exactly **2 image XObjects** on page 1: **465 × 114** and **337 × 90**, matching the uploaded and drawn signatures.
- The original `PRIVATE PDF SECRET` text overlay is still present in the rendered page.
- Visual check of the browser's PDF viewer showed both signatures on page 1 alongside the text annotation.

This verifies the upload path specifically, not just the pad drawing path.

## 4. Six-editor regression checks

Each existing editor was opened in the browser. For each: history drawer was hidden initially, opened to `display: flex`, and closed back to `display: none`; a forced remote version bump followed by a local edit showed the conflict bar, and resolving it hid the bar and saved; one real edit bumped the persisted version.

| Editor | Drawer initial → open → closed | Conflict bar | Version |
|---|---|---|---|
| doc | none → flex → none | visible, resolved | 3 → 5 |
| sheet | none → flex → none | visible, resolved | 3 → 5 |
| deck | none → flex → none | visible, resolved | 4 → 6 |
| form | none → flex → none | visible, resolved | 4 → 6 |
| code | none → flex → none | visible, resolved | 4 → 6 |
| board | none → flex → none | visible; **Keep mine** hid it and saved | 5 → 7 |

The board check used a trusted Playwright mouse drag because synthetic `PointerEvent`s throw in `setPointerCapture`. The conflict bar was `display: flex` before clicking **Keep mine**, `display: none` after, and the saved version reached 7.

PDF-specific dialog/drawer check under the global `[hidden]` rule:

- History drawer: `none` → `flex` → `none`.
- Signature `<dialog>`: `open=false` → `true` → `false`.
- Conflict bar: remained `none` until triggered.

No drawer, modal, or conflict-bar regression from `[hidden] { display: none !important; }` was observed.

### Create → edit → save → reload

All six non-PDF kinds were created through the real `/create` dialog, edited, autosaved, reloaded, and re-read:

| Kind | Create result | Edit | Version after reload | Reload evidence |
|---|---|---|---|---|
| doc | UI dialog | appended text | 2 | text present in DOM and API |
| sheet | UI dialog | set A1 | 2 | value visible in grid and API |
| deck | UI dialog | added text element | 2 | 1 element in API and DOM |
| form | UI dialog | added field | 2 | 2 fields in API and DOM |
| code | UI dialog | appended comment | 2 | text present in textarea and API |
| board | UI dialog | created rectangles by drag | 3 | 2 elements in API after reload |

A post-fix PDF creation through the same dialog also returned version 1 with `isPublic: false`.

## 5. Finding F1 — `isPublic` string coercion published private files

**Severity:** Medium (privacy exposure; API misuse hazard, not a cross-account authorization bypass).
**Status:** Verified, fixed, re-verified.
**Affected:** `POST /api/workspace/docs` and `POST /api/files/:id/share` for every workspace kind, including PDF.

### Reproduction (before fix)

With an authenticated owner:

```bash
# 1. Create a record with the JSON string "false" instead of a boolean.
curl -b "$COOKIE" -H 'content-type: application/json' \
  -d '{"kind":"pdf","name":"coercion test","isPublic":"false"}' \
  "$BASE/api/workspace/docs"

# 2. Read it back.
curl -b "$COOKIE" "$BASE/api/workspace/docs/$ID"
```

Expected: `"false"` is not a true value, so the record stays private (or the request is rejected).
Actual: create returned **200**, and `isPublic` was **true**.

The same happened on the share endpoint after setting the record private with a real boolean:

```bash
curl -b "$COOKIE" -H 'content-type: application/json' \
  -d '{"isPublic":false}' "$BASE/api/files/$ID/share"        # 200, private
curl -b "$COOKIE" -H 'content-type: application/json' \
  -d '{"isPublic":"false"}' "$BASE/api/files/$ID/share"      # 200, isPublic:true
```

The UI always sends real booleans, so this required a direct API/script client. It is still a realistic accidental-publication path for API users and would apply to all seven kinds.

### Fix

`790e1d4`:

- `src/server.js`: the share route now requires `typeof isPublic === 'boolean'` and returns **400** otherwise.
- `src/workspace.js`: create rejects a present non-boolean `isPublic` with **400**, and stores `isPublic: isPublic === true`.

### Re-verification after fix

- `POST /api/workspace/docs` with `"isPublic":"false"` → **400** `{"error":"isPublic must be a boolean"}`; no record created.
- `POST /api/workspace/docs` with `false` → **200**, new record `isPublic: false`.
- `POST /api/files/:id/share` with `"false"` on a private record → **400**, record remained `isPublic: false`.
- Boolean `true` → **200** public; anonymous `/c/:slug` **200**; boolean `false` → **200** private; anonymous `/c/:slug` **404**.
- Browser **Share** button on the fixed server: `Share` → `Public ✓` → `Share`, with the API following each click.
- Browser create dialog after the fix: new PDF version 1, `isPublic: false`.

Test records created for the coercion probe were deleted afterward.

## 6. Residual risks (suspected, not reproduced)

These are outside the access-control pass and were not fixed in this audit. They are called out for the next review, not reported as verified defects.

1. **PDF storage amplification — suspected, performance/data-growth risk.** PDF source is stored as base64 inside the document JSON, and each save can create a version snapshot. A 12 MB PDF plus the 25-version history can multiply into a very large SQLite row set. Not benchmarked at the request-size limit.
2. **Malformed signature data URL — suspected robustness issue.** Signatures are trusted as stored data URLs; an invalid PNG/JPEG payload would likely make PDF export throw a 500. Not reproduced because it requires crafting a document through the API.
3. **JSON mutation endpoints have no CSRF token — suspected hardening gap.** Session cookies use framework defaults (no explicit `SameSite`), and the app does not enable CORS. Browser defaults reduce cross-site risk, but this was not penetration-tested.
4. **Client-side merge has no input-size guard — suspected memory risk.** Merge reads files in the browser; a very large upload can exhaust the tab. No server merge route exists, so there is no server-side privacy impact.

## 7. Limitations

- The exported PDF was checked structurally with `pdf-lib` and visually in Chrome's PDF viewer, not in Adobe Acrobat or a print-production workflow.
- The access matrix was exercised against the local SQLite test database, not a staging deployment with a CDN in front. Cache behavior after revocation was not tested.
- During a preliminary API-key probe, an admin-owned test key was used by mistake and briefly published the private test PDF. It was immediately set private again; every matrix result above was collected after confirming `isPublic: false`. That was a harness mistake, not a product finding. The test keys were revoked.
- No load, concurrency, or disk-quota tests were run for PDFs; the residual risks above are source-level suspicions.
