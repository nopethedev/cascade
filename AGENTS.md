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
- Persistence: Sequelize + SQLite (`src/db.js`, default `data/cascade.sqlite`). Models: `User`, `FileRecord`, `NodeRecord`, `ApiKeyRecord`, `AnalyticsEvent`, `Setting`. Settings are a singleton row read through `getSettings()` / written with `saveSettings()`.
- Blobs stay on disk in `data/uploads/` or on storage nodes — never in SQL.
- `SERVER_MODE=main|node` selects the role; `docker-compose.yml` has a single service.
- API keys (`src/apiKeys.js`) are hashed; requests authenticate with `x-api-key` or `Authorization: Bearer`. `req.user` is set for both sessions and keys.
- Analytics events are written by `recordEvent()` (`src/analytics.js`) and never block a response.
- User-facing docs live at `/docs` (`views/docs.ejs`); keep it current when routes or env vars change.

## Workspace suite

- `/create`, `/edit/:id`, `/api/workspace/*`, `/export/:id`, `/forms/:slug`, `/responses/:id` and `/search` live in `src/workspace.js` (mounted from `src/server.js`).
- Workspace documents are rows in the existing `files` table with `kind` (`doc|sheet|deck|board|form|code`), JSON `content`, and a `version` counter. Blobs/uploads keep `kind = 'file'`.
- Each editor is its own view (`views/editors/*.ejs`) + engine (`public/editors/*.js`) over the shared runtime in `public/editors/common.js` (autosave, versions, conflicts, presence, sharing, templates).
- Templates (built-in and user-saved) are in `src/templates.js` and the `templates` table.
- Migrations: `migrateSchema()` in `src/db.js` runs *before* `sequelize.sync()` and adds new columns to an existing `files` table via PRAGMA/ALTER. New tables come from `sync()`.
- Server-side formula evaluation for exports lives in `src/formula.js`; keep it in sync with the browser engine in `public/editors/sheet.js`.
- Editors rely on `window.__DOC__` injected per page and expose no globals beyond `window.Workspace`.
