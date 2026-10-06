import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { LucideIcon } from "lucide-react"
import {
  GitBranch, Ban, ChevronRight, Megaphone, ClipboardList, Workflow,
  Send, ShieldCheck, Database,
} from "lucide-react"

/**
 * This deployment holds leads and campaigns, but it has no sequence / automation
 * engine: prisma/schema.prisma has no Sequence or SequenceStep model, and there is
 * no /api/sequences route. The multi-step outreach that actually runs for this
 * company lives outside this application — n8n automations and the MaysanMails /
 * WhatsApp tooling on the same server — and this app cannot read or edit those
 * cadences. So this page states that limit instead of rendering a cadence nobody
 * here could run. Every name, link and number below refers to something that
 * exists in this repository; the "would be required" list is explicitly aspirational.
 */

interface RealSurface {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

const REAL_SURFACES: RealSurface[] = [
  {
    href: "/dashboard/campaigns",
    icon: Megaphone,
    title: "Campaigns",
    description:
      "Group leads into outreach campaigns. These are real rows in the Campaign table — this screen is where grouping and targeting live.",
  },
  {
    href: "/dashboard/leads",
    icon: ClipboardList,
    title: "Leads",
    description:
      "The call sheet: every lead with its contact details, status and score, read from the leads database.",
  },
]

interface Requirement {
  icon: LucideIcon
  title: string
  detail: string
}

// Presented strictly as "what would be required" — none of this exists today.
const REQUIREMENTS: Requirement[] = [
  {
    icon: Database,
    title: "A Sequence and SequenceStep model",
    detail:
      "An ordered list of steps (email / delay / condition) has no table in the schema today. It would have to be added before any cadence could be stored or scheduled here.",
  },
  {
    icon: Send,
    title: "A sender with its own delivery log",
    detail:
      "Running a cadence needs a sending identity plus a per-message log (queued / sent / failed). This deployment keeps no such send records.",
  },
  {
    icon: ShieldCheck,
    title: "An unsubscribe / consent check on the send path",
    detail:
      "Every step would have to consult the existing suppression list (prisma.suppression) and consent records before sending. The suppression list is real and already enforced on the export path, but nothing on a send path consults it here — because there is no send path.",
  },
  {
    icon: Workflow,
    title: "A scheduler or worker",
    detail:
      "Delays and step progression need something to advance them over time. This app has no background worker or cron bound to sequences.",
  },
]

export default function SequencesPage() {
  return (
    <div className="space-y-6">
      {/* Header — same layout/spacing conventions as the other dashboard pages. */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-zinc-400" />
            Sequences
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Multi-step outreach automation — not run from this application.
          </p>
        </div>
      </div>

      {/* The honest capability notice, in the same pattern as the Signals page's
          "Not available in this deployment" panel. */}
      <Card className="bg-white/5 border-white/10 border-dashed">
        <CardHeader className="p-4">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Ban className="w-4 h-4 text-zinc-500" />
            Not available in this deployment
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <p className="text-sm text-zinc-300">
            This deployment holds leads and campaigns, but it has no sequence or
            automation engine. There is no Sequence model in the database and no
            sequences API, so no cadence can be shown, created or edited here — and
            nothing on this page pretends otherwise.
          </p>
          <p className="text-sm text-zinc-500">
            The multi-step email and WhatsApp outreach that actually runs for this
            company is automated <span className="text-zinc-400">outside this application</span>,
            using n8n workflows and the MaysanMails / WhatsApp tooling on the same
            server. This app cannot read, edit or report on those sequences.
          </p>
        </CardContent>
      </Card>

      {/* What this deployment does provide — each a real screen, each a working link. */}
      <div className="space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-zinc-500">
          What this deployment does provide
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {REAL_SURFACES.map((surface) => {
            const Icon = surface.icon
            return (
              <Link key={surface.href} href={surface.href} className="group block">
                <Card className="bg-[#0a0a0a] border-white/10 hover:border-white/20 transition h-full">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-blue-400" />
                      <span className="font-semibold">{surface.title}</span>
                      <ChevronRight className="w-4 h-4 ml-auto text-zinc-500 group-hover:text-zinc-300 transition" />
                    </div>
                    <p className="text-sm text-zinc-400 mt-2">{surface.description}</p>
                    <p className="text-xs text-zinc-500 mt-3 font-mono">{surface.href}</p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Where the real automation lives, stated plainly. */}
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader className="p-4">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Workflow className="w-4 h-4 text-purple-400" />
            Where the real automation runs
          </CardTitle>
          <CardDescription className="text-zinc-500">
            These run outside this application and are not controllable from it.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ul className="space-y-2 text-sm text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-2 flex-shrink-0" />
              <span>n8n workflows that drive the multi-step outreach.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-2 flex-shrink-0" />
              <span>MaysanMails for email delivery.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-2 flex-shrink-0" />
              <span>WhatsApp tooling on the same server.</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* A future sequence engine — presented only as what WOULD be required. */}
      <Card className="bg-[#0a0a0a] border-white/10">
        <CardHeader className="p-4">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-medium">
              What a sequence engine would require
            </CardTitle>
            <Badge className="bg-zinc-500/20 text-zinc-400 border-0 text-xs font-normal">
              Would be required
            </Badge>
          </div>
          <CardDescription className="text-zinc-500">
            None of the following exists in this deployment today.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ul className="space-y-3">
            {REQUIREMENTS.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.title} className="border-l-2 border-zinc-700 pl-3">
                  <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                    <Icon className="w-4 h-4 text-zinc-500" />
                    {item.title}
                  </div>
                  <div className="text-sm text-zinc-500 mt-0.5">{item.detail}</div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
