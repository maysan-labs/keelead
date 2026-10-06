// Behaviour checks for the dashboard data layer, the pipeline state machine, the audit trail, the
// signals, the compliance report and the suppression-enforced export path.
//
//   npm run check:dashboard
//
// Runs against a throwaway SQLite file (never the volume). The point of this file: every number the
// dashboard shows must be reproducible from the database, and every write path must leave a trail.
import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"

const DB_FILE = process.env.CHECK_DB || "/opt/data/cache/scratch/keelead-dashboard-check.db"
if (!DB_FILE.includes("cache/scratch")) {
  console.error(`refusing to run against ${DB_FILE} — it must be a scratch database`)
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

const DAY = 24 * 60 * 60 * 1000

async function main() {
  execFileSync(path.join(process.cwd(), "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
    env: process.env,
    stdio: "ignore",
  })

  const prisma = (await import("@/lib/db")).default
  const { pipelineBoard, moveLead, getLeadWithActivity, exportRows, isSuppressed, loadSuppressionIndex } = await import("@/lib/leads-query")
  const { deriveSignals, complianceReport } = await import("@/lib/insights")

  const now = new Date("2026-10-06T12:00:00Z")

  // ---------------------------------------------------------------- empty database is honest
  const emptyBoard = await pipelineBoard()
  check("empty board: every stage zero", emptyBoard.stages.map((s) => s.count), [0, 0, 0, 0, 0])
  check("empty board: no leads rendered", emptyBoard.stages.every((s) => s.leads.length === 0), true)
  check("empty board: no unmapped rows", [emptyBoard.unmappedCount, emptyBoard.unmapped.length], [0, 0])

  const emptySignals = await deriveSignals(now)
  check("empty database yields no signals", emptySignals.signals.map((s) => s.count), [0, 0, 0, 0, 0])
  check("signals still explain what needs a provider", emptySignals.unavailable.length >= 3, true)

  const emptyReport = await complianceReport(now)
  check("empty database: nothing claimed as evidenced except the enforced export rule", emptyReport.items.filter((i) => i.status === "evidenced").map((i) => i.id), ["suppression_enforced"])
  check("empty report counts", [emptyReport.counts.leads, emptyReport.counts.suppressed, emptyReport.counts.activities], [0, 0, 0])

  // ---------------------------------------------------------------- seed real rows
  const hot = await prisma.lead.create({
    data: { firstName: "Arete Clinics", lastName: "-", company: "Arete Clinics", email: "areteclinics@gmail.com", phone: "+912241615350", status: "new", score: 95, source: "OpenStreetMap", createdAt: new Date(now.getTime() - 3 * DAY) },
  })
  const contacted = await prisma.lead.create({
    data: { firstName: "Mahavir Medical", lastName: "-", company: "Mahavir Medical Research Centre", email: "reception@mmrchospital.com", status: "contacted", score: 85, source: "OpenStreetMap", updatedAt: new Date(now.getTime() - 20 * DAY) },
  })
  const unreachable = await prisma.lead.create({
    data: { firstName: "Belle 32", lastName: "-", company: "Belle 32", status: "new", score: 60, source: "OpenStreetMap" },
  })
  const odd = await prisma.lead.create({
    data: { firstName: "Legacy Import", lastName: "-", company: "Legacy Import", status: "archived_somehow", score: 10 },
  })

  const board = await pipelineBoard()
  const counts = Object.fromEntries(board.stages.map((s) => [s.id, s.count]))
  check("board counts match the rows", [counts.new, counts.contacted, counts.qualified, counts.converted, counts.lost], [2, 1, 0, 0, 0])
  check("a row with an unknown status is surfaced, not folded into a column", [board.unmappedCount, board.unmapped[0]?.firstName], [1, "Legacy Import"])
  check("board orders a column by score", board.stages.find((s) => s.id === "new")?.leads.map((l) => l.score), [95, 60])

  // ---------------------------------------------------------------- the state machine
  const illegal = await moveLead({ id: hot.id, to: "qualified", actor: "test" })
  check("new -> qualified is refused", [illegal.ok, illegal.status], [false, 409])
  check("the refusal says what is allowed", /can only move to/i.test(illegal.error || ""), true)

  const same = await moveLead({ id: hot.id, to: "new" })
  check("moving to the same stage is refused", [same.ok, same.status], [false, 409])

  const legal = await moveLead({ id: hot.id, to: "contacted", actor: "sanjay", note: "first call booked" })
  check("new -> contacted succeeds", legal.ok, true)

  const withTrail = await getLeadWithActivity(hot.id)
  check("the move is recorded with from/to/actor/note", withTrail?.activities.slice(0, 1).map((a) => [a.type, a.fromValue, a.toValue, a.actor, a.detail]), [["status_change", "new", "contacted", "sanjay", "first call booked"]])
  check("the stored status is the new one", withTrail?.status, "contacted")

  const toLost = await moveLead({ id: hot.id, to: "lost" })
  const reopened = await moveLead({ id: hot.id, to: "contacted" })
  check("lost -> contacted is allowed (a lead can be reopened)", [toLost.ok, reopened.ok, reopened.status], [true, true, 200])

  // converted is terminal: revenue history is not rewritten by a status change.
  const toQualified = await moveLead({ id: hot.id, to: "qualified" })
  const toConverted = await moveLead({ id: hot.id, to: "converted" })
  const afterConverted = await moveLead({ id: hot.id, to: "lost" })
  check("contacted -> qualified -> converted", [toQualified.ok, toConverted.ok], [true, true])
  check("converted is terminal", [afterConverted.ok, afterConverted.status], [false, 409])
  check("the closed-stage refusal says why", /closed stage/i.test(afterConverted.error || ""), true)

  // ---------------------------------------------------------------- audit trail on delete
  await prisma.leadActivity.create({ data: { leadId: unreachable.id, type: "note", detail: "temp" } })
  await prisma.lead.delete({ where: { id: unreachable.id } })
  check("deleting a lead removes its trail (no orphans)", await prisma.leadActivity.count({ where: { leadId: unreachable.id } }), 0)

  // ---------------------------------------------------------------- signals are real
  // (a fresh lead: the state-machine section above moved the first one out of "new")
  const hotUnworked = await prisma.lead.create({
    data: { firstName: "Sparkle Dental Care", lastName: "-", company: "Sparkle Dental Care", email: "kayannush@sparkledentalcare.co.in", status: "new", score: 92, source: "OpenStreetMap", createdAt: new Date(now.getTime() - 3 * DAY) },
  })

  const signals = await deriveSignals(now)
  const byId = Object.fromEntries(signals.signals.map((s) => [s.id, s]))
  check("hot_untouched finds the high score lead", [byId.hot_untouched.count, byId.hot_untouched.leads[0]?.name], [1, "Sparkle Dental Care"])
  check("stale finds the lead untouched for 20 days", [byId.stale.count, byId.stale.leads[0]?.company], [1, "Mahavir Medical Research Centre"])
  check("unreachable counts every row with no way to make contact", [byId.unreachable.count, byId.unreachable.leads[0]?.name], [1, "Legacy Import"])
  check("each signal carries the rule that produced it", byId.stale.rule.includes("14 days"), true)

  // ---------------------------------------------------------------- suppression is enforced on export
  // Derived, not hardcoded: the check must survive another seeded row being added above.
  const storedRows = await prisma.lead.count()
  const before = await exportRows()
  check("export sees every stored row while nothing is suppressed", [before.exported, before.suppressed], [storedRows, 0])

  const suppressionPost = await (await import("@/app/api/compliance/suppression/route")).POST(
    new Request("http://localhost/api/compliance/suppression", {
      method: "POST",
      body: JSON.stringify({ value: "areteclinics@gmail.com", kind: "email", reason: "opted_out" }),
    }) as never
  )
  check("suppression can be recorded through the API", suppressionPost.status, 200)

  const after = await exportRows()
  check("a suppressed contact is excluded from the export", [after.exported, after.suppressed, after.totalInDatabase], [storedRows - 1, 1, storedRows])
  check("the excluded address is not in the rows", after.rows.some((r) => r.email === "areteclinics@gmail.com"), false)

  const index = await loadSuppressionIndex()
  check("a phone matches on its last 10 digits", isSuppressed({ phone: "+91 22 4161 5350" }, new Set(["2241615350"])), true)
  check("an email domain suppresses the whole domain", isSuppressed({ email: "someone@mmrchospital.com" }, new Set(["mmrchospital.com"])), true)
  check("an unrelated contact is not suppressed", isSuppressed({ email: "ok@example.com", phone: "+911112223334" }, index), false)

  const suppressionDelete = await (await import("@/app/api/compliance/suppression/route")).DELETE(
    new Request("http://localhost/api/compliance/suppression?value=areteclinics@gmail.com") as never
  )
  check("a suppression can be removed", suppressionDelete.status, 200)
  check("removing it restores the row to the export", (await exportRows()).exported, storedRows)

  // ---------------------------------------------------------------- compliance reflects the tables
  const consent = await (await import("@/app/api/compliance/route")).POST(
    new Request("http://localhost/api/compliance", {
      method: "POST",
      body: JSON.stringify({ subject: "reception@mmrchospital.com", channel: "email", status: "withdrawn", evidence: "email reply 2026-10-06" }),
    }) as never
  )
  check("a withdrawal can be recorded through the API", consent.status, 200)
  check("a withdrawal without a body is a 400, not a silent success", (await (await import("@/app/api/compliance/route")).POST(new Request("http://localhost/api/compliance", { method: "POST", body: JSON.stringify({}) }) as never)).status, 400)

  const report = await complianceReport(now)
  const item = (id: string) => report.items.find((i) => i.id === id)
  check("a withdrawal suppresses the contact immediately", isSuppressed({ email: "reception@mmrchospital.com" }, await loadSuppressionIndex()), true)
  check("the withdrawal is written on every matching lead's trail", (await prisma.leadActivity.count({ where: { leadId: contacted.id, type: "consent" } })) > 0, true)
  check("lawful basis is evidenced once a record exists", item("lawful_basis")?.status, "evidenced")
  check("opt-out is evidenced once an entry exists", item("opt_out_mechanism")?.status, "evidenced")
  check("the report still refuses to claim an erasure workflow", item("erasure")?.status, "not_recorded")
  check("report counts agree with the tables", [report.counts.leads, report.counts.consentRecords, report.counts.activities > 0], [storedRows, 1, true])

  // ---------------------------------------------------------------- export path via the route
  const csv = await (await import("@/app/api/export/route")).GET(new Request("http://localhost/api/export?format=csv") as never)
  const body = await csv.text()
  check("the CSV download itself excludes the suppressed address", body.includes("mmrchospital.com"), false)
  check("the CSV still contains the exportable rows", body.includes("Legacy Import"), true)

  await prisma.$disconnect()
  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("dashboard check crashed:", error)
  process.exit(1)
})
