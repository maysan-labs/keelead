// OpenStreetMap — Free local business data via Overpass API + Nominatim.
// Completely free, no API key required, worldwide coverage.
//
// This is the source that answers "businesses of type X in place Y" — a clinic search must find
// clinics. Two rules are load-bearing and both were violated upstream:
//
//   1. Type matching is on WORD BOUNDARIES, longest phrase first. The old substring match turned
//      "healthcare clinics" into `shop=car` (because "care" contains "car"), so a clinic search
//      returned car showrooms. Partial/substring matching against a short key is always a bug.
//   2. One business type maps to SEVERAL OSM tags (a clinic is `amenity=clinic` for some mappers
//      and `healthcare=clinic` for others). The Overpass query unions every tag pair for the type.
//
// Leads that come out of here are marked `metadata.match = "attested"`: the element matched both
// the requested type and the requested place inside Overpass itself, so the engine's relevance
// gate passes them without a keyword test (a business named "SK Wheels" is a legitimate clinic
// match only if Overpass said amenity=clinic — a naive keyword test would drop it wrongly).
import { BaseSource } from "../base"
import type { Lead, SearchOptions, CompanyData, ContactData } from "../types"

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
// Two public Overpass instances. An overloaded primary (HTTP 429/504) is the normal case when a
// burst of queries follows a deploy, so a second instance is tried before giving up.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
// Nominatim's usage policy requires a User-Agent that identifies the application and a contact.
const USER_AGENT = "KeeLead/1.0 (+https://keelead.maysanlabs.com; lead-generation)"

export interface OsmTag {
  key: string
  value: string
}

export interface BusinessType {
  /** Human label used in lead titles and the UI. */
  label: string
  /** Every OSM tag combination that means this business type, unioned in Overpass. */
  tags: OsmTag[]
}

const t = (key: string, ...values: string[]): OsmTag[] => values.map((value) => ({ key, value }))

/** Phrase -> business type. Keys are matched on word boundaries, longest key wins. */
const BUSINESS_TYPE_MAP: Record<string, BusinessType> = {
  // Food & drink
  restaurant: { label: "Restaurant", tags: t("amenity", "restaurant") },
  restaurants: { label: "Restaurant", tags: t("amenity", "restaurant") },
  cafe: { label: "Cafe", tags: t("amenity", "cafe") },
  cafes: { label: "Cafe", tags: t("amenity", "cafe") },
  "coffee shop": { label: "Cafe", tags: t("amenity", "cafe") },
  "coffee shops": { label: "Cafe", tags: t("amenity", "cafe") },
  bar: { label: "Bar", tags: t("amenity", "bar") },
  bars: { label: "Bar", tags: t("amenity", "bar") },
  pub: { label: "Pub", tags: t("amenity", "pub") },
  bakery: { label: "Bakery", tags: t("shop", "bakery") },
  // Healthcare — the case that motivated this table
  clinic: { label: "Clinic", tags: [...t("amenity", "clinic"), ...t("healthcare", "clinic")] },
  clinics: { label: "Clinic", tags: [...t("amenity", "clinic"), ...t("healthcare", "clinic")] },
  "medical clinic": { label: "Clinic", tags: [...t("amenity", "clinic"), ...t("healthcare", "clinic")] },
  "healthcare clinic": { label: "Clinic", tags: [...t("amenity", "clinic"), ...t("healthcare", "clinic")] },
  "polyclinic": { label: "Clinic", tags: [...t("amenity", "clinic"), ...t("healthcare", "clinic")] },
  "nursing home": { label: "Hospital", tags: [...t("amenity", "hospital"), ...t("healthcare", "hospital")] },
  hospital: { label: "Hospital", tags: [...t("amenity", "hospital"), ...t("healthcare", "hospital")] },
  hospitals: { label: "Hospital", tags: [...t("amenity", "hospital"), ...t("healthcare", "hospital")] },
  doctor: { label: "Doctor", tags: [...t("amenity", "doctors"), ...t("healthcare", "doctor")] },
  doctors: { label: "Doctor", tags: [...t("amenity", "doctors"), ...t("healthcare", "doctor")] },
  physician: { label: "Doctor", tags: [...t("amenity", "doctors"), ...t("healthcare", "doctor")] },
  "general physician": { label: "Doctor", tags: [...t("amenity", "doctors"), ...t("healthcare", "doctor")] },
  dentist: { label: "Dentist", tags: [...t("amenity", "dentist"), ...t("healthcare", "dentist")] },
  dentists: { label: "Dentist", tags: [...t("amenity", "dentist"), ...t("healthcare", "dentist")] },
  "dental clinic": { label: "Dentist", tags: [...t("amenity", "dentist"), ...t("healthcare", "dentist")] },
  physiotherapist: { label: "Physiotherapist", tags: t("healthcare", "physiotherapist") },
  physiotherapy: { label: "Physiotherapist", tags: t("healthcare", "physiotherapist") },
  "diagnostic lab": { label: "Diagnostic Laboratory", tags: t("healthcare", "laboratory") },
  "diagnostic centre": { label: "Diagnostic Laboratory", tags: t("healthcare", "laboratory") },
  laboratory: { label: "Laboratory", tags: t("healthcare", "laboratory") },
  pharmacy: { label: "Pharmacy", tags: t("amenity", "pharmacy") },
  pharmacies: { label: "Pharmacy", tags: t("amenity", "pharmacy") },
  "medical store": { label: "Pharmacy", tags: t("amenity", "pharmacy") },
  chemist: { label: "Pharmacy", tags: t("amenity", "pharmacy") },
  "veterinary clinic": { label: "Veterinary", tags: t("amenity", "veterinary") },
  veterinarian: { label: "Veterinary", tags: t("amenity", "veterinary") },
  optician: { label: "Optician", tags: t("shop", "optician") },
  "optical store": { label: "Optician", tags: t("shop", "optician") },
  // Local services
  plumber: { label: "Plumber", tags: t("office", "plumber") },
  plumbers: { label: "Plumber", tags: t("office", "plumber") },
  electrician: { label: "Electrician", tags: t("craft", "electrician") },
  electricians: { label: "Electrician", tags: t("craft", "electrician") },
  salon: { label: "Salon", tags: t("shop", "hairdresser") },
  salons: { label: "Salon", tags: t("shop", "hairdresser") },
  "hair salon": { label: "Salon", tags: t("shop", "hairdresser") },
  "beauty parlour": { label: "Salon", tags: t("shop", "beauty") },
  "beauty parlor": { label: "Salon", tags: t("shop", "beauty") },
  gym: { label: "Gym", tags: t("leisure", "fitness_centre") },
  gyms: { label: "Gym", tags: t("leisure", "fitness_centre") },
  "fitness centre": { label: "Gym", tags: t("leisure", "fitness_centre") },
  hotel: { label: "Hotel", tags: t("tourism", "hotel") },
  hotels: { label: "Hotel", tags: t("tourism", "hotel") },
  "travel agency": { label: "Travel Agency", tags: t("shop", "travel_agency") },
  "courier service": { label: "Courier", tags: t("office", "courier") },
  // Retail
  supermarket: { label: "Supermarket", tags: t("shop", "supermarket") },
  supermarkets: { label: "Supermarket", tags: t("shop", "supermarket") },
  grocery: { label: "Grocery", tags: t("shop", "supermarket") },
  grocery_store: { label: "Grocery", tags: t("shop", "supermarket") },
  bookstore: { label: "Bookstore", tags: t("shop", "books") },
  bookstores: { label: "Bookstore", tags: t("shop", "books") },
  "clothing store": { label: "Clothing Store", tags: t("shop", "clothes") },
  "clothes store": { label: "Clothing Store", tags: t("shop", "clothes") },
  "electronics store": { label: "Electronics Store", tags: t("shop", "electronics") },
  "furniture store": { label: "Furniture Store", tags: t("shop", "furniture") },
  "jewellery store": { label: "Jewellery Store", tags: t("shop", "jewelry") },
  "jewelry store": { label: "Jewellery Store", tags: t("shop", "jewelry") },
  // Automotive — note there is deliberately NO bare "car" key: it substring-matched everything.
  "car dealer": { label: "Car Dealer", tags: t("shop", "car") },
  "car showroom": { label: "Car Dealer", tags: t("shop", "car") },
  "car repair": { label: "Car Repair", tags: t("shop", "car_repair") },
  "car service centre": { label: "Car Repair", tags: t("shop", "car_repair") },
  mechanic: { label: "Car Repair", tags: t("shop", "car_repair") },
  mechanics: { label: "Car Repair", tags: t("shop", "car_repair") },
  "auto parts": { label: "Auto Parts", tags: t("shop", "car_parts") },
  // Education
  school: { label: "School", tags: t("amenity", "school") },
  schools: { label: "School", tags: t("amenity", "school") },
  college: { label: "College", tags: t("amenity", "college") },
  colleges: { label: "College", tags: t("amenity", "college") },
  university: { label: "University", tags: t("amenity", "university") },
  universities: { label: "University", tags: t("amenity", "university") },
  "play school": { label: "Kindergarten", tags: t("amenity", "kindergarten") },
  kindergarten: { label: "Kindergarten", tags: t("amenity", "kindergarten") },
  "coaching centre": { label: "Coaching Centre", tags: t("amenity", "prep_school") },
  // Professional services
  lawyer: { label: "Lawyer", tags: t("office", "lawyer") },
  lawyers: { label: "Lawyer", tags: t("office", "lawyer") },
  advocate: { label: "Lawyer", tags: t("office", "lawyer") },
  advocates: { label: "Lawyer", tags: t("office", "lawyer") },
  "law firm": { label: "Law Firm", tags: t("office", "lawyer") },
  accountant: { label: "Accountant", tags: t("office", "accountant") },
  accountants: { label: "Accountant", tags: t("office", "accountant") },
  "chartered accountant": { label: "Chartered Accountant", tags: t("office", "accountant") },
  "accounting firm": { label: "Accountant", tags: t("office", "accountant") },
  auditor: { label: "Auditor", tags: t("office", "accountant") },
  architect: { label: "Architect", tags: t("office", "architect") },
  architects: { label: "Architect", tags: t("office", "architect") },
  "real estate": { label: "Real Estate Agency", tags: t("office", "estate_agent") },
  "real estate agent": { label: "Real Estate Agency", tags: t("office", "estate_agent") },
  "estate agent": { label: "Real Estate Agency", tags: t("office", "estate_agent") },
  "property dealer": { label: "Real Estate Agency", tags: t("office", "estate_agent") },
  "insurance agency": { label: "Insurance Agency", tags: t("office", "insurance") },
  "it company": { label: "IT Company", tags: t("office", "it") },
  "software company": { label: "Software Company", tags: t("office", "it") },
  "software house": { label: "Software Company", tags: t("office", "it") },
  "tech company": { label: "IT Company", tags: t("office", "it") },
  "digital agency": { label: "Advertising Agency", tags: t("office", "advertising_agency") },
  "marketing agency": { label: "Advertising Agency", tags: t("office", "advertising_agency") },
  "advertising agency": { label: "Advertising Agency", tags: t("office", "advertising_agency") },
  "marketing company": { label: "Advertising Agency", tags: t("office", "advertising_agency") },
  consultancy: { label: "Consultancy", tags: t("office", "consulting") },
  "consulting firm": { label: "Consultancy", tags: t("office", "consulting") },
  "employment agency": { label: "Employment Agency", tags: t("office", "employment_agency") },
  "recruitment agency": { label: "Employment Agency", tags: t("office", "employment_agency") },
  "staffing agency": { label: "Employment Agency", tags: t("office", "employment_agency") },
  "coworking space": { label: "Coworking Space", tags: t("office", "coworking") },
  bank: { label: "Bank", tags: t("amenity", "bank") },
  banks: { label: "Bank", tags: t("amenity", "bank") },
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Lower-case, collapse whitespace, drop surrounding punctuation. */
export function normaliseTerm(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Resolve a free-text business-type term to an OSM type.
 *
 * Exact match first, then the LONGEST key that appears on a word boundary (never a substring
 * match: "healthcare clinics" must not resolve through "car"), then a singularised retry.
 */
export function lookupBusinessType(term: string): BusinessType | null {
  const value = normaliseTerm(term)
  if (!value) return null

  const candidates = [value]
  const singular = value.replace(/\b(\w{3,})s\b/g, "$1")
  if (singular !== value) candidates.push(singular)

  for (const candidate of candidates) {
    if (BUSINESS_TYPE_MAP[candidate]) return BUSINESS_TYPE_MAP[candidate]
  }

  let best: { key: string; type: BusinessType } | null = null
  for (const [key, type] of Object.entries(BUSINESS_TYPE_MAP)) {
    if (key.length < 4) continue
    for (const candidate of candidates) {
      if (!new RegExp(`\\b${escapeRegex(key)}\\b`).test(candidate)) continue
      if (!best || key.length > best.key.length) best = { key, type }
    }
  }
  return best ? best.type : null
}

/** Every known business type, for docs/tests. */
export function knownBusinessTypes(): string[] {
  return Object.keys(BUSINESS_TYPE_MAP).sort()
}

interface NominatimResult {
  place_id: number
  licence: string
  osm_type: string
  osm_id: number
  boundingbox: [string, string, string, string] // south, north, west, east
  lat: string
  lon: string
  display_name: string
  class: string
  type: string
  importance: number
  icon?: string
}

interface OverpassElement {
  type: "node" | "way" | "relation"
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface OverpassResponse {
  version: number
  generator: string
  elements: OverpassElement[]
}

interface ParsedQuery {
  searchTerm: string | null // null means "all businesses of the type"
  location: string
  businessType: BusinessType | null
}

export class OpenStreetMapSource extends BaseSource {
  name = "OpenStreetMap"
  id = "openstreetmap"
  category = "local"
  requiresApiKey = false
  rateLimit = 10

  /**
   * Parse a user query into {business type, location}.
   *   "healthcare clinics in Mumbai" -> { Clinic, "Mumbai" }
   *   "dentists near Paris"          -> { Dentist, "Paris" }
   *   "tech companies in Pune"       -> { searchTerm: "tech companies", "Pune" }
   *   "Mumbai"                       -> { null, "Mumbai" }
   */
  parseQuery(query: string): ParsedQuery {
    const q = (query || "").trim()

    for (const pattern of [
      /^(.+?)\s+in\s+(.+)$/i,
      /^(.+?)\s+near\s+(.+)$/i,
      /^(.+?)\s+around\s+(.+)$/i,
      /^(.+?)\s+close\s+to\s+(.+)$/i,
      /^(.+?)\s+nearby\s+(.+)$/i,
    ]) {
      const match = q.match(pattern)
      if (!match) continue
      const rawType = match[1].trim()
      const location = match[2].trim()
      const businessType = lookupBusinessType(rawType)
      // A known type with a place is a directory lookup; anything else is a name search.
      return businessType
        ? { searchTerm: null, location, businessType }
        : { searchTerm: rawType, location, businessType: null }
    }

    const businessType = lookupBusinessType(q)
    if (businessType) return { searchTerm: null, location: "", businessType }

    return { searchTerm: null, location: q, businessType: null }
  }

  private async geocode(location: string): Promise<NominatimResult | null> {
    if (!location) return null
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=1&addressdetails=1`
    for (let attempt = 0; attempt < 2; attempt++) {
      const results = await this.fetchJson<NominatimResult[]>(url, { "User-Agent": USER_AGENT })
      // An empty array is Nominatim answering "no such place" — retrying that is pointless.
      if (results) {
        if (results.length === 0) {
          this.note(`OpenStreetMap's geocoder (Nominatim) does not know the place "${location}"`)
          return null
        }
        return results[0]
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    this.note(`OpenStreetMap's geocoder (Nominatim) did not answer for "${location}"`)
    return null
  }

  /** Union every tag pair for the type (a clinic can be amenity=clinic OR healthcare=clinic). */
  private buildOverpassQuery(parsed: ParsedQuery, bbox: string): string {
    const nameFilter = parsed.searchTerm
      ? `["name"~"${parsed.searchTerm.replace(/["\\]/g, "")}",i]`
      : ""

    if (parsed.businessType) {
      const parts: string[] = []
      for (const { key, value } of parsed.businessType.tags) {
        for (const element of ["node", "way", "relation"]) {
          parts.push(`  ${element}["${key}"="${value}"]${nameFilter}(${bbox});`)
        }
      }
      return `[out:json][timeout:25];\n(\n${parts.join("\n")}\n);\nout center 200;`
    }

    if (parsed.searchTerm) {
      const term = parsed.searchTerm.replace(/["\\]/g, "")
      const parts: string[] = []
      for (const element of ["node", "way", "relation"]) {
        for (const key of ["amenity", "shop", "office", "tourism", "leisure", "healthcare", "craft"]) {
          parts.push(`  ${element}["name"~"${term}",i]["${key}"](${bbox});`)
        }
      }
      return `[out:json][timeout:25];\n(\n${parts.join("\n")}\n);\nout center 200;`
    }

    // No type, no name: named businesses in the area.
    const parts: string[] = []
    for (const element of ["node", "way"]) {
      for (const key of ["amenity", "shop", "office", "tourism", "leisure"]) {
        parts.push(`  ${element}["name"]["${key}"](${bbox});`)
      }
    }
    return `[out:json][timeout:25];\n(\n${parts.join("\n")}\n);\nout center 200;`
  }

  private async queryOverpass(query: string): Promise<OverpassElement[]> {
    let failure = "no response"
    for (const endpoint of OVERPASS_ENDPOINTS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": USER_AGENT,
            },
            body: `data=${encodeURIComponent(query)}`,
          })
          if (!res.ok) {
            failure = `HTTP ${res.status} from ${hostOf(endpoint)}`
            // 400 is our query being wrong; retrying it or moving on cannot help.
            if (res.status === 400) break
            await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
            continue
          }
          const data = (await res.json()) as OverpassResponse
          return data.elements || []
        } catch (error) {
          failure = `${error instanceof Error ? error.message : "network error"} (${hostOf(endpoint)})`
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
        }
      }
    }
    // Swallowing this is how a busy Overpass read as "Mumbai has no clinics" with no explanation.
    this.note(
      `OpenStreetMap's Overpass API did not answer (${failure}) — local businesses are missing from this result`
    )
    return []
  }

  private buildAddress(tags: Record<string, string>): string {
    const parts: string[] = []

    const houseNumber = tags["addr:housenumber"]
    const street = tags["addr:street"]
    if (street) parts.push(houseNumber ? `${houseNumber} ${street}` : street)

    const city = tags["addr:city"] || tags["addr:suburb"] || tags["addr:district"]
    const state = tags["addr:state"]
    const postcode = tags["addr:postcode"]

    if (city) parts.push(city)
    if (state) parts.push(state)
    if (postcode) parts.push(postcode)

    if (parts.length === 0 && tags["addr:full"]) return tags["addr:full"]
    return parts.join(", ")
  }

  private getBusinessCategory(tags: Record<string, string>): string {
    if (tags.healthcare) return tags.healthcare
    if (tags.amenity) return tags.amenity
    if (tags.shop) return tags.shop
    if (tags.office) return tags.office
    if (tags.craft) return tags.craft
    if (tags.tourism) return tags.tourism
    if (tags.leisure) return tags.leisure
    return "business"
  }

  private elementToLead(
    element: OverpassElement,
    parsed: ParsedQuery,
    locationName: string,
    query: string
  ): Lead | null {
    const tags = element.tags
    if (!tags) return null
    const name = tags.name || tags["name:en"] || tags.operator || tags.brand
    if (!name) return null

    const lat = element.lat ?? element.center?.lat
    const lon = element.lon ?? element.center?.lon

    const phone = tags.phone || tags["contact:phone"] || tags["contact:mobile"]
    const email = tags.email || tags["contact:email"]
    const website = tags.website || tags["contact:website"] || tags.url
    const address = this.buildAddress(tags)
    const category = this.getBusinessCategory(tags)

    const location = [address, locationName].filter(Boolean).join(", ")

    const metadata: Record<string, unknown> = {
      source: "OpenStreetMap",
      osmId: element.id,
      osmType: element.type,
      category,
      // The match was performed by Overpass against the requested type/name and bbox, so the
      // engine's relevance gate can trust it instead of re-testing the text.
      match: "attested",
      matchKind: parsed.businessType ? "business-type" : "name",
      businessType: parsed.businessType?.label,
      query,
      lat,
      lon,
      osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    }
    if (tags.cuisine) metadata.cuisine = tags.cuisine
    if (tags.opening_hours) metadata.openingHours = tags.opening_hours
    if (tags.brand) metadata.brand = tags.brand
    if (tags.operator) metadata.operator = tags.operator
    if (tags.description) metadata.description = tags.description

    let confidence = 0.6
    if (phone) confidence += 0.1
    if (email) confidence += 0.1
    if (website) confidence += 0.1
    if (address) confidence += 0.05
    confidence = Math.min(confidence, 0.95)

    return this.makeLead({
      firstName: name,
      lastName: "",
      company: name,
      title: parsed.businessType?.label || category,
      email: email || undefined,
      phone: phone || undefined,
      website: website || undefined,
      location,
      confidence,
      tags: ["local", "openstreetmap", category, parsed.businessType?.label?.toLowerCase() || ""].filter(Boolean),
      metadata,
    })
  }

  async search(query: string, options?: SearchOptions): Promise<Lead[]> {
    const parsed = this.parseQuery(query)

    const geo = parsed.location
      ? await this.geocode(parsed.location)
      : null

    if (!geo) {
      // No place in the query — a directory needs one. Return nothing rather than guessing a city.
      // (When a place WAS named, geocode() has already recorded why it could not be used.)
      return []
    }

    return this.searchWithGeo(parsed, geo, options, query)
  }

  private async searchWithGeo(
    parsed: ParsedQuery,
    geo: NominatimResult,
    options: SearchOptions | undefined,
    query: string
  ): Promise<Lead[]> {
    const [south, north, west, east] = geo.boundingbox
    const bbox = `${south},${west},${north},${east}`

    // A country-sized bbox cannot be enumerated (Overpass would time out); say nothing instead.
    const latSpan = Math.abs(parseFloat(north) - parseFloat(south))
    const lonSpan = Math.abs(parseFloat(east) - parseFloat(west))
    if (latSpan > 6 || lonSpan > 6) return []

    const elements = await this.queryOverpass(this.buildOverpassQuery(parsed, bbox))
    if (elements.length === 0) return []

    const locationName = geo.display_name.split(",").slice(0, 3).join(",").trim()
    const leads: Lead[] = []
    const seen = new Set<string>()

    for (const element of elements) {
      const lead = this.elementToLead(element, parsed, locationName, query)
      if (!lead) continue
      const key = `${lead.company}|${lead.location}`.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      leads.push(lead)
    }

    leads.sort((a, b) => b.confidence - a.confidence)
    const count = options?.count || leads.length
    return leads.slice(0, Math.min(count, 200))
  }

  async getCompany(domain: string): Promise<CompanyData | null> {
    const elements = await this.queryOverpass(
      `[out:json][timeout:10];\n(\n  node["website"~"${domain}",i];\n  way["website"~"${domain}",i];\n);\nout center 5;`
    )
    if (elements.length === 0) return null

    const el = elements[0]
    const tags = el.tags || {}
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon

    return this.makeCompany({
      name: tags.name || domain.replace(/\.(com|io|co|org|net|de|fr|jp)$/, ""),
      domain,
      website: tags.website || `https://${domain}`,
      description: tags.description || "Business found via OpenStreetMap",
      industry: this.getBusinessCategory(tags),
      headquarters: this.buildAddress(tags) || undefined,
      metadata: {
        source: "OpenStreetMap",
        osmId: el.id,
        lat,
        lon,
        phone: tags.phone || tags["contact:phone"],
        email: tags.email || tags["contact:email"],
        openingHours: tags.opening_hours,
      },
    })
  }

  async getContact(email: string): Promise<ContactData | null> {
    const elements = await this.queryOverpass(
      `[out:json][timeout:10];\n(\n  node["email"~"${email}",i];\n  node["contact:email"~"${email}",i];\n  way["email"~"${email}",i];\n  way["contact:email"~"${email}",i];\n);\nout center 5;`
    )
    if (elements.length === 0) return null

    const el = elements[0]
    const tags = el.tags || {}

    return {
      name: tags.name || email.split("@")[0],
      email,
      phone: tags.phone || tags["contact:phone"],
      company: tags.name,
      confidence: 0.6,
      source: this.name,
    }
  }
}

export default new OpenStreetMapSource()
