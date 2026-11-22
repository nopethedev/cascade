# Cascade

Self-hosted file upload / view / edit + public share & CDN links, with **Main server + storage Nodes** and configurable **replication**.

Stack: **Express (ES Modules) + EJS + Tailwind-free hand-written CSS design system**. No external database — metadata in `data/db.json`, blobs in `data/uploads/`.

Theme: flat black surfaces, hairline rules and one red accent, fully customizable in **Admin → Appearance** (or `.env`: `THEME_ACCENT`, `THEME_BG`, `THEME_SURFACE`, `THEME_TEXT`, `SITE_NAME`).

## Features

- Upload (multi-file, drag & drop), view (images / video / audio inline), edit text files, rename, delete
- Share publicly: pretty page `/c/:slug` + raw CDN URL `/raw/:slug` (long cache headers)
- Roles: `admin` / `user`, per-user quota (GB)
- Admin panel: overview (users / files / bytes / nodes), create users, browse all files, manage nodes, replication, appearance
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

## Docker

One service, one switch — `SERVER_MODE` decides what it is:

```bash
# main server on :3000
docker compose up -d

# storage node on :3000 (set your own key and, if you like, another port)
SERVER_MODE=node NODE_ACCESS_KEY=my-secret-key CASCADE_PORT=3001 docker compose up -d
```

The image is pulled from GHCR (`ghcr.io/nopethedev/cascade:latest`, built by `.github/workflows/docker.yml`).
Add `--build` to build from source instead, or set `CASCADE_IMAGE` to use another tag. Data lives in the `cascade-data` volume.

> The node prints its auto-generated key on first boot when `NODE_ACCESS_KEY` is empty (also saved to `data/node-key.txt`).
> Add the node to the main server in **Admin → Nodes** with its URL and that key.

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

## Env

See `.env.example`. Main knobs: `PORT`, `SERVER_MODE`, `SESSION_SECRET`, `DB_PATH`, `STORAGE_DIR`, `SITE_NAME`, `THEME_*`, `NODE_ACCESS_KEY` (node mode), `HEALTHCHECK_INTERVAL_MS`.

## GitHub Actions

- `.github/workflows/build.yml` — installs, syntax-checks, boots the server and runs a setup + upload smoke test, then verifies the image builds (no push).
- `.github/workflows/docker.yml` — builds and pushes `ghcr.io/<owner>/<repo>` on pushes to `main` and `v*` tags (`latest` on the default branch). No secrets needed beyond the default `GITHUB_TOKEN`.
