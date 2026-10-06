import { NextRequest, NextResponse } from "next/server"
import { searchLeads } from "@/lib/lead-engine"
import { parseLeadIntent, LEAD_GEN_SYSTEM_PROMPT } from "@/lib/ai"
import { saveLeads, logSearch } from "@/lib/leads-store"

export async function POST(request: NextRequest) {
  try {
    const { message, conversationId } = await request.json()

    // Parse intent from message
    const intent = parseLeadIntent(message)

    // Handle different intents
    if (intent.type === "search") {
      const results = await searchLeads(intent)
      const leadCount = results.leads.length
      const sources = results.sources.join(", ") || "none"

      // Maysan Labs: persist what the search found, and record that it ran.
      const saved = await saveLeads(results.leads, results.query || message)
      await logSearch(results.query || message, results.sources, results.total, saved.inserted)

      let content = ""
      if (leadCount > 0) {
        content += `I found **${leadCount} leads** matching your query`
        if (results.plan?.businessType) content += ` — ${results.plan.businessType}s`
        if (results.plan?.location) content += ` in ${results.plan.location}`
        content += `.\n\n`
        content += `| Name | Company | Title | Contact | Score |\n`
        content += `|------|---------|-------|---------|-------|\n`
        for (const lead of results.leads.slice(0, 15)) {
          const score = Math.round(lead.confidence * 100)
          const contact = lead.email || lead.phone || lead.website || "-"
          content += `| ${lead.firstName} ${lead.lastName} | ${lead.company || "-"} | ${lead.title || "-"} | ${contact} | ${score}% |\n`
        }
        if (results.leads.length > 15) {
          content += `\n*...and ${results.leads.length - 15} more results*\n`
        }
      } else {
        // An empty result has to explain itself: silence looks like a bug, and the old behaviour —
        // returning unrelated people — looked like success.
        content += `**No leads matched** \`${results.query || message}\`.\n\n`
        if (results.plan?.why?.length) {
          content += `How this query was routed:\n`
          for (const reason of results.plan.why) content += `- ${reason}\n`
        }
      }

      content += `\n📊 Sources queried: ${sources}`
      if (typeof results.filtered === "number" && results.filtered > 0) {
        content += `\n🧹 Discarded by the relevance gate: ${results.filtered}`
      }
      if (results.notes?.length) {
        content += `\n\n${results.notes.map((note) => `_${note}_`).join("\n")}`
      }

      return NextResponse.json({
        content,
        metadata: {
          leads: results.leads,
          total: results.total,
          sources: results.sources,
          intent: results.intent,
          filtered: results.filtered,
          plan: results.plan,
          notes: results.notes,
          saved: saved.inserted,
        },
      })
    }

    if (intent.type === "research") {
      const { researchCompany } = await import("@/lib/research")
      const company = intent.params.company || intent.query.replace(/research|tell me about/gi, "").trim()
      const profile = await researchCompany(company)

      let content = `## ${profile.name} — Company Research\n\n`
      content += `**Industry:** ${profile.industry} | **Size:** ${profile.size} employees | **Founded:** ${profile.founded}\n`
      content += `**Headquarters:** ${profile.headquarters} | **Revenue:** ${profile.revenue}\n\n`
      content += `### Tech Stack\n${profile.techStack.join(", ")}\n\n`
      content += `### Key People\n`
      for (const person of profile.keyPeople.slice(0, 5)) {
        content += `- **${person.name}** — ${person.title}\n`
      }
      content += `\n### Funding\n`
      for (const round of profile.funding) {
        content += `- **${round.round}**: ${round.amount} (${round.date}) — ${round.investors.join(", ")}\n`
      }

      return NextResponse.json({ content, metadata: { company: profile } })
    }

    if (intent.type === "verify") {
      const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w+/)
      if (emailMatch) {
        const { verifyEmail } = await import("@/lib/email")
        const result = await verifyEmail(emailMatch[0])

        let content = `## Email Verification: \`${result.email}\`\n\n`
        content += `**Status:** ${result.status.toUpperCase()} | **Score:** ${result.score}/100\n\n`
        content += `### Verification Layers\n`
        for (const layer of result.layers) {
          const icon = layer.passed ? "✅" : "❌"
          content += `${icon} **${layer.name}** (Layer ${layer.layer}): ${layer.details}\n`
        }
        if (result.suggestion) {
          content += `\n💡 **Suggestion:** Did you mean \`${result.suggestion}\`?`
        }

        return NextResponse.json({ content, metadata: { verification: result } })
      }
    }

    // Default: AI-powered response
    const content = `I understand you're asking about: "${message}"\n\nHere's what I can help with:\n\n- **Search leads**: "Find 50 SaaS founders in San Francisco"\n- **Research companies**: "Research company Tesla"\n- **Verify emails**: "Verify email test@example.com"\n- **Find contacts**: "Find the CTO of Stripe"\n\nTry being more specific and I'll search every source this deployment has enabled (see Settings → Data Sources) for you!`

    return NextResponse.json({ content })
  } catch (error) {
    console.error("Chat API error:", error)
    return NextResponse.json(
      { content: "Sorry, I encountered an error. Please try again." },
      { status: 500 }
    )
  }
}
