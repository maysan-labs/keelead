# KeeLead on Dokploy — how this fork actually runs

Maysan Labs runs **KeeLead** (upstream `Atum246/keelead`, MIT) as an internal lead-generation
tool. This file is the operator's note: what was changed and why, how it is deployed, how to
verify it, and what is still missing.

## Shape

```
browser -> Traefik -> auth-proxy (nginx + HTTP Basic) -> keelead (Next.js 14 + SQLite on a volume)
```

* Dokploy: project **Maysan ecosytem** / environment *production*, compose **keelead**,
  `sourceType: github` -> `maysan-labs/keelead` @ `main`, `composePath: ./dokploy-compose.yml`.
* Domain `keelead.maysanlabs.com` points at the **auth-proxy** service (port 8080), never at the app.
* SQLite lives on the named volume `keelead_data` at `/app/data/keelead.db`. The schema stays in
  the image at `/app/prisma`; the entrypoint runs `prisma db push` on every start.

## The app has no authentication of its own

Upstream ships no login (multi-user auth is on its roadmap) and a self-hosted lead database is
not something to publish unauthenticated, so the credentials gate lives in front of the app
rather than inside it — `proxy/` (nginx + `openssl passwd`), credentials supplied as runtime env
vars `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` from the Dokploy env block.

They are declared `${BASIC_AUTH_PASSWORD:?...}` in the compose **on purpose**: if the variable is
ever missing the deploy fails loudly instead of publishing an open dashboard.

Rotating the password = change the env var, redeploy. Nothing is baked into an image layer, and
the htpasswd file is regenerated at container start.

`/healthz` is exempt from auth and proxies to the app's `/api/health` (app + database status) so
the deployment can be monitored without storing the password in a watchdog.

## Upstream defects this fork fixes (all were blocking)

| Defect | Consequence | Fix |
|---|---|---|
| `next.config.js` had no `output: 'standalone'` while the Dockerfile copies `.next/standalone` | the image could not build at all | `output: 'standalone'` |
| Prisma datasource hardcoded `file:./keelead.db` | `DATABASE_URL` (README, `.env.example`, upstream compose) was a **no-op**; the DB was written inside the image and lost on every recreate | `url = env("DATABASE_URL")` |
| `lib/sources/local/openstreetmap.ts:240` left a template literal unclosed (`);` instead of a backtick) | syntax error; `tsc`/`next build` could not type-check | closed the literal |
| `lib/browser/index.ts:50` called `|| ''` on a `Promise` | type error, build aborted | `await` inside the map |
| `searchWithGeo` referenced an undefined `options` | type error | threaded `options` through |
| `playwright` was absent from `package-lock.json` | `npm ci` could never succeed (upstream fell back to `npm install`) | lockfile resynced |
| Next's build trace drops `playwright`/`playwright-core` from the standalone bundle | browser-backed sources would fail with `Cannot find module 'playwright'` at runtime | the Dockerfile copies both into the runtime image and installs Chromium with the matching version |

The base image is Debian (not Alpine) on purpose: a Prisma engine generated on musl cannot run on
glibc, so builder and runtime must share a libc.

## Verify a deployment

```sh
# app + database, unauthenticated by design
curl -sS https://keelead.maysanlabs.com/healthz
# -> {"status":"ok","db":"ok","app":"keelead","built_at":"2026-..."}

# the gate: no credentials must NOT return the app
curl -sS -o /dev/null -w '%{http_code}\n' https://keelead.maysanlabs.com/          # -> 401
curl -sS -o /dev/null -w '%{http_code}\n' -u "$USER:$PASS" https://keelead.maysanlabs.com/   # -> 200
```

`built_at` is baked into the image at build time, so it proves a deploy actually replaced the
running image rather than merely reporting `done`.

## Known gaps

* The AI chat route does not call a provider yet — it answers from a canned intent parser. The
  provider env vars (`CUSTOM_AI_*` etc.) are declared and wired for when that path lands.
* Several data sources are placeholder implementations upstream; expect empty results from some.
* No seed data is loaded in production (`npm run db:seed`) — the dashboard starts empty.
* Credentials are single-user HTTP Basic. Replace with real per-user auth if this is ever exposed
  beyond Maysan Labs.
