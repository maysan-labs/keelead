import { NextRequest, NextResponse } from "next/server"
import { pipelineBoard } from "@/lib/leads-query"

// The board, computed from the Lead table. Upstream rendered four hardcoded columns of people who
// do not exist; a client looking at this page must be able to trust every number on it.
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const perStage = parseInt(searchParams.get("perStage") || "25", 10) || 25
    const board = await pipelineBoard(perStage)
    return NextResponse.json(board)
  } catch (error) {
    console.error("pipeline API error:", error)
    return NextResponse.json({ error: "Could not build the pipeline board" }, { status: 500 })
  }
}
