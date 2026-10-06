import { NextRequest, NextResponse } from "next/server"
import { searchLeads } from "@/lib/lead-engine"
import { parseLeadIntent } from "@/lib/ai"
import { saveLeads, logSearch } from "@/lib/leads-store"
import { listLeads, pipelineBoard } from "@/lib/leads-query"
import { STAGE_IDS, isStage } from "@/lib/pipeline"

// Maysan Labs: search AND persist, and expose the stored leads for the UI / Hermes.
// Upstream ran the scrapers and discarded the results, which is why the database was always
// empty and every dashboard tile had to be a hardcoded constant.
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query: string = body.query || `Find ${body.count || 10} leads`
    const intent = parseLeadIntent(query)
    if (body.count) intent.params.count = String(body.count)
    if (body.location) intent.params.location = body.location
    if (body.industry) intent.params.industry = body.industry

    const results = await searchLeads(intent)

    // `save: false` runs a search without writing to the database (used to probe the sources).
    const saved = body.save === false ? { inserted: 0, skipped: 0 } : await saveLeads(results.leads, results.query || query)
    await logSearch(results.query || query, results.sources, results.total, saved.inserted)

    return NextResponse.json({
      ...results,
      saved: saved.inserted,
      skipped: saved.skipped,
    })
  } catch (error) {
    console.error("leads API error:", error)
    return NextResponse.json({ error: "Search failed", leads: [], total: 0, sources: [] }, { status: 500 })
  }
}

// GET lists the leads already in the database. (Upstream's GET re-ran a live scrape on every
// call, which made paging impossible and filled the UI with unmaterialised results.)
//
// `view=board` returns the pipeline board, so the UI has ONE endpoint to read per screen and the
// two views can never disagree about a count.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    if (searchParams.get("view") === "board") {
      const perStage = parseInt(searchParams.get("perStage") || "25", 10) || 25
      return NextResponse.json(await pipelineBoard(perStage))
    }

    const status = (searchParams.get("status") || searchParams.get("stage") || "").trim()
    if (status && !isStage(status)) {
      return NextResponse.json({ error: `Unknown stage "${status}" — valid stages are ${STAGE_IDS.join(", ")}` }, { status: 400 })
    }

    const minScoreRaw = searchParams.get("minScore")
    const order = (searchParams.get("order") || "recent").trim()

    const result = await listLeads({
      status,
      source: searchParams.get("source") || undefined,
      campaignId: searchParams.get("campaignId") || undefined,
      q: searchParams.get("q") || undefined,
      minScore: minScoreRaw === null ? undefined : Number(minScoreRaw),
      limit: parseInt(searchParams.get("limit") || "50", 10) || 50,
      offset: parseInt(searchParams.get("offset") || "0", 10) || 0,
      order: order === "score" || order === "company" ? order : "recent",
    })

    return NextResponse.json({ ...result, count: result.leads.length })
  } catch (error) {
    console.error("leads list error:", error)
    return NextResponse.json({ error: "Could not read leads" }, { status: 500 })
  }
}
