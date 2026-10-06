import { NextResponse } from "next/server"
import { sourceManager, PRODUCTION_SOURCE_IDS } from "@/lib/sources"
import { planQuery } from "@/lib/lead-engine/query"

// Maysan Labs: this route used to return a HARDCODED list of 57 sources with `enabled: true` on
// almost all of them (Google, LinkedIn, Google Maps, Yelp…) while the engine actually ran a much
// smaller, different set. The panel therefore advertised a toolbox that did not exist.
//
// It is now answered from the live registry — the same objects the engine searches — so the UI
// cannot disagree with the behaviour. The registry objects themselves (name, category, rate limit)
// are the source of truth; nothing here re-states them.
export const dynamic = "force-dynamic"

export async function GET() {
  const sources = sourceManager.getAll().map((source) => ({
    id: source.id,
    name: source.name,
    category: source.category,
    requiresApiKey: source.requiresApiKey,
    rateLimit: source.rateLimit,
    enabled: source.enabled,
  }))

  const categories: Record<string, number> = {}
  for (const source of sources) {
    categories[source.category] = (categories[source.category] || 0) + 1
  }

  const free = sources.filter((source) => !source.requiresApiKey).length
  const active = sources.filter((source) => source.enabled)

  // The routing examples run through the SAME planner the search path uses, so this cannot drift
  // into a second, prettier description of the rules.
  const examples: Array<{ intent: string; sources: string[]; example: string }> = [
    { intent: "local", sources: ["openstreetmap", "web"], example: "healthcare clinics in Mumbai" },
    { intent: "developer", sources: ["github", "stackoverflow", "devto", "web"], example: "node.js developers in Berlin" },
    { intent: "academic", sources: ["google-scholar", "orcid", "web"], example: "machine learning professors in India" },
    { intent: "company", sources: ["opencorporates", "sec-edgar", "web"], example: "fintech companies in Pune" },
    { intent: "web", sources: ["web", "duckduckgo"], example: "any query no niche source covers" },
  ]

  return NextResponse.json({
    sources,
    total: sources.length,
    enabled: active.length,
    free,
    paid: sources.length - free,
    categories,
    policy: {
      allowedSourceIds: PRODUCTION_SOURCE_IDS,
      activeSourceIds: active.map((source) => source.id),
      note:
        "A source is enabled only when it returns real records, and it is asked only the query types " +
        "it can answer. Sources that fabricate records stay disabled.",
      routing: examples.map((entry) => {
        const plan = planQuery(entry.example)
        return {
          ...entry,
          plannedIntent: plan.intent,
          plannedSources: plan.sourceIds,
          why: plan.why,
        }
      }),
    },
  })
}
