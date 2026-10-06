"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { STAGES, allowedTransitions, normaliseStage, type LeadStage } from "@/lib/pipeline"
import {
  Plus, Search, Mail, Phone, Building2, Star, Users, AlertTriangle,
  RefreshCw, Loader2, ArrowRight, Clock, ExternalLink, X,
} from "lucide-react"

// The board reads the real pipeline. Every number below comes from GET /api/pipeline; nothing on
// this page is a sample. A row is a row in the Lead table, and a move is validated by lib/pipeline
// (the same rules the API enforces) so the UI can never offer a move the API would refuse.

interface Lead {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  website: string | null
  location: string | null
  source: string | null
  status: string
  score: number
  verified: boolean
  tags: string | null
  metadata: string | null
  createdAt: string
  updatedAt: string
}

interface BoardStage {
  id: string
  name: string
  color: string
  description: string
  count: number
  leads: Lead[]
}

interface Board {
  stages: BoardStage[]
  unmapped: Lead[]
  unmappedCount: number
  total: number
}

interface Activity {
  id: string
  type: string
  fromValue: string | null
  toValue: string | null
  detail: string | null
  actor: string
  createdAt: string
}

interface LeadDetail {
  lead: Lead & { activities: Activity[] }
  stage: LeadStage | null
}

interface FetchError {
  status: number
  message: string
}

const PER_STAGE = 25

/** `tags` is a JSON-encoded string column — parse defensively, never assume the shape. */
function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : []
  } catch {
    return []
  }
}

function initials(lead: Lead): string {
  const a = (lead.firstName || "").trim().charAt(0)
  const b = (lead.lastName || "").trim().charAt(0)
  return `${a}${b}`.toUpperCase() || "?"
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function stageName(id: string): string {
  return STAGES.find((s) => s.id === id)?.name ?? id
}

export default function PipelinePage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FetchError | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<LeadDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<FetchError | null>(null)

  const [moveErrors, setMoveErrors] = useState<Record<string, string | undefined>>({})
  const [movePending, setMovePending] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pipeline?perStage=${PER_STAGE}`, { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError({ status: res.status, message: body?.error || res.statusText || "Request failed" })
        return
      }
      setBoard(body as Board)
      setFetchedAt(new Date().toISOString())
    } catch (e) {
      setError({ status: 0, message: e instanceof Error ? e.message : "Network error" })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openLead = useCallback(async (id: string) => {
    setSelectedId(id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/leads/${id}`, { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDetailError({ status: res.status, message: body?.error || res.statusText || "Request failed" })
        return
      }
      setDetail(body as LeadDetail)
    } catch (e) {
      setDetailError({ status: 0, message: e instanceof Error ? e.message : "Network error" })
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeLead = () => {
    setSelectedId(null)
    setDetail(null)
    setDetailError(null)
  }

  const moveLead = async (lead: Lead, to: LeadStage) => {
    setMoveErrors((prev) => ({ ...prev, [lead.id]: undefined }))
    setMovePending(lead.id)
    try {
      const note = (notes[lead.id] || "").trim()
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to, actor: "console", ...(note ? { note } : {}) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 409 carries the reason the operator needs — show it verbatim, never swallow it.
        setMoveErrors((prev) => ({
          ...prev,
          [lead.id]: body?.error || `Move failed (HTTP ${res.status})`,
        }))
        return
      }
      setNotes((prev) => ({ ...prev, [lead.id]: "" }))
      await load()
      if (selectedId === lead.id) await openLead(lead.id)
    } catch (e) {
      setMoveErrors((prev) => ({
        ...prev,
        [lead.id]: e instanceof Error ? e.message : "Network error",
      }))
    } finally {
      setMovePending(null)
    }
  }

  const filteredStages = useMemo(() => {
    if (!board) return []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return board.stages
    return board.stages.map((stage) => ({
      ...stage,
      leads: stage.leads.filter((lead) =>
        `${lead.firstName} ${lead.lastName} ${lead.company ?? ""} ${lead.email ?? ""}`
          .toLowerCase()
          .includes(q)
      ),
    }))
  }, [board, searchQuery])

  const moveOptions = useMemo(() => {
    if (!detail) return []
    const from = normaliseStage(detail.lead.status)
    return from ? allowedTransitions(from) : []
  }, [detail])

  return (
    <div className="space-y-6">
      {/* Header strip — every figure is read from the API, with the fetch time it was read at. */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-zinc-400 text-sm mt-1 flex items-center gap-2 flex-wrap">
            <span>{board ? board.total.toLocaleString() : "—"} total leads</span>
            <span className="text-zinc-600">•</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live from the database
            </span>
            {fetchedAt && (
              <span className="text-zinc-500">fetched {formatWhen(fetchedAt)}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter loaded leads..."
              className="pl-9 bg-white/5 border-white/10 w-48"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 hover:bg-white/5"
            onClick={load}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh
          </Button>
          <Button asChild size="sm" className="bg-blue-500 hover:bg-blue-600">
            <Link href="/dashboard/finder">
              <Plus className="w-4 h-4 mr-2" /> Find Leads
            </Link>
          </Button>
        </div>
      </div>

      {/* Error state — the HTTP status and the server's message, plus a retry. */}
      {error && (
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-400">
                Could not load the pipeline{error.status ? ` (HTTP ${error.status})` : ""}
              </p>
              <p className="text-sm text-zinc-300 mt-1 break-words">{error.message}</p>
            </div>
            <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5" onClick={load}>
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading state — skeletons, not fabricated rows. */}
      {loading && !board && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => (
            <div key={stage.id} className="flex-shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-3 h-3 rounded-full ${stage.color} opacity-50`} />
                <span className="font-medium text-sm text-zinc-500">{stage.name}</span>
              </div>
              <div className="space-y-2 min-h-[200px] rounded-xl bg-white/[0.02] border border-white/5 p-2">
                {[0, 1, 2].map((n) => (
                  <div
                    key={n}
                    className="p-3 rounded-xl bg-[#0a0a0a] border border-white/10 animate-pulse space-y-3"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-white/10" />
                      <div className="space-y-1.5 flex-1">
                        <div className="h-3 w-24 rounded bg-white/10" />
                        <div className="h-2.5 w-16 rounded bg-white/5" />
                      </div>
                    </div>
                    <div className="h-2.5 w-20 rounded bg-white/5" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && board && board.total === 0 && (
        // Honest empty state: the database is empty. No placeholder rows.
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-10 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <Users className="w-5 h-5 text-zinc-400" />
            </div>
            <h2 className="text-lg font-semibold">No leads yet</h2>
            <p className="text-sm text-zinc-400 mt-1 max-w-md">
              The database has no leads, so there is nothing to show here. Run a search on the Find
              Leads page to populate the pipeline — rows will appear as real leads are saved.
            </p>
            <Button asChild className="mt-5 bg-blue-500 hover:bg-blue-600">
              <Link href="/dashboard/finder">
                <Search className="w-4 h-4 mr-2" /> Go to Find Leads
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && board && board.total > 0 && (
        <>
          {/* A stored status that is not a known stage is a data problem — show it, never hide it. */}
          {board.unmappedCount > 0 && (
            <Card className="bg-yellow-500/5 border-yellow-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-yellow-400">
                  <AlertTriangle className="w-4 h-4" />
                  {board.unmappedCount} lead{board.unmappedCount === 1 ? "" : "s"} with an unrecognised
                  status
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-zinc-400 mb-3">
                  These rows have a stored status that is not one of the pipeline stages
                  ({STAGES.map((s) => s.id).join(", ")}), so they belong to no column. They are shown
                  here so a bad write is visible rather than counted into a stage it does not belong to.
                </p>
                <div className="space-y-2">
                  {board.unmapped.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => openLead(lead.id)}
                      className="w-full text-left p-3 rounded-xl bg-[#0a0a0a] border border-yellow-500/20 hover:border-yellow-500/40 transition flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {lead.firstName} {lead.lastName}
                        </p>
                        <p className="text-xs text-zinc-400 truncate">
                          {lead.company || "No company"} · {lead.email || lead.phone || "no contact"}
                        </p>
                      </div>
                      <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 text-[10px] flex-shrink-0">
                        status: {lead.status}
                      </Badge>
                    </button>
                  ))}
                </div>
                {board.unmappedCount > board.unmapped.length && (
                  <p className="text-[11px] text-zinc-500 mt-2">
                    Showing {board.unmapped.length} of {board.unmappedCount}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stage summary strip — counts come from the API, not from the rows rendered. */}
          <div className="flex flex-wrap gap-4">
            {board.stages.map((stage) => (
              <div key={stage.id} className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                <span className="text-sm text-zinc-400">{stage.name}</span>
                <Badge variant="outline" className="border-white/10 text-xs">
                  {stage.count.toLocaleString()}
                </Badge>
              </div>
            ))}
          </div>

          {/* Kanban board */}
          <div className="flex gap-4 overflow-x-auto pb-4">
            {filteredStages.map((stage) => (
              <div key={stage.id} className="flex-shrink-0 w-72">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${stage.color}`} />
                    <span className="font-medium text-sm">{stage.name}</span>
                    <Badge variant="outline" className="border-white/10 text-xs text-zinc-400">
                      {stage.count.toLocaleString()}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-2 min-h-[200px] rounded-xl bg-white/[0.02] border border-white/5 p-2">
                  {stage.leads.map((lead) => {
                    const tags = parseTags(lead.tags)
                    return (
                      <div
                        key={lead.id}
                        onClick={() => openLead(lead.id)}
                        className="p-3 rounded-xl bg-[#0a0a0a] border border-white/10 hover:border-white/20 cursor-pointer transition group"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {initials(lead)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {lead.firstName} {lead.lastName}
                              </p>
                              <p className="text-xs text-zinc-400 truncate">{lead.title || "—"}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Star className="w-3 h-3 text-yellow-500" />
                            <span className="text-xs font-medium">{lead.score}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mb-2 text-xs text-zinc-400 min-w-0">
                          <Building2 className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{lead.company || "No company"}</span>
                        </div>

                        {(lead.email || lead.phone) && (
                          <div className="space-y-1 mb-2">
                            {lead.email && (
                              <div className="flex items-center gap-2 text-xs text-zinc-400 min-w-0">
                                <Mail className="w-3 h-3 flex-shrink-0" />
                                <span className={`truncate ${lead.verified ? "text-emerald-400" : ""}`}>
                                  {lead.email}
                                </span>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-2 text-xs text-zinc-400 min-w-0">
                                <Phone className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{lead.phone}</span>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="border-white/10 text-zinc-400 text-[10px] max-w-[8rem] truncate">
                            {lead.source || "unknown source"}
                          </Badge>
                          <div className="flex gap-1">
                            {tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="outline" className="border-white/10 text-zinc-400 text-[10px]">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {moveErrors[lead.id] && (
                          <p className="mt-2 text-[10px] text-red-400 leading-snug">
                            {moveErrors[lead.id]}
                          </p>
                        )}
                      </div>
                    )
                  })}

                  {stage.leads.length === 0 && (
                    <div className="text-center py-8 text-zinc-600 text-xs">
                      {searchQuery ? "No loaded lead matches the filter" : "No leads in this stage"}
                    </div>
                  )}

                  {stage.count > stage.leads.length && (
                    <p className="text-center text-[10px] text-zinc-600 pt-1">
                      Showing {stage.leads.length} of {stage.count.toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Lead detail — the audit trail is the point of this panel. */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={closeLead} />
          <div className="relative w-full max-w-md bg-[#0a0a0a] border-l border-white/10 h-full overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold">Lead Details</h2>
                <button onClick={closeLead} className="text-zinc-400 hover:text-white" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {detailLoading && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading lead…
                </div>
              )}

              {detailError && !detailLoading && (
                <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                  <p className="text-sm text-red-400">
                    Could not load this lead{detailError.status ? ` (HTTP ${detailError.status})` : ""}
                  </p>
                  <p className="text-xs text-zinc-300 mt-1 break-words">{detailError.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 hover:bg-white/5 mt-3"
                    onClick={() => openLead(selectedId)}
                  >
                    <RefreshCw className="w-3 h-3 mr-2" /> Retry
                  </Button>
                </div>
              )}

              {detail && !detailLoading && (
                <>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-lg font-bold flex-shrink-0">
                      {initials(detail.lead)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold truncate">
                        {detail.lead.firstName} {detail.lead.lastName}
                      </h3>
                      <p className="text-zinc-400 text-sm truncate">
                        {detail.lead.title || "—"}
                        {detail.lead.company ? ` at ${detail.lead.company}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {detail.lead.email && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                        <Mail className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-400">Email</p>
                          <p className={`truncate ${detail.lead.verified ? "text-emerald-400" : ""}`}>
                            {detail.lead.email}
                          </p>
                        </div>
                        {detail.lead.verified && (
                          <Badge className="ml-auto bg-emerald-500/20 text-emerald-400 border-0 text-xs flex-shrink-0">
                            Verified
                          </Badge>
                        )}
                      </div>
                    )}
                    {detail.lead.phone && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                        <Phone className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-400">Phone</p>
                          <p className="truncate">{detail.lead.phone}</p>
                        </div>
                      </div>
                    )}
                    {detail.lead.website && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                        <ExternalLink className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-400">Website</p>
                          <a
                            href={detail.lead.website}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 truncate block"
                          >
                            {detail.lead.website}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Stage</p>
                      <p className="mt-0.5">
                        {detail.stage ? stageName(detail.stage) : (
                          <span className="text-yellow-400">unrecognised: {detail.lead.status}</span>
                        )}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Score</p>
                      <p className="mt-0.5 flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-yellow-500" /> {detail.lead.score}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Source</p>
                      <p className="mt-0.5 truncate">{detail.lead.source || "—"}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/5">
                      <p className="text-xs text-zinc-400">Location</p>
                      <p className="mt-0.5 truncate">{detail.lead.location || "—"}</p>
                    </div>
                  </div>

                  {parseTags(detail.lead.tags).length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm text-zinc-400 mb-2">Tags</p>
                      <div className="flex flex-wrap gap-2">
                        {parseTags(detail.lead.tags).map((tag) => (
                          <Badge key={tag} variant="outline" className="border-white/10 text-zinc-300">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Move control — only the moves lib/pipeline permits, nothing hand-written. */}
                  <div className="mt-6">
                    <p className="text-sm text-zinc-400 mb-2">Move to</p>
                    {moveOptions.length === 0 ? (
                      <p className="text-xs text-zinc-500">
                        {detail.stage
                          ? `"${detail.stage}" is a closed stage — no moves are allowed from here.`
                          : "This lead's stored status is not a recognised stage, so it cannot be moved until it is corrected."}
                      </p>
                    ) : (
                      <>
                        <Input
                          value={notes[detail.lead.id] || ""}
                          onChange={(e) =>
                            setNotes((prev) => ({ ...prev, [detail.lead.id]: e.target.value }))
                          }
                          placeholder="Optional note (recorded in the trail)"
                          className="bg-white/5 border-white/10 mb-2"
                        />
                        <div className="flex flex-wrap gap-2">
                          {moveOptions.map((to) => (
                            <Button
                              key={to}
                              size="sm"
                              variant="outline"
                              className="border-white/10 hover:bg-white/5"
                              disabled={movePending === detail.lead.id}
                              onClick={() => moveLead(detail.lead, to)}
                            >
                              {movePending === detail.lead.id ? (
                                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                              ) : (
                                <ArrowRight className="w-3 h-3 mr-2" />
                              )}
                              {stageName(to)}
                            </Button>
                          ))}
                        </div>
                      </>
                    )}

                    {moveErrors[detail.lead.id] && (
                      <div className="mt-3 rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                        <p className="text-sm text-red-400">{moveErrors[detail.lead.id]}</p>
                      </div>
                    )}
                  </div>

                  {/* The audit trail — how this lead got where it is. */}
                  <div className="mt-6">
                    <p className="text-sm text-zinc-400 mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4" /> Activity
                      <Badge variant="outline" className="border-white/10 text-xs text-zinc-400">
                        {detail.lead.activities.length}
                      </Badge>
                    </p>
                    {detail.lead.activities.length === 0 ? (
                      <p className="text-xs text-zinc-500">No activity recorded for this lead.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.lead.activities.map((activity) => (
                          <div key={activity.id} className="p-3 rounded-lg bg-white/5 border border-white/5">
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="border-white/10 text-zinc-300 text-[10px]">
                                {activity.type}
                              </Badge>
                              <span className="text-[10px] text-zinc-500">
                                {formatWhen(activity.createdAt)}
                              </span>
                            </div>
                            {(activity.fromValue || activity.toValue) && (
                              <p className="text-xs text-zinc-300 mt-2 flex items-center gap-2">
                                <span className="text-zinc-500">{activity.fromValue || "—"}</span>
                                <ArrowRight className="w-3 h-3 text-zinc-500" />
                                <span className="text-emerald-400">{activity.toValue || "—"}</span>
                              </p>
                            )}
                            {activity.detail && (
                              <p className="text-xs text-zinc-300 mt-2">{activity.detail}</p>
                            )}
                            <p className="text-[10px] text-zinc-500 mt-2">by {activity.actor}</p>
                          </div>
                        ))}
                      </div>
                    )}
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
