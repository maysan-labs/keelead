// Relevance gate — the check that stops an unrelated record from becoming a lead.
//
// A source answering a different question than the one asked is the most expensive failure in a
// lead tool: the row looks fine in the UI (a name, a score of 70), it costs a real phone call, and
// it burns sender reputation if it is ever mailed. The gate is applied twice — in the engine,
// before results are returned, and again in lib/leads-store.ts, before anything is written — so a
// caller that bypasses the engine still cannot persist noise.
//
// Two ways a lead can pass:
//   1. The source attested the match itself (metadata.match === "attested"). Overpass matched the
//      business type and the bounding box inside OpenStreetMap, so "SK Wheels" is a legitimate hit
//      for a clinic query even though the name contains no keyword.
//   2. At least one content keyword of the query appears in the lead (and, for local queries, the
//      requested place appears too).
import type { Lead } from "@/lib/sources/types"
import type { QueryPlan } from "./query"

export interface RelevanceVerdict {
  ok: boolean
  reason: string
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** True when `token` appears as a whole word (never as a fragment of a longer word). */
export function containsWholeToken(haystack: string, token: string): boolean {
  if (!token) return false
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(token)}([^\\p{L}\\p{N}]|$)`, "u").test(haystack)
  } catch {
    return haystack.includes(token)
  }
}

/** Everything searchable about a lead, lower-cased, tags and metadata included. */
export function leadHaystack(lead: Lead): string {
  const metadata =
    lead.metadata && typeof lead.metadata === "object"
      ? Object.values(lead.metadata as Record<string, unknown>)
          .filter((value) => typeof value === "string")
          .join(" ")
      : ""
  const tags = Array.isArray(lead.tags) ? lead.tags.join(" ") : ""
  return [
    lead.firstName,
    lead.lastName,
    lead.company,
    lead.title,
    lead.website,
    lead.email,
    lead.location,
    lead.linkedin,
    tags,
    metadata,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function isRelevant(lead: Lead, plan: QueryPlan): RelevanceVerdict {
  const haystack = leadHaystack(lead)
  if (!haystack.trim()) return { ok: false, reason: "empty record" }

  const attested = lead.metadata?.match === "attested"

  // 1. The source matched the record against the query itself.
  if (attested) {
    return { ok: true, reason: `attested ${lead.metadata?.matchKind || "match"} in ${lead.source}` }
  }

  // 2. Keyword match.
  const keywords = plan.keywords || []
  const matched = keywords.filter((keyword) => containsWholeToken(haystack, keyword))

  if (keywords.length > 0 && matched.length === 0) {
    return {
      ok: false,
      reason: `no query keyword (${keywords.slice(0, 4).join(", ")}) appears in this ${lead.source} record`,
    }
  }

  // 3. Local queries must actually be located where the user asked.
  if (plan.intent === "local" && plan.location) {
    const placeTokens = plan.location.toLowerCase().split(/\s+/).filter(Boolean)
    const inPlace = placeTokens.some((token) => containsWholeToken(haystack, token))
    if (!inPlace) {
      return { ok: false, reason: `not located in ${plan.location}` }
    }
  }

  return {
    ok: true,
    reason: matched.length ? `matched ${matched.slice(0, 3).join(", ")}` : "matched the place",
  }
}

export interface RelevanceReport {
  kept: Lead[]
  dropped: number
  dropReasons: string[]
}

/** Split leads into what can be shown/stored and what must be thrown away. */
export function filterRelevant(leads: Lead[], plan: QueryPlan): RelevanceReport {
  const kept: Lead[] = []
  const dropReasons: string[] = []
  let dropped = 0

  for (const lead of leads) {
    const verdict = isRelevant(lead, plan)
    if (verdict.ok) {
      kept.push(lead)
    } else {
      dropped++
      if (dropReasons.length < 5) dropReasons.push(`${lead.company || lead.firstName || "unknown"}: ${verdict.reason}`)
    }
  }

  return { kept, dropped, dropReasons }
}
