# Agent notes

## Git

Always commit your changes and push them to GitHub (`main`) when work is finished.
No need to ask for confirmation first.

- Identity: `git config user.email codebuff@freebuff.com`, `git config user.name Codebuff`
- Commit messages: conventional style (`feat:`, `fix:`, `chore:`)
- Never commit `data/` or `.env` (they are gitignored); keep the default `data/` dir out of commits.

## Project

- Express 5 / ES Modules, EJS views, no build step.
- Theme is hand-written CSS in `public/theme.css` using CSS variables (no Tailwind).
- Persistence: Sequelize + SQLite (`src/db.js`, default `data/cascade.sqlite`). Models: `User`, `FileRecord`, `NodeRecord`, `ApiKeyRecord`, `AnalyticsEvent`, `Setting`, plus workspace `Collaborator`, `ShareLink`, `CommentThread` and `CollabRoom`. Settings are a singleton row read through `getSettings()` / written with `saveSettings()`.
- Blobs stay on disk in `data/uploads/` or on storage nodes — never in SQL.
- `SERVER_MODE=main|node` selects the role; `docker-compose.yml` has a single service.
- API keys (`src/apiKeys.js`) are SHA-256-hashed and scoped (`read`, `write`, or `full`); requests authenticate with `x-api-key` or `Authorization: Bearer`. `req.user` is set for both sessions and keys. `scope` is added to existing databases by `migrateSchema()`.
- Analytics events are written by `recordEvent()` (`src/analytics.js`) and never block a response.
- MCP (`src/mcp.js`) is mounted at `/mcp` in `src/server.js`. It is stateless Streamable HTTP JSON-RPC, reuses the app auth middleware and API-key scopes, and every document lookup goes through an owner/admin check. Read-only keys may call read tools but never mutations.
- User-facing docs live at `/docs` (`views/docs.ejs`); keep it current when routes or env vars change.

## Game Studio

- Game documents use `kind = 'game'` and `content.mode = '2d' | '3d'`. The shared schema/normalizer is `public/game/schema.mjs`; node registries are `public/game/nodes.mjs` and `nodes3d.mjs`; validation/compilation is `public/game/compiler.js`.
- The runtimes are independent but share the graph interpreter: `public/game/runtime.js` (Canvas2D + Matter.js) and `public/game/runtime3d.js` (Three.js + Cannon-es). Both expose the live instance at `window.__CASCADE_GAME__` and read `window.__GAME_PROJECT__`.
- `src/game/templates.js` holds all built-in 2D/3D templates. `src/game/export.js` inlines the vendored engine bundles, runtime, project and owned assets for standalone HTML/ZIP export. The editor route is `views/editors/game.ejs` + `public/editors/game.js`; server endpoints are in `src/workspace.js` (`/game/compile`, `/game/export`, `/game/preview`, public `/games/:slug`).
- Dependencies are vendored (do not move them to a CDN): `public/vendor/cascade-three.js` (Three + GLTF/OBJ/STL/FBX loaders), `public/vendor/cannon-es.js` and `public/vendor/matter.min.js`. Rebuild `cascade-three.js` with the esbuild command recorded in the commit history after upgrading Three.js.
- Runtime code is cached on first read by `src/game/export.js`; restart the server after editing `runtime.js`/`runtime3d.js` when testing through the editor or preview endpoints.
- Keep 2D and 3D gameplay validated by browser QA; `test/game.test.mjs` covers schema/template compilation and exports but not live controls. Current unsupported 3D features are listed in README (navigation/behavior trees, skeletal animation playback/blending, networked 3D play, mesh editing/sculpting, advanced post-processing).

## Roblox Studio and Sites

- Roblox projects are existing `files` rows with `kind = 'roblox'`; the browser editor and relay live in `src/studio.js`, and the installable plugin is generated from `plugin/CascadePlugin.luau` by `src/robloxPlugin.js` at `/studio/roblox/plugin.rbxmx`. The plugin is the final authority and uses HTTP polling with `x-studio-token`; never claim real Studio integration works without the manual checklist in `docs/roblox-studio-manual-checklist.md`.
- Studio models (`StudioPairing`, `StudioSession`, `StudioCommand`, `StudioSnapshot`) and site deployment/CMS models (`SiteDeployment`, `SiteCollection`, `SiteItem`) are added in `src/db.js`. Website CMS/deployment routes are in `src/sites.js`; CMS rendering is shared through `public/site-render.mjs`.
- Three.js and Monaco are vendored under `public/vendor/` (not imported from a CDN). The Studio client is `public/studio/studio.js` + `views/studio/*.ejs`; collaboration reuses `public/editors/collab-client.js`.

## Workspace suite

- `/create`, `/edit/:id`, `/api/workspace/*`, `/export/:id`, `/forms/:slug`, `/responses/:id`, `/template-preview/:id` and `/search` live in `src/workspace.js` (mounted from `src/server.js`). Published websites and their public forms/assets/exports live in `src/sites.js` at `/sites/:slug`; custom-domain Host routing is mounted before the app auth/setup middleware.
- Workspace documents are rows in the existing `files` table with `kind` (`doc|sheet|deck|pdf|board|form|code|site|game|flow|roblox`), JSON `content`, and a `version` counter. Blobs/uploads keep `kind = 'file'`.
- Collaboration is `src/collab.js` + `src/access.js` on the HTTP server's WebSocket upgrade path (`/collab`). Rooms are Yjs documents whose `content` map matches the editor JSON; tokens are HMAC-signed and short lived. Server roles are authoritative, persisted to `DocVersion`/`FileRecord`, and revoked sockets are closed with code 4001. The browser transport is `public/editors/collab-client.js`; it imports the browser bundle `public/vendor/yjs.bundle.mjs`. Rebuild that bundle after upgrading Yjs with `npx esbuild node_modules/yjs/dist/yjs.mjs --bundle --format=esm --platform=browser --minify-syntax --outfile=public/vendor/yjs.bundle.mjs`.
- Website rendering is shared by the editor, template gallery, published page and exports through `public/site-render.mjs`. Keep the renderer pure-string/Node-safe; do not import browser-only APIs.
- PDFs store their real source bytes base64-encoded in `content.pdf`; annotations/signatures live beside it in the same JSON. The editor (`public/editors/pdf.js`) renders with pdf.js and performs page operations with pdf-lib in the browser; `renderPdfBuffer()` in `src/workspace.js` burns annotations and signatures into exports with pdf-lib.
- pdf.js and pdf-lib are vendored, not installed at runtime: `public/vendor/pdfjs/{pdf.mjs,pdf.worker.mjs,standard_fonts/}` and `public/vendor/pdf-lib.min.js`. Refresh them after upgrading with:
  `cp node_modules/pdfjs-dist/build/{pdf.mjs,pdf.worker.mjs} public/vendor/pdfjs/ && cp node_modules/pdfjs-dist/standard_fonts/*.pfb public/vendor/pdfjs/standard_fonts/ && cp node_modules/pdf-lib/dist/pdf-lib.min.js public/vendor/`
- Each editor is its own view (`views/editors/*.ejs`) + engine (`public/editors/*.js`) over the shared runtime in `public/editors/common.js` (autosave, versions, conflicts, live collaboration, presence, sharing, comments, templates). The shared editor bar is `views/partials/editor-bar.ejs`; it injects `window.__ACCESS__` and loads the collaboration module.
- Office exports live in `src/office.js`: documents → DOCX (`docx`), sheets → XLSX (`exceljs`), decks → PPTX (`pptxgenjs`). Local images in content (`/f/:id/raw` or data URLs) are embedded after an owner check by `resolveDocImage()` in `src/workspace.js`. Shared docs rewrite owned images to `/c/:slug/asset/:id`.
- The image library is `public/image-library.js` + `src/images.js`: lists `/api/files`, uploads through `/api/upload`, and searches keyless Wikimedia Commons through `/api/images/search` with a host-allowlisted `/api/images/proxy`. Documents and decks embed images; spreadsheets store per-sheet `images` and export them as XLSX drawings.
- Templates (built-in and user-saved) are in `src/templates.js` and the `templates` table.
- Migrations: `migrateSchema()` in `src/db.js` runs *before* `sequelize.sync()` and adds new columns to an existing `files` table via PRAGMA/ALTER. New tables come from `sync()`.
- Server-side formula evaluation for exports lives in `src/formula.js`; keep it in sync with the browser engine in `public/editors/sheet.js`.
- Editors rely on `window.__DOC__` injected per page and expose no globals beyond `window.Workspace`.
