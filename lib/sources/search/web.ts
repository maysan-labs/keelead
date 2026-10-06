// Web Search — the general-purpose source: real web results for any query no niche source covers.
//
// Upstream shipped a DEMO GENERATOR here (invented names, `contact0@<q>.com` emails, random phone
// numbers, no HTTP call at all). That is worse than returning nothing, because invented rows look
// like leads.
//
// This is a provider CHAIN, tried in order, and it fails closed — if every provider refuses, the
// source returns [] and the response says nothing was found:
//
//   1. Brave Search API        — used when BRAVE_SEARCH_API_KEY is set (the compose declares it).
//   2. Brave Search results page — HTML-parsed, no key. Brave rate-limits by IP (HTTP 429), and a
//      burst of searches gets throttled, so requests are paced and one retry is allowed.
//   3. Bing results page       — HTML-parsed fallback, also keyless. Bing localises results to the
//      server's region, so it is a LAST resort; the target URL is decoded out of Bing's redirect.
//
// A web result is a COMPANY-shaped lead (site name, URL, snippet), never a fabricated person.
import { BaseSource } from "../base"
import type { Lead, SearchOptions, CompanyData, ContactData } from "../types"

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/** Minimum gap between outbound requests — self-inflicted 429s are the common failure here. */
const MIN_REQUEST_GAP_MS = 2000
/** Process-wide pacing state (one Next.js server process on this deployment). */
let lastRequestAt = 0

interface WebResult {
  title: string
  url: string
  siteName: string
  snippet: string
  position: number
  via: string
}

async function pacedFetch(url: string, accept: string): Promise<Response | null> {
  const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt))
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
      },
    })
  } catch {
    return null
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Hosts that are the search engine itself, not a business. A SERP can land inside our own result
 * set — Bing's page for a query it could not answer came back as "bing.com" and was stored as a
 * lead for a Mumbai clinic search. Nothing on these hosts is ever a lead.
 */
const ENGINE_LABELS = new Set([
  "bing",
  "google",
  "duckduckgo",
  "brave",
  "yahoo",
  "baidu",
  "yandex",
  "ecosia",
  "startpage",
  "qwant",
  "mojeek",
  "ask",
  "aol",
  "naver",
  "seznam",
])

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\d*\./, "").toLowerCase()
  } catch {
    return ""
  }
}

/**
 * True when any label of the host is an engine (bing.com, in.bing.com, google.co.uk, search.brave.com),
 * or when the host cannot be parsed. Erring towards rejection is deliberate: the cost of dropping a
 * domain that merely contains an engine's name is one missing row, and the cost of keeping one is a
 * support page in the call sheet.
 */
export function isSearchEngineHost(host: string): boolean {
  if (!host) return true
  const labels = host.split(".").filter(Boolean)
  if (labels.length < 2) return true
  return labels.some((label) => ENGINE_LABELS.has(label))
}

/** Bing wraps result URLs in /ck/a?…&u=a1<base64url> — decode it, or keep the cite for display. */
function decodeBingUrl(href: string, cite: string): string {
  try {
    const u = new URL(href, "https://www.bing.com").searchParams.get("u")
    if (u && u.startsWith("a1")) {
      const decoded = Buffer.from(u.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
      if (/^https?:\/\//.test(decoded)) return decoded
    }
  } catch {
    /* fall through */
  }
  if (/^https?:\/\//.test(href)) return href
  const cleanCite = cite.replace(/\s*›\s*/g, "/").replace(/^\/+/, "")
  return cleanCite ? `https://${cleanCite}` : ""
}

export class WebSearchSource extends BaseSource {
  name = "Web Search"
  id = "web"
  category = "search"
  requiresApiKey = false // keyless by design; a Brave API key upgrades it to the official endpoint
  rateLimit = 20

  private apiKey(): string {
    return (process.env.BRAVE_SEARCH_API_KEY || "").trim()
  }

  async search(query: string, options?: SearchOptions): Promise<Lead[]> {
    if (!query || !query.trim()) return []
    const count = Math.min(Math.max(options?.count || 10, 1), 20)

    let results: WebResult[] = []
    if (this.apiKey()) {
      results = await this.viaBraveApi(query, count, "brave-api")
    }
    if (!results.length) {
      results = await this.viaBraveHtml(query, count)
    }
    if (!results.length) {
      results = await this.viaBingHtml(query, count)
    }

    return results
      .filter((result) => !isSearchEngineHost(hostOf(result.url)))
      .map((result) => this.toLead(result, query, options))
  }

  private async viaBraveApi(query: string, count: number, via: string): Promise<WebResult[]> {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
        { headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey() } }
      )
      if (!res.ok) return []
      const data = (await res.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string; profile?: { name?: string }; meta_url?: { hostname?: string } }> }
      }
      return (data.web?.results || []).map((result, index) => ({
        title: (result.title || "").trim(),
        url: (result.url || "").trim(),
        siteName: (result.profile?.name || result.meta_url?.hostname || "").trim(),
        snippet: stripHtml(result.description || ""),
        position: index + 1,
        via,
      }))
    } catch {
      return []
    }
  }

  private async viaBraveHtml(query: string, count: number): Promise<WebResult[]> {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await pacedFetch(url, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
      if (!res) return []
      if (res.status === 429 || res.status >= 500) {
        // Back off once, then let the next provider try.
        await new Promise((resolve) => setTimeout(resolve, 4000))
        continue
      }
      if (!res.ok) return []
      const html = await res.text()
      if (!html.includes('data-type="web"')) return []
      return this.parseBraveHtml(html, count)
    }
    return []
  }

  private parseBraveHtml(html: string, count: number): WebResult[] {
    const blocks = html.split(/(?=<div class="snippet[^"]*" data-pos="\d+" data-type="web)/)
    const results: WebResult[] = []
    const seen = new Set<string>()

    for (const block of blocks) {
      if (results.length >= count) break
      if (!block.includes('data-type="web"')) continue

      const linkMatch = block.match(/<a href="(https?:\/\/[^"]+)"/)
      const url = linkMatch ? linkMatch[1] : ""
      if (!url || url.includes("search.brave.com") || url.includes("imgs.search.brave.com")) continue

      let host = ""
      try {
        host = new URL(url).hostname.replace(/^www\./, "")
      } catch {
        continue
      }
      if (seen.has(url)) continue
      seen.add(url)

      const siteMatch = block.match(/class="desktop-small-semibold[^"]*"[^>]*>([^<]*)</)
      const titleAttr = block.match(/class="title[^"]*"[^>]*title="([^"]*)"/)
      const titleText = block.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/)
      const snippetMatch = block.match(/class="content[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\/div>/)

      results.push({
        title: stripHtml(titleAttr?.[1] || titleText?.[1] || siteMatch?.[1] || host),
        url,
        siteName: stripHtml(siteMatch?.[1] || host),
        snippet: snippetMatch ? stripHtml(snippetMatch[1]) : "",
        position: results.length + 1,
        via: "brave-html",
      })
    }

    return results
  }

  private async viaBingHtml(query: string, count: number): Promise<WebResult[]> {
    const res = await pacedFetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(count * 2, 30)}`,
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    )
    if (!res || !res.ok) return []
    const html = (await res.text()).replace(/<link[^>]*>/g, "")
    if (!html.includes('class="b_algo"')) return []

    const blocks = html.split(/(?=<li class="b_algo")/)
    const results: WebResult[] = []
    const seen = new Set<string>()

    for (const block of blocks) {
      if (results.length >= count) break
      if (!block.includes('class="b_algo"')) continue

      const href = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"/)?.[1] || ""
      const cite = stripHtml(block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/)?.[1] || "")
      const url = decodeBingUrl(href, cite)
      if (!url || seen.has(url)) continue
      seen.add(url)

      let host = ""
      try {
        host = new URL(url).hostname.replace(/^www\./, "")
      } catch {
        continue
      }

      results.push({
        title: stripHtml(block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] || host),
        url,
        siteName: host,
        snippet: stripHtml(block.match(/<p class="b_[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] || ""),
        position: results.length + 1,
        via: "bing-html",
      })
    }

    return results
  }

  /**
   * A web result becomes a COMPANY-shaped lead: the site name (preferred over a keyword-stuffed
   * page title), its URL and the snippet. Never a made-up person.
   */
  private toLead(result: WebResult, query: string, options?: SearchOptions): Lead {
    const siteName = (result.siteName || "").trim()
    const looksLikeName = siteName.length > 0 && siteName.length <= 60 && !/\s\|\s/.test(siteName)
    const company =
      (looksLikeName ? siteName : result.title.split(/\s[|–-]\s/)[0].trim() || siteName) || result.url

    let domain = ""
    try {
      domain = new URL(result.url).hostname.replace(/^www\./, "")
    } catch {
      domain = ""
    }

    const requested = (options?.location || "").trim()
    const location =
      (requested && result.snippet.toLowerCase().includes(requested.toLowerCase()) ? requested : undefined) ||
      this.locationFromSnippet(result.snippet)

    return this.makeLead({
      firstName: company,
      lastName: "",
      company,
      title: "Web result",
      website: result.url,
      location,
      confidence: result.position <= 3 ? 0.6 : 0.5,
      tags: ["web", result.via, domain].filter(Boolean),
      metadata: {
        source: "Web Search",
        via: result.via,
        position: result.position,
        title: result.title,
        description: result.snippet,
        domain,
        query,
      },
    })
  }

  /** "…clinic in Bandra, Mumbai…" -> "Mumbai" — used to enrich, never to invent. */
  private locationFromSnippet(snippet: string): string | undefined {
    const match = snippet.match(
      /\b(?:in|at|near|across)\s+([A-Z][\p{L}.'-]+(?:\s+[A-Z][\p{L}.'-]+){0,2})(?:[,.]|\s|$)/u
    )
    return match?.[1]?.trim() || undefined
  }

  async getCompany(domain: string): Promise<CompanyData | null> {
    const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    const leads = await this.search(`${clean} company`, { count: 5 })
    const hit = leads[0]
    if (!hit) return null
    return this.makeCompany({
      name: hit.company || clean,
      domain: clean,
      website: `https://${clean}`,
      description: (hit.metadata?.description as string) || `Web result for ${clean}`,
      metadata: { source: "Web Search", via: hit.metadata?.via },
    })
  }

  async getContact(email: string): Promise<ContactData | null> {
    const [local, domain] = email.split("@")
    const parts = (local || "").split(/[._-]/)
    return {
      name: parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
      email,
      company: (domain || "").replace(/\.(com|io|co|org|net)$/, ""),
      confidence: 0.4,
      source: this.name,
    }
  }
}

export default new WebSearchSource()
