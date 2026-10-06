// Maysan Labs: real dashboard numbers.
//
// Upstream rendered `value: "12,847"` and friends as literals in the page components and in
// /api/analytics, so the UI never reflected the database. Everything below is a COUNT/SUM over
// the real tables; a fresh install honestly reports zeros, and the numbers move as searches,
// verifications and campaigns happen.
import prisma from "@/lib/db"

const DAY = 24 * 60 * 60 * 1000
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export type Trend = number | null

/** Percentage change, or null when there is no previous period to compare against. */
function pctDelta(current: number, previous: number): Trend {
  if (previous === 0) return current === 0 ? null : 100
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function relTime(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export interface Activity {
  action: string
  detail: string
  time: string
  type: "lead" | "verify" | "search" | "export" | "campaign"
}

export async function getStats() {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const d7 = new Date(now.getTime() - 7 * DAY)
  const d14 = new Date(now.getTime() - 14 * DAY)
  const monthsBack = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const [
    leads,
    leads7,
    leadsPrev7,
    verifiedEmails,
    verified7,
    verifiedPrev7,
    statusGroups,
    sourceGroups,
    campaigns,
    activeCampaigns,
    campaigns7,
    campaignsPrev7,
    campaignAgg,
    verificationTotal,
    verificationValid,
    exportTotal,
    searchesToday,
    searchTotal,
    search7,
    searchPrev7,
    recentLeads,
    recentVerifications,
    recentExports,
    recentSearches,
    leadDates,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: d7 } } }),
    prisma.lead.count({ where: { createdAt: { gte: d14, lt: d7 } } }),
    prisma.lead.count({ where: { verified: true } }),
    prisma.lead.count({ where: { verified: true, createdAt: { gte: d7 } } }),
    prisma.lead.count({ where: { verified: true, createdAt: { gte: d14, lt: d7 } } }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.campaign.count(),
    prisma.campaign.count({ where: { status: "active" } }),
    prisma.campaign.count({ where: { createdAt: { gte: d7 } } }),
    prisma.campaign.count({ where: { createdAt: { gte: d14, lt: d7 } } }),
    prisma.campaign.aggregate({ _sum: { sentCount: true } }),
    prisma.verificationLog.count(),
    prisma.verificationLog.count({ where: { status: "valid" } }),
    prisma.exportLog.count(),
    prisma.searchLog.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.searchLog.count(),
    prisma.searchLog.count({ where: { createdAt: { gte: d7 } } }),
    prisma.searchLog.count({ where: { createdAt: { gte: d14, lt: d7 } } }),
    prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.verificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.exportLog.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.searchLog.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.lead.findMany({ where: { createdAt: { gte: monthsBack } }, select: { createdAt: true } }),
  ])

  // Top sources, with the share each one contributed.
  const sources = sourceGroups
    .map((group) => ({
      name: group.source || "Unknown",
      leads: group._count._all,
    }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 6)
    .map((row) => ({
      ...row,
      percentage: leads > 0 ? Math.round((row.leads / leads) * 1000) / 10 : 0,
    }))

  // Leads per month for the last 12 months (the usage chart).
  const buckets = new Map<string, number>()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, 0)
  }
  for (const row of leadDates) {
    const key = `${row.createdAt.getFullYear()}-${row.createdAt.getMonth()}`
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  const monthly = Array.from(buckets.entries()).map(([key, count]) => {
    const [year, month] = key.split("-").map(Number)
    return { label: MONTH_LABELS[month], year, leads: count }
  })

  // Activity feed, merged from every table that records something happening.
  const events: { at: Date; activity: Activity }[] = []
  for (const lead of recentLeads) {
    events.push({
      at: lead.createdAt,
      activity: {
        action: "Lead added",
        detail: `${lead.firstName} ${lead.lastName}${lead.company ? ` — ${lead.company}` : ""}`,
        time: "",
        type: "lead",
      },
    })
  }
  for (const search of recentSearches) {
    events.push({
      at: search.createdAt,
      activity: {
        action: "Search run",
        detail: `"${search.query}" — ${search.leadsFound} found, ${search.leadsSaved} saved`,
        time: "",
        type: "search",
      },
    })
  }
  for (const verification of recentVerifications) {
    events.push({
      at: verification.createdAt,
      activity: {
        action: "Email verified",
        detail: `${verification.email} — ${verification.status} (${verification.score}/100)`,
        time: "",
        type: "verify",
      },
    })
  }
  for (const exportLog of recentExports) {
    events.push({
      at: exportLog.createdAt,
      activity: {
        action: "Export completed",
        detail: `${exportLog.count} leads to ${exportLog.format.toUpperCase()}`,
        time: "",
        type: "export",
      },
    })
  }
  const recentActivity: Activity[] = events
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8)
    .map((event) => ({ ...event.activity, time: relTime(event.at) }))

  return {
    generatedAt: now.toISOString(),
    totals: {
      leads,
      verifiedEmails,
      searchesToday,
      searchesTotal: searchTotal,
      activeCampaigns,
      campaigns,
      emailsSent: campaignAgg._sum.sentCount || 0,
      verifications: verificationTotal,
      verificationsValid: verificationValid,
      exports: exportTotal,
    },
    trends: {
      leads: pctDelta(leads7, leadsPrev7),
      verifiedEmails: pctDelta(verified7, verifiedPrev7),
      searches: pctDelta(search7, searchPrev7),
      campaigns: pctDelta(campaigns7, campaignsPrev7),
    },
    byStatus: statusGroups.map((group) => ({ status: group.status, count: group._count._all })),
    sources,
    monthly,
    recentActivity,
  }
}

export type Stats = Awaited<ReturnType<typeof getStats>>
