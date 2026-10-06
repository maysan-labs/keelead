"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { LucideIcon } from "lucide-react"
import {
  Shield, ShieldCheck, AlertTriangle, MinusCircle, CheckCircle2, FileText,
  Download, Plus, RefreshCw, Ban, Trash2, Users, Mail, Phone, Loader2,
  Activity, UserCheck, Scale, Clock,
} from "lucide-react"

/**
 * This page renders the COMPUTED compliance report from GET /api/compliance. Every number and every
 * line of detail comes from the API. An item the API marks "not_recorded" / "not_available" is never
 * shown as compliant: it carries no green tick, no "Pass", and states nothing beyond the returned
 * detail. There is deliberately no percentage or score — the report does not compute one.
 */

type ComplianceStatus = "evidenced" | "not_recorded" | "not_available"

interface ComplianceItem {
  id: string
  title: string
  requirement: string
  status: ComplianceStatus
  detail: string
}

interface ComplianceCounts {
  leads: number
  withEmail: number
  withPhone: number
  withoutContactDetails: number
  verified: number
  consentRecords: number
  suppressed: number
  verifications: number
  exports: number
  activities: number
}

interface ConsentRecordRow {
  id: string
  subject: string
  channel: string
  status: string
  basis: string | null
  evidence: string | null
  source: string | null
  recordedAt: string
  updatedAt: string
}

interface SuppressionRow {
  id: string
  value: string
  kind: string
  reason: string
  note: string | null
  createdAt: string
}

interface VerificationRow {
  id: string
  email: string
  result: string
  score: number
  status: string
  createdAt: string
}

interface ExportRow {
  id: string
  format: string
  count: number
  filters: string | null
  filePath: string | null
  createdAt: string
}

interface ActivityRow {
  id: string
  leadId: string
  type: string
  fromValue: string | null
  toValue: string | null
  detail: string | null
  actor: string
  createdAt: string
}

interface ComplianceReport {
  generatedAt: string
  items: ComplianceItem[]
  counts: ComplianceCounts
  consent: ConsentRecordRow[]
  suppression: { byKind: { kind: string; count: number }[]; latest: SuppressionRow[] }
  verification: VerificationRow[]
  exports: ExportRow[]
  activity: ActivityRow[]
  retention: { oldest: string | null; newest: string | null; oldestDays: number }
  stages: string[]
}

interface SuppressionList {
  total: number
  matchableForms: number
  entries: SuppressionRow[]
}

interface ApiError {
  status: number | null
  message: string
}

const STATUS_ORDER: ComplianceStatus[] = ["evidenced", "not_recorded", "not_available"]

const STATUS_META: Record<
  ComplianceStatus,
  { heading: string; badge: string; icon: LucideIcon; iconClass: string; ring: string; headingClass: string }
> = {
  evidenced: {
    heading: "Evidenced",
    badge: "bg-emerald-500/20 text-emerald-400 border-0",
    icon: ShieldCheck,
    iconClass: "text-emerald-400",
    ring: "border-emerald-500/30",
    headingClass: "text-emerald-400",
  },
  not_recorded: {
    heading: "Not recorded yet",
    badge: "bg-amber-500/20 text-amber-400 border-0",
    icon: AlertTriangle,
    iconClass: "text-amber-400",
    ring: "border-amber-500/30",
    headingClass: "text-amber-400",
  },
  not_available: {
    heading: "Not available",
    badge: "bg-zinc-500/20 text-zinc-400 border-0",
    icon: MinusCircle,
    iconClass: "text-zinc-400",
    ring: "border-white/10",
    headingClass: "text-zinc-400",
  },
}

const STATUS_LABEL: Record<ComplianceStatus, string> = {
  evidenced: "evidenced",
  not_recorded: "not recorded",
  not_available: "not available",
}

const CHANNELS = ["email", "whatsapp", "phone"] as const
const CONSENT_STATUSES = ["granted", "withdrawn", "unknown"] as const
const KINDS = ["email", "phone", "domain"] as const
const REASONS = ["opted_out", "bounced", "complained", "manual"] as const

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function apiMessage(status: number, body: unknown): string {
  const message =
    body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "The request failed."
  return `HTTP ${status}: ${message}`
}

export default function CompliancePage() {
  const [report, setReport] = useState<ComplianceReport | null>(null)
  const [suppressionList, setSuppressionList] = useState<SuppressionList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [dncError, setDncError] = useState<string | null>(null)

  const loadSuppression = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/suppression", { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDncError(apiMessage(res.status, body))
        return
      }
      setSuppressionList(body as SuppressionList)
      setDncError(null)
    } catch (e) {
      setDncError(e instanceof Error ? e.message : "Could not reach the suppression API.")
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/compliance", { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError({
          status: res.status,
          message:
            body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
              ? (body as { error: string }).error
              : "Could not load the compliance report.",
        })
        setLoading(false)
        return
      }
      setReport(body as ComplianceReport)
      setLoading(false)
      void loadSuppression()
    } catch (e) {
      setError({ status: null, message: e instanceof Error ? e.message : "Network error while loading the report." })
      setLoading(false)
    }
  }, [loadSuppression])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Compliance</h1>
        <p className="text-zinc-400 text-sm mt-1">
          What GDPR / CAN-SPAM hygiene is actually recorded in the database — and what is not.
        </p>
        {report && (
          <p className="text-zinc-500 text-xs mt-1 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Report generated {formatDateTime(report.generatedAt)} — computed from stored records, read-only.
          </p>
        )}
      </div>

      {loading && (
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-10 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Loading the compliance report…</p>
          </CardContent>
        </Card>
      )}

      {!loading && error && (
        <Card className="bg-[#0a0a0a] border-red-500/30">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <p className="font-medium">Could not load the compliance report</p>
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

      {!loading && !error && report && (
        <ComplianceReportView
          report={report}
          suppressionList={suppressionList}
          dncError={dncError}
          onReload={load}
        />
      )}
    </div>
  )
}

function CountsStrip({ counts }: { counts: ComplianceCounts }) {
  const items: { key: keyof ComplianceCounts; label: string; icon: LucideIcon }[] = [
    { key: "leads", label: "Leads", icon: Users },
    { key: "withEmail", label: "With email", icon: Mail },
    { key: "withPhone", label: "With phone", icon: Phone },
    { key: "withoutContactDetails", label: "No contact details", icon: AlertTriangle },
    { key: "verified", label: "Verified leads", icon: UserCheck },
    { key: "consentRecords", label: "Consent records", icon: FileText },
    { key: "suppressed", label: "Suppressed", icon: Ban },
    { key: "verifications", label: "Verification runs", icon: ShieldCheck },
    { key: "exports", label: "Exports", icon: Download },
    { key: "activities", label: "Audit events", icon: Activity },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map(({ key, label, icon: Icon }) => (
        <Card key={key} className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <Icon className="w-4 h-4" />
              <p className="text-xs">{label}</p>
            </div>
            <p className="text-2xl font-semibold mt-2">{counts[key]}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Checklist({ items }: { items: ComplianceItem[] }) {
  return (
    <div className="space-y-6">
      {STATUS_ORDER.map((status) => {
        const meta = STATUS_META[status]
        const grouped = items.filter((item) => item.status === status)
        return (
          <div key={status} className="space-y-3">
            <div className="flex items-center gap-2">
              <meta.icon className={`w-4 h-4 ${meta.iconClass}`} />
              <h2 className={`text-sm font-semibold ${meta.headingClass}`}>{meta.heading}</h2>
              <Badge className={`${meta.badge} text-xs`}>{grouped.length}</Badge>
            </div>
            {grouped.length === 0 ? (
              <p className="text-xs text-zinc-500 pl-6">Nothing in this group.</p>
            ) : (
              <div className="space-y-3">
                {grouped.map((item) => (
                  <Card key={item.id} className={`bg-[#0a0a0a] border ${meta.ring}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <meta.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${meta.iconClass}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-sm">{item.title}</p>
                            <Badge className={`${meta.badge} text-xs`}>{STATUS_LABEL[item.status]}</Badge>
                          </div>
                          <p className="text-xs text-zinc-500 mt-1">{item.requirement}</p>
                          <p className="text-sm text-zinc-400 mt-2">{item.detail}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ConsentPanel({
  report,
  onReload,
}: {
  report: ComplianceReport
  onReload: () => Promise<void>
}) {
  const [subject, setSubject] = useState("")
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email")
  const [status, setStatus] = useState<(typeof CONSENT_STATUSES)[number]>("granted")
  const [basis, setBasis] = useState("")
  const [evidence, setEvidence] = useState("")
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setConfirmation(null)
    setBusy(true)
    try {
      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          channel,
          status,
          basis: basis || undefined,
          evidence: evidence || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(apiMessage(res.status, body))
        setBusy(false)
        return
      }
      const withdrawal = status === "withdrawn"
      setConfirmation(
        withdrawal
          ? `Recorded a withdrawal for "${subject}" on ${channel}. The subject was also added to the do-not-contact list.`
          : `Recorded consent status "${status}" for "${subject}" on ${channel}.`,
      )
      setSubject("")
      setBasis("")
      setEvidence("")
      setBusy(false)
      await onReload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error while recording consent.")
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader>
          <CardTitle className="text-base">Record consent or a withdrawal</CardTitle>
          <CardDescription>
            This writes a consent record. Recording a <span className="text-amber-400">withdrawal</span> also adds
            the subject to the do-not-contact list, so the next export filters them out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="consent-subject">Subject (email, phone or domain)</Label>
                <Input
                  id="consent-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="person@example.com"
                  required
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="consent-channel">Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as (typeof CHANNELS)[number])}>
                  <SelectTrigger id="consent-channel" className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="consent-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as (typeof CONSENT_STATUSES)[number])}>
                  <SelectTrigger id="consent-status" className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONSENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {status === "withdrawn" && (
                  <p className="text-xs text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    A withdrawal also suppresses this subject from exports.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="consent-basis">Basis (optional)</Label>
                <Input
                  id="consent-basis"
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                  placeholder="consent / legitimate_interest / contract"
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="consent-evidence">Evidence (optional)</Label>
                <Input
                  id="consent-evidence"
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Form URL, message id or call note"
                  className="bg-white/5 border-white/10"
                />
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> {formError}
              </p>
            )}
            {confirmation && (
              <p className="text-sm text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> {confirmation}
              </p>
            )}

            <Button type="submit" disabled={busy} className="bg-blue-500 hover:bg-blue-600">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Record
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader>
          <CardTitle className="text-base">Recent consent records</CardTitle>
          <CardDescription>{report.counts.consentRecords} consent record(s) on file.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.consent.length === 0 ? (
            <p className="p-6 pt-0 text-sm text-zinc-400">No consent records recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Subject</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Channel</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Status</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Basis</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {report.consent.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-3 font-mono text-xs">{row.subject}</td>
                      <td className="p-3 text-zinc-400 text-xs">{row.channel}</td>
                      <td className="p-3">
                        <Badge
                          className={`border-0 text-xs ${
                            row.status === "granted"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : row.status === "withdrawn"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-zinc-500/20 text-zinc-400"
                          }`}
                        >
                          {row.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-zinc-400 text-xs">{row.basis || "—"}</td>
                      <td className="p-3 text-zinc-400 text-xs">{formatDateTime(row.recordedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DoNotContactPanel({
  report,
  suppressionList,
  dncError,
  onReload,
}: {
  report: ComplianceReport
  suppressionList: SuppressionList | null
  dncError: string | null
  onReload: () => Promise<void>
}) {
  const entries = suppressionList?.entries ?? report.suppression.latest
  const [value, setValue] = useState("")
  const [kind, setKind] = useState<(typeof KINDS)[number]>("email")
  const [reason, setReason] = useState<(typeof REASONS)[number]>("opted_out")
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    setConfirmation(null)
    setBusy(true)
    try {
      const res = await fetch("/api/compliance/suppression", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, kind, reason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(apiMessage(res.status, body))
        setBusy(false)
        return
      }
      setConfirmation(`Added "${value}" to the do-not-contact list.`)
      setValue("")
      setBusy(false)
      await onReload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error while adding the entry.")
      setBusy(false)
    }
  }

  async function remove(entryValue: string) {
    setFormError(null)
    setConfirmation(null)
    setRemoving(entryValue)
    try {
      const res = await fetch(`/api/compliance/suppression?value=${encodeURIComponent(entryValue)}`, {
        method: "DELETE",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(apiMessage(res.status, body))
        setRemoving(null)
        return
      }
      setConfirmation(`Removed "${entryValue}" from the do-not-contact list.`)
      setRemoving(null)
      await onReload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error while removing the entry.")
      setRemoving(null)
    }
  }

  const byKind = report.suppression.byKind

  return (
    <div className="space-y-4">
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Ban className="w-4 h-4 text-blue-400" /> Do-not-contact list
          </CardTitle>
          <CardDescription>
            Enforced on export: every export reads rows through the suppression filter, so a suppressed contact
            cannot leave the system. There is no score here — only what is stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" />
              {suppressionList ? suppressionList.total : report.counts.suppressed} entr
              {(suppressionList ? suppressionList.total : report.counts.suppressed) === 1 ? "y" : "ies"} held
            </span>
            {suppressionList && <span>{suppressionList.matchableForms} matchable forms enforced on export</span>}
            {byKind.map((b) => (
              <Badge key={b.kind} className="bg-white/5 text-zinc-300 border-0 text-xs">
                {b.kind}: {b.count}
              </Badge>
            ))}
          </div>

          <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="dnc-value">Value</Label>
              <Input
                id="dnc-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="email, phone or domain"
                required
                className="bg-white/5 border-white/10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dnc-kind">Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as (typeof KINDS)[number])}>
                <SelectTrigger id="dnc-kind" className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dnc-reason">Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as (typeof REASONS)[number])}>
                <SelectTrigger id="dnc-reason" className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4">
              <Button type="submit" disabled={busy} size="sm" className="bg-blue-500 hover:bg-blue-600">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Add entry
              </Button>
            </div>
          </form>

          {dncError && <p className="text-sm text-red-400">Could not read the suppression list. {dncError}</p>}
          {formError && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> {formError}
            </p>
          )}
          {confirmation && (
            <p className="text-sm text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> {confirmation}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0a] border-white/10">
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="p-6 text-sm text-zinc-400">No suppression entries recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Value</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Kind</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Reason</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Added</th>
                    <th className="text-right p-3 text-zinc-400 font-medium text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-3 font-mono text-xs">{entry.value}</td>
                      <td className="p-3">
                        <Badge className="bg-white/5 text-zinc-300 border-0 text-xs">{entry.kind}</Badge>
                      </td>
                      <td className="p-3 text-zinc-400 text-xs">{entry.reason}</td>
                      <td className="p-3 text-zinc-400 text-xs">{formatDateTime(entry.createdAt)}</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 text-zinc-400 hover:text-red-400"
                          disabled={removing === entry.value}
                          onClick={() => void remove(entry.value)}
                          aria-label={`Remove ${entry.value}`}
                        >
                          {removing === entry.value ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AuditPanel({ report }: { report: ComplianceReport }) {
  return (
    <div className="space-y-4">
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" /> Lead activity ({report.counts.activities})
          </CardTitle>
          <CardDescription>The recorded lead events — type, detail, actor and time. Not invented log lines.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.activity.length === 0 ? (
            <p className="p-6 pt-0 text-sm text-zinc-400">No lead events recorded yet.</p>
          ) : (
            <div className="space-y-2 p-4 pt-0">
              {report.activity.map((log) => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-emerald-500/20 text-emerald-400">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">{log.type}</p>
                      {log.fromValue || log.toValue ? (
                        <Badge className="bg-white/5 text-zinc-300 border-0 text-xs">
                          {log.fromValue || "—"} → {log.toValue || "—"}
                        </Badge>
                      ) : null}
                    </div>
                    {log.detail && <p className="text-sm text-zinc-400 mt-0.5">{log.detail}</p>}
                    <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500">
                      <span>{log.actor}</span>
                      <span>{formatDateTime(log.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-400" /> Exports ({report.counts.exports})
          </CardTitle>
          <CardDescription>Every export recorded, and the row count written through the suppression filter.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.exports.length === 0 ? (
            <p className="p-6 pt-0 text-sm text-zinc-400">No exports recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Format</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Rows</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Filters</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">When</th>
                  </tr>
                </thead>
                <tbody>
                  {report.exports.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-3">
                        <Badge className="bg-blue-500/20 text-blue-400 border-0 text-xs">{row.format}</Badge>
                      </td>
                      <td className="p-3 text-zinc-400 text-xs">{row.count}</td>
                      <td className="p-3 text-zinc-400 text-xs font-mono truncate max-w-[280px]">{row.filters || "—"}</td>
                      <td className="p-3 text-zinc-400 text-xs">{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-zinc-400" /> Verification runs ({report.counts.verifications})
          </CardTitle>
          <CardDescription>Recent email-verification results recorded in the database.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.verification.length === 0 ? (
            <p className="p-6 pt-0 text-sm text-zinc-400">No verification runs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Email</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Status</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">Score</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-xs">When</th>
                  </tr>
                </thead>
                <tbody>
                  {report.verification.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-3 font-mono text-xs">{row.email}</td>
                      <td className="p-3 text-zinc-400 text-xs">{row.status}</td>
                      <td className="p-3 text-zinc-400 text-xs">{row.score}</td>
                      <td className="p-3 text-zinc-400 text-xs">{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ComplianceReportView({
  report,
  suppressionList,
  dncError,
  onReload,
}: {
  report: ComplianceReport
  suppressionList: SuppressionList | null
  dncError: string | null
  onReload: () => Promise<void>
}) {
  const evidenced = report.items.filter((i) => i.status === "evidenced").length
  const notRecorded = report.items.filter((i) => i.status === "not_recorded").length
  const notAvailable = report.items.filter((i) => i.status === "not_available").length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="font-medium">Evidenced</p>
                <p className="text-xs text-zinc-400">{evidenced} requirement(s) backed by records</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="font-medium">Not recorded yet</p>
                <p className="text-xs text-zinc-400">{notRecorded} not yet supported by a record</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#0a0a0a] border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-500/20 flex items-center justify-center">
                <MinusCircle className="w-5 h-5 text-zinc-400" />
              </div>
              <div>
                <p className="font-medium">Not available</p>
                <p className="text-xs text-zinc-400">{notAvailable} outside this application</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <CountsStrip counts={report.counts} />

      <Tabs defaultValue="checklist" className="space-y-6">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="checklist" className="data-[state=active]:bg-white/10">
            <Shield className="w-4 h-4 mr-2" /> Checklist
          </TabsTrigger>
          <TabsTrigger value="consent" className="data-[state=active]:bg-white/10">
            <Scale className="w-4 h-4 mr-2" /> Consent
          </TabsTrigger>
          <TabsTrigger value="dnc" className="data-[state=active]:bg-white/10">
            <Ban className="w-4 h-4 mr-2" /> Do-not-contact
          </TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-white/10">
            <FileText className="w-4 h-4 mr-2" /> Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checklist" className="space-y-4">
          <p className="text-sm text-zinc-400">
            Grouped by what the API records. An item marked “not recorded” or “not available” is reported as
            such — it is not a pass, and nothing is claimed beyond the detail below it.
          </p>
          <Checklist items={report.items} />
          <p className="text-xs text-zinc-500">
            Retention: oldest lead {report.retention.oldestDays} day(s) old · newest{" "}
            {report.retention.newest ? report.retention.newest.slice(0, 10) : "—"}.
          </p>
        </TabsContent>

        <TabsContent value="consent" className="space-y-4">
          <ConsentPanel report={report} onReload={onReload} />
        </TabsContent>

        <TabsContent value="dnc" className="space-y-4">
          <DoNotContactPanel
            report={report}
            suppressionList={suppressionList}
            dncError={dncError}
            onReload={onReload}
          />
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <AuditPanel report={report} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
