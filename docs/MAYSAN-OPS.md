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

## Where the numbers come from (and what used to be fake)

The upstream dashboard rendered `value: "12,847"`, a made-up activity feed ("Sarah Chen —
CloudSync") and invented source bars as literals in the React components, and `/api/analytics`
returned a second copy of the same fiction. `/api/export` claimed `count = 12847` and served a
two-row sample CSV. This fork replaces all of it with counts over the real tables:

* `lib/stats.ts` — totals, week-over-week trends, top sources, a 12-month series and the
  activity feed, all from Prisma counts.
* `GET /api/stats` — the dashboard summary (also what the Hermes client reads).
* `GET /api/analytics` — campaign overview, source performance, conversion funnel.
* `POST /api/leads` — runs the sources **and persists what they return** (dedupe on email, then
  name+company; an existing row is never overwritten) and logs the search in `SearchLog`.
* `GET /api/leads` — lists stored leads with `limit` / `offset` / `status` / `source` / `q`.
* `GET /api/export?format=csv|json` — exports the stored rows (no more sample CSV).

A fresh install reports zeros. That is the point: the numbers move only when something real
happens. All of these routes are `force-dynamic` so Next can never prerender them at build time
(which would bake in zeros from a database that does not exist in the builder stage).

## Data sources: most of this repo fabricates people

`GET /api/sources/probe?q=<query>&count=N` asks all 67 registered sources for leads and reports
which ones actually return data. On this deployment **29 of them returned synthetic records** with
the same fingerprint — a random first/last name, `contact0@<domain>`, a generated phone number,
`confidence: 0.5 + Math.random() * 0.4` — without contacting any real service: Bing, Brave, Xing,
AngelList, Crunchbase, Companies House, Glassdoor, Indeed, G2, Google Maps, Yelp, Foursquare,
Thumbtack, HomeAdvisor, Twitter/X, Facebook, Instagram, TikTok, YouTube, Pinterest, Product Hunt,
F6S, Gust, SAM.gov, Hunter.io, Clearbit, Eventbrite, Meetup, Luma. The engine's own built-in
"sources" (Web Search, LinkedIn, Google Maps, Crunchbase, Yelp, Yellow Pages, Product Hunt,
AngelList, Hunter) are the same kind of thing.

Only real integrations are wired in (`lib/lead-engine/index.ts`):

| Source | What it returns |
|---|---|
| GitHub (`github`, `github-orgs`) | users and organisations, public API |
| DuckDuckGo (`duckduckgo`) | web results |
| Stack Overflow (`stackoverflow`) | developer profiles |
| Dev.to (`devto`) | developer authors |
| ORCID (`orcid`) | researchers and research organisations |
| Google Scholar (`google-scholar`) | academics |

`wikidata`, `sec-edgar` and `opencorporates` stay enabled for company research/enrichment.
Everything else is disabled in both the engine and the shared registry, so the UI cannot present
a generator as an active source.

**Re-run the probe after any upstream upgrade** before trusting a source list again, and never
enable a source that invents its results: a call sheet full of non-existent people wastes the
sales rep's day and burns sender reputation.

## Operating it from Hermes

`/opt/data/bin/keelead.py` is the client; credentials come from
`/opt/data/state/keelead/creds.env` (mode 600) and are never printed.

```sh
keelead.py health                                     # /healthz
keelead.py stats                                      # live counts
keelead.py search "fintech companies in Pune" --count 25   # search + save
keelead.py leads --limit 50 --status new              # read the database
keelead.py export --format csv --out /tmp/leads.csv   # export
keelead.py sources --query "digital agency"           # which sources are real
```

## Known gaps

* The AI chat route still does not call a provider — it answers from the canned intent parser in
  `app/api/chat/route.ts`. `lib/ai/index.ts` defines the providers and `CUSTOM_AI_*` is wired to
  DeepSeek in the Dokploy env, but nothing constructs a provider yet, so the chat surface is
  rule-based until that path is implemented.
* Sends/opens/replies have no history table, so those metrics read 0 / "—" rather than a number.
  Adding campaign send + click tracking is the next real step.
* Key-gated aggregators (Apollo, Hunter, Clearbit) are not wired; result quality depends on the
  public sources above.
* Credentials are single-user HTTP Basic. Replace with per-user auth if this is ever exposed
  beyond Maysan Labs.
