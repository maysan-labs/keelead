import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { searchLeads } from "@/lib/lead-engine"
import { parseLeadIntent } from "@/lib/ai"
import { saveLeads, logSearch } from "@/lib/leads-store"
import prisma from "@/lib/db"

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
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 1000)
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0)

    const where: Prisma.LeadWhereInput = {}
    const status = searchParams.get("status")
    const source = searchParams.get("source")
    const q = searchParams.get("q")
    if (status) where.status = status
    if (source) where.source = source
    if (q) {
      where.OR = [
        { email: { contains: q } },
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { company: { contains: q } },
        { title: { contains: q } },
      ]
    }

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    ])

    return NextResponse.json({ total, limit, offset, count: leads.length, leads })
  } catch (error) {
    console.error("leads list error:", error)
    return NextResponse.json({ error: "Could not read leads" }, { status: 500 })
  }
}
