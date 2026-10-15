# CD Tracker

Cloudflare Pages (static `public/` + Pages Function in `functions/api`) with a Neon Postgres database.

## Setup (Cloudflare Workers)
1. **Neon**: create a project, open the SQL editor, run `schema.sql`, copy the connection string.
2. **GitHub**: push this folder to the repo root (`wrangler.jsonc`, `src`, `public` at the top level).
3. In `wrangler.jsonc`, set `name` to the exact name of your Worker in Cloudflare (a mismatch fails the build).
4. Cloudflare dashboard > your Worker > Settings > Builds: connect the GitHub repo, deploy command `npx wrangler deploy`.
5. Worker > Settings > Variables and Secrets: add `DATABASE_URL` (the Neon string) as a **Secret**.
6. Every commit to the connected branch now builds and deploys.

Requests to `/api/*` run `src/index.js`; everything else is served from `public/`.

## iPhone
Open the site in Safari, then Share > Add to Home Screen. Camera scanning needs the site served over HTTPS (Pages does this).

## Local dev
`npm install`, put `DATABASE_URL=...` in `.dev.vars`, run `npx wrangler dev`.
