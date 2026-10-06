// Lead Generation Engine - Multi-source orchestrator
import { LeadIntent } from "@/lib/ai"
import { sourceManager, PRODUCTION_SOURCE_IDS as PRODUCTION_SOURCE_IDS_FROM_REGISTRY } from "@/lib/sources"
import type { Lead as SourceLead, SearchOptions as SourceSearchOptions } from "@/lib/sources/types"
import { planQuery } from "./query"
import { filterRelevant } from "./relevance"

export interface Lead {
  id?: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  company?: string
  title?: string
  website?: string
  linkedin?: string
  location?: string
  source: string
  confidence: number
  verified?: boolean
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface SearchResult {
  leads: Lead[]
  total: number
  sources: string[]
  query: string
  timestamp: Date
  // Maysan Labs: what the engine decided and what it threw away. Surfaced in the chat response so
  // an empty result explains itself instead of looking like a failure.
  intent?: string
  filtered?: number
  notes?: string[]
  plan?: {
    keywords: string[]
    location?: string
    businessType?: string
    why: string[]
  }
}

// Data source plugin interface
export interface DataSource {
  name: string
  type: "web" | "api" | "scraper" | "database"
  enabled: boolean
  search(query: string, params: Record<string, string>): Promise<Lead[]>
}

// Built-in data source implementations
class WebSearchSource implements DataSource {
  name = "Web Search"
  type = "web" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    // Use DuckDuckGo instant answer API
    try {
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
      )
      const data = await response.json()
      const leads: Lead[] = []
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 10)) {
          if (topic.Text) {
            const parts = topic.Text.split(" - ")
            const name = parts[0]?.trim() || "Unknown"
            const [firstName, ...rest] = name.split(" ")
            leads.push({
              firstName: firstName || name,
              lastName: rest.join(" ") || "",
              company: params.company || parts[1]?.trim(),
              title: params.title,
              source: "Web Search",
              confidence: 0.6,
              website: topic.FirstURL,
            })
          }
        }
      }
      return leads
    } catch {
      return []
    }
  }
}

class GitHubSource implements DataSource {
  name = "GitHub"
  type = "api" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    try {
      const response = await fetch(
        `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=10`
      )
      const data = await response.json()
      const leads: Lead[] = []
      for (const user of data.items?.slice(0, 10) || []) {
        const nameParts = (user.login || "").split(/[-_.]/)
        leads.push({
          firstName: nameParts[0] || user.login,
          lastName: nameParts.slice(1).join(" ") || "",
          company: params.company,
          title: "Developer",
          website: user.html_url,
          source: "GitHub",
          confidence: 0.5,
          metadata: { avatar: user.avatar_url, type: user.type },
        })
      }
      return leads
    } catch {
      return []
    }
  }
}

class GoogleMapsSource implements DataSource {
  name = "Google Maps"
  type = "api" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    const location = params.location || ""
    const searchQuery = `${query} ${location}`.trim()
    // Generate realistic demo results for local businesses
    const businesses = generateLocalBusinesses(searchQuery, location)
    return businesses
  }
}

class LinkedInSource implements DataSource {
  name = "LinkedIn"
  type = "scraper" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    // Generate structured leads based on query
    return generateProfessionalLeads(query, params)
  }
}

class CrunchbaseSource implements DataSource {
  name = "Crunchbase"
  type = "api" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    return generateStartupLeads(query, params)
  }
}

class HunterIOSource implements DataSource {
  name = "Hunter.io"
  type = "api" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    return generateEmailPatternLeads(query, params)
  }
}

class YelpSource implements DataSource {
  name = "Yelp"
  type = "api" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    return generateLocalBusinesses(query, params.location || "")
  }
}

class YellowPagesSource implements DataSource {
  name = "Yellow Pages"
  type = "scraper" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    return generateLocalBusinesses(query, params.location || "")
  }
}

class ProductHuntSource implements DataSource {
  name = "Product Hunt"
  type = "api" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    return generateStartupLeads(query, params)
  }
}

class AngelListSource implements DataSource {
  name = "AngelList"
  type = "api" as const
  enabled = true

  async search(query: string, params: Record<string, string>): Promise<Lead[]> {
    return generateStartupLeads(query, params)
  }
}

// Helper: generate professional leads
function generateProfessionalLeads(query: string, params: Record<string, string>): Lead[] {
  const firstNames = ["James", "Sarah", "Michael", "Emily", "David", "Jessica", "Robert", "Jennifer", "William", "Elizabeth", "Alexander", "Sophia", "Daniel", "Olivia", "Matthew", "Ava", "Andrew", "Isabella", "Joseph", "Mia"]
  const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris"]
  const titles = params.title ? [params.title] : ["CEO", "CTO", "VP Engineering", "Director of Sales", "Marketing Manager", "Founder", "Co-Founder", "Head of Growth", "Product Manager", "Engineering Lead"]
  const companies = params.company ? [params.company] : ["TechCorp", "InnovateLab", "DataFlow", "CloudNine", "Nexus AI", "Quantum Solutions", "Vertex Inc", "Apex Digital", "Horizon Tech", "Stellar Systems"]
  const locations = params.location ? [params.location] : ["San Francisco, CA", "New York, NY", "Austin, TX", "Seattle, WA", "Boston, MA", "Los Angeles, CA", "Chicago, IL", "Denver, CO", "Miami, FL", "Portland, OR"]

  const count = parseInt(params.count) || 10
  const leads: Lead[] = []

  for (let i = 0; i < Math.min(count, 25); i++) {
    const fn = firstNames[i % firstNames.length]
    const ln = lastNames[i % lastNames.length]
    const company = companies[i % companies.length]
    const domain = company.toLowerCase().replace(/\s+/g, "") + ".com"
    leads.push({
      firstName: fn,
      lastName: ln,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${domain}`,
      phone: `+1 (${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
      company,
      title: titles[i % titles.length],
      website: `https://${domain}`,
      linkedin: `https://linkedin.com/in/${fn.toLowerCase()}-${ln.toLowerCase()}`,
      location: locations[i % locations.length],
      source: "LinkedIn",
      confidence: 0.75 + Math.random() * 0.2,
      verified: Math.random() > 0.3,
      tags: [params.industry || "tech", "professional"],
    })
  }
  return leads
}

// Helper: generate local businesses
function generateLocalBusinesses(query: string, location: string): Lead[] {
  const types = ["Restaurant", "Cafe", "Bakery", "Bar", "Grill", "Bistro", "Eatery", "Kitchen", "Diner", "Tavern"]
  const adjectives = ["Golden", "Silver", "Royal", "Grand", "Elite", "Prime", "Fresh", "Urban", "Classic", "Modern"]
  const streets = ["Main St", "Broadway", "Market St", "Oak Ave", "Elm St", "Park Ave", "5th Ave", "1st St", "Highland Ave", "Washington Blvd"]
  const cities = location ? [location] : ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose"]

  const count = 10
  const leads: Lead[] = []

  for (let i = 0; i < count; i++) {
    const adj = adjectives[i % adjectives.length]
    const type = types[i % types.length]
    const name = `${adj} ${type}`
    const city = cities[i % cities.length]
    const domain = name.toLowerCase().replace(/\s+/g, "") + ".com"
    leads.push({
      firstName: name,
      lastName: "",
      email: `info@${domain}`,
      phone: `+1 (${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
      company: name,
      title: "Owner",
      website: `https://${domain}`,
      location: `${Math.floor(Math.random() * 999) + 1} ${streets[i % streets.length]}, ${city}`,
      source: "Google Maps / Yelp",
      confidence: 0.8,
      verified: true,
      tags: ["local", "business"],
    })
  }
  return leads
}

// Helper: generate startup leads
function generateStartupLeads(query: string, params: Record<string, string>): Lead[] {
  const startups = [
    { name: "NeuralPath", desc: "AI-powered analytics", funding: "$5M Series A" },
    { name: "CloudSync", desc: "Cloud infrastructure", funding: "$12M Series B" },
    { name: "DataVault", desc: "Data security platform", funding: "$3M Seed" },
    { name: "AppForge", desc: "Mobile development", funding: "$8M Series A" },
    { name: "CyberShield", desc: "Cybersecurity solutions", funding: "$15M Series B" },
    { name: "GreenTech", desc: "Sustainable technology", funding: "$4M Seed" },
    { name: "FinFlow", desc: "Financial automation", funding: "$10M Series A" },
    { name: "HealthAI", desc: "Healthcare AI", funding: "$20M Series C" },
    { name: "EduLearn", desc: "EdTech platform", funding: "$6M Series A" },
    { name: "SpaceLog", desc: "Logistics optimization", funding: "$7M Series A" },
  ]

  return startups.slice(0, parseInt(params.count) || 10).map((s, i) => {
    const domain = s.name.toLowerCase() + ".io"
    return {
      firstName: s.name,
      lastName: "Team",
      email: `founders@${domain}`,
      company: s.name,
      title: s.desc,
      website: `https://${domain}`,
      source: "Crunchbase / Product Hunt",
      confidence: 0.85,
      verified: true,
      tags: ["startup", params.industry || "tech"],
      metadata: { funding: s.funding },
    }
  })
}

// Helper: generate email pattern leads
function generateEmailPatternLeads(query: string, params: Record<string, string>): Lead[] {
  const company = params.company || query.split(" ")[0] || "Company"
  const domain = company.toLowerCase().replace(/\s+/g, "") + ".com"
  const patterns = [
    { first: "first.last", pattern: "{first}.{last}@" + domain },
    { first: "firstlast", pattern: "{first}{last}@" + domain },
    { first: "f.last", pattern: "{f}.{last}@" + domain },
    { first: "first", pattern: "{first}@" + domain },
  ]
  return patterns.map((p, i) => ({
    firstName: `Pattern ${i + 1}`,
    lastName: "",
    email: p.pattern,
    company,
    title: "Email Pattern",
    source: "Hunter.io",
    confidence: 0.7,
    tags: ["pattern", "email"],
  }))
}

// Source registry
// Maysan Labs — which sources are allowed to produce leads in production.
//
// The ten built-in classes below are DEMO GENERATORS: they invent people (random first/last
// names, `contact0@<domain>` emails, generated phone numbers) and never call a real service.
// The /api/sources/probe endpoint on this deployment showed 29 of the repo's 67 sources
// behaving that way. Writing them into the lead database would fill the sales pipeline with
// people who do not exist — a wasted call sheet and a deliverability risk — so they are
// disabled and only sources that returned real records for a plain lead query are wired in.
// The list lives in lib/sources/index.ts so the registry, the UI and the engine agree; re-run
// the probe after any upstream upgrade before trusting a source list again.
const PRODUCTION_SOURCE_IDS = PRODUCTION_SOURCE_IDS_FROM_REGISTRY

function adaptRegistrySource(id: string): DataSource | null {
  const source = sourceManager.get(id)
  if (!source) return null
  return {
    name: source.name,
    type: "api",
    enabled: true,
    async search(query: string, params: Record<string, string>): Promise<Lead[]> {
      const options: SourceSearchOptions = {
        count: parseInt(params.count, 10) || 25,
        location: params.location,
        industry: params.industry,
      }
      const leads: SourceLead[] = await source.search(query, options)
      return leads.map((lead) => ({
        id: lead.id,
        firstName: lead.firstName || "",
        lastName: lead.lastName || "",
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        title: lead.title,
        website: lead.website,
        linkedin: lead.linkedin,
        location: lead.location,
        source: source.name,
        confidence: lead.confidence ?? 0.5,
        verified: lead.verified,
        tags: lead.tags,
        metadata: lead.metadata,
      }))
    },
  }
}

const SOURCES: DataSource[] = [
  new WebSearchSource(),
  new GitHubSource(),
  new GoogleMapsSource(),
  new LinkedInSource(),
  new CrunchbaseSource(),
  new HunterIOSource(),
  new YelpSource(),
  new YellowPagesSource(),
  new ProductHuntSource(),
  new AngelListSource(),
]

// Every built-in is a generator: switch it off, then add the real sources.
for (const source of SOURCES) source.enabled = false
SOURCES.push(...PRODUCTION_SOURCE_IDS.map(adaptRegistrySource).filter((s): s is DataSource => s !== null))

// The shared registry applies the same allow-list in its constructor, so the UI and
// /api/sources cannot present a generator as an active source.

// Main search orchestrator
//
// Maysan Labs: the query is PLANNED first (./query.ts) and only the sources that can answer that
// class of question are asked at all; results then pass the relevance gate (./relevance.ts) before
// they are returned or persisted. The old version sent every query to every enabled source and
// returned the union, which is how a Mumbai clinic search came back full of Dev.to authors.
export async function searchLeads(intent: LeadIntent): Promise<SearchResult> {
  const { query, params } = intent
  const plan = planQuery(query)
  const count = parseInt(params?.count || "", 10) || 25

  const options: SourceSearchOptions = {
    count,
    location: plan.location || params?.location,
    industry: params?.industry,
  }

  const known = new Set(sourceManager.getAll().map((source) => source.id))
  const unknown = plan.sourceIds.filter((id) => !known.has(id))
  const runnable = plan.sourceIds.filter((id) => {
    const source = sourceManager.get(id)
    return Boolean(source && source.enabled)
  })

  const notes: string[] = []
  if (unknown.length) notes.push(`Not in this build: ${unknown.join(", ")}`)
  for (const id of plan.sourceIds) {
    const source = sourceManager.get(id)
    if (source && !source.enabled) notes.push(`${source.name} is disabled in this deployment's source policy`)
  }
  if (runnable.length === 0) {
    notes.push("No enabled source can answer this query, so nothing was returned — an unrelated result set is worse than an empty one.")
  }

  const raw = runnable.length ? await sourceManager.searchSources(runnable, query, options) : []

  // Nothing runs unattested past this point: keyword + place must match, unless the source
  // itself matched the record against the query (OpenStreetMap/Overpass does).
  const { kept, dropped, dropReasons } = filterRelevant(raw, plan)
  if (dropped > 0) {
    notes.push(`${dropped} result${dropped === 1 ? "" : "s"} discarded by the relevance gate`)
    notes.push(...dropReasons.map((reason) => `Discarded — ${reason}`))
  }

  const limited = kept.slice(0, count)

  return {
    leads: limited,
    total: kept.length,
    sources: runnable.map((id) => sourceManager.get(id)?.name || id),
    query,
    timestamp: new Date(),
    intent: plan.intent,
    filtered: dropped,
    notes,
    plan: {
      keywords: plan.keywords,
      location: plan.location,
      businessType: plan.businessType?.label,
      why: plan.why,
    },
  }
}

// Get all available sources
export function getDataSources(): DataSource[] {
  return SOURCES
}

// Toggle source
export function toggleSource(name: string, enabled: boolean): void {
  const source = SOURCES.find((s) => s.name === name)
  if (source) source.enabled = enabled
}
