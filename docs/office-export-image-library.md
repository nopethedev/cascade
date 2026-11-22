# Native Office Exports and Image Library

- **Date:** 2026-11-22
- **Implementation commit:** `b22f834` (`feat: add Office exports and an editor image library`)
- **Environment:** local `main` server, SQLite test database, Chrome preview, independent OOXML parsers (`python-docx`, `openpyxl`, `python-pptx`).
- **Scope:** document, spreadsheet and presentation downloads; owned/public image embedding; image library in document and deck editors.

## 1. What changed

### Native downloads

`GET /download/:id` now returns, per kind:

| Kind | Format | Content type |
|---|---|---|
| Document | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Spreadsheet | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Presentation | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| Board | `.svg` | `image/svg+xml` (unchanged) |
| PDF | `.pdf` | burned-in annotations (unchanged) |
| Code | active file text | unchanged |
| Form | JSON | unchanged |

The renderers live in `src/office.js`. Documents preserve headings, paragraphs, inline bold/italic/underline/strike, links (styled), lists, blockquotes, code blocks, horizontal rules, tables, header/footer text and images. Sheets preserve sheets, names and computed values. Decks preserve slide backgrounds, text boxes, rectangles, images and speaker notes.

### Image library

A shared dialog (`public/image-library.js`) is opened by **Image** in the document editor and **+ Image** in the deck editor:

- **Your images** lists image uploads from `/api/files`, with thumbnails and sizes.
- **Upload image** posts a new image through the existing quota-checked `/api/upload`.
- **Search online** searches Wikimedia Commons with no API key through `/api/images/search`.
- Search result thumbnails are served through `/api/images/proxy`, which only permits `upload.wikimedia.org`, `thumb.wikimedia.org` and `commons.wikimedia.org`.
- Online images carry title, author and license metadata. Inserted online images get a visible `figcaption` (document) or `credit` text box (presentation) such as:
  `Mountain Lake Virginia lakeview.jpg — Rolfmueller (CC BY-SA 3.0), Wikimedia Commons`.
- Non-PNG/JPEG uploads are normalized to PNG in the browser so Word/PowerPoint can embed them.

### Image handling in exports and public shares

- Document images are resolved by `resolveDocImage()` in `src/workspace.js`; only images owned by the document owner are embedded. Data URLs and already-public images are also accepted.
- Public document pages rewrite `/f/:id/raw` to `/c/:slug/asset/:id`. That route verifies the document is public and the image belongs to the document owner; otherwise **404**.
- Public deck pages use `/c/:slug/preview`, which inlines owned images as data URLs. The public download remains PPTX.
- README, in-app `/docs` and `AGENTS.md` were updated with the new formats, library, routes and import limitation.

## 2. Verification performed

### Automated renderer smoke tests

`npm test` (Node's test runner):

```
✔ DOCX export is a valid ZIP with headings, lists, tables and an embedded image
✔ XLSX export preserves values, computed formulas and sheet names
✔ PPTX export embeds an image and keeps slide text
ℹ tests 3   pass 3   fail 0
```

### Independent OOXML parser validation

These parsers are third-party libraries, not this project's code. They verify the containers are readable and preserve content; they do **not** prove Microsoft Word's exact layout.

| File | Check | Result |
|---|---|---|
| image-bearing DOCX | `python-docx` | 7 paragraphs, **2 inline images**, header and footer |
| formatted DOCX | `python-docx` | 12 paragraphs, **1 table**, header and footer |
| XLSX export | `openpyxl` | `Sheet1`, cell A1 `create-flow-sheet-edit` |
| multi-sheet XLSX | `openpyxl` | names `Numbers`/`Second`; A3 formula computed to `5`; B1 `Hello`; second sheet `Other` |
| image-bearing PPTX | `python-pptx` | 1 slide, 2 shapes, **1 picture**, text `Double-click to edit` |

DOCX media inspection also showed the expected embedded files:

```text
word/media/image1.jpg   107239 bytes
word/media/image1.png     2914 bytes
word/media/image2.jpg   226020 bytes
```

The downloaded ZIPs passed `unzip -t` with no archive errors.

### Browser flows

- Opened a document, clicked **Image**: the library dialog appeared with tabs, upload button and existing images.
- Uploaded a 640×400 PNG through the real file input: image inserted into the page, autosaved, survived reload.
- Search term `red panda`: **12** Wikimedia results; proxy thumbnails loaded as `image/jpeg`.
- Selected an online result: image downloaded through the proxy, uploaded to the user's files, inserted with its attribution caption, and autosaved.
- Repeated insertion while the caret was inside an existing figure no longer nests `<figure>` elements. Final content had 2 separate figures and 1 caption.
- Searched `mountain lake`, inserted a second online image, and confirmed its credit line.
- Deck: **+ Image** opened the same library and added `{type:'image', src:'/f/…/raw', alt, credit}`; export contained `ppt/media/image-1-1.png`.

### Public-share checks

| Check | Result |
|---|---|
| Public document page | 200 |
| Rewritten image asset `/c/:slug/asset/:id` | 200, `image/jpeg`, 107,239 bytes |
| Public document DOCX download | 200, DOCX with both embedded images |
| Public deck preview `/c/:slug/preview` | 200, HTML containing the image as a data URL |
| Public deck PPTX download | 200, PPTX with `ppt/media/image-1-1.png` |
| Preview after share revoked | 404 |

### UI check

The image library was rendered at a 333 px content width (mobile-sized preview): two columns, readable cards, working tabs and an upload label. Screenshot saved locally at `artifacts/image-library-dialog.png` (ignored by git).

## 3. Security and data handling

- Public image assets are scoped to the shared document's owner; arbitrary file IDs return 404.
- The online image proxy is authenticated, HTTPS-only, host-allowlisted and capped at 15 MB. Upstream redirects are re-checked against the allowlist; non-image content types are rejected.
- Search and proxy use a descriptive User-Agent identifying Cascade.
- Library insertion uses DOM text nodes/attributes, not string HTML interpolation, for untrusted titles and filenames.
- New image uploads still go through the existing `/api/upload` quota and storage replication path.
- An `image-size` override forces pptxgenjs onto the patched 2.x parser; `npm audit --omit=dev` no longer reports the image-size advisory. The remaining audit critical/high entries come from the existing sqlite3 `node-gyp`/`tar` install chain, not from the new renderers.

## 4. Limitations and suspected risks

- **No Microsoft Word or LibreOffice is installed in this environment.** Word compatibility is verified structurally and through third-party OOXML parsers, not by opening the files in Word. Layout edge cases (fonts, very wide tables, unusual CSS) remain unverified.
- **Import is still not supported.** This change adds native export only.
- **Wikimedia Commons is the only online provider.** It is keyless and free-licensed, but requires outbound network access and may be unavailable in restricted networks. Results depend on Commons search quality.
- **Legacy non-PNG/JPEG images** already stored in content may be skipped by DOCX/PPTX embedding; new library uploads are normalized to PNG. Existing public document pages can still display them through the asset route.
- **Large-file stress testing was not run.** Very large images or documents with many images can produce large DOCX/PPTX files and slow exports; no size-limit benchmark is available.
- **No automated browser test** was added for the image library; the committed automated tests cover the three renderers only. Browser flows above were executed manually against the preview.
