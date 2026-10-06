import { NextResponse } from "next/server"
import { getStats } from "@/lib/stats"

// Maysan Labs: real numbers from the database (upstream returned hardcoded demo constants).
// force-dynamic so Next never prerenders this at build time — a build-time render would bake
// in zeros (and query a database path that does not exist in the builder stage).
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // NOTE: /api/analytics is the campaign-funnel view; this endpoint is the dashboard summary
    // and is also what the Hermes ops client reads. See dokploy-ops/keelead-ops.
    return NextResponse.json(await getStats())
  } catch (error) {
    console.error("stats API error:", error)
    return NextResponse.json({ error: "stats unavailable" }, { status: 500 })
  }
}
