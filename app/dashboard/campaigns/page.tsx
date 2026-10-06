"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { LucideIcon } from "lucide-react"
import {
  Plus, Megaphone, Users, Mail, TrendingUp,
  MoreHorizontal, Target, BarChart3, Send, Phone, Loader2,
  AlertTriangle, RefreshCw,
} from "lucide-react"

/**
 * Campaigns are read from GET /api/campaigns — real rows from the Campaign table, each carrying the
 * real number of attached leads. There is no demo data here: an empty table renders an empty state.
 * A rate the database has never recorded (no sends yet) is shown as "—", never as a fabricated 0.0.
 */

interface Campaign {
  id: string
  name: string
  description: string | null
  status: string
  type: string
  targetLeads: number
  sentCount: number
  openRate: number
  replyRate: number
  createdAt: string
  _count: { leads: number }
}

interface ApiError {
  status: number | null
  message: string
}

const STATUSES = ["draft", "active", "paused", "completed"] as const
const TYPES = ["email", "linkedin", "phone", "multi"] as const
const FILTERS = ["all", ...STATUSES] as const

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400",
  paused: "bg-yellow-500/20 text-yellow-400",
  completed: "bg-blue-500/20 text-blue-400",
  draft: "bg-zinc-500/20 text-zinc-400",
}

const typeIcons: Record<string, LucideIcon> = {
  email: Mail,
  linkedin: Users,
  phone: Phone,
  multi: Target,
}

function apiMessage(status: number, body: unknown): string {
  const message =
    body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "The request failed."
  return `HTTP ${status}: ${message}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString()
}

// A rate is only real once something has been sent. With no sends there is no open or reply rate to
// report, so it reads "—" instead of a misleading 0.0%.
function formatRate(value: number | null | undefined, sentCount: number): string {
  if (!Number.isFinite(sentCount) || sentCount <= 0) return "—"
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  return `${value}%`
}

function averageRate(campaigns: Campaign[], key: "openRate" | "replyRate"): string {
  const measured = campaigns.filter((c) => c.sentCount > 0 && Number.isFinite(c[key]))
  if (measured.length === 0) return "—"
  const avg = measured.reduce((sum, c) => sum + c[key], 0) / measured.length
  return `${avg.toFixed(1)}%`
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [busyId, setBusyId] = useState<string | null>(null)

  // Create form
  const [formName, setFormName] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formType, setFormType] = useState<(typeof TYPES)[number]>("email")
  const [formStatus, setFormStatus] = useState<(typeof STATUSES)[number]>("draft")
  const [formTarget, setFormTarget] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // `silent` re-reads without flashing the full-page loader (used after a write).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Could not load campaigns."
        setError({ status: res.status, message })
        setLoading(false)
        return
      }
      setCampaigns((body as { campaigns?: Campaign[] }).campaigns ?? [])
      setLoading(false)
    } catch (e) {
      setError({ status: null, message: e instanceof Error ? e.message : "Network error while loading campaigns." })
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = campaigns.filter((c) => statusFilter === "all" || c.status === statusFilter)
  const activeCount = campaigns.filter((c) => c.status === "active").length

  async function updateStatus(id: string, status: string) {
    setActionError(null)
    setBusyId(id)
    try {
      const res = await fetch("/api/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(apiMessage(res.status, body))
        setBusyId(null)
        return
      }
      await load(true)
      setBusyId(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Network error while updating the campaign.")
      setBusyId(null)
    }
  }

  async function createCampaign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          description: formDescription || undefined,
          type: formType,
          status: formStatus,
          targetLeads: formTarget.trim() === "" ? undefined : Number(formTarget),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(apiMessage(res.status, body))
        setCreating(false)
        return
      }
      setFormName("")
      setFormDescription("")
      setFormType("email")
      setFormStatus("draft")
      setFormTarget("")
      setCreating(false)
      setShowCreate(false)
      await load(true)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Network error while creating the campaign.")
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {loading ? "Loading…" : error ? "Could not load campaigns" : `${campaigns.length} campaigns • ${activeCount} active`}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm" className="bg-blue-500 hover:bg-blue-600">
          <Plus className="w-4 h-4 mr-2" /> New Campaign
        </Button>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Stats — computed from the stored rows. A rate with no sends behind it reads "—". */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
              <Megaphone className="w-4 h-4" /> Total Campaigns
            </div>
            <div className="text-2xl font-bold">{campaigns.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
              <Send className="w-4 h-4" /> Emails Sent
            </div>
            <div className="text-2xl font-bold">{campaigns.reduce((a, c) => a + c.sentCount, 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
              <Mail className="w-4 h-4" /> Avg Open Rate
            </div>
            <div className="text-2xl font-bold text-emerald-400">{averageRate(campaigns, "openRate")}</div>
          </CardContent>
        </Card>
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1">
              <TrendingUp className="w-4 h-4" /> Avg Reply Rate
            </div>
            <div className="text-2xl font-bold text-blue-400">{averageRate(campaigns, "replyRate")}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {FILTERS.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === status ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {loading && (
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Loading campaigns…</p>
          </CardContent>
        </Card>
      )}

      {!loading && error && (
        <Card className="bg-[#0a0a0a] border-red-500/30">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <p className="font-medium">Could not load campaigns</p>
            </div>
            <p className="text-sm text-zinc-400">
              {error.status !== null ? `HTTP ${error.status}: ` : ""}
              {error.message}
            </p>
            <Button onClick={() => void load()} size="sm" variant="outline" className="border-white/10">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && campaigns.length === 0 && (
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
              <Megaphone className="w-5 h-5 text-zinc-400" />
            </div>
            <p className="font-medium">No campaigns yet</p>
            <p className="text-sm text-zinc-400 max-w-sm">
              The campaigns table is empty. Create your first campaign to start tracking outreach.
            </p>
            <Button onClick={() => setShowCreate(true)} size="sm" className="bg-blue-500 hover:bg-blue-600">
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && campaigns.length > 0 && filtered.length === 0 && (
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-6 text-sm text-zinc-400">No campaigns match the “{statusFilter}” filter.</CardContent>
        </Card>
      )}

      {/* Campaign Cards */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((campaign) => {
            const TypeIcon = typeIcons[campaign.type] || Megaphone
            const progress = campaign.targetLeads > 0 ? (campaign.sentCount / campaign.targetLeads) * 100 : 0
            return (
              <Card key={campaign.id} className="bg-[#0a0a0a] border-white/10 hover:border-white/20 transition">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        campaign.status === "active" ? "bg-emerald-500/20" : "bg-white/5"
                      }`}>
                        <TypeIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{campaign.name}</h3>
                        <p className="text-xs text-zinc-400">{campaign.description || campaign.type}</p>
                      </div>
                    </div>
                    <Badge className={`${statusColors[campaign.status] || "bg-white/5 text-zinc-300"} border-0 text-xs`}>
                      {campaign.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="text-center p-2 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Sent</p>
                      <p className="font-bold text-sm">{campaign.sentCount}/{campaign.targetLeads}</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Leads</p>
                      <p className="font-bold text-sm">{campaign._count.leads}</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Open</p>
                      <p className="font-bold text-sm text-emerald-400">
                        {formatRate(campaign.openRate, campaign.sentCount)}
                      </p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Reply</p>
                      <p className="font-bold text-sm text-blue-400">
                        {formatRate(campaign.replyRate, campaign.sentCount)}
                      </p>
                    </div>
                  </div>

                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-zinc-500">Created {formatDate(campaign.createdAt)}</span>
                    <div className="flex items-center gap-1">
                      <Select
                        value={campaign.status}
                        onValueChange={(value) => void updateStatus(campaign.id, value)}
                        disabled={busyId === campaign.id}
                      >
                        <SelectTrigger
                          className="h-8 w-[130px] bg-white/5 border-white/10 text-xs"
                          aria-label={`Status for ${campaign.name}`}
                        >
                          {busyId === campaign.id ? (
                            <span className="flex items-center gap-1.5 text-zinc-400">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving
                            </span>
                          ) : (
                            <SelectValue />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="w-8 h-8 text-zinc-400" aria-label="View campaign stats">
                        <BarChart3 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-8 h-8 text-zinc-400" aria-label="More options">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Campaign Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-[#0a0a0a] border-white/10">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
            <DialogDescription>Set up a new outreach campaign. It is written to the database on save.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createCampaign} className="space-y-4 mt-4">
            <div>
              <Label htmlFor="campaign-name" className="text-sm font-medium mb-1.5 block">Campaign Name</Label>
              <Input
                id="campaign-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Q1 SaaS Outreach"
                required
                className="bg-white/5 border-white/10"
              />
            </div>
            <div>
              <Label htmlFor="campaign-description" className="text-sm font-medium mb-1.5 block">Description</Label>
              <Textarea
                id="campaign-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe your campaign goals..."
                className="bg-white/5 border-white/10"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="campaign-type" className="text-sm font-medium mb-1.5 block">Campaign Type</Label>
                <Select value={formType} onValueChange={(v) => setFormType(v as (typeof TYPES)[number])}>
                  <SelectTrigger id="campaign-type" className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="campaign-status" className="text-sm font-medium mb-1.5 block">Status</Label>
                <Select value={formStatus} onValueChange={(v) => setFormStatus(v as (typeof STATUSES)[number])}>
                  <SelectTrigger id="campaign-status" className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="campaign-target" className="text-sm font-medium mb-1.5 block">Target Leads</Label>
              <Input
                id="campaign-target"
                type="number"
                min={0}
                step={1}
                value={formTarget}
                onChange={(e) => setFormTarget(e.target.value)}
                placeholder="0"
                className="bg-white/5 border-white/10"
              />
            </div>

            {createError && (
              <p className="text-sm text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> {createError}
              </p>
            )}

            <Button type="submit" disabled={creating} className="w-full bg-blue-500 hover:bg-blue-600">
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Create Campaign
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
