"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  TrendingUp, Users, Mail, Eye, MousePointerClick, Reply,
  ArrowUpRight, ArrowDownRight, Globe, Search, Building2, Github, MapPin, Download
} from "lucide-react"

// Maysan Labs: upstream shipped this page with invented figures (12,847 leads, 47.3% open
// rate, weekly bars). Everything here is computed from the database by /api/analytics; a
// metric with no supporting table yet shows 0 / "—" rather than a made-up number.
interface AnalyticsPayload {
  generatedAt: string
  overview: {
    totalLeads: number
    totalEmailsSent: number
    openRate: number
    replyRate: number
    clickRate: number
    conversionRate: number
  }
  trends: { leads: number | null; emails: number | null; opens: number | null; replies: number | null }
  sourcePerformance: { source: string; leads: number; emails: number; opens: number; replies: number; convRate: number }[]
  funnel: { stage: string; count: number; percentage: number; color: string }[]
  weekly: { week: string; leads: number; emails: number; opens: number; replies: number }[]
  counts: { verifications: number; campaignCount: number; previousWeekLeads: number }
}

function change(value: number | null): { label: string; up: boolean } {
  if (value === null) return { label: "—", up: true }
  return { label: `${value >= 0 ? "+" : ""}${value}%`, up: value >= 0 }
}

function sourceIcon(source: string) {
  const name = source.toLowerCase()
  if (name.includes("github")) return <Github className="w-4 h-4" />
  if (name.includes("linkedin")) return <Users className="w-4 h-4" />
  if (name.includes("map") || name.includes("openstreetmap")) return <MapPin className="w-4 h-4" />
  if (name.includes("crunchbase") || name.includes("company")) return <Building2 className="w-4 h-4" />
  if (name.includes("search") || name.includes("bing") || name.includes("duckduckgo")) return <Globe className="w-4 h-4" />
  return <Search className="w-4 h-4" />
}

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState("30d")
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/analytics", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((json: AnalyticsPayload) => {
        if (alive) setData(json)
      })
      .catch((err) => {
        if (alive) setError(String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  const overview = data?.overview
  const loading = !data && !error
  const num = (n: number | undefined, suffix = "") => (loading ? "…" : `${(n ?? 0).toLocaleString()}${suffix}`)

  const overviewStats = [
    { label: "Total Leads", value: num(overview?.totalLeads), trend: change(data?.trends.leads ?? null), icon: <Users className="w-4 h-4 text-blue-400" /> },
    { label: "Emails Sent", value: num(overview?.totalEmailsSent), trend: change(data?.trends.emails ?? null), icon: <Mail className="w-4 h-4 text-purple-400" /> },
    { label: "Open Rate", value: num(overview?.openRate, "%"), trend: change(null), icon: <Eye className="w-4 h-4 text-emerald-400" /> },
    { label: "Reply Rate", value: num(overview?.replyRate, "%"), trend: change(null), icon: <Reply className="w-4 h-4 text-orange-400" /> },
    { label: "Click Rate", value: num(overview?.clickRate, "%"), trend: change(null), icon: <MousePointerClick className="w-4 h-4 text-yellow-400" /> },
    { label: "Conversion", value: num(overview?.conversionRate, "%"), trend: change(null), icon: <TrendingUp className="w-4 h-4 text-green-400" /> },
  ]

  const sourcePerformance = data?.sourcePerformance ?? []
  const funnelStages = data?.funnel ?? []
  const weeklyData = data?.weekly ?? []
  const weeklyPeak = Math.max(1, ...weeklyData.map((week) => week.leads))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Straight from the database — leads, sources and campaign rows
            {data?.generatedAt ? ` (updated ${new Date(data.generatedAt).toLocaleTimeString()})` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          {["7d", "30d", "90d", "1y"].map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                dateRange === range ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {range}
            </button>
          ))}
          <Button variant="outline" size="sm" className="border-white/10 ml-2">
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      {error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-4 text-sm text-red-300">Could not load analytics ({error}).</CardContent>
        </Card>
      )}

      <p className="text-xs text-zinc-500">
        Figures are all-time totals. The range buttons are visual only until per-day send/open history is tracked.
      </p>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {overviewStats.map((stat) => (
          <Card key={stat.label} className="bg-[#0a0a0a] border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">{stat.icon} {stat.label}</div>
              <div className="text-xl font-bold">{stat.value}</div>
              <div className="flex items-center gap-1 mt-1">
                {stat.trend.up ? (
                  <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 text-red-400" />
                )}
                <span className={`text-xs ${stat.trend.up ? "text-emerald-400" : "text-red-400"}`}>{stat.trend.label}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Source Performance */}
        <Card className="lg:col-span-2 bg-[#0a0a0a] border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Source Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-2 text-zinc-400 font-medium text-xs">Source</th>
                    <th className="text-right p-2 text-zinc-400 font-medium text-xs">Leads</th>
                    <th className="text-right p-2 text-zinc-400 font-medium text-xs">Sent</th>
                    <th className="text-right p-2 text-zinc-400 font-medium text-xs">Opens</th>
                    <th className="text-right p-2 text-zinc-400 font-medium text-xs">Replies</th>
                    <th className="text-right p-2 text-zinc-400 font-medium text-xs">Conv %</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcePerformance.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-zinc-500 text-sm">
                        No leads stored yet. Run a search — each source that returns results shows up here.
                      </td>
                    </tr>
                  )}
                  {sourcePerformance.map((source) => (
                    <tr key={source.source} className="border-b border-white/5">
                      <td className="p-2 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-zinc-400">
                          {sourceIcon(source.source)}
                        </div>
                        {source.source}
                      </td>
                      <td className="p-2 text-right">{source.leads.toLocaleString()}</td>
                      <td className="p-2 text-right text-zinc-400">{source.emails.toLocaleString()}</td>
                      <td className="p-2 text-right text-emerald-400">{source.opens.toLocaleString()}</td>
                      <td className="p-2 text-right text-blue-400">{source.replies}</td>
                      <td className="p-2 text-right">
                        <Badge className={`border-0 text-xs ${source.convRate >= 4 ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-500/20 text-zinc-400"}`}>
                          {source.convRate}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Conversion Funnel */}
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {funnelStages.map((stage) => (
                <div key={stage.stage}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-zinc-400">{stage.stage}</span>
                    <span className="font-medium">{stage.count.toLocaleString()}</span>
                  </div>
                  <div className="h-6 bg-white/5 rounded-lg overflow-hidden">
                    <div
                      className={`h-full ${stage.color} opacity-80 rounded-lg flex items-center justify-end pr-2`}
                      style={{ width: `${Math.max(stage.percentage, 2)}%` }}
                    >
                      <span className="text-[10px] font-bold">{stage.percentage}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-4">
              {data?.counts
                ? `${data.counts.campaignCount} campaign(s), ${data.counts.verifications} verification(s) recorded.`
                : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Weekly Trend */}
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weekly Trend (leads stored per week)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-end gap-8 px-4">
            {weeklyData.map((week) => (
              <div key={week.week} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex gap-1 items-end" style={{ height: "140px" }}>
                  <div
                    className="flex-1 bg-blue-500 rounded-t"
                    title={`${week.leads} leads`}
                    style={{ height: `${week.leads === 0 ? 2 : Math.max(6, (week.leads / weeklyPeak) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400">{week.week}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-6 mt-4">
            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
              <div className="w-2.5 h-2.5 rounded bg-blue-500" /> Leads
            </span>
            <span className="text-xs text-zinc-500">
              Sent / opens / replies appear once campaign sends are tracked.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
