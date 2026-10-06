// Query planning — which sources can actually answer THIS query, and what "relevant" means.
//
// This module exists because of a real failure: the engine sent every query to every enabled
// source and returned whatever came back, so "healthcare clinics in Mumbai" was answered by
// Dev.to (popular dev articles), Google Scholar (a 2021 paper) and ORCID (a researcher) — three
// sources answering a question nobody asked, persisted as leads at score 70.
//
// The rule now: a query is classified first, and only the sources that can answer that class of
// question are queried at all. When nothing can answer it, the engine says so instead of
// returning noise.
import { lookupBusinessType, type BusinessType } from "@/lib/sources/local/openstreetmap"

export type QueryIntent = "local" | "developer" | "academic" | "company" | "web"

export interface QueryPlan {
  query: string
  intent: QueryIntent
  /** Content tokens of the query (stopwords, location and filler removed) — the relevance test. */
  keywords: string[]
  /** Place name extracted from the query, if any. */
  location?: string
  /** Resolved OSM business type when the query names one ("clinics", "car dealers"). */
  businessType: BusinessType | null
  /** Which sources will be asked, in priority order. */
  sourceIds: string[]
  /** Human-readable reasons, surfaced in the chat response so the user can see the routing. */
  why: string[]
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "with", "without", "from", "by", "on", "in",
  "into", "at", "near", "around", "close", "across", "within", "inside", "me", "my", "us", "our",
  "i", "we", "you", "your", "please", "want", "need", "give", "show", "get", "find", "search",
  "looking", "look", "list", "about", "that", "this", "these", "those", "is", "are", "was", "were",
  "be", "been", "do", "does", "did", "can", "could", "should", "would", "will", "any", "all",
  "some", "more", "most", "top", "best", "new", "good", "who", "what", "where", "when", "how",
  "there", "here", "it", "its", "as", "so", "up", "out", "over", "under", "between", "per", "each",
  "leads", "lead", "contacts", "contact", "people", "persons", "person", "results", "result",
  "list", "directory", "data", "info", "information", "details", "email", "emails", "phone",
  "number", "numbers", "address", "addresses", "sheet", "call", "sheet",
])

/** Filler that means "local businesses" when no business type was named. */
const LOCAL_FILLER = new Set([
  "business", "businesses", "company", "companies", "shop", "shops", "store", "stores", "vendor",
  "vendors", "supplier", "suppliers", "dealer", "dealers", "provider", "providers", "service",
  "services", "place", "places", "local", "nearby",
])

const DEVELOPER_RE =
  /\b(developers?|engineers?|programmers?|coders?|devops|sre|front[- ]?end|back[- ]?end|full[- ]?stack|software|open[- ]?source|github|maintainers?|data scientists?|data engineers?|machine learning|ml engineers?|ai engineers?)\b/i

const ACADEMIC_RE =
  /\b(professors?|researchers?|academics?|phds?|postdocs?|scientists?|scholars?|universit(?:y|ies)|colleges?|publications?|papers?|journals?|citations?)\b/i

const COMPANY_RE =
  /\b(compan(?:y|ies)|startups?|firms?|enterprises?|businesses|brands?|manufacturers?|distributors?|suppliers?|agenc(?:y|ies)|industr(?:y|ies)|vendors?|dealer(?:s|ships)?|hospitals?|clinics?)\b/i

const PLACE_PREPOSITION_RE = /\b(?:in|near|around|close\s+to|within|across|from|at)\s+([^,;()]+)/i
const PLACE_STOP_TAIL = /\b(?:and|or|with|that|who|which|for)\b.*$/i

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tokenise(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.'-]+/u)
    .map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter(Boolean)
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word.length > 2 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ")
}

/**
 * Pull the place out of the query.
 * "clinics in Mumbai" -> "Mumbai"; "founders in San Francisco" -> "San Francisco";
 * "clinics" -> undefined (never guess a city — a directory lookup without one returns nothing).
 */
export function extractLocation(query: string): string | undefined {
  const match = query.match(PLACE_PREPOSITION_RE)
  if (!match) return undefined

  let candidate = match[1].trim()
  candidate = candidate.replace(PLACE_STOP_TAIL, "").replace(/[.?!,;:]+$/, "").trim()
  if (!candidate) return undefined

  const words = candidate.split(/\s+/).filter(Boolean)
  if (words.length > 4) return undefined // that is a sentence, not a place

  // Strip a leading article and reject a candidate made only of filler words.
  while (words.length && STOPWORDS.has(words[0].toLowerCase())) words.shift()
  if (!words.length) return undefined
  if (words.every((word) => STOPWORDS.has(word.toLowerCase()) || LOCAL_FILLER.has(word.toLowerCase()))) {
    return undefined
  }

  const place = words.join(" ")
  // Nominatim does better with a capitalised place name; the query is usually lower-case.
  return /^[a-z]/.test(place) ? titleCase(place) : place
}

/** The business type a query names, if any ("healthcare clinics in Mumbai" -> Clinic). */
export function extractBusinessType(query: string): { type: BusinessType; term: string } | null {
  const direct = lookupBusinessType(query)
  if (direct) return { type: direct, term: query }

  // Also try the head of the phrase (everything before " in | near | around ").
  const head = query.match(/^(.+?)\s+(?:in|near|around|close\s+to|within|across|at)\s+/i)?.[1]
  if (head) {
    const fromHead = lookupBusinessType(head)
    if (fromHead) return { type: fromHead, term: head }
  }
  return null
}

/** Classify the query and pick the sources that can answer it. */
export function planQuery(query: string): QueryPlan {
  const raw = (query || "").trim()
  const why: string[] = []

  const location = extractLocation(raw)
  const business = extractBusinessType(raw)

  const locationTokens = new Set(location ? tokenise(location) : [])
  const keywords = tokenise(raw).filter(
    (token) => !STOPWORDS.has(token) && !locationTokens.has(token) && token.length > 1
  )

  const hasPlace = Boolean(location)
  const onlyFiller = keywords.length > 0 && keywords.every((token) => LOCAL_FILLER.has(token))

  let intent: QueryIntent
  if (business || (hasPlace && onlyFiller)) {
    intent = "local"
  } else if (DEVELOPER_RE.test(raw)) {
    intent = "developer"
  } else if (ACADEMIC_RE.test(raw)) {
    intent = "academic"
  } else if (COMPANY_RE.test(raw)) {
    intent = "company"
  } else {
    intent = "web"
  }

  const sources: string[] = []
  if (intent === "local") {
    if (business) {
      sources.push("openstreetmap")
      why.push(
        `"${business.type.label}" is a business-directory lookup, so OpenStreetMap (Overpass + Nominatim, free, no key) is queried${hasPlace ? ` for ${location}` : " — but the query names no place, so it will return nothing"}`
      )
    } else {
      why.push(
        `No business type in the query, so OpenStreetMap is used as a directory${hasPlace ? ` for ${location}` : ""}`
      )
      if (hasPlace) sources.push("openstreetmap")
    }
    sources.push("web")
    why.push("Web Search (Brave, Bing fallback) covers the businesses OpenStreetMap is missing — or the whole query if no place was named")
  } else if (intent === "developer") {
    sources.push("github", "stackoverflow", "web")
    why.push("Developer query: GitHub, Stack Overflow and Web Search; Dev.to is asked too but only ever answers single-word tag queries")
    sources.push("devto")
  } else if (intent === "academic") {
    sources.push("google-scholar", "orcid", "web")
    why.push("Academic query: Google Scholar and ORCID for researcher profiles, plus Web Search")
  } else if (intent === "company") {
    sources.push("opencorporates", "sec-edgar", "web")
    why.push("Company query: OpenCorporates and SEC EDGAR for registered entities, plus Web Search")
  } else {
    sources.push("web", "duckduckgo")
    why.push("General web query: Web Search (Brave, Bing fallback); DuckDuckGo is asked as well but its instant-answer API only answers entity questions")
  }

  // A named place is a strong signal that local coverage helps, whatever the intent.
  if (intent !== "local" && hasPlace && business) {
    sources.push("openstreetmap")
    why.push(`Also queried OpenStreetMap for "${business.type.label}"${location ? ` in ${location}` : ""}`)
  }

  if (!hasPlace && (intent === "local" || intent === "company")) {
    why.push("No place found in the query — directory sources (OpenStreetMap) need one and will be skipped")
  }
  if (keywords.length === 0) {
    why.push("No content keywords survived stopword removal — every returned lead must at least match the place name")
  }

  return {
    query: raw,
    intent,
    keywords,
    location,
    businessType: business?.type || null,
    sourceIds: Array.from(new Set(sources)),
    why,
  }
}

export { escapeRegex }
