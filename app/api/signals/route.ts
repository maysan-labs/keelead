import { NextResponse } from "next/server"
import { deriveSignals } from "@/lib/insights"

// Signals are DERIVED from the leads we hold. Upstream's POST returned a fixed list of invented
// events ("New hire at <company>", "<company> funding activity") attributed to LinkedIn, Crunchbase
// and "Job Boards" — none of which this deployment runs. Every signal now comes from a query, and the
// classes we cannot compute are listed as unavailable with the provider they would need.
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const signals = await deriveSignals()
    return NextResponse.json(signals)
  } catch (error) {
    console.error("signals API error:", error)
    return NextResponse.json({ error: "Could not compute signals" }, { status: 500 })
  }
}
