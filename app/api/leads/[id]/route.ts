import { NextRequest, NextResponse } from "next/server"
import { getLeadWithActivity, moveLead } from "@/lib/leads-query"
import { STAGES, allowedTransitions, normaliseStage } from "@/lib/pipeline"

export const dynamic = "force-dynamic"

/** One lead with its audit trail — the answer to "how did this lead get here". */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const lead = await getLeadWithActivity(params.id)
    if (!lead) return NextResponse.json({ error: "No lead with that id" }, { status: 404 })

    const stage = normaliseStage(lead.status)
    return NextResponse.json({
      lead,
      stage,
      allowedTransitions: stage ? allowedTransitions(stage) : [],
      stages: STAGES,
    })
  } catch (error) {
    console.error("lead GET error:", error)
    return NextResponse.json({ error: "Could not read the lead" }, { status: 500 })
  }
}

/** Move the lead. A refused move is a 409 with the reason the operator can act on. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}))
    const to = String(body.status || body.stage || "").trim().toLowerCase()
    if (!to) return NextResponse.json({ error: "status is required" }, { status: 400 })

    const result = await moveLead({ id: params.id, to, actor: body.actor, note: body.note })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    return NextResponse.json({ success: true, lead: result.lead, activity: result.activity })
  } catch (error) {
    console.error("lead PATCH error:", error)
    return NextResponse.json({ error: "Could not move the lead" }, { status: 500 })
  }
}
