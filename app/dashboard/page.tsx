"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Users, Mail, Search, Megaphone, ArrowUpRight, ArrowDownRight,
  Plus, MessageSquare, Download, Eye
} from "lucide-react"
import Link from "next/link"

// Maysan Labs: this page used to render literal demo values ("12,847" leads, a fake activity
// feed and invented source bars). Every number now comes from /api/stats, which counts real
// rows — a fresh install honestly shows zeros.
interface Activity {
  action: string
  detail: string
  time: string
  type: "lead" | "verify" | "search" | "export" | "campaign"
}

interface StatsPayload {
  generatedAt: string
  totals: {
    leads: number
    verifiedEmails: number
    searchesToday: number
    searchesTotal: number
    activeCampaigns: number
    campaigns: number
    emailsSent: number
    verifications: number
    verificationsValid: number
    exports: number
  }
  trends: { leads: number | null; verifiedEmails: number | null; searches: number | null; campaigns: number | null }
  sources: { name: string; leads: number; percentage: number }[]
  monthly: { label: string; year: number; leads: number }[]
  recentActivity: Activity[]
}

function TrendLabel({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="flex items-center gap-1 mt-1">
        <span className="text-xs text-zinc-500">no prior week to compare</span>
      </div>
    )
  }
  const up = value >= 0
  return (
    <div className="flex items-center gap-1 mt-1">
      {up ? <ArrowUpRight className="w-3 h-3 text-emerald-400" /> : <ArrowDownRight className="w-3 h-3 text-red-400" />}
      <span className={`text-xs ${up ? "text-emerald-400" : "text-red-400"}`}>
        {up ? "+" : ""}
        {value}%
      </span>
      <span className="text-xs text-zinc-500">vs last week</span>
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<StatsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/stats", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((json: StatsPayload) => {
        if (alive) setData(json)
      })
      .catch((err) => {
        if (alive) setError(String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  const totals = data?.totals
  const loading = !data && !error
  const value = (n: number | undefined) => (loading ? "…" : (n ?? 0).toLocaleString())

  const stats = [
    { label: "Total Leads", value: value(totals?.leads), trend: data?.trends.leads ?? null, icon: Users, color: "text-blue-400" },
    { label: "Verified Emails", value: value(totals?.verifiedEmails), trend: data?.trends.verifiedEmails ?? null, icon: Mail, color: "text-emerald-400" },
    { label: "Searches Today", value: value(totals?.searchesToday), trend: data?.trends.searches ?? null, icon: Search, color: "text-purple-400" },
    { label: "Active Campaigns", value: value(totals?.activeCampaigns), trend: data?.trends.campaigns ?? null, icon: Megaphone, color: "text-orange-400" },
  ]

  const recentActivity = data?.recentActivity ?? []
  const topSources = data?.sources ?? []
  const monthly = data?.monthly ?? []
  const peakMonthly = Math.max(1, ...monthly.map((month) => month.leads))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Live counts from the database
            {data?.generatedAt ? ` — updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/chat">
            <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5">
              <MessageSquare className="w-4 h-4 mr-2" /> AI Chat
            </Button>
          </Link>
          <Link href="/dashboard/leads">
            <Button size="sm" className="bg-blue-500 hover:bg-blue-600">
              <Plus className="w-4 h-4 mr-2" /> Add Lead
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-4 text-sm text-red-300">
            Could not load stats ({error}). This dashboard reads /api/stats — the API or the database is unreachable.
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-[#0a0a0a] border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-zinc-400 text-sm">{stat.label}</span>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <TrendLabel value={stat.trend} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <Card className="lg:col-span-2 bg-[#0a0a0a] border-white/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <span className="text-xs text-zinc-500">
                {totals ? `${totals.searchesTotal} search${totals.searchesTotal === 1 ? "" : "es"} recorded` : ""}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.length === 0 && (
                <p className="text-sm text-zinc-500 py-6 text-center">
                  Nothing yet. Run a search in{" "}
                  <Link href="/chat" className="text-blue-400 hover:underline">
                    AI Chat
                  </Link>{" "}
                  — every search and every lead is recorded here.
                </p>
              )}
              {recentActivity.map((activity, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    activity.type === "lead" ? "bg-blue-500/20" :
                    activity.type === "verify" ? "bg-emerald-500/20" :
                    activity.type === "search" ? "bg-purple-500/20" :
                    activity.type === "campaign" ? "bg-orange-500/20" :
                    "bg-zinc-500/20"
                  }`}>
                    {activity.type === "lead" ? <Users className="w-4 h-4 text-blue-400" /> :
                     activity.type === "verify" ? <Mail className="w-4 h-4 text-emerald-400" /> :
                     activity.type === "search" ? <Eye className="w-4 h-4 text-purple-400" /> :
                     activity.type === "campaign" ? <Megaphone className="w-4 h-4 text-orange-400" /> :
                     <Download className="w-4 h-4 text-zinc-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{activity.action}</p>
                    <p className="text-xs text-zinc-400 truncate">{activity.detail}</p>
                  </div>
                  <span className="text-xs text-zinc-500 flex-shrink-0">{activity.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Lead Sources */}
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topSources.length === 0 && (
                <p className="text-sm text-zinc-500 py-6 text-center">No leads stored yet — sources appear as leads arrive.</p>
              )}
              {topSources.map((source) => (
                <div key={source.name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{source.name}</span>
                    <span className="text-zinc-400">{source.leads.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all"
                      style={{ width: `${source.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link href="/chat">
              <Button variant="outline" className="w-full justify-start border-white/10 hover:bg-white/5">
                <MessageSquare className="w-4 h-4 mr-2" /> Lead Search
              </Button>
            </Link>
            <Link href="/dashboard/verify">
              <Button variant="outline" className="w-full justify-start border-white/10 hover:bg-white/5">
                <Mail className="w-4 h-4 mr-2" /> Verify Email
              </Button>
            </Link>
            <Link href="/dashboard/research">
              <Button variant="outline" className="w-full justify-start border-white/10 hover:bg-white/5">
                <Search className="w-4 h-4 mr-2" /> Research Co.
              </Button>
            </Link>
            <Link href="/dashboard/export">
              <Button variant="outline" className="w-full justify-start border-white/10 hover:bg-white/5">
                <Download className="w-4 h-4 mr-2" /> Export
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Leads per month */}
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Leads Over Time</CardTitle>
            <Badge className="bg-blue-500/20 text-blue-400 border-0">last 12 months</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-end gap-2">
            {monthly.map((month, i) => (
              <div
                key={i}
                className="flex-1 flex flex-col items-center gap-1"
                title={`${month.label} ${month.year}: ${month.leads} leads`}
              >
                <div
                  className="w-full rounded-t bg-gradient-to-t from-blue-500 to-emerald-500 opacity-80 hover:opacity-100 transition"
                  style={{ height: `${month.leads === 0 ? 2 : Math.max(6, (month.leads / peakMonthly) * 100)}%` }}
                />
                <span className="text-[10px] text-zinc-600">{month.label}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-3 text-xs text-zinc-500">
            <span>Peak month: {peakMonthly.toLocaleString()} leads</span>
            <span>Total stored: {(totals?.leads ?? 0).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
