import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/db"

// Maysan Labs: exports are produced from the stored leads (upstream returned a fixed
// "count = 12847" and a two-row sample CSV regardless of what was in the database).
export const dynamic = "force-dynamic"

const MAX_ROWS = 10000

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ""
  const headers = Object.keys(rows[0])
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(","))
  }
  return lines.join("\n")
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const format: string = (body.format || "csv").toLowerCase()
    const count = await prisma.lead.count()
    const filename = `keelead-export-${Date.now()}.${format}`

    await prisma.exportLog.create({
      data: {
        format,
        count,
        filters: body.filters ? JSON.stringify(body.filters) : null,
      },
    })

    return NextResponse.json({
      success: true,
      format,
      count,
      filename,
      url: `/api/export?format=${format}`,
      message: count === 0 ? "No leads to export yet" : `Exported ${count} leads to ${format.toUpperCase()}`,
    })
  } catch (error) {
    console.error("export error:", error)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const format = (searchParams.get("format") || "csv").toLowerCase()

    const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: MAX_ROWS })

    if (format === "json") {
      return NextResponse.json({ count: leads.length, leads })
    }

    if (format !== "csv") {
      return NextResponse.json({ error: `Unsupported format: ${format}. Use csv or json.` }, { status: 400 })
    }

    const rows = leads.map((lead) => ({
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
      verified: lead.verified,
      createdAt: lead.createdAt.toISOString(),
    }))

    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="keelead-export-${Date.now()}.csv"`,
      },
    })
  } catch (error) {
    console.error("export download error:", error)
    return NextResponse.json({ error: "Download failed" }, { status: 500 })
  }
}
