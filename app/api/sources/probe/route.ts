import { NextRequest, NextResponse } from "next/server"
import { sourceManager } from "@/lib/sources"

// OPERATIONAL PROBE (Maysan Labs): asks every registered data source for a few leads and
// reports which ones actually return data, which are key-gated, and which come back empty.
// This is how we choose the production source list: most sources in this repo are demo
// generators that invent people, and they must not write into the real lead database.
export const dynamic = "force-dynamic"

const PER_SOURCE_TIMEOUT_MS = 12000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q") || "digital agency"
  const count = Math.min(Math.max(parseInt(searchParams.get("count") || "3", 10) || 3, 1), 10)

  const sources = sourceManager.getAll()
  const results: Record<string, unknown>[] = []

  const batchSize = 5
  for (let i = 0; i < sources.length; i += batchSize) {
    const batch = sources.slice(i, i + batchSize)
    const settled = await Promise.allSettled(
      batch.map(async (source) => {
        const leads = await withTimeout(source.search(query, { count }), PER_SOURCE_TIMEOUT_MS)
        return { source, leads }
      })
    )
    settled.forEach((entry, index) => {
      const source = batch[index]
      if (entry.status === "fulfilled") {
        const first = entry.value.leads[0]
        results.push({
          id: source.id,
          name: source.name,
          category: source.category,
          apiKey: source.requiresApiKey,
          enabled: source.enabled,
          leads: entry.value.leads.length,
          sample: first ? `${first.firstName} ${first.lastName}`.trim() + (first.email ? ` <${first.email}>` : "") + (first.company ? ` @ ${first.company}` : "") : "",
        })
      } else {
        results.push({
          id: source.id,
          name: source.name,
          category: source.category,
          apiKey: source.requiresApiKey,
          enabled: source.enabled,
          leads: -1,
          error: String(entry.reason).slice(0, 80),
        })
      }
    })
  }

  const working = results.filter((row) => Number(row.leads) > 0)
  return NextResponse.json({
    query,
    count,
    totalSources: sources.length,
    returningData: working.length,
    results,
  })
}
