"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Zap, AlertCircle, Loader2, RefreshCw, SearchX, Ban, ChevronRight,
} from "lucide-react"

// ---------------------------------------------------------------------------
// GET /api/signals -> the signals that were actually computed over the leads
// table, plus the signal classes this deployment cannot compute at all.
// Every number and every name on this page comes from that response — there
// are no sample events here, because an invented event is worse than no event.
// ---------------------------------------------------------------------------

type Severity = "high" | "medium" | "low"

interface SignalLead {
  id: string
  name: string
  company: string
  email: string
  phone: string
  status: string
  score: number
  updatedAt: string
}

interface SignalRow {
  id: string
  title: string
  description: string
  rule: string
  severity: Severity
  count: number
  leads: SignalLead[]
}

interface UnavailableSignal {
  id: string
  title: string
  reason: string
}

interface SignalsResponse {
  signals: SignalRow[]
  unavailable: UnavailableSignal[]
  generatedAt: string
  totalSignalled: number
}

type LoadState = "loading" | "error" | "loaded"

interface FetchError {
  status: number | null
  message: string
}

// --- small helpers (local to this page; lib/ is owned by other agents) -------

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "unknown time"
  const diffMs = Date.now() - then
  const future = diffMs < 0
  const seconds = Math.round(Math.abs(diffMs) / 1000)
  const fmt = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`
  let text: string
  if (seconds < 45) text = "just now"
  else if (seconds < 90) text = "1 minute ago"
  else if (seconds < 3600) text = `${fmt(Math.round(seconds / 60), "minute")} ago`
  else if (seconds < 86400) text = `${fmt(Math.round(seconds / 3600), "hour")} ago`
  else if (seconds < 2592000) text = `${fmt(Math.round(seconds / 86400), "day")} ago`
  else text = new Date(iso).toLocaleDateString()
  if (future && seconds >= 45) text = text.replace(" ago", " from now")
  return text
}

const SEVERITY: Record<Severity, { badge: string; accent: string; figure: string; label: string }> = {
  high: {
    badge: "bg-red-500/20 text-red-400 border-0",
    accent: "border-l-red-500",
    figure: "text-red-400",
    label: "High",
  },
  medium: {
    badge: "bg-amber-500/20 text-amber-400 border-0",
    accent: "border-l-amber-500",
    figure: "text-amber-400",
    label: "Medium",
  },
  low: {
    badge: "bg-zinc-500/20 text-zinc-400 border-0",
    accent: "border-l-zinc-600",
    figure: "text-zinc-300",
    label: "Low",
  },
}

function severityStyle(sev: string) {
  return SEVERITY[(sev as Severity)] ?? SEVERITY.low
}

function scoreClass(score: number): string {
  if (score >= 90) return "text-emerald-400"
  if (score >= 75) return "text-blue-400"
  return "text-yellow-400"
}

export default function SignalsPage() {
  const [state, setState] = useState<LoadState>("loading")
  const [data, setData] = useState<SignalsResponse | null>(null)
  const [error, setError] = useState<FetchError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setState("loading")
      setError(null)
      try {
        const res = await fetch("/api/signals", { signal: controller.signal, cache: "no-store" })
        if (!res.ok) {
          let message = res.statusText || "Request failed"
          try {
            const body = await res.json()
            if (body && typeof body.error === "string") message = body.error
          } catch {
            // response had no JSON body — keep the status text
          }
          if (!cancelled) {
            setError({ status: res.status, message })
            setState("error")
          }
          return
        }
        const json = (await res.json()) as SignalsResponse
        if (!cancelled) {
          setData({
            signals: Array.isArray(json.signals) ? json.signals : [],
            unavailable: Array.isArray(json.unavailable) ? json.unavailable : [],
            generatedAt: json.generatedAt,
            totalSignalled: typeof json.totalSignalled === "number" ? json.totalSignalled : 0,
          })
          setState("loaded")
        }
      } catch (e) {
        if (cancelled || (e instanceof Error && e.name === "AbortError")) return
        setError({
          status: null,
          message: e instanceof Error ? e.message : "Could not reach /api/signals",
        })
        setState("error")
      }
    }

    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [reloadKey])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  // --- loading --------------------------------------------------------------
  if (state === "loading") {
    return (
      <div className="space-y-6">
        <PageHeader />
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            <p className="text-sm">Computing signals from the leads database…</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- error ----------------------------------------------------------------
  if (state === "error" || !data) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <Card className="bg-[#0a0a0a] border-red-500/30">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h2 className="font-medium text-red-400">Could not load signals</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  {error?.status !== null && error?.status !== undefined ? (
                    <span className="font-mono text-zinc-300">HTTP {error.status}</span>
                  ) : (
                    <span className="font-mono text-zinc-300">network error</span>
                  )}
                  {error?.message ? <span className="ml-2">{error.message}</span> : null}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retry}
                  className="mt-4 border-white/10"
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> Retry
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- loaded ---------------------------------------------------------------
  const totalMatched = data.signals.reduce((sum, s) => sum + (s.count || 0), 0)
  const totalLeads = data.signals.reduce((sum, s) => sum + (s.leads?.length || 0), 0)
  const isEmpty = totalMatched === 0 && totalLeads === 0

  return (
    <div className="space-y-6">
      <PageHeader
        total={data.totalSignalled}
        computedAt={data.generatedAt}
      />

      {isEmpty ? (
        /* Honest empty state — no sample events, ever. */
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3 text-center">
            <SearchX className="w-6 h-6 text-zinc-500" />
            <p className="text-sm text-zinc-300 font-medium">No signals to show yet</p>
            <p className="text-sm text-zinc-500 max-w-md">
              No signals to show yet — they appear as leads accumulate and go stale.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.signals.map((signal) => {
            const sev = severityStyle(signal.severity)
            return (
              <Card
                key={signal.id}
                className={`bg-[#0a0a0a] border-white/10 border-l-2 ${sev.accent} hover:border-white/20 transition`}
              >
                <CardHeader className="p-4 flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base font-medium">{signal.title}</CardTitle>
                      <Badge className={`${sev.badge} text-xs`}>{sev.label}</Badge>
                    </div>
                    <p className="text-sm text-zinc-400 mt-1">{signal.description}</p>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <div className={`text-3xl font-bold leading-none ${sev.figure}`}>{signal.count}</div>
                    <span className="text-xs text-zinc-500 mt-1">leads match</span>
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-0">
                  {/* The query that produced the count — an unexplainable number
                      is indistinguishable from a fabricated one. */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-zinc-500">
                    <span className="uppercase tracking-wide text-[10px]">How this is computed</span>
                    <code className="font-mono text-zinc-400 bg-white/5 rounded px-1.5 py-0.5 border border-white/10">
                      {signal.rule}
                    </code>
                  </div>

                  {signal.leads && signal.leads.length > 0 ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                            <th className="font-medium py-2 pr-4">Name</th>
                            <th className="font-medium py-2 pr-4">Company</th>
                            <th className="font-medium py-2 pr-4 text-right">Score</th>
                            <th className="font-medium py-2 pr-4">Status</th>
                            <th className="font-medium py-2 text-right">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {signal.leads.map((lead) => (
                            <tr
                              key={lead.id}
                              className="border-t border-white/10 hover:bg-white/5 transition"
                            >
                              <td className="py-2 pr-4">
                                {/* id-based link into the existing leads screen —
                                    links this row to the exact lead the signal is about. */}
                                <Link
                                  href={`/dashboard/leads?lead=${encodeURIComponent(lead.id)}`}
                                  className="inline-flex items-center gap-1 text-zinc-200 hover:text-white hover:underline"
                                >
                                  {lead.name || "Unnamed lead"}
                                  <ChevronRight className="w-3 h-3 text-zinc-500" />
                                </Link>
                              </td>
                              <td className="py-2 pr-4 text-zinc-400">{lead.company || "—"}</td>
                              <td className={`py-2 pr-4 text-right font-medium ${scoreClass(lead.score)}`}>
                                {lead.score}
                              </td>
                              <td className="py-2 pr-4">
                                <Badge className="bg-white/5 text-zinc-300 border-white/10 text-xs font-normal">
                                  {lead.status || "unknown"}
                                </Badge>
                              </td>
                              <td className="py-2 text-right text-zinc-500 whitespace-nowrap">
                                {relativeTime(lead.updatedAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">
                      No leads currently match this signal.
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Required, visibly separate panel: the signal classes this deployment
          cannot compute. Without it the page can look complete while being
          fiction, so it renders even when the list is empty. */}
      <Card className="bg-white/5 border-white/10 border-dashed">
        <CardHeader className="p-4">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Ban className="w-4 h-4 text-zinc-500" />
            Not available in this deployment
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {data.unavailable.length === 0 ? (
            <p className="text-sm text-zinc-500">
              None — every signal class is computable from the leads database here.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.unavailable.map((item) => (
                <li key={item.id} className="border-l-2 border-zinc-700 pl-3">
                  <div className="text-sm font-medium text-zinc-300">{item.title}</div>
                  <div className="text-sm text-zinc-500 mt-0.5">{item.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PageHeader({ total, computedAt }: { total?: number; computedAt?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" /> Intent Signals
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          {typeof total === "number" ? (
            <>
              <span className="text-zinc-200 font-medium">{total}</span> signal{total === 1 ? "" : "s"} computed
              {computedAt ? (
                <> — Computed {relativeTime(computedAt)} from the leads database.</>
              ) : null}
            </>
          ) : (
            "Signals derived from the leads in your database."
          )}
        </p>
      </div>
    </div>
  )
}
