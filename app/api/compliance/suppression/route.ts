import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/db"
import { loadSuppressionIndex } from "@/lib/leads-query"

// The do-not-contact list. It is enforced in lib/leads-query.exportRows(), which is what every
// export reads through — the list matters on the way OUT of the system.
export const dynamic = "force-dynamic"

const KINDS = ["email", "phone", "domain"]
const REASONS = ["opted_out", "bounced", "complained", "manual"]

export async function GET() {
  try {
    const [entries, index] = await Promise.all([
      prisma.suppression.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
      loadSuppressionIndex(),
    ])
    return NextResponse.json({ total: entries.length, matchableForms: index.size, entries })
  } catch (error) {
    console.error("suppression GET error:", error)
    return NextResponse.json({ error: "Could not read the suppression list" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const value = String(body.value || "").trim().toLowerCase()
    const kind = String(body.kind || "email").trim().toLowerCase()
    const reason = String(body.reason || "manual").trim().toLowerCase()
    const note = body.note ? String(body.note).trim() : null

    if (!value) return NextResponse.json({ error: "value is required (email address, phone number or domain)" }, { status: 400 })
    if (!KINDS.includes(kind)) return NextResponse.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 })
    if (!REASONS.includes(reason)) return NextResponse.json({ error: `reason must be one of ${REASONS.join(", ")}` }, { status: 400 })

    const entry = await prisma.suppression.upsert({
      where: { value },
      update: { kind, reason, note },
      create: { value, kind, reason, note },
    })
    return NextResponse.json({ success: true, entry })
  } catch (error) {
    console.error("suppression POST error:", error)
    return NextResponse.json({ error: "Could not record the suppression" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const value = (searchParams.get("value") || "").trim().toLowerCase()
    if (!value) return NextResponse.json({ error: "value is required" }, { status: 400 })

    const existing = await prisma.suppression.findUnique({ where: { value } })
    if (!existing) return NextResponse.json({ error: "No suppression entry with that value" }, { status: 404 })

    await prisma.suppression.delete({ where: { value } })
    return NextResponse.json({ success: true, removed: value })
  } catch (error) {
    console.error("suppression DELETE error:", error)
    return NextResponse.json({ error: "Could not remove the suppression" }, { status: 500 })
  }
}
