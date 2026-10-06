import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/db"

// Maysan Labs: this route used to return four invented campaigns from an inline array, so the
// dashboard showed a fiction. It now reads and writes the real `Campaign` table — the table the
// UI renders is the table the database holds. `_count.leads` comes from a single query, never N+1.
export const dynamic = "force-dynamic"

const STATUSES = ["draft", "active", "paused", "completed"] as const
const TYPES = ["email", "linkedin", "phone", "multi"] as const

type Status = (typeof STATUSES)[number]
type Type = (typeof TYPES)[number]

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
}

function isType(value: unknown): value is Type {
  return typeof value === "string" && (TYPES as readonly string[]).includes(value)
}

// GET /api/campaigns[?status=active] — the stored campaigns, newest first, each carrying the real
// number of attached leads.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = (searchParams.get("status") || "").trim()

    if (status && !isStatus(status)) {
      return NextResponse.json(
        { error: `Unknown status "${status}" — valid statuses are ${STATUSES.join(", ")}` },
        { status: 400 },
      )
    }

    const campaigns = await prisma.campaign.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    })

    return NextResponse.json({ campaigns, total: campaigns.length })
  } catch (error) {
    console.error("campaigns list error:", error)
    return NextResponse.json({ error: "Could not read campaigns from the database" }, { status: 500 })
  }
}

// POST /api/campaigns — create a campaign. Only a name is required; the database defaults cover the
// rest, but anything the caller does send is validated before it is written.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 })
    }

    const { name, description, status, type, targetLeads } = body as Record<string, unknown>

    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 })
    }

    if (status !== undefined && !isStatus(status)) {
      return NextResponse.json(
        { error: `Unknown status "${status}" — valid statuses are ${STATUSES.join(", ")}` },
        { status: 400 },
      )
    }

    if (type !== undefined && !isType(type)) {
      return NextResponse.json(
        { error: `Unknown type "${type}" — valid types are ${TYPES.join(", ")}` },
        { status: 400 },
      )
    }

    if (
      targetLeads !== undefined &&
      (typeof targetLeads !== "number" || !Number.isInteger(targetLeads) || targetLeads < 0)
    ) {
      return NextResponse.json(
        { error: "targetLeads must be a non-negative integer" },
        { status: 400 },
      )
    }

    if (description !== undefined && description !== null && typeof description !== "string") {
      return NextResponse.json({ error: "description must be a string" }, { status: 400 })
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: name.trim(),
        description: typeof description === "string" && description.trim() !== "" ? description.trim() : null,
        ...(status !== undefined ? { status } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(targetLeads !== undefined ? { targetLeads } : {}),
      },
      include: { _count: { select: { leads: true } } },
    })

    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    console.error("campaign create error:", error)
    return NextResponse.json({ error: "Could not create the campaign" }, { status: 500 })
  }
}

// PATCH /api/campaigns — move a campaign between draft / active / paused / completed.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 })
    }

    const { id, status } = body as Record<string, unknown>

    if (typeof id !== "string" || id.trim() === "") {
      return NextResponse.json({ error: "Campaign id is required" }, { status: 400 })
    }

    if (!isStatus(status)) {
      return NextResponse.json(
        {
          error:
            status === undefined
              ? "status is required"
              : `Unknown status "${status}" — valid statuses are ${STATUSES.join(", ")}`,
        },
        { status: 400 },
      )
    }

    const existing = await prisma.campaign.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: `No campaign with id "${id}"` }, { status: 404 })
    }

    const campaign = await prisma.campaign.update({
      where: { id },
      data: { status },
      include: { _count: { select: { leads: true } } },
    })

    return NextResponse.json(campaign)
  } catch (error) {
    console.error("campaign update error:", error)
    return NextResponse.json({ error: "Could not update the campaign" }, { status: 500 })
  }
}
