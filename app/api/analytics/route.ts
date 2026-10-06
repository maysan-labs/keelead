import { NextResponse } from "next/server"
import prisma from "@/lib/db"

// Maysan Labs: this route used to return fabricated demo data (12,847 leads, 47.3% open rate…)
// while the database was empty. Every figure below is derived from real rows.
export const dynamic = "force-dynamic"

const DAY = 24 * 60 * 60 * 1000

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export async function GET() {
  try {
    const now = new Date()
    const d7 = new Date(now.getTime() - 7 * DAY)
    const d14 = new Date(now.getTime() - 14 * DAY)
    const weeks = [0, 1, 2, 3].map((offset) => ({
      start: new Date(now.getTime() - (offset + 1) * 7 * DAY),
      end: new Date(now.getTime() - offset * 7 * DAY),
      label: `W${4 - offset}`,
    }))

    const [totalLeads, leads7, leadsPrev7, statusGroups, sourceGroups, campaignRows, verificationTotal] =
      await Promise.all([
        prisma.lead.count(),
        prisma.lead.count({ where: { createdAt: { gte: d7 } } }),
        prisma.lead.count({ where: { createdAt: { gte: d14, lt: d7 } } }),
        prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.lead.groupBy({ by: ["source"], _count: { _all: true } }),
        prisma.campaign.findMany({
          select: { targetLeads: true, sentCount: true, openRate: true, replyRate: true },
        }),
        prisma.verificationLog.count(),
      ])

    const statusCount = (name: string): number =>
      statusGroups.find((group) => group.status === name)?._count._all ?? 0

    const contacted = statusCount("contacted")
    const qualified = statusCount("qualified")
    const converted = statusCount("converted")
    const emailsSent = campaignRows.reduce((sum, row) => sum + (row.sentCount || 0), 0)

    // Campaign rates are stored per campaign; weight them by target size so the aggregate is
    // an honest weighted average rather than a plain mean of runs of different sizes.
    const weighted = campaignRows.filter((row) => (row.targetLeads || 0) > 0)
    const weight = weighted.reduce((sum, row) => sum + row.targetLeads, 0)
    const weightedAvg = (pick: (row: (typeof weighted)[number]) => number): number =>
      weight > 0 ? Math.round((weighted.reduce((sum, row) => sum + pick(row) * row.targetLeads, 0) / weight) * 10) / 10 : 0

    const openRate = weightedAvg((row) => row.openRate || 0)
    const replyRate = weightedAvg((row) => row.replyRate || 0)

    const weekly = await Promise.all(
      weeks.map(async (week) => ({
        week: week.label,
        leads: await prisma.lead.count({ where: { createdAt: { gte: week.start, lt: week.end } } }),
        emails: 0,
        opens: 0,
        replies: 0,
      }))
    )

    const previousWeekStart = new Date(now.getTime() - 14 * DAY)
    const previousWeekEnd = new Date(now.getTime() - 7 * DAY)
    const previousWeekLeads = await prisma.lead.count({
      where: { createdAt: { gte: previousWeekStart, lt: previousWeekEnd } },
    })

    const sourcePerformance = sourceGroups
      .map((group) => ({
        source: group.source || "Unknown",
        leads: group._count._all,
        emails: 0,
        opens: 0,
        replies: 0,
        convRate: pct(converted, group._count._all),
      }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 10)

    return NextResponse.json({
      generatedAt: now.toISOString(),
      overview: {
        totalLeads,
        totalEmailsSent: emailsSent,
        openRate,
        replyRate,
        clickRate: 0, // no click tracking table yet — shown as 0 rather than invented
        conversionRate: pct(converted, totalLeads),
      },
      trends: {
        leads: pctDelta(leads7, leadsPrev7),
        // Sends/opens/replies have no history table yet — null renders as "—" instead of a
        // fabricated percentage.
        emails: null,
        opens: null,
        replies: null,
      },
      sourcePerformance,
      funnel: [
        { stage: "Total Leads", count: totalLeads, percentage: totalLeads > 0 ? 100 : 0, color: "bg-blue-500" },
        { stage: "Contacted", count: contacted, percentage: pct(contacted, totalLeads), color: "bg-purple-500" },
        { stage: "Qualified", count: qualified, percentage: pct(qualified, totalLeads), color: "bg-green-500" },
        { stage: "Converted", count: converted, percentage: pct(converted, totalLeads), color: "bg-emerald-400" },
      ],
      weekly,
      counts: {
        verifications: verificationTotal,
        campaignCount: campaignRows.length,
        previousWeekLeads,
      },
    })
  } catch (error) {
    console.error("analytics API error:", error)
    return NextResponse.json({ error: "analytics unavailable" }, { status: 500 })
  }
}
