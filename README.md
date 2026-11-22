# Cascade

Self-hosted file upload / view / edit + public share & CDN links, with **Main server + storage Nodes** and configurable **replication**.

Stack: **Express (ES Modules) + EJS + Tailwind (CDN) + CSS variables theme**. No external database — metadata in `data/db.json`, blobs in `data/uploads/`.

Theme: simple black with a red accent — fully customizable in **Admin → Appearance** (or `.env`: `THEME_ACCENT`, `THEME_BG`, `THEME_SURFACE`, `THEME_TEXT`, `SITE_NAME`).

## Features

- Upload (multi-file), view (images / video / audio inline), edit text files, rename, delete
- Share publicly: pretty page `/c/:slug` + raw CDN URL `/raw/:slug` (long cache headers)
- Roles: `admin` / `user`, per-user quota (GB)
- Admin panel: overview (users / files / bytes / nodes), create users, browse all files, manage nodes, replication, appearance
- First-run setup wizard creates the admin user
- `SERVER_MODE=main | node` in `.env`
- Replication modes: **all / select / single (1 only) / default (1 default node) / n copies with auto-heal**

## Quick start (local)

```bash
cp .env.example .env
npm install
npm start
# open http://localhost:3000 → setup wizard → create admin
```

## Docker Compose

```bash
docker compose up --build
# main on :3000 (data in cascade-main-data volume)
```

Run a storage node:

```bash
NODE_ACCESS_KEY=my-secret-key docker compose --profile node up --build cascade-node
# node on :3001. Main → Admin → Nodes → add URL http://cascade-node:3000 + key.
```

> The node prints its auto-generated key on first boot when `NODE_ACCESS_KEY` is empty (also saved to `data/node-key.txt`).

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
| Replicate to all | every enabled node gets a copy |
| Replicate to select nodes | only the checked nodes |
| 1 only (`single`) | exactly one copy, prefers local |
| 1 default node (`default`) | always the chosen node |
| Always N (`n`) | first N nodes (local first); health-checker re-copies to another healthy node when one goes down |

## Env

See `.env.example`. Main knobs: `PORT`, `SERVER_MODE`, `SESSION_SECRET`, `DB_PATH`, `STORAGE_DIR`, `SITE_NAME`, `THEME_*`, `NODE_ACCESS_KEY` (node mode), `HEALTHCHECK_INTERVAL_MS`.

## GitHub Action

`.github/workflows/docker.yml` builds the image on push to `main` / tags and pushes to GHCR (`ghcr.io/<owner>/<repo>`). No secrets needed beyond the default `GITHUB_TOKEN`.
