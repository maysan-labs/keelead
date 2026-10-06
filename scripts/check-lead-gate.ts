// Behaviour check for the two gates that keep junk out of the lead database.
//
//   npx tsx scripts/check-lead-gate.ts
//
// These are the cases that actually bit us, not the happy path:
//   * a source that echoes OUR query back in its metadata must not pass on that echo alone —
//     a Bing SERP page ("bing.com") was saved as a healthcare clinic in Mumbai that way;
//   * a search engine's own page is never a lead, whatever its snippet says;
//   * a local query's result must be in the place that was asked for;
//   * an attested directory match (Overpass matched the type + bbox) is trusted even when the
//     business name contains no keyword — "SK Wheels" is a real clinic hit, not a bug.
import { isRelevant } from "@/lib/lead-engine/relevance"
import { planQuery } from "@/lib/lead-engine/query"
import { isSearchEngineHost } from "@/lib/sources/search/web"
import openstreetmapSource from "@/lib/sources/local/openstreetmap"
import type { Lead } from "@/lib/sources/types"

let failures = 0

function check(name: string, actual: boolean, expected: boolean) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${actual}, wanted ${expected})`}`)
}

function lead(overrides: Partial<Lead>): Lead {
  return { firstName: "", lastName: "", source: "Web Search", confidence: 0.5, ...overrides }
}

const plan = planQuery("healthcare clinics in Mumbai")

// 1. The bing.com case: no content keyword anywhere, but every bookkeeping field echoes the request.
const echo = lead({
  firstName: "bing.com",
  company: "bing.com",
  title: "Web result",
  website: "https://www.bing.com/search?q=healthcare+clinics+in+mumbai",
  tags: ["web", "bing-html", "bing.com"],
  metadata: {
    source: "Web Search",
    via: "bing-html",
    position: 1,
    title: "bing.com",
    description: "Search the web",
    domain: "bing.com",
    query: "healthcare clinics in Mumbai",
  },
})
check("a record that only echoes the query is dropped", isRelevant(echo, plan).ok, false)

// 2. Real content: the keyword appears in the snippet and the place in the record.
const real = lead({
  firstName: "Apollo Clinic",
  company: "Apollo Clinic",
  website: "https://apolloclinic.com",
  location: "Bandra, Mumbai",
  metadata: { domain: "apolloclinic.com", description: "Multi-speciality healthcare clinics in Bandra, Mumbai" },
})
check("keyword + place in the content passes", isRelevant(real, plan).ok, true)

// 3. Right keyword, wrong city.
const wrongPlace = lead({
  firstName: "Delhi Care Clinic",
  company: "Delhi Care Clinic",
  website: "https://delhicare.in",
  location: "New Delhi",
  metadata: { description: "A clinic in New Delhi" },
})
check("a clinic outside the requested place is dropped", isRelevant(wrongPlace, plan).ok, false)

// 4. Attested directory match with no keyword in the name.
const attested = lead({
  firstName: "SK Wheels",
  company: "SK Wheels",
  location: "Mumbai",
  source: "OpenStreetMap",
  metadata: { match: "attested", matchKind: "business-type", businessType: "Clinic", query: "healthcare clinics in Mumbai" },
})
check("an attested Overpass match is trusted", isRelevant(attested, plan).ok, true)

// 5. Search engines are never leads.
for (const host of ["bing.com", "www.bing.com", "in.bing.com", "search.brave.com", "google.co.uk", "duckduckgo.com"]) {
  check(`search-engine host rejected: ${host}`, isSearchEngineHost(host), true)
}
for (const host of ["mumbaiclinic.com", "apolloclinic.com", "kumisystems.com", "gorgeousbing.example"]) {
  check(`real host accepted: ${host}`, isSearchEngineHost(host), false)
}

// 6. A source that could not answer must SAY so. An overloaded Overpass used to return a silent
// zero, which read as "Mumbai has no clinics" instead of "the API refused us".
const NOMINATIM_BODY = JSON.stringify([
  {
    place_id: 1,
    licence: "ODbL",
    osm_type: "relation",
    osm_id: 1,
    boundingbox: ["18.89", "19.27", "72.77", "73.00"],
    lat: "19.07",
    lon: "72.87",
    display_name: "Mumbai, Mumbai Suburban District, Maharashtra, India",
    class: "place",
    type: "city",
    importance: 1,
  },
])
const CLINIC_ELEMENT = {
  version: 0.6,
  generator: "stub",
  elements: [
    { type: "node", id: 1, lat: 19.05, lon: 72.83, tags: { name: "Test Clinic", amenity: "clinic", phone: "+912212345678" } },
  ],
}

async function withStubbedFetch(overpassStatus: number, body: string, run: () => Promise<boolean>): Promise<boolean> {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("nominatim")) {
      return new Response(NOMINATIM_BODY, { status: 200, headers: { "content-type": "application/json" } })
    }
    return new Response(body, { status: overpassStatus, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = real
  }
}


async function runSourceChecks(): Promise<void> {
  const osm = openstreetmapSource

// Overpass refuses (429 at both endpoints, twice each): no leads, but an explanation.
const mute = await withStubbedFetch(429, "rate limited", async () => {
  const leads = await osm.search("healthcare clinics in Mumbai", { count: 5 })
  const notes = osm.takeNotes()
  if (leads.length !== 0) return false
  return notes.some((n) => n.includes("Overpass"))
})
check("a refused Overpass produces a note, not a silent zero", mute, true)

// Positive control: the same call with a working Overpass returns the record and no note, so the
// check above is testing the failure path and not a source that simply never returns anything.
const quiet = await withStubbedFetch(200, JSON.stringify(CLINIC_ELEMENT), async () => {
  const leads = await osm.search("healthcare clinics in Mumbai", { count: 5 })
  const notes = osm.takeNotes()
  return leads.length === 1 && leads[0].company === "Test Clinic" && notes.length === 0
})
check("a working Overpass returns the record with no note", quiet, true)
}

runSourceChecks()
  .then(() => {
    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch((error) => {
    console.error("check harness crashed:", error)
    process.exit(1)
  })
