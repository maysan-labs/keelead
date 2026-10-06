"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Search, Plus, Download, Trash2, Tag, ChevronDown, MoreHorizontal,
  Mail, Phone, Globe, Linkedin, Eye, RefreshCw, ChevronLeft, ChevronRight,
} from "lucide-react"

// The list a rep works from reads REAL rows. Nothing here is invented: every value comes from
// GET /api/leads, and every filter is applied by the database, not by slicing an array in the
// browser — the list has to survive thousands of rows and stay the source of truth.

const PAGE_SIZE = 25

type LeadStage = "new" | "contacted" | "qualified" | "converted" | "lost"

interface Lead {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  website: string | null
  linkedin: string | null
  location: string | null
  source: string | null
  status: string
  score: number
  verified: boolean
  tags: string | null
  notes: string | null
  metadata: string | null
  campaignId: string | null
  createdAt: string
  updatedAt: string
}

interface LeadActivity {
  id: string
  leadId: string
  type: string
  fromValue: string | null
  toValue: string | null
  detail: string | null
  actor: string
  createdAt: string
}

interface LeadsListResponse {
  total: number
  leads: Lead[]
  limit: number
  offset: number
  count: number
}

interface StageInfo {
  id: LeadStage
  name: string
  color: string
  description: string
}

interface LeadDetailResponse {
  lead: Lead & { activities: LeadActivity[] }
  stage: LeadStage | null
  allowedTransitions: LeadStage[]
  stages: StageInfo[]
}

type FetchError = { status: number; message: string }

const statusColors: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400",
  contacted: "bg-yellow-500/20 text-yellow-400",
  qualified: "bg-purple-500/20 text-purple-400",
  converted: "bg-emerald-500/20 text-emerald-400",
  lost: "bg-zinc-500/20 text-zinc-300",
}

function initials(lead: Lead): string {
  const first = (lead.firstName || "").trim().charAt(0)
  const last = (lead.lastName || "").trim().charAt(0)
  return `${first}${last}`.toUpperCase() || "?"
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : []
  } catch {
    return []
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

function stageName(stages: StageInfo[], id: string): string {
  return stages.find((stage) => stage.id === id)?.name ?? id
}

export default function LeadsPage() {
  // List state: loading / error / loaded, driven by a server round-trip.
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [listStatus, setListStatus] = useState<"loading" | "error" | "loaded">("loading")
  const [listError, setListError] = useState<FetchError | null>(null)

  // Filters. Only `q`, `minScore`, `status` and `order` are sent as query params — the server does
  // the filtering. The text/number inputs are debounced before they become query params.
  const [qInput, setQInput] = useState("")
  const [scoreInput, setScoreInput] = useState("")
  const [q, setQ] = useState("")
  const [minScore, setMinScore] = useState("")
  const [status, setStatus] = useState("")
  const [order, setOrder] = useState<"recent" | "score" | "company">("recent")
  const [offset, setOffset] = useState(0)

  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set())
  const [reloadKey, setReloadKey] = useState(0)

  // Detail drawer: its own fetch of /api/leads/{id}, with the activity trail and allowed moves.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<LeadDetailResponse | null>(null)
  const [detailStatus, setDetailStatus] = useState<"loading" | "error" | "loaded">("loading")
  const [detailError, setDetailError] = useState<FetchError | null>(null)
  const [detailReloadKey, setDetailReloadKey] = useState(0)

  const [note, setNote] = useState("")
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  // Debounce the free-text filters so a keystroke does not fire a request per character.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim())
      setMinScore(scoreInput.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [qInput, scoreInput])

  // Fetch the page whenever a server-side filter or the page window changes.
  useEffect(() => {
    const controller = new AbortController()
    setListStatus("loading")
    setListError(null)
    setSelectedLeads(new Set())

    const params = new URLSearchParams()
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(offset))
    params.set("order", order)
    if (q) params.set("q", q)
    if (status) params.set("status", status)
    if (minScore) params.set("minScore", minScore)

    ;(async () => {
      try {
        const res = await fetch(`/api/leads?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!res.ok) {
          let message = `Request failed with status ${res.status}`
          try {
            const body = await res.json()
            if (body && typeof body.error === "string") message = body.error
          } catch {
            /* non-JSON error body — keep the status-based message */
          }
          setListError({ status: res.status, message })
          setListStatus("error")
          return
        }
        const data = (await res.json()) as LeadsListResponse
        setLeads(Array.isArray(data.leads) ? data.leads : [])
        setTotal(typeof data.total === "number" ? data.total : 0)
        setListStatus("loaded")
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        setListError({ status: 0, message: (err as Error).message || "Network request failed" })
        setListStatus("error")
      }
    })()

    return () => controller.abort()
  }, [q, status, minScore, order, offset, reloadKey])

  // Fetch the selected lead plus its trail.
  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    setDetailStatus("loading")
    setDetailError(null)
    setDetail(null)
    setMoveError(null)
    setNote("")

    ;(async () => {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(selectedId)}`, {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!res.ok) {
          let message = `Request failed with status ${res.status}`
          try {
            const body = await res.json()
            if (body && typeof body.error === "string") message = body.error
          } catch {
            /* non-JSON error body */
          }
          setDetailError({ status: res.status, message })
          setDetailStatus("error")
          return
        }
        const data = (await res.json()) as LeadDetailResponse
        setDetail(data)
        setDetailStatus("loaded")
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        setDetailError({ status: 0, message: (err as Error).message || "Network request failed" })
        setDetailStatus("error")
      }
    })()

    return () => controller.abort()
  }, [selectedId, detailReloadKey])

  const filtersActive = q !== "" || status !== "" || minScore !== ""

  const clearFilters = () => {
    setQInput("")
    setScoreInput("")
    setQ("")
    setMinScore("")
    setStatus("")
    setOffset(0)
  }

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = offset + leads.length
  const hasPrev = offset > 0
  const hasNext = offset + leads.length < total

  const toggleSelectAll = () => {
    if (selectedLeads.size === leads.length && leads.length > 0) {
      setSelectedLeads(new Set())
    } else {
      setSelectedLeads(new Set(leads.map((lead) => lead.id)))
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedLeads)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedLeads(next)
  }

  const moveLead = async (to: LeadStage) => {
    if (!selectedId || moving) return
    setMoving(true)
    setMoveError(null)
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: to,
          actor: "console",
          note: note.trim() || undefined,
        }),
      })
      if (!res.ok) {
        // Surface the API's reason verbatim — a refused move is information, not noise.
        let message = `Request failed with status ${res.status}`
        try {
          const body = await res.json()
          if (body && typeof body.error === "string") message = body.error
        } catch {
          /* non-JSON error body */
        }
        setMoveError(message)
        return
      }
      setNote("")
      setDetailReloadKey((key) => key + 1)
      setReloadKey((key) => key + 1)
    } catch (err) {
      setMoveError((err as Error).message || "Network request failed")
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {listStatus === "loaded" ? `${total} total leads` : "Loading leads…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild className="border-white/10 hover:bg-white/5">
            <a href="/api/export?format=csv" download>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </a>
          </Button>
          <Button size="sm" asChild className="bg-blue-500 hover:bg-blue-600">
            <Link href="/dashboard/finder">
              <Plus className="w-4 h-4 mr-2" /> Add Lead
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters — every control below becomes a query param; nothing is filtered client-side. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search leads..."
            className="pl-9 bg-white/5 border-white/10"
          />
        </div>
        <div className="flex gap-2">
          {["all", "new", "contacted", "qualified", "converted", "lost"].map((value) => (
            <button
              key={value}
              onClick={() => {
                setStatus(value === "all" ? "" : value)
                setOffset(0)
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                (value === "all" && status === "") || status === value
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="relative">
          <Input
            value={scoreInput}
            onChange={(e) => setScoreInput(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="Min score"
            className="w-28 bg-white/5 border-white/10"
          />
        </div>
        <div className="relative">
          <select
            value={order}
            onChange={(e) => {
              setOrder(e.target.value as "recent" | "score" | "company")
              setOffset(0)
            }}
            className="h-9 rounded-md border border-white/10 bg-white/5 px-3 pr-8 text-sm text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring appearance-none"
          >
            <option value="recent">Newest</option>
            <option value="score">Highest score</option>
            <option value="company">Company A–Z</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        </div>
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition"
          >
            Clear filters
          </button>
        )}
        {selectedLeads.size > 0 && (
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" className="border-white/10 text-xs">
              <Tag className="w-3 h-3 mr-1" /> Tag ({selectedLeads.size})
            </Button>
            <Button variant="outline" size="sm" asChild className="border-white/10 text-xs">
              <a href="/api/export?format=csv" download>
                <Download className="w-3 h-3 mr-1" /> Export ({selectedLeads.size})
              </a>
            </Button>
            <Button variant="outline" size="sm" className="border-red-500/20 text-red-400 text-xs hover:bg-red-500/10">
              <Trash2 className="w-3 h-3 mr-1" /> Delete ({selectedLeads.size})
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-3 w-10">
                    <Checkbox
                      checked={leads.length > 0 && selectedLeads.size === leads.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Name</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Company</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Title</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Email</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Source</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Status</th>
                  <th className="text-left p-3 text-zinc-400 font-medium">Score</th>
                  <th className="text-left p-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {listStatus === "loading" &&
                  Array.from({ length: 6 }).map((_, row) => (
                    <tr key={`skeleton-${row}`} className="border-b border-white/5">
                      <td className="p-3">
                        <Skeleton className="h-4 w-4" />
                      </td>
                      {Array.from({ length: 7 }).map((__, cell) => (
                        <td key={cell} className="p-3">
                          <Skeleton className="h-4 w-full max-w-[140px]" />
                        </td>
                      ))}
                      <td className="p-3" />
                    </tr>
                  ))}

                {listStatus === "error" && listError && (
                  <tr className="border-b border-white/5">
                    <td colSpan={9} className="p-8">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <p className="text-sm text-red-400 font-medium">
                          {listError.status > 0
                            ? `Could not load leads (HTTP ${listError.status})`
                            : "Could not load leads"}
                        </p>
                        <p className="text-xs text-zinc-400 whitespace-pre-wrap">{listError.message}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-white/10 hover:bg-white/5"
                          onClick={() => setReloadKey((key) => key + 1)}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" /> Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}

                {listStatus === "loaded" && leads.length === 0 && filtersActive && (
                  <tr className="border-b border-white/5">
                    <td colSpan={9} className="p-10 text-center">
                      <p className="text-sm text-zinc-300 font-medium">No rows match these filters</p>
                      <p className="text-xs text-zinc-400 mt-1">
                        Nothing in the database matches the current search, status or score.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 border-white/10 hover:bg-white/5"
                        onClick={clearFilters}
                      >
                        Clear filters
                      </Button>
                    </td>
                  </tr>
                )}

                {listStatus === "loaded" && leads.length === 0 && !filtersActive && (
                  <tr className="border-b border-white/5">
                    <td colSpan={9} className="p-10 text-center">
                      <p className="text-sm text-zinc-300 font-medium">No leads yet</p>
                      <p className="text-xs text-zinc-400 mt-1">
                        Your database is empty. Find leads to get started.
                      </p>
                      <Button size="sm" asChild className="mt-4 bg-blue-500 hover:bg-blue-600">
                        <Link href="/dashboard/finder">
                          <Plus className="w-4 h-4 mr-2" /> Find Leads
                        </Link>
                      </Button>
                    </td>
                  </tr>
                )}

                {listStatus === "loaded" &&
                  leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition"
                      onClick={() => setSelectedId(lead.id)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedLeads.has(lead.id)} onCheckedChange={() => toggleSelect(lead.id)} />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-xs font-bold">
                            {initials(lead)}
                          </div>
                          <div>
                            <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                            <p className="text-xs text-zinc-400">{lead.phone || "No phone"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-zinc-300">{lead.company || "—"}</td>
                      <td className="p-3 text-zinc-400">{lead.title || "—"}</td>
                      <td className="p-3">
                        <span className={lead.verified ? "text-emerald-400" : "text-zinc-400"}>
                          {lead.email || "—"}
                        </span>
                      </td>
                      <td className="p-3">
                        {lead.source ? (
                          <Badge variant="outline" className="border-white/10 text-zinc-400 text-xs">
                            {lead.source}
                          </Badge>
                        ) : (
                          <span className="text-zinc-500 text-xs">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge className={`${statusColors[lead.status] || "bg-white/10 text-zinc-300"} border-0 text-xs`}>
                          {lead.status}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                lead.score >= 90 ? "bg-emerald-500" : lead.score >= 70 ? "bg-blue-500" : "bg-yellow-500"
                              }`}
                              style={{ width: `${Math.max(0, Math.min(100, lead.score))}%` }}
                            />
                          </div>
                          <span className="text-xs text-zinc-400">{lead.score}</span>
                        </div>
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="w-8 h-8 text-zinc-400">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Pagination — driven by total/limit/offset returned by the API. */}
          <div className="flex items-center justify-between gap-3 border-t border-white/10 p-3">
            <p className="text-xs text-zinc-400">
              {total === 0 ? "0 leads" : `${pageStart}–${pageEnd} of ${total}`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 hover:bg-white/5"
                disabled={!hasPrev || listStatus === "loading"}
                onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 hover:bg-white/5"
                disabled={!hasNext || listStatus === "loading"}
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lead Detail Sidebar */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelectedId(null)} />
          <div className="relative w-full max-w-md bg-[#0a0a0a] border-l border-white/10 h-full overflow-y-auto animate-slide-in">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold">Lead Details</h2>
                <button onClick={() => setSelectedId(null)} className="text-zinc-400 hover:text-white">
                  ✕
                </button>
              </div>

              {detailStatus === "loading" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="w-14 h-14 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              )}

              {detailStatus === "error" && detailError && (
                <div className="flex flex-col items-center gap-3 text-center py-10">
                  <p className="text-sm text-red-400 font-medium">
                    {detailError.status > 0
                      ? `Could not load this lead (HTTP ${detailError.status})`
                      : "Could not load this lead"}
                  </p>
                  <p className="text-xs text-zinc-400 whitespace-pre-wrap">{detailError.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 hover:bg-white/5"
                    onClick={() => setDetailReloadKey((key) => key + 1)}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" /> Retry
                  </Button>
                </div>
              )}

              {detailStatus === "loaded" && detail && (
                <>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-lg font-bold">
                      {initials(detail.lead)}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">{detail.lead.firstName} {detail.lead.lastName}</h3>
                      <p className="text-zinc-400">
                        {detail.lead.title || "—"}
                        {detail.lead.company ? ` at ${detail.lead.company}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <Mail className="w-4 h-4 text-zinc-400" />
                      <div>
                        <p className="text-xs text-zinc-400">Email</p>
                        <p className={`${detail.lead.verified ? "text-emerald-400" : ""} break-all`}>
                          {detail.lead.email || <span className="text-zinc-500">Not recorded</span>}
                        </p>
                      </div>
                      {detail.lead.verified && (
                        <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-0 text-xs">Verified</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <Phone className="w-4 h-4 text-zinc-400" />
                      <div>
                        <p className="text-xs text-zinc-400">Phone</p>
                        <p>{detail.lead.phone || <span className="text-zinc-500">Not recorded</span>}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <Globe className="w-4 h-4 text-zinc-400" />
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-400">Website</p>
                        {detail.lead.website ? (
                          <a
                            href={detail.lead.website}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 break-all"
                          >
                            {detail.lead.website}
                          </a>
                        ) : (
                          <p className="text-zinc-500">Not recorded</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                      <Linkedin className="w-4 h-4 text-zinc-400" />
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-400">LinkedIn</p>
                        {detail.lead.linkedin ? (
                          <a
                            href={detail.lead.linkedin}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 break-all"
                          >
                            {detail.lead.linkedin}
                          </a>
                        ) : (
                          <p className="text-zinc-500">Not recorded</p>
                        )}
                      </div>
                    </div>
                    {detail.lead.location && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                        <Eye className="w-4 h-4 text-zinc-400" />
                        <div>
                          <p className="text-xs text-zinc-400">Location</p>
                          <p>{detail.lead.location}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    <p className="text-sm text-zinc-400 mb-2">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {parseTags(detail.lead.tags).length > 0 ? (
                        parseTags(detail.lead.tags).map((tag) => (
                          <Badge key={tag} variant="outline" className="border-white/10 text-zinc-300">
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-zinc-500">No tags</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-6">
                    <p className="text-sm text-zinc-400 mb-2">Status</p>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={`${statusColors[detail.lead.status] || "bg-white/10 text-zinc-300"} border-0 text-xs`}
                      >
                        {detail.stage ? stageName(detail.stages, detail.stage) : detail.lead.status}
                      </Badge>
                      {!detail.stage && (
                        <span className="text-xs text-amber-400">
                          Unrecognised stage — this lead cannot be moved.
                        </span>
                      )}
                    </div>

                    {detail.stage && (
                      <>
                        <p className="text-xs text-zinc-400 mt-4 mb-2">
                          {detail.allowedTransitions.length > 0
                            ? "Move to"
                            : "No further moves — this stage is closed"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {detail.allowedTransitions.map((target) => (
                            <button
                              key={target}
                              onClick={() => moveLead(target)}
                              disabled={moving}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                                statusColors[target] || "bg-white/10 text-zinc-300"
                              } ${moving ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"}`}
                            >
                              {stageName(detail.stages, target)}
                            </button>
                          ))}
                        </div>

                        <div className="mt-3">
                          <label className="text-xs text-zinc-400">Note (optional, recorded in the trail)</label>
                          <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            placeholder="Why this move?"
                            className="mt-1 bg-white/5 border-white/10 text-sm"
                          />
                        </div>
                      </>
                    )}

                    {moveError && (
                      <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 whitespace-pre-wrap">
                        {moveError}
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    <p className="text-sm text-zinc-400 mb-3">Activity</p>
                    {detail.lead.activities.length === 0 ? (
                      <p className="text-xs text-zinc-500">No activity recorded for this lead yet.</p>
                    ) : (
                      <ol className="space-y-3">
                        {detail.lead.activities.map((activity) => (
                          <li key={activity.id} className="rounded-lg bg-white/5 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-zinc-200">{activity.type}</span>
                              <span className="text-[11px] text-zinc-500">{formatDate(activity.createdAt)}</span>
                            </div>
                            {(activity.fromValue || activity.toValue) && (
                              <p className="text-xs text-zinc-400 mt-1">
                                {activity.fromValue || "—"} → {activity.toValue || "—"}
                              </p>
                            )}
                            {activity.detail && <p className="text-xs text-zinc-300 mt-1">{activity.detail}</p>}
                            <p className="text-[11px] text-zinc-500 mt-1">by {activity.actor}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  <div className="mt-6 flex gap-2">
                    {detail.lead.email ? (
                      <Button asChild className="flex-1 bg-blue-500 hover:bg-blue-600">
                        <a href={`mailto:${detail.lead.email}`}>
                          <Mail className="w-4 h-4 mr-2" /> Send Email
                        </a>
                      </Button>
                    ) : (
                      <Button disabled className="flex-1 bg-blue-500 hover:bg-blue-600">
                        <Mail className="w-4 h-4 mr-2" /> Send Email
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="border-white/10 hover:bg-white/5"
                      onClick={() => setSelectedId(null)}
                    >
                      <Eye className="w-4 h-4 mr-2" /> Close
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
