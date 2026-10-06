// The dashboard's data layer. Every page and API route reads through these functions, so the board,
// the signals, the compliance report and the exports cannot disagree about what is in the database.
//
// Rules this file exists to enforce:
//   * no caller composes its own Prisma query for the UI (they drift, and one of them will forget
//     the suppression list);
//   * a status change is validated against lib/pipeline and written together with its audit row in
//     one transaction — a move that succeeds but leaves no trace is worse than a refused move;
//   * nothing is invented: an empty database yields empty arrays and zero counts, never samples.
import type { Prisma } from "@prisma/client"
import prisma from "@/lib/db"
import { STAGE_IDS, STAGES, isStage, normaliseStage, transitionError, type LeadStage } from "@/lib/pipeline"

export interface LeadFilter {
  status?: string
  stage?: string
  source?: string
  q?: string
  minScore?: number
  campaignId?: string
}

export interface LeadListOptions extends LeadFilter {
  limit?: number
  offset?: number
  order?: "recent" | "score" | "company"
}

/** Clamp paging input: an unbounded limit is a memory problem, a negative offset a silent bug. */
export function clampPaging(limit: number | undefined, offset: number | undefined) {
  const take = Math.min(Math.max(Number.isFinite(limit) ? Number(limit) : 50, 1), 500)
  const skip = Math.max(Number.isFinite(offset) ? Number(offset) : 0, 0)
  return { take, skip }
}

export function buildWhere(filter: LeadFilter): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {}
  const status = (filter.status || filter.stage || "").trim()
  if (status) where.status = status
  if (filter.source) where.source = filter.source.trim()
  if (filter.campaignId) where.campaignId = filter.campaignId
  if (typeof filter.minScore === "number" && Number.isFinite(filter.minScore)) {
    where.score = { gte: filter.minScore }
  }
  const q = (filter.q || "").trim()
  if (q) {
    where.OR = [
      { email: { contains: q } },
      { phone: { contains: q } },
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { company: { contains: q } },
      { title: { contains: q } },
      { location: { contains: q } },
    ]
  }
  return where
}

export function orderByFor(order: LeadListOptions["order"]): Prisma.LeadOrderByWithRelationInput[] {
  if (order === "score") return [{ score: "desc" }, { createdAt: "desc" }]
  if (order === "company") return [{ company: "asc" }, { firstName: "asc" }]
  return [{ createdAt: "desc" }]
}

export async function listLeads(options: LeadListOptions) {
  const { take, skip } = clampPaging(options.limit, options.offset)
  const where = buildWhere(options)
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, orderBy: orderByFor(options.order), take, skip }),
  ])
  return { total, leads, limit: take, offset: skip }
}

export interface BoardStage {
  id: string
  name: string
  color: string
  description: string
  count: number
  leads: Awaited<ReturnType<typeof prisma.lead.findMany>>
}

/**
 * The board: one grouped count for every stage, then a bounded slice of the top leads per stage.
 * Six queries regardless of lead count — a board that fires one query per lead becomes unusable at
 * exactly the moment the pipeline starts working.
 */
export async function pipelineBoard(perStage = 25) {
  const take = Math.min(Math.max(perStage, 1), 100)

  const [grouped, unmappedCount] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.lead.count({ where: { status: { notIn: STAGE_IDS as unknown as string[] } } }),
  ])

  const counts = new Map<string, number>()
  for (const row of grouped) counts.set(row.status, row._count._all)

  const stages: BoardStage[] = []
  for (const stage of STAGES) {
    const leads = await prisma.lead.findMany({
      where: { status: stage.id },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take,
    })
    stages.push({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      description: stage.description,
      count: counts.get(stage.id) || 0,
      leads,
    })
  }

  // A row whose status is not a stage we know is a data problem the board must SHOW, not swallow
  // into "new" — otherwise a bad write silently inflates a column.
  const unmapped = unmappedCount
    ? await prisma.lead.findMany({
        where: { status: { notIn: STAGE_IDS as unknown as string[] } },
        orderBy: { createdAt: "desc" },
        take,
      })
    : []

  return { stages, unmapped, unmappedCount, total: Array.from(counts.values()).reduce((sum, n) => sum + n, 0) }
}

export async function getLeadWithActivity(id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { activities: { orderBy: { createdAt: "desc" }, take: 50 } },
  })
  return lead
}

export interface MoveResult {
  ok: boolean
  status: number
  error?: string
  lead?: Awaited<ReturnType<typeof prisma.lead.update>>
  activity?: Awaited<ReturnType<typeof prisma.leadActivity.create>>
}

/**
 * Move a lead and record who did it. The read, the check, the update and the audit row share one
 * transaction: a status that changed without an audit row (or an audit row with no change) would
 * make the trail useless for exactly the question it exists to answer.
 */
export async function moveLead(input: { id: string; to: string; actor?: string; note?: string }): Promise<MoveResult> {
  const actor = (input.actor || "operator").trim() || "operator"

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: input.id } })
    if (!lead) return { ok: false, status: 404, error: "No lead with that id" }

    const from = normaliseStage(lead.status)
    if (!from) {
      return {
        ok: false,
        status: 409,
        error: `This lead's stored status ("${lead.status}") is not a known stage, so it cannot be moved until it is corrected`,
      }
    }
    const problem = transitionError(from, input.to as LeadStage)
    if (problem) return { ok: false, status: 409, error: problem }

    const updated = await tx.lead.update({ where: { id: lead.id }, data: { status: input.to } })
    const activity = await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "status_change",
        fromValue: lead.status,
        toValue: input.to,
        detail: (input.note || "").trim() || null,
        actor,
      },
    })
    return { ok: true, status: 200, lead: updated, activity }
  })
}

/**
 * Who the suppression list covers. Values are matched case-insensitively; a phone number is matched
 * on its last 10 digits so +91 22… and 022… cannot slip past each other.
 */
export function suppressionForms(input: { email?: string | null; phone?: string | null }): string[] {
  const forms: string[] = []
  const email = (input.email || "").trim().toLowerCase()
  if (email) {
    forms.push(email)
    const domain = email.split("@")[1]
    if (domain) forms.push(domain)
  }
  const digits = (input.phone || "").replace(/\D/g, "")
  if (digits) forms.push(digits.slice(-10))
  return forms
}

/** Pure predicate so the export rule can be tested without a database. */
export function isSuppressed(
  input: { email?: string | null; phone?: string | null },
  suppressed: Set<string>
): boolean {
  return suppressionForms(input).some((form) => suppressed.has(form))
}

export async function loadSuppressionIndex(): Promise<Set<string>> {
  const rows = await prisma.suppression.findMany({ select: { value: true, kind: true } })
  return new Set(
    rows.map((row) => (row.kind === "phone" ? row.value.replace(/\D/g, "").slice(-10) : row.value.trim().toLowerCase()))
  )
}

export interface ExportRows {
  rows: Array<Record<string, string | number | null>>
  exported: number
  suppressed: number
  totalInDatabase: number
}

/**
 * The rows an export may contain. The suppression check lives HERE, on the way out, because a
 * do-not-contact list that is only consulted in a settings screen is not a control.
 */
export async function exportRows(): Promise<ExportRows> {
  const [leads, suppressed] = await Promise.all([
    prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 10000 }),
    loadSuppressionIndex(),
  ])

  const kept = leads.filter((lead) => !isSuppressed({ email: lead.email, phone: lead.phone }, suppressed))

  return {
    rows: kept.map((lead) => ({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      title: lead.title,
      website: lead.website,
      linkedin: lead.linkedin,
      location: lead.location,
      source: lead.source,
      status: lead.status,
      score: lead.score,
      verified: lead.verified ? "yes" : "no",
      createdAt: lead.createdAt.toISOString(),
    })),
    exported: kept.length,
    suppressed: leads.length - kept.length,
    totalInDatabase: leads.length,
  }
}

export async function recordExport(format: string, count: number, filters?: unknown) {
  return prisma.exportLog.create({
    data: { format, count, filters: filters ? JSON.stringify(filters) : null },
  })
}

export async function recordLeadActivity(input: {
  leadId: string
  type: string
  detail?: string | null
  actor?: string
  fromValue?: string | null
  toValue?: string | null
}) {
  return prisma.leadActivity.create({
    data: {
      leadId: input.leadId,
      type: input.type,
      detail: (input.detail || "").trim() || null,
      actor: (input.actor || "system").trim() || "system",
      fromValue: input.fromValue ?? null,
      toValue: input.toValue ?? null,
    },
  })
}

/** True when the value parses as a stage id — re-exported so routes validate in one place. */
export { isStage }
