import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/db"
import { complianceReport } from "@/lib/insights"
import { recordLeadActivity } from "@/lib/leads-query"

// What we can evidence, and what we cannot. The report is computed; a claim with no table behind it
// is reported as "not recorded" rather than asserted.
export const dynamic = "force-dynamic"

const CHANNELS = ["email", "whatsapp", "phone"]
const STATUSES = ["granted", "withdrawn", "unknown"]

export async function GET() {
  try {
    const report = await complianceReport()
    return NextResponse.json(report)
  } catch (error) {
    console.error("compliance API error:", error)
    return NextResponse.json({ error: "Could not build the compliance report" }, { status: 500 })
  }
}

/**
 * Record consent or a withdrawal. This is a WRITE path on purpose: an opt-out a person cannot
 * actually record is not a mechanism. The row is upserted per (subject, channel) so a withdrawal
 * does not leave the earlier grant looking current.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const subject = String(body.subject || "").trim().toLowerCase()
    const channel = String(body.channel || "email").trim().toLowerCase()
    const status = String(body.status || "granted").trim().toLowerCase()
    const basis = body.basis ? String(body.basis).trim() : null
    const evidence = body.evidence ? String(body.evidence).trim() : null
    const source = body.source ? String(body.source).trim() : "operator"

    if (!subject) {
      return NextResponse.json({ error: "subject is required (the email address, phone number or domain)" }, { status: 400 })
    }
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 })
    }
    if (!CHANNELS.includes(channel)) {
      return NextResponse.json({ error: `channel must be one of ${CHANNELS.join(", ")}` }, { status: 400 })
    }

    const record = await prisma.consentRecord.upsert({
      where: { subject_channel: { subject, channel } },
      update: { status, basis, evidence, source },
      create: { subject, channel, status, basis, evidence, source },
    })

    // A withdrawal must reach the matching leads immediately, otherwise the consent table and the
    // pipeline disagree and the next campaign mails someone who opted out.
    let suppressed = null
    if (status === "withdrawn") {
      suppressed = await prisma.suppression.upsert({
        where: { value: subject },
        update: {},
        create: { value: subject, kind: channel === "phone" ? "phone" : "email", reason: "opted_out" },
      })
      const affected = await prisma.lead.findMany({
        where: {
          OR: [{ email: subject }, { phone: { contains: subject } }],
        },
        select: { id: true },
      })
      for (const lead of affected) {
        await recordLeadActivity({
          leadId: lead.id,
          type: "consent",
          detail: `Opt-out recorded for ${subject}${evidence ? ` (${evidence})` : ""}`,
          actor: source,
        })
      }
    }

    return NextResponse.json({ success: true, consent: record, suppression: suppressed })
  } catch (error) {
    console.error("compliance POST error:", error)
    return NextResponse.json({ error: "Could not record the consent record" }, { status: 500 })
  }
}
