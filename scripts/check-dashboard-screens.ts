// Static guard over the dashboard screens — the regression net for the fabrication that was removed.
//
//   npm run check:screens
//
// Three things this asserts, all of which were true of this codebase at some point:
//   1. no screen holds an authored data array (demoCampaigns / demoLeads / mockStats …) — the shape
//      that let a page look complete while showing people who do not exist;
//   2. no screen mentions the retired demo identities or the sources this deployment cannot reach;
//   3. every /api/… path a screen fetches resolves to a route that exists, so a page cannot be
//      written against an endpoint nobody implemented (the signals screen shipped against a GET that
//      only had a POST, and fetched bread for a week).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const DASHBOARD = path.join(ROOT, "app/dashboard")

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`}`)
}

function pageFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...pageFiles(full))
    else if (entry === "page.tsx" || entry === "page.ts") out.push(full)
  }
  return out
}

/** app/api/leads/[id]/route.ts style lookup for a path the browser fetches. */
function routeExists(apiPath: string): boolean {
  const cleaned = apiPath.split("?")[0].replace(/\/+$/, "")
  const segments = cleaned.split("/").filter(Boolean) // ["api","leads","{id}"]
  const rest = segments.slice(1) // drop "api"
  const candidates: string[] = []
  // /api/leads/{id} -> app/api/leads/[id]/route.ts, and the literal form /api/leads
  const dynamic = rest.map((segment) => (/^\{|\$\{|:\w/.test(segment) ? "[id]" : segment))
  candidates.push(path.join(ROOT, "app/api", ...dynamic, "route.ts"))
  candidates.push(path.join(ROOT, "app/api", ...dynamic.slice(0, -1), "route.ts"))
  candidates.push(path.join(ROOT, "app/api", ...dynamic, "route.tsx"))
  return candidates.some((candidate) => existsSync(candidate))
}

const pages = pageFiles(DASHBOARD)
check("the dashboard has screens to check", pages.length > 5, true)

const AUTHORED_ARRAY = /const\s+(demo|mock|sample|fake|initial|hardcoded)[A-Za-z]*\s*(?::[^=\n]*)?=\s*\[/g
const RETIRED_FICTION =
  /cloudsync|techcorp|innovatelab|nexus ai|sarah@|james@techcorp|emily@|lisa@|Q4 SaaS Outreach|Enterprise Decision Makers|Startup Founders NYC|Tech Conference Follow-up|Alex Rivera/gi

const offenders: string[] = []
const fiction: string[] = []
const missingRoutes: string[] = []

for (const file of pages) {
  const rel = path.relative(ROOT, file)
  const source = readFileSync(file, "utf8")

  for (const match of source.matchAll(AUTHORED_ARRAY)) offenders.push(`${rel}: ${match[0].trim()}`)
  for (const match of source.matchAll(RETIRED_FICTION)) fiction.push(`${rel}: ${match[0]}`)

  // only literal or template-prefix targets; a bare variable is not resolvable statically
  for (const match of source.matchAll(/["'`](\/api\/[^"'`\s)`,]*)/g)) {
    const target = match[1]
    if (target.includes("${") && !target.includes("?") && target.endsWith("/")) continue
    if (!routeExists(target.replace(/\$\{[^}]*\}/g, "{id}"))) missingRoutes.push(`${rel}: ${target}`)
  }
}

check("no screen holds an authored data array", offenders, [])
check("no screen names a retired demo identity or an unreachable source", fiction, [])
check("every /api path a screen fetches has a route", missingRoutes, [])

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
