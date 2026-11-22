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
- One-shot config in `src/config.js`, JSON store in `data/db.json`, blobs in `data/uploads/`.
- `SERVER_MODE=main|node` selects the role; `docker-compose.yml` has a single service.
