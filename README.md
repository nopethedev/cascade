# Cascade

Self-hosted file upload / view / edit + public share & CDN links, with **Main server + storage Nodes**, configurable **replication**, **API keys** and built-in **analytics**.

Stack: **Express (ES Modules) + EJS + Sequelize/SQLite + hand-written CSS design system**. Metadata (users, files, nodes, settings, API keys, analytics) lives in one SQLite file; file blobs stay on disk or on storage nodes.

Theme: flat black surfaces, hairline rules and one red accent, fully customizable in **Admin → Appearance** (or `.env`: `THEME_ACCENT`, `THEME_BG`, `THEME_SURFACE`, `THEME_TEXT`, `SITE_NAME`).

## Workspace editors

Beyond uploads, Cascade is a small productivity suite. **+ Create** (dashboard sidebar, admin files) opens `/create`: a searchable template gallery with type and category filters, recent files, and your own saved templates. Pick a template, name the file, choose a folder, optionally share it, and the matching editor opens.

| Editor | Implemented |
|---|---|
| **Document** | rich text, headings, lists, quotes, alignment, links, images, tables, header/footer, word count, HTML export |
| **Spreadsheet** | formula engine with dependency tracking (`=SUM(A1:A5)`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `PRODUCT`, `ROUND`, `ABS`, `IF`, cell refs and ranges), formatting, multiple sheets, column sort + filter, CSV export |
| **Presentation** | drag/resize text, shapes and images, slide list, speaker notes, present mode, undo/redo, HTML export |
| **PDF** | pdf.js rendering with zoom/page navigation and text selection, highlight/text/comment/signature annotations, page rotate/reorder/duplicate/insert/delete, merge another PDF, split out selected pages, exported PDFs burn annotations in |
| **Whiteboard** | infinite pan/zoom canvas, pen, rectangle, ellipse, arrow, text, sticky notes, eraser, undo/redo, SVG export |
| **Form** | 8 field types, visual builder, publish link, server-side validation, stored responses, per-question analytics, CSV export |
| **Code** | multi-file project, tabs, syntax highlighting, rename/delete, export |

Shared behaviour: debounced autosave, version history (last 25 snapshots, restorable), optimistic concurrency with a conflict bar when another session saves first, presence chips, share links, "save as template", and a global `/search` across file names and document contents.

PDFs are stored as their real PDF bytes (base64 inside the document JSON). Pages are edited in the browser with **pdf-lib** and rendered with **pdf.js**, both served from `public/vendor/`; annotations are burned into the export on the server. DOCX/XLSX/PPTX import/export, live cursors/CRDT collaboration, offline sync, AI assistance and a light theme are not included. Add `pdfjs-dist` and `pdf-lib` static builds again with the copy step in `AGENTS.md` if you upgrade them.

## Features

- Upload (multi-file, drag & drop, progress), view (images / video / audio inline), edit text files, rename, delete
- Workspace editors for documents, spreadsheets, presentations, PDFs, whiteboards, forms and code (see above)
- Share publicly: pretty page `/c/:slug` + raw CDN URL `/raw/:slug` (immutable cache headers)
- Roles: `admin` / `user`, per-user quota (GB)
- Admin panel: overview, **analytics**, users, all files, nodes + replication, **API keys**, appearance
- **Analytics** — views, downloads, uploads, unique visitors, traffic chart, top files and recent events, all stored in SQLite (no third-party scripts)
- **API keys** — hashed keys for scripts, acting as their owner; create/revoke in the admin panel
- **Documentation** — `/docs` in the app (API reference, nodes, config, backups)
- First-run setup wizard creates the admin user
- `SERVER_MODE=main | node`
- Replication modes: **all / select / single (1 only) / default (1 default node) / n copies with auto-heal**

## Quick start (local)

```bash
cp .env.example .env
npm install
npm start
# open http://localhost:3000 → setup wizard → create admin
```

The database (`data/cascade.sqlite`) and tables are created on first boot. If you upgraded from an older release, an existing `data/db.json` is imported automatically the first time the database is empty.

## Docker

One service, one switch — `SERVER_MODE` decides what it is:

```bash
# main server on :3000
docker compose up -d

# storage node on :3001 (set your own key)
SERVER_MODE=node NODE_ACCESS_KEY=my-secret-key CASCADE_PORT=3001 docker compose up -d
```

The image is pulled from GHCR (`ghcr.io/nopethedev/cascade:latest`, built by `.github/workflows/docker.yml`).
Add `--build` to build from source instead, or set `CASCADE_IMAGE` to use another tag. Data (SQLite + uploads) lives in the `cascade-data` volume.

> The node prints its auto-generated key on first boot when `NODE_ACCESS_KEY` is empty (also saved to `data/node-key.txt`).
> Add the node to the main server in **Admin → Nodes** with its URL and that key.

## API

Full reference: **`/docs`** in the app (also linked in the footer).

Create a key in **Admin → API keys**, then send it as `x-api-key: csk_…` or `Authorization: Bearer csk_…`.

```bash
KEY=csk_…

curl -H "x-api-key: $KEY" http://localhost:3000/api/me
curl -H "x-api-key: $KEY" -F "files=@./report.pdf" http://localhost:3000/api/upload
curl -H "x-api-key: $KEY" http://localhost:3000/api/files
curl -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"isPublic":true}' http://localhost:3000/api/files/FILE_ID/share
```

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | public health / mode / node status |
| `GET /api/me` | account, quota and usage |
| `GET /api/files` | list files (`?limit=`, `?all=1` for admins) |
| `GET /api/files/:id` | one file + raw/public URLs |
| `POST /api/upload` | multipart upload, field `files` |
| `GET/PUT /api/files/:id/text` | read / rewrite a text file |
| `POST /api/files/:id/share` | toggle public sharing |
| `POST /api/files/:id/rename` | rename + re-detect MIME |
| `DELETE /api/files/:id` | delete from every replica |

Workspace API (same auth): `POST /api/workspace/docs`, `GET|PUT /api/workspace/docs/:id`, `GET /api/workspace/docs/:id/versions`, `POST /api/workspace/docs/:id/restore`, `POST /api/workspace/docs/:id/heartbeat`, `POST /api/workspace/docs/:id/template`, `POST /api/workspace/folders`, `GET /export/:id`, `GET /download/:id`.

## Node protocol (main → node, header `x-node-key`)

- `GET /node/health`
- `PUT /node/store/:id` (raw bytes)
- `GET /node/file/:id`
- `DELETE /node/file/:id`
- `GET /node/stat`

The main server itself always acts as the `local` node, so it works with zero remotes.

## Replication

Admin → Nodes → Replication:

| Mode | Meaning |
|---|---|
| All nodes | every enabled node gets a copy |
| Selected nodes | only the checked nodes |
| One node (`single`) | exactly one copy, prefers local |
| One default node (`default`) | always the chosen node |
| N copies (`n`) | first N nodes (local first); health-checker re-copies to another healthy node when one goes down |

## Data & backups

```
data/
  cascade.sqlite   # Sequelize database: users, files, nodes, settings, API keys, analytics
  uploads/         # local blobs, named by file id
  node-key.txt     # node mode access key, when auto-generated
```

Back up the SQLite file and `uploads/` together. In Docker both live in `cascade-data`.

## Env

See `.env.example`. Main knobs: `PORT`, `SERVER_MODE`, `SESSION_SECRET`, `DB_PATH`, `STORAGE_DIR`, `SITE_NAME`, `THEME_*`, `NODE_ACCESS_KEY` (node mode), `HEALTHCHECK_INTERVAL_MS`.

## GitHub Actions

- `.github/workflows/build.yml` — installs, syntax-checks, boots the server and runs a setup + upload smoke test, then verifies the image builds (no push).
- `.github/workflows/docker.yml` — builds and pushes `ghcr.io/<owner>/<repo>` on pushes to `main` and `v*` tags (`latest` on the default branch). No secrets needed beyond the default `GITHUB_TOKEN`.
