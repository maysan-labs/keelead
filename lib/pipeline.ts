// The pipeline is a state machine, defined once and imported by the board, the API and the tests.
//
// Upstream's board was four hardcoded columns of invented people. Two things are needed instead: a
// single definition of what the stages ARE (matching Lead.status in the schema), and a rule about
// which moves are legal — a lead does not go from "qualified" back to "new", and a client asking
// "how did this lead get here" must be able to read the answer out of LeadActivity.

export interface Stage {
  id: LeadStage
  name: string
  /** Tailwind colour token, kept here so the board and the API cannot disagree. */
  color: string
  description: string
}

export type LeadStage = "new" | "contacted" | "qualified" | "converted" | "lost"

export const STAGES: Stage[] = [
  { id: "new", name: "New", color: "bg-blue-500", description: "Found but not yet contacted" },
  { id: "contacted", name: "Contacted", color: "bg-yellow-500", description: "First touch sent or call made" },
  { id: "qualified", name: "Qualified", color: "bg-purple-500", description: "A real conversation is happening" },
  { id: "converted", name: "Converted", color: "bg-emerald-500", description: "Became a customer" },
  { id: "lost", name: "Lost", color: "bg-zinc-500", description: "Closed without a deal" },
]

export const STAGE_IDS: LeadStage[] = STAGES.map((stage) => stage.id)

export function isStage(value: unknown): value is LeadStage {
  return typeof value === "string" && (STAGE_IDS as string[]).includes(value)
}

/**
 * Legal moves. Deliberately not "any status to any status":
 *   * `new` may only be contacted (or dropped) — nothing is qualified before it is spoken to;
 *   * `qualified` may convert or be lost;
 *   * `lost` may be re-opened to `contacted` (a forgotten lead is a common, legitimate case), and a
 *     re-opened lead keeps its history in LeadActivity rather than being deleted and re-created;
 *   * `converted` is terminal — a refund or a mistake is a NEW record, so revenue history cannot be
 *     rewritten by a status change.
 */
const TRANSITIONS: Record<LeadStage, LeadStage[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["converted", "lost"],
  converted: [],
  lost: ["contacted"],
}

export function allowedTransitions(from: LeadStage): LeadStage[] {
  return TRANSITIONS[from] || []
}

export function canTransition(from: LeadStage, to: LeadStage): boolean {
  if (from === to) return false
  return allowedTransitions(from).includes(to)
}

/** Why a move was refused, phrased for the person who tried it (the API returns this verbatim). */
export function transitionError(from: LeadStage, to: LeadStage): string | null {
  if (!isStage(to)) return `Unknown stage "${to}" — valid stages are ${STAGE_IDS.join(", ")}`
  if (!isStage(from)) return `This lead is in an unrecognised stage ("${from}") and cannot be moved`
  if (from === to) return `This lead is already in "${to}"`
  if (!canTransition(from, to)) {
    const options = allowedTransitions(from)
    return options.length
      ? `A lead in "${from}" can only move to ${options.map((stage) => `"${stage}"`).join(" or ")}`
      : `"${from}" is a closed stage; a correction must be recorded as a new lead, not a status change`
  }
  return null
}

/** The stage a stored status maps to — anything unrecognised is REPORTED, never silently shown as "new". */
export function normaliseStage(status: string | null | undefined): LeadStage | null {
  const value = (status || "").trim().toLowerCase()
  return isStage(value) ? value : null
}
