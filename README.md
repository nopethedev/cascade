# Cascade

Self-hosted file upload / view / edit + public share & CDN links, with **Main server + storage Nodes**, configurable **replication**, **API keys** and built-in **analytics**.

Stack: **Express (ES Modules) + EJS + Sequelize/SQLite + hand-written CSS design system**. Metadata (users, files, nodes, settings, API keys, analytics) lives in one SQLite file; file blobs stay on disk or on storage nodes.

Theme: flat black surfaces, hairline rules and one red accent, fully customizable in **Admin → Appearance** (or `.env`: `THEME_ACCENT`, `THEME_BG`, `THEME_SURFACE`, `THEME_TEXT`, `SITE_NAME`).

## Workspace editors

Beyond uploads, Cascade is a small productivity suite. **+ Create** (dashboard sidebar, admin files) opens `/create`: a searchable template gallery with type and category filters, recent files, and your own saved templates. Pick a template, name the file, choose a folder, optionally share it, and the matching editor opens.

| Editor | Implemented |
|---|---|
| **Document** | rich text, headings, lists, quotes, alignment, links, images, tables, header/footer, word count, Word (.docx) export with embedded images |
| **Spreadsheet** | formula engine with dependency tracking (`=SUM(A1:A5)`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `PRODUCT`, `ROUND`, `ABS`, `IF`, cell refs and ranges), formatting, multiple sheets, column sort + filter, Excel (.xlsx) export |
| **Presentation** | drag/resize text, shapes and images, layouts, thumbnails, snapping, transitions (fade/push/wipe/zoom), per-element entrance animations and click builds, presenter mode, notes, PPTX export with native transitions |
| **PDF** | pdf.js rendering with zoom/page navigation and text selection, highlight/text/comment/signature annotations, page rotate/reorder/duplicate/insert/delete, merge another PDF, split out selected pages, exported PDFs burn annotations in |
| **Whiteboard** | infinite pan/zoom canvas, pen, rectangle, ellipse, arrow, text, sticky notes, eraser, undo/redo, SVG export |
| **Form** | 8 field types, visual builder, publish link, server-side validation, stored responses, per-question analytics, CSV export |
| **Code** | multi-file project, tabs, syntax highlighting, rename/delete, export |
| **Website** | visual section builder, layers/reorder, responsive previews, theme + SEO, sandboxed custom code, SQLite CMS collections and dynamic pages, staging/production deployments with rollback, publishing with forms/analytics/sitemap, custom domains, HTML/React export |
| **Roblox Studio** | installable Luau plugin, one-time pairing, live Explorer, properties, Luau/Monaco scripts, GUI designer, Three.js approximation viewport, snapshots, MCP tools and live collaboration |
| **Game Studio** | real 2D (Canvas + Matter.js) and 3D (Three.js + Cannon-es) runtimes, scene hierarchy, transform gizmos, inspector/components, visual graph scripting, JavaScript scripts, GLB/glTF/OBJ/FBX/STL import, lighting, particles, terrain, prefabs, play/pause/step, HTML5/ZIP/standalone exports and public `/games/:slug` publishing |
| **Cascade Motion** | frame-accurate multitrack NLE: media library, Canvas2D compositor, trim/split/ripple/slip/slide, 62 transitions, 50 subtitle styles, 105 effects, 51 motion templates, 30 colour presets and scopes, keyframes, masks, nested compositions, on-device Whisper subtitles, render queue and real FFmpeg H.264/H.265/VP9/AV1 + AAC/Opus/E-AC-3 exports |
| **Cascade AI** | native streaming chat at `/ai`: branching history, folders/search, Markdown/KaTeX/highlighted code, attachments and vision, PDF/Office extraction, knowledge bases with local or provider embeddings, assistants, voice input/TTS, web search, thinking/effort controls, shared and per-user MCP servers with destructive-action confirmation, image generation/editing, token usage and admin-configured providers/limits |

The entire interface uses a Tailwind 3 design system with Lucide icons: a shared top bar, Tailwind-styled dashboards, template gallery, account/admin screens, documentation, public share/form pages and editor chrome. The compiled Tailwind layer sits on top of the CSS-variable theme, so admin-selected colours and the light theme still apply everywhere. Build it with `npm run css:build` after changing views or `src/tailwind.css`.

Shared behaviour: Yjs/WebSocket live collaboration with incremental JSON patches, cursors, selections, presence and reconnect recovery; offline draft merge; debounced autosave; version history (last 25 snapshots, restorable); server-enforced Owner/Editor/Commenter/Viewer roles; expiring capability links; threaded comments with @mentions; "save as template"; a global `/search` across file names and document contents; and an image library for documents, spreadsheets, decks and websites. Template cards render the actual template content, not placeholders.

### Roblox Studio bridge

`/studio/roblox` is a real remote editor for an installed Roblox Studio plugin, not a simulation. Create a place, click **Connect Studio**, and hand the one-time URL + pairing code to the plugin. The relay uses authenticated HTTP polling (Roblox plugins cannot depend on WebSockets), never asks for a Roblox password or cookie, hashes session tokens, supports heartbeat/reconnect/revocation, and keeps the plugin as the final authority for supported changes.

Explorer, property editing, Luau scripts (Monaco), GUI instances, Three.js viewport transforms and scene snapshots are implemented. The 3D preview is opt-in via **Enable 3D preview** because remote desktops and embedded browsers can expose a software WebGL rasterizer that blocks the editor; it requires hardware WebGL, while the Explorer, properties, scripts and GUI designer continue to work without it. Every edit is schema-validated and queued; unsupported properties and unavailable Studio APIs are reported rather than faked. Terrain sculpting, animation timelines, particle simulation, pathfinding visualization and asset uploads remain Studio-side workflows. See [`docs/roblox-studio-manual-checklist.md`](docs/roblox-studio-manual-checklist.md) for the acceptance checklist that must be run with a real Studio install.

### Cascade Game Studio

Create a **2D Project** or **3D Project** from `/create`. Both modes share the project manager, assets, scripts, save/load, collaboration, version history, input map, audio and export system while keeping independent runtimes:

- **2D** uses Canvas2D rendering and a Matter.js rigid-body world. The starter library includes a platformer, top-down adventure and physics sandbox.
- **3D** uses Three.js for rendering and Cannon-es for fixed-timestep physics. The scene editor supports orbit/pan/zoom/WASD fly, hierarchy parenting, transform gizmos, grid/rotation snapping, perspective and orthographic views. Components cover meshes, PBR materials, lights and shadows, cameras, rigid bodies, colliders, character controllers, joints, particle emitters, audio, terrain and UI.
- **Gameplay** is written with a typed visual graph compiler or sandboxed JavaScript. The editor's Play button runs the same runtime and exported HTML file as the published game; pause, resume, frame-step, stop, console, problems and profiler are available.
- **Assets** accept GLB, glTF, OBJ, FBX, STL, images and audio. Imported models are cached; the first-person template ships with a real OBJ crate. Materials expose base color, metalness, roughness, opacity, emissive, normal maps and textures.
- **Templates** are editable projects, not screenshots: first-person vault exploration, third-person platformer, 3D physics sandbox, arcade driving, low-poly survival, plus 2D starters. The first-person project includes a character controller, imported model, door interaction visual script, HUD and win condition and is covered by the browser QA flow.

The exported game is a single self-contained HTML file (engine, runtime, project JSON and data-URL assets inlined) with a restrictive CSP; ZIP export additionally includes the runtime source, `game.json`, extracted assets and a README. Publishing serves the same build publicly at `/games/:slug` without requiring a Cascade account.

Current 3D limits: terrain is a procedural heightfield with a simple collider; navigation/behavior trees, skeletal animation blending, networked 3D play, mesh editing/sculpting and advanced post-processing are not implemented yet. Imported model animations are not played by the runtime. The editor reports unsupported projects rather than pretending those systems exist.

### Cascade Motion

**Cascade Motion** is the workspace video editor. It is a real nonlinear editor backed by the same SQLite file records, collaboration rooms, history and MCP server as the rest of Cascade; heavy editor modules and FFmpeg are loaded only when a video project is open.

- **Timeline** — integer-microsecond ticks, unlimited tracks, linked A/V, trim, split, ripple, roll, slip, slide, snapping, markers, groups, multi-select, frame stepping, speed/reverse/freeze, virtualised clip DOM and full undo/redo.
- **Compositor** — Canvas2D preview with simultaneous video layers, transforms, opacity, blend modes, masks, text, karaoke/word-level subtitles, transitions, colour curves/selective colour and deterministic particles. WebCodecs/WebGL2 are feature-detected; unsupported codecs use generated proxies.
- **Audio** — waveforms, music library, fades, gain/pan, EQ, compression, limiter, denoise/enhance, reverb/echo, pitch, ducking preview, beat markers, peak meters and master mix.
- **Colour and graphics** — lift/gamma/gain, temperature/tint, RGB curves, hue/sat/luma selective colour, `.cube` LUT imports with intensity, histogram/waveform/parade/vectorscope, 50 editable caption presets, 51 motion templates and shape/text layers.
- **Export** — a persistent render queue runs outside the Express process with progress, cancellation, retry and error logs. FFmpeg validates container/codec/encoder support before rendering, detects hardware encoders, and uses a shared filter graph plus deterministic particle/composition layers so exported frames match the preview. Outputs are stored in Cascade Files and downloadable from the job.
- **Automation** — `motion_*` MCP tools expose project inspection, transactional edit batches with dry-run/CAS, media import, frame capture, render progress, history and undo. The editor and MCP use the same validation and edit operations.

Docker installs `ffmpeg`, `ffprobe` and DejaVu fonts; set `FFMPEG_PATH`/`FFPROBE_PATH` when using a custom binary.

Automatic subtitles in **Cascade Motion** use Whisper running locally in a Web Worker. The bundled ONNX runtime and model list run on the user's device; audio is decoded and transcribed in the browser and is never uploaded. The first run downloads the selected model from Hugging Face and caches it in the browser (Tiny ~40 MB, Base ~80 MB, Small ~250 MB quantized). Inference uses the bundled WebAssembly runtime. The server-side providers configured in **Admin → Motion** remain available to automation/MCP, but the editor's subtitle dialog does not call them.

Current export limits are reported in the job warnings rather than hidden: animated scale/rotation/opacity and animated effect parameters use their first-frame value, selective/lift/gamma/gain grades have preview-only components, HDR source conversions are not tone-mapped, and nested compositions are flattened one level (audio inside a composition is not mixed). Particle, text, colour, keyframed x/y transforms, transitions and subtitles are rendered into the export.

### Cascade Sites CMS and deployments

The website editor's **CMS** panel stores collections and items in SQLite and renders real dynamic `/c/:collection` and `/c/:collection/:slug` pages. **Deployments** keeps immutable staging and production snapshots, and **Staging** previews the next build without touching production. Publishing remains available at `/sites/:slug` with sitemap/robots, SEO, forms, analytics and custom-domain routing; HTML and React exports are self-contained.

Document, sheet and deck exports are real Office Open XML files (`.docx`, `.xlsx`, `.pptx`) with embedded local images, so they open in Word, Excel and PowerPoint rather than being renamed HTML/CSV files. The DOCX writer mirrors the editor's page width, 15.5px body type, 1.72 line height, headings, list numbering, quote/code blocks, table borders and image sizing. Presentation exports keep the deck's exact slide size and include native OOXML slide transitions added after pptxgenjs writes the package. Uploading a `.pptx` converts it into an editable presentation (text, shapes, images, tables, notes, transitions, original slide size); an already-uploaded `.pptx` can be converted from its file page with **Edit as presentation**. Shared-document pages expose only images owned by that document. PDFs are stored as their real PDF bytes (base64 inside the document JSON). Pages are edited in the browser with **pdf-lib** and rendered with **pdf.js**, both served from `public/vendor/`; annotations are burned into the export on the server. DOCX and XLSX **import** are not included. Add `pdfjs-dist` and `pdf-lib` static builds again with the copy step in `AGENTS.md` if you upgrade them.

### Cascade AI

`/ai` is an AI workspace built into Cascade's own Express/EJS app, not an iframe of another product. Chat responses stream over SSE and render Markdown, LaTeX and highlighted code. Conversations have folders, search, pinning and a real branching tree: regenerate an answer, then move between sibling branches. Attachments use the normal file store — vision models receive images, while text, PDF and Office documents are extracted into the prompt. Knowledge bases chunk, embed and retrieve documents, using a configured embedding provider or a deterministic local lexical fallback. Assistants pin a system prompt, model, temperature and knowledge bases. Voice input uses the browser's speech recognition, and speech output uses the configured TTS provider with a browser fallback.

Providers are configured in **Admin → Cascade AI**: OpenAI-compatible endpoints or Ollama, model discovery, default provider/model, image generation/editing, speech, SearXNG/Tavily web search, embedding provider, per-user daily token limits and MCP servers. API keys stay in SQLite (or an `apiKeyEnv` environment variable) and are stripped from every browser response; a blank key in the admin JSON keeps the stored key. Without a configured provider, `/ai` still opens but chat returns an explicit setup error — there is no bundled model or simulated answer.

AI tool calls use the same owner-scoped tools as `/mcp`, so a conversation can create documents, decks, sheets, PDFs, boards, forms, code, websites, games, Flow bots, Roblox Studio edits and Motion projects. Results are saved to Cascade Files and linked directly to `/edit/:id`. `cascade_generate_image` generates images into Files. Destructive tools (`delete_document`, `studio_queue_command`) pause for an explicit Approve/Decline card instead of running automatically. External MCP servers are called over JSON-RPC; their tools are namespaced and only public http(s) URLs are accepted. Administrators configure shared servers, while each user can add write-only personal servers (and tokens) under **Personal MCP** in `/ai`. The chat top bar also exposes per-conversation **Thinking** and **Effort** controls, saved as account defaults.

## Features

- Upload (multi-file, drag & drop, progress), view (images / video / audio inline), edit text files, rename, delete
- Workspace editors for documents, spreadsheets, presentations, PDFs, whiteboards, forms, code, websites, Roblox Studio, Game Studio and Cascade Motion video editing (see above)
- Live collaboration rooms, comments, roles and capability links across every editor
- Published websites with forms, analytics, sitemap/robots and custom-domain Host routing
- Share publicly: pretty page `/c/:slug` + raw CDN URL `/raw/:slug` (5-minute revalidating public cache)
- Roles: `admin` / `user`, per-user quota (MB, with 0.1 GB = 102.4 MB)
- Admin panel: overview, **analytics**, users, all files, **storage cleanup**, nodes + replication, **API keys**, appearance, **Cascade AI**
- Storage cleanup scans local blobs and reports only objects with no matching file record, so ordinary uploads and document assets are never removed
- **Analytics** — views, downloads, uploads, unique visitors, traffic chart, top files and recent events, all stored in SQLite (no third-party scripts)
- **API keys** — SHA-256-hashed, revocable keys with read-only, read/write or full-owner scopes; create/revoke in the admin panel
- **MCP server** — stateless Streamable HTTP at `/mcp` with owner-scoped document CRUD, folders, search, versions/restore, starring/sharing, templates, form responses, and resources, using the same API keys and permissions as the app; atomic version concurrency and adversarial isolation tests are verified with the official SDK and documented against MCP 2025-11-25 in `docs/mcp-server.md`
- **Cascade AI** — native `/ai` chat with streaming, branching, attachments, knowledge bases, assistants, image generation, speech, web search, token usage and MCP tool calling; providers and limits are configured server-side in Admin → Cascade AI
- **Documentation** — `/docs` in the app (API reference, nodes, config, backups), plus step-by-step tutorials for the [Game Studio](/docs/game) and [Cascade Flow Discord bots](/docs/flow)
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

The image is pulled from GHCR (`ghcr.io/nopethedev/cascade:latest`, built by `.github/workflows/docker.yml`) and includes FFmpeg/FFprobe and fonts for Cascade Motion exports.
Add `--build` to build from source instead, or set `CASCADE_IMAGE` to use another tag. Data (SQLite + uploads) lives in the `cascade-data` volume.

> When `NODE_ACCESS_KEY` is empty, the node generates a key and saves it to `data/node-key.txt` (mode 0600) without printing the value. Read it from that file to register the node.
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
| `GET /api/auth/config` | public registration availability |
| `POST /api/auth/register` | create a standard account when registration is enabled |
| `GET /api/me` | account, quota and usage |
| `GET /api/files` | list files (`?limit=`, `?all=1` for admins) |
| `GET /api/files/:id` | one file + raw/public URLs |
| `POST /api/upload` | multipart upload, field `files` |
| `GET/PUT /api/files/:id/text` | read / rewrite a text file |
| `POST /api/files/:id/share` | toggle public sharing |
| `POST /api/files/:id/rename` | rename + re-detect MIME |
| `DELETE /api/files/:id` | delete from every replica |

Account settings (same auth): `/settings`, `POST /settings/profile`, `POST /settings/password`. Public registration is disabled by default and can be enabled in Admin → Users; new accounts always have the `user` role.

Workspace API (same auth): `POST /api/workspace/docs`, `GET|PUT /api/workspace/docs/:id`, `GET /api/workspace/docs/:id/versions`, `POST /api/workspace/docs/:id/restore`, `POST /api/workspace/docs/:id/heartbeat`, `POST /api/workspace/docs/:id/template`, `POST /api/workspace/folders`, `GET /export/:id`, `GET /download/:id`, `GET /api/images/search?q=`, `GET /api/images/proxy?url=` (editor image library; Wikimedia-host allowlist).

Game Studio (same auth): `POST /api/workspace/docs/:id/game/compile`, `POST /api/workspace/docs/:id/game/export`, `GET /api/workspace/docs/:id/game/preview`, and public `GET /games/:slug`. Publishing uses the existing `POST /api/workspace/docs/:id/publish` with a game document.

Collaboration and websites (same auth): `GET /api/workspace/docs/:id/collab-token`, WebSocket `/collab?token=…`, `GET|POST /api/files/:id/access`, `POST /api/files/:id/share-links`, `POST /api/share-links/:token/revoke`, `GET|POST /api/workspace/docs/:id/comments`, `POST /api/workspace/docs/:id/publish`, `GET /sites/:slug`, `POST /sites/:slug/submit`, `GET /sites/:id/export.html|export.jsx|export.css`, `GET /sites/:slug/sitemap.xml`, and capability pages at `/s/:token`.

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

See `.env.example`. Main knobs: `PORT`, `SERVER_MODE`, `SESSION_SECRET`, `DB_PATH`, `STORAGE_DIR`, `SITE_NAME`, `THEME_*`, `NODE_ACCESS_KEY` (node mode), `HEALTHCHECK_INTERVAL_MS`, `FFMPEG_PATH`, `FFPROBE_PATH`, `WHISPER_*` (Motion).

## GitHub Actions

- `.github/workflows/build.yml` — installs, syntax-checks, boots the server and runs a setup + upload smoke test, then verifies the image builds (no push).
- `.github/workflows/docker.yml` — builds and pushes `ghcr.io/<owner>/<repo>` on pushes to `main` and `v*` tags (`latest` on the default branch). No secrets needed beyond the default `GITHUB_TOKEN`.
