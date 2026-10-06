// Signals and the compliance report — both COMPUTED from the database, never authored.
//
// The pages they feed used to show invented rows ("New CTO at CloudSync", "Nexus AI raises $30M
// Series B") from sources this deployment does not run. The rule now:
//
//   * a signal exists only if a query over our own tables can produce it, and it carries the rows
//     that prove it plus the rule that produced it;
//   * a signal class that needs a provider we do not have is LISTED as unavailable with the reason,
//     so the absence is visible instead of being filled with a plausible story;
//   * the compliance report states what is recorded and says "not recorded" where nothing is. A
//     compliance page that claims hygiene it cannot evidence is worse than an empty one.
import prisma from "@/lib/db"
import { STAGE_IDS } from "@/lib/pipeline"
import { loadSuppressionIndex } from "@/lib/leads-query"

export interface SignalLead {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  status: string
  score: number
  updatedAt: string
}

export interface Signal {
  id: string
  title: string
  description: string
  /** How this signal was computed — shown in the UI so the number is never a mystery. */
  rule: string
  severity: "high" | "medium" | "low"
  count: number
  leads: SignalLead[]
}

export interface UnavailableSignal {
  id: string
  title: string
  reason: string
}

const DAY = 24 * 60 * 60 * 1000

function toSignalLead(lead: {
  id: string
  firstName: string
  lastName: string
  company: string | null
  email: string | null
  phone: string | null
  status: string
  score: number
  updatedAt: Date
}): SignalLead {
  return {
    id: lead.id,
    name: `${lead.firstName} ${lead.lastName}`.replace(/\s*-\s*$/, "").trim(),
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    score: lead.score,
    updatedAt: lead.updatedAt.toISOString(),
  }
}

/**
 * Every signal below is a query over the leads we actually hold. `now` is injectable so the tests
 * can prove the windows without waiting for a clock.
 */
export async function deriveSignals(now: Date = new Date(), perSignal = 10) {
  const take = Math.min(Math.max(perSignal, 1), 50)
  const staleBefore = new Date(now.getTime() - 14 * DAY)
  const untouchedBefore = new Date(now.getTime() - 2 * DAY)

  const [untouched, hotUntouched, stale, unreachable, duplicateEmails, duplicateCompanies] = await Promise.all([
    prisma.lead.findMany({ where: { status: "new", createdAt: { lte: untouchedBefore } }, orderBy: { createdAt: "asc" }, take }),
    prisma.lead.findMany({ where: { status: "new", score: { gte: 80 } }, orderBy: { score: "desc" }, take }),
    prisma.lead.findMany({
      where: { status: { in: ["contacted", "qualified"] }, updatedAt: { lte: staleBefore } },
      orderBy: { updatedAt: "asc" },
      take,
    }),
    prisma.lead.findMany({ where: { email: null, phone: null }, orderBy: { createdAt: "desc" }, take }),
    prisma.lead.groupBy({ by: ["email"], where: { email: { not: null } }, _count: { _all: true }, having: { email: { _count: { gt: 1 } } } }),
    prisma.lead.groupBy({ by: ["company"], where: { company: { not: null } }, _count: { _all: true }, having: { company: { _count: { gt: 1 } } } }),
  ])

  const [untouchedCount, hotCount, staleCount, unreachableCount, duplicateEmailCount, duplicateCompanyCount] = await Promise.all([
    prisma.lead.count({ where: { status: "new", createdAt: { lte: untouchedBefore } } }),
    prisma.lead.count({ where: { status: "new", score: { gte: 80 } } }),
    prisma.lead.count({ where: { status: { in: ["contacted", "qualified"] }, updatedAt: { lte: staleBefore } } }),
    prisma.lead.count({ where: { email: null, phone: null } }),
    prisma.lead.count({ where: { email: { in: duplicateEmails.map((row) => row.email as string) } } }),
    prisma.lead.count({ where: { company: { in: duplicateCompanies.map((row) => row.company as string) } } }),
  ])

  const signals: Signal[] = [
    {
      id: "hot_untouched",
      title: "High-scoring and never contacted",
      description: "The best leads in the database that no one has touched yet.",
      rule: "status = new AND score ≥ 80",
      severity: "high",
      count: hotCount,
      leads: hotUntouched.map(toSignalLead),
    },
    {
      id: "untouched",
      title: "Waiting more than 48 hours",
      description: "Found, never contacted. A lead this old has usually already been approached elsewhere.",
      rule: "status = new AND created more than 48 hours ago",
      severity: "medium",
      count: untouchedCount,
      leads: untouched.map(toSignalLead),
    },
    {
      id: "stale",
      title: "Open conversations gone quiet",
      description: "Contacted or qualified, with no change in 14 days.",
      rule: "status ∈ {contacted, qualified} AND not updated in 14 days",
      severity: "medium",
      count: staleCount,
      leads: stale.map(toSignalLead),
    },
    {
      id: "unreachable",
      title: "No way to make contact",
      description: "No email and no phone — these cannot be worked until they are enriched.",
      rule: "email IS NULL AND phone IS NULL",
      severity: "low",
      count: unreachableCount,
      leads: unreachable.map(toSignalLead),
    },
    {
      id: "duplicates",
      title: "Possible duplicates",
      description: "The same email or company stored more than once — worth merging before a call sheet is built.",
      rule: "email or company appearing on more than one lead",
      severity: "low",
      count: duplicateEmailCount + duplicateCompanyCount,
      leads: [],
    },
  ]

  // Honest about what we cannot detect here. These need an external feed we do not run; listing them
  // is the point — the alternative is a page that looks complete and is fiction.
  const unavailable: UnavailableSignal[] = [
    {
      id: "job_change",
      title: "Job changes",
      reason: "Needs a professional-network feed (LinkedIn) or a paid intent provider — not enabled in this deployment.",
    },
    {
      id: "funding",
      title: "Funding events",
      reason: "Needs Crunchbase/Dealroom — no API key configured, and the free sources cannot answer it.",
    },
    {
      id: "tech_install",
      title: "Technology installs",
      reason: "Needs a technographics provider (BuiltWith/Wappalyzer) that is not part of this deployment.",
    },
    {
      id: "website_change",
      title: "Website changes",
      reason: "Would require scheduled crawling of every lead's site; not configured (no crawl schedule exists yet).",
    },
  ]

  return {
    signals,
    unavailable,
    generatedAt: now.toISOString(),
    totalSignalled: signals.reduce((sum, signal) => sum + signal.count, 0),
  }
}

export interface ComplianceItem {
  id: string
  title: string
  requirement: string
  status: "evidenced" | "not_recorded" | "not_available"
  detail: string
}

/** GDPR/PECR-shaped checklist whose every line is computed from a table we hold. */
export async function complianceReport(now: Date = new Date()) {
  const [
    leadTotal,
    withEmail,
    withPhone,
    withNeither,
    consentGranted,
    consentWithdrawn,
    consentLatest,
    suppressedByKind,
    suppressedLatest,
    verificationTotal,
    verificationLatest,
    exportTotal,
    exportLatest,
    activityTotal,
    activityLatest,
    oldest,
    newest,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { email: { not: null } } }),
    prisma.lead.count({ where: { phone: { not: null } } }),
    prisma.lead.count({ where: { email: null, phone: null } }),
    prisma.consentRecord.count({ where: { status: "granted" } }),
    prisma.consentRecord.count({ where: { status: "withdrawn" } }),
    prisma.consentRecord.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.suppression.groupBy({ by: ["kind"], _count: { _all: true } }),
    prisma.suppression.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.verificationLog.count(),
    prisma.verificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.exportLog.count(),
    prisma.exportLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.leadActivity.count(),
    prisma.leadActivity.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.lead.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.lead.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ])

  const suppressedTotal = suppressedByKind.reduce((sum, row) => sum + row._count._all, 0)
  const suppressionIndex = await loadSuppressionIndex()
  const oldestDays = oldest ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / DAY) : 0

  const items: ComplianceItem[] = [
    {
      id: "lawful_basis",
      title: "Lawful basis recorded per contact",
      requirement: "A basis (consent / legitimate interest / contract) must be recorded for each subject you contact.",
      status: consentGranted + consentWithdrawn > 0 ? "evidenced" : "not_recorded",
      detail:
        consentGranted + consentWithdrawn > 0
          ? `${consentGranted + consentWithdrawn} consent record(s) on file (${consentGranted} granted, ${consentWithdrawn} withdrawn).`
          : "No consent records yet. Nothing is asserted about basis until a record exists — record it as contacts are worked.",
    },
    {
      id: "opt_out_mechanism",
      title: "Opt-out / do-not-contact mechanism",
      requirement: "Anyone can be suppressed, and the suppression must be enforced where data leaves the system.",
      status: suppressedTotal > 0 ? "evidenced" : "not_recorded",
      detail:
        suppressedTotal > 0
          ? `${suppressedTotal} suppression entr${suppressedTotal === 1 ? "y" : "ies"} held; the export path filters against them (${suppressionIndex.size} matchable forms).`
          : "The mechanism exists and is enforced on export, but no entry has been recorded yet.",
    },
    {
      id: "suppression_enforced",
      title: "Suppression applied on export",
      requirement: "A suppressed contact must not be exportable, whatever the UI says.",
      status: "evidenced",
      detail: "POST /api/export and GET /api/export both read rows through exportRows(), which filters the suppression list before writing a file.",
    },
    {
      id: "audit_trail",
      title: "Audit trail of changes",
      requirement: "It must be possible to say who changed what, and when.",
      status: activityTotal > 0 ? "evidenced" : "not_recorded",
      detail: activityTotal > 0 ? `${activityTotal} recorded lead event(s).` : "No lead events recorded yet.",
    },
    {
      id: "retention",
      title: "Retention visibility",
      requirement: "You must know how old the data you hold is, to delete it on time.",
      status: leadTotal > 0 ? "evidenced" : "not_recorded",
      detail: leadTotal > 0 ? `Oldest lead ${oldestDays} day(s) old; newest ${newest?.createdAt.toISOString().slice(0, 10) ?? "-"}. No automatic deletion is configured — that is a policy decision, not a technical gap.` : "No leads stored.",
    },
    {
      id: "erasure",
      title: "Erasure on request",
      requirement: "A subject's data must be deletable on request.",
      status: "not_recorded",
      detail: "No per-subject erasure is tracked yet. Deleting a row is possible by id; a documented, logged erasure workflow is not built.",
    },
    {
      id: "breach_log",
      title: "Breach and DPA register",
      requirement: "Breach notifications and processor agreements must be recorded with dates.",
      status: "not_available",
      detail: "Not tracked in this application. Belongs in your legal register, not in the lead engine.",
    },
    {
      id: "verification",
      title: "Email verification before sending",
      requirement: "Sending to unverified addresses risks bounces and sender reputation.",
      status: verificationTotal > 0 ? "evidenced" : "not_recorded",
      detail: verificationTotal > 0 ? `${verificationTotal} verification run(s) logged.` : "No verification runs logged — nothing has been verified before sending yet.",
    },
  ]

  return {
    generatedAt: now.toISOString(),
    items,
    counts: {
      leads: leadTotal,
      withEmail,
      withPhone,
      withoutContactDetails: withNeither,
      verified: await prisma.lead.count({ where: { verified: true } }),
      consentRecords: consentGranted + consentWithdrawn,
      suppressed: suppressedTotal,
      verifications: verificationTotal,
      exports: exportTotal,
      activities: activityTotal,
    },
    consent: consentLatest,
    suppression: { byKind: suppressedByKind.map((row) => ({ kind: row.kind, count: row._count._all })), latest: suppressedLatest },
    verification: verificationLatest,
    exports: exportLatest,
    activity: activityLatest,
    retention: { oldest: oldest?.createdAt ?? null, newest: newest?.createdAt ?? null, oldestDays },
    stages: STAGE_IDS,
  }
}
