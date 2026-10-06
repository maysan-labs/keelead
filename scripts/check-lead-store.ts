// Behaviour check for persistence: the same business must not be stored twice.
//
//   npx tsx scripts/check-lead-store.ts
//
// This runs against a throwaway SQLite file (never the volume), and it exists because the duplicate
// check compared the empty string against rows written with the "-" sentinel, so every re-run of
// the same search inserted the same clinics again — 44 rows for 25 real businesses.
import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"

const DB_FILE = process.env.CHECK_DB || "/opt/data/cache/scratch/keelead-store-check.db"
if (!DB_FILE.includes("cache/scratch")) {
  console.error(`refusing to run the store check against ${DB_FILE} — it must be a scratch database`)
  process.exit(1)
}
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const file = `${DB_FILE}${suffix}`
  if (existsSync(file)) rmSync(file)
}
process.env.DATABASE_URL = `file:${DB_FILE}`

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`}`)
}

const clinic = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Rajendra Clinic",
  lastName: "",
  company: "Rajendra Clinic",
  phone: "2224150000",
  location: "Wadala, Mumbai Suburban District, Maharashtra",
  source: "OpenStreetMap",
  confidence: 0.9,
  metadata: { source: "OpenStreetMap", osmId: 999001, match: "attested", businessType: "Clinic" },
  ...overrides,
})

async function main() {
  execFileSync(path.join(process.cwd(), "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
    env: process.env,
    stdio: "ignore",
  })

  const { saveLeads } = await import("@/lib/leads-store")
  const prisma = (await import("@/lib/db")).default

  // A clinic the engine found for a Mumbai query.
  const first = await saveLeads([clinic()] as never, "healthcare clinics in Mumbai")
  check("first run inserts the clinic", [first.inserted, first.skipped], [1, 0])

  // The same search run again, with the whitespace a live source actually returns.
  const second = await saveLeads([clinic({ firstName: " Rajendra Clinic ", company: "Rajendra Clinic" })] as never, "healthcare clinics in Mumbai")
  check("re-running the same search inserts nothing", [second.inserted, second.skipped], [0, 1])

  // The same business twice inside ONE response (an OSM node and a way).
  const doubled = await saveLeads([clinic(), clinic({ phone: "2224150001" })] as never, "healthcare clinics in Mumbai")
  check("a doubled record is inserted once", [doubled.inserted, doubled.skipped], [0, 2])

  // An unrelated record must still be rejected by the gate before it is written (defence in depth).
  const junk = await saveLeads(
    [{ firstName: "bing.com", lastName: "", company: "bing.com", website: "https://www.bing.com/search?q=healthcare+clinics+in+mumbai", source: "Web Search", confidence: 0.6, metadata: { query: "healthcare clinics in Mumbai", via: "bing-html" } }] as never,
    "healthcare clinics in Mumbai"
  )
  check("the gate still rejects a SERP row", [junk.inserted, junk.filtered], [0, 1])

  const rows = await prisma.lead.findMany()
  check("exactly one row exists", rows.length, 1)
  const stored = JSON.parse(String(rows[0]?.metadata || "{}"))
  check("the source's own id survives persistence", stored.osmId, 999001)
  check("the row records the query that found it", stored.query, "healthcare clinics in Mumbai")

  await prisma.$disconnect()
  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("store check crashed:", error)
  process.exit(1)
})
