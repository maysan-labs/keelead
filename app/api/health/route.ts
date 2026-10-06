import { NextResponse } from "next/server"
import { readFileSync } from "fs"
import { join } from "path"
import { prisma } from "@/lib/db"

// Maysan Labs: /api/health is what the deployment is verified and monitored against.
// It is the one route the edge proxy serves without credentials (see proxy/default.conf),
// so it must report status only — never data, never configuration.
export const dynamic = "force-dynamic"

function builtAt(): string | null {
  for (const p of ["/app/BUILD_TIME", join(process.cwd(), "BUILD_TIME")]) {
    try {
      return readFileSync(p, "utf8").trim()
    } catch {}
  }
  return null
}

export async function GET() {
  const base = { app: "keelead", built_at: builtAt() }
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: "ok", db: "ok", ...base })
  } catch (error) {
    console.error("Health check failed:", error)
    return NextResponse.json({ status: "error", db: "error", ...base }, { status: 503 })
  }
}
