# CD Tracker

Cloudflare Pages (static `public/` + Pages Function in `functions/api`) with a Neon Postgres database.

## Setup
1. **Neon**: create a project, open the SQL editor, run `schema.sql`, copy the connection string.
2. **GitHub**: push this folder to a new repo.
3. **Cloudflare Pages**: Workers & Pages > Create > Pages > connect the repo. Build command: leave empty. Build output directory: `public`.
4. In the Pages project: Settings > Variables and Secrets, add `DATABASE_URL` (the Neon string) as a secret, then redeploy.
5. Every commit to the connected branch now triggers a build and deploy.

## iPhone
Open the site in Safari, then Share > Add to Home Screen. Camera scanning needs the site served over HTTPS (Pages does this).

## Local dev
`npm install`, put `DATABASE_URL=...` in `.dev.vars`, run `npx wrangler pages dev public`.
