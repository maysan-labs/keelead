import { NextRequest, NextResponse } from "next/server"
import { exportRows, recordExport } from "@/lib/leads-query"

// Maysan Labs: exports are produced from the stored leads (upstream returned a fixed
// "count = 12847" and a two-row sample CSV regardless of what was in the database), and they are
// filtered against the suppression list — a do-not-contact entry that does not stop an export is
// not a control.
export const dynamic = "force-dynamic"

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
    const { exported, suppressed, totalInDatabase } = await exportRows()
    const filename = `keelead-export-${Date.now()}.${format}`

    await recordExport(format, exported, body.filters)

    return NextResponse.json({
      success: true,
      format,
      count: exported,
      suppressed,
      totalInDatabase,
      filename,
      url: `/api/export?format=${format}`,
      message:
        exported === 0
          ? totalInDatabase === 0
            ? "No leads to export yet"
            : `Nothing to export: all ${totalInDatabase} lead(s) are on the do-not-contact list`
          : `Exported ${exported} lead(s) to ${format.toUpperCase()}${suppressed ? ` (${suppressed} suppressed and excluded)` : ""}`,
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

    if (format !== "csv" && format !== "json") {
      return NextResponse.json({ error: `Unsupported format: ${format}. Use csv or json.` }, { status: 400 })
    }

    const { rows, exported, suppressed, totalInDatabase } = await exportRows()

    if (format === "json") {
      return NextResponse.json({ count: exported, suppressed, totalInDatabase, rows })
    }

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
