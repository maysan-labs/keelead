// Maysan Labs: the bridge between a search and the database.
//
// Upstream's /api/leads and /api/chat returned scraper results and threw them away, so the
// Lead table stayed empty forever and every dashboard number was a hardcoded constant. Every
// search now persists what it found (and what it did) so the UI, the exports and the API all
// read the same real rows.
import prisma from "@/lib/db"
import type { Lead as EngineLead } from "@/lib/lead-engine"
import { planQuery } from "@/lib/lead-engine/query"
import { isRelevant } from "@/lib/lead-engine/relevance"

export interface SaveResult {
  inserted: number
  skipped: number
  duplicates: string[]
  /** Records the relevance gate threw away — they never reach the table. */
  filtered: number
}

/** Normalise the scraper's confidence (0-1 or 0-100) into the Lead.score column (0-100). */
function toScore(confidence: number | undefined): number {
  const c = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0
  const scaled = c <= 1 ? c * 100 : c
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

/**
 * The sentinel used for an absent name part. It MUST be applied on both sides of the duplicate
 * check: rows were written with `"-"` while the lookup compared the empty string, so the check
 * never matched and every re-run of the same search inserted the same businesses again (44 rows
 * for 25 real clinics).
 */
const NAME_FALLBACK = "-"

const clean = (value?: string | null): string => (value || "").trim()

/**
 * Persist scraped leads. Deduplicates on email, falling back to name+company+source, and never
 * overwrites a row that is already there (a re-run must not reset status/notes/tags that a
 * human or campaign has since set).
 */
export async function saveLeads(leads: EngineLead[], query: string): Promise<SaveResult> {
  let inserted = 0
  let skipped = 0
  let filtered = 0
  const duplicates: string[] = []

  // Defence in depth: the engine already gates its results, but a caller that reaches this
  // function directly (an API route, a script) must not be able to write an unrelated record into
  // the lead table. The gate runs against the SAME query the leads were found with.
  const plan = planQuery(query || "")
  const relevant = leads.filter((lead) => {
    const verdict = isRelevant(lead, plan)
    if (!verdict.ok) filtered++
    return verdict.ok
  })

  // A source can hand back the same business twice in one response (two OSM elements, a node and
  // a way) — dedupe inside the batch as well as against the table.
  const seenInBatch = new Set<string>()

  for (const lead of relevant) {
    const email = clean(lead.email).toLowerCase() || null
    const firstName = clean(lead.firstName)
    const lastName = clean(lead.lastName)
    const company = clean(lead.company) || null
    const source = clean(lead.source) || null
    const storedFirst = firstName || NAME_FALLBACK
    const storedLast = lastName || NAME_FALLBACK
    const batchKey = email || `${storedFirst}|${storedLast}|${company}|${source}`.toLowerCase()

    if (!email && !firstName && !lastName) {
      skipped++
      continue
    }

    if (seenInBatch.has(batchKey)) {
      duplicates.push(email || `${firstName} ${lastName}`.trim())
      skipped++
      continue
    }
    seenInBatch.add(batchKey)

    try {
      const existing = email
        ? await prisma.lead.findFirst({ where: { email } })
        : await prisma.lead.findFirst({
            where: { firstName: storedFirst, lastName: storedLast, company, source },
          })

      if (existing) {
        duplicates.push(email || `${firstName} ${lastName}`.trim())
        skipped++
        continue
      }

      await prisma.lead.create({
        data: {
          firstName: storedFirst,
          lastName: storedLast,
          email,
          phone: (lead.phone || "").trim() || null,
          company,
          title: (lead.title || "").trim() || null,
          website: (lead.website || "").trim() || null,
          linkedin: (lead.linkedin || "").trim() || null,
          location: clean(lead.location) || null,
          source,
          status: "new",
          score: toScore(lead.confidence),
          verified: false,
          tags: lead.tags && lead.tags.length ? JSON.stringify(lead.tags) : null,
          // Keep what the source told us about the record (Overpass id, match evidence, the web
          // provider) — it is the provenance of the row, and it is what a re-run can be checked by.
          metadata: JSON.stringify({ ...(lead.metadata || {}), query, importedAt: new Date().toISOString() }),
        },
      })
      inserted++
    } catch (error) {
      console.error("saveLeads: could not persist a lead", error)
      skipped++
    }
  }

  return { inserted, skipped, duplicates, filtered }
}

/** Record a search so "Searches today" and the activity feed are real. Never fatal. */
export async function logSearch(
  query: string,
  sources: string[],
  leadsFound: number,
  leadsSaved: number
): Promise<void> {
  try {
    await prisma.searchLog.create({
      data: {
        query: (query || "").slice(0, 500),
        sources: JSON.stringify(sources || []),
        leadsFound,
        leadsSaved,
      },
    })
  } catch (error) {
    console.error("logSearch failed (non-fatal)", error)
  }
}
