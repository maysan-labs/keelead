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
| OpenStreetMap (`openstreetmap`) | **local businesses by type + place** — Overpass + Nominatim, no key. Real names, addresses, phones, websites. |
| Web Search (`web`) | **general web results** — Brave API when a key is set, else the Brave results page, else Bing. Company-shaped leads from real search hits. |
| GitHub (`github`, `github-orgs`) | users and organisations, public API |
| DuckDuckGo (`duckduckgo`) | DuckDuckGo instant answers (entity questions only) |
| Stack Overflow (`stackoverflow`) | developer profiles |
| Dev.to (`devto`) | developer authors — single-word TAG queries only |
| ORCID (`orcid`) | researchers and research organisations |
| Google Scholar (`google-scholar`) | academics |

`wikidata`, `sec-edgar` and `opencorporates` stay enabled for company research/enrichment.
Everything else is disabled in both the engine and the shared registry, so the UI cannot present a
generator as an active source.

**Re-run the probe after any upstream upgrade** before trusting a source list again, and never
enable a source that invents its results: a call sheet full of non-existent people wastes the
sales rep's day and burns sender reputation.

## Routing and the relevance gate — why a query no longer returns nonsense

Being real is not enough. A source must also be able to answer the question asked, so the engine
plans the query before it searches (`lib/lead-engine/query.ts`) and gates what comes back
(`lib/lead-engine/relevance.ts`).

**What went wrong without this** (observed live): `healthcare clinics in Mumbai` was sent to every
enabled source. DuckDuckGo, GitHub, GitHub Orgs, Stack Overflow, OpenCorporates and SEC EDGAR
returned nothing; Dev.to returned **three unrelated developers** (its tag lookup missed, and the
code then fell back to `top=7` — "most popular articles this week" — ignoring the query entirely);
Google Scholar returned a 2021 paper and ORCID a random researcher. Five of those were stored as
leads at score 70, and the panel's Settings → Data Sources tab listed 57 sources as enabled when 7
were.

The rules now:

* **The query is classified** — `local` / `developer` / `academic` / `company` / `web` — and only
  the sources for that class are called at all. A local-business query never reaches Dev.to.
* **A source that cannot match the query returns nothing.** Dev.to searches a real tag or nothing;
  no source may substitute "popular stuff" for the query.
* **Every lead passes the relevance gate** before it is returned or written. A lead passes when the
  source attested the match itself (Overpass matched the business type inside the requested place —
  so a clinic called "SK Wheels" is legitimate) or when a content keyword of the query (and, for
  local queries, the place) appears in the record. The gate runs **twice**: in the engine, and again
  in `lib/leads-store.ts` before the INSERT.
* **An empty result explains itself.** The chat answer lists the routing decision ("Clinic is a
  business-directory lookup, so OpenStreetMap is queried for Mumbai"), the sources queried, and how
  many rows the gate discarded. Nothing returns a confident-looking table of the wrong people.
* **`/api/sources` is answered from the registry**, so the UI can no longer advertise sources that
  do not run; the Settings tab is read-only and shows the live Active/Off state plus the routing
  table computed by the real planner.

Business-type coverage in `lib/sources/local/openstreetmap.ts` is a phrase table matched on **word
boundaries, longest phrase first** — the upstream substring matcher resolved "healthcare clinics"
through the key `car` ("care" contains "car") and returned car showrooms for a clinic search.

## The web source is a chain, and it fails closed

`lib/sources/search/web.ts`: Brave API (if `BRAVE_SEARCH_API_KEY` is set) → Brave results page
(HTML) → Bing results page (HTML). Brave rate-limits by IP with HTTP 429 after a burst, so requests
are paced (≥2 s apart) and one retry is allowed; Bing localises to the server's region, which is why
it is last. If every provider refuses, the source returns `[]` — it never invents a record. Every
lead records which path produced it in `metadata.via`.

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
