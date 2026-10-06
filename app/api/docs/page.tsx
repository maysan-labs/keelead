"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Copy, Check, ChevronRight, Lock, Zap, Globe, Webhook,
  BookOpen, Code, Database, Mail, Building2, Users, BarChart3
} from "lucide-react"

const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/leads",
    description: "Search for leads — the engine routes the query to the sources that can answer it",
    category: "Leads",
    body: '{\n  "query": "healthcare clinics in Mumbai",\n  "count": 25\n}',
    response: '{\n  "leads": [\n    {\n      "firstName": "Mumbai Citiclinic",\n      "lastName": "",\n      "company": "Mumbai Citiclinic",\n      "title": "Clinic",\n      "website": "https://mumbaiclinic.com/",\n      "location": "Mumbai",\n      "confidence": 0.7\n    }\n  ],\n  "total": 12,\n  "sources": ["OpenStreetMap", "Brave Search"],\n  "intent": "local",\n  "filtered": 3\n}',
  },
  {
    method: "GET",
    path: "/api/leads",
    description: "Retrieve saved leads with pagination",
    category: "Leads",
    response: '{\n  "leads": [...],\n  "total": 150,\n  "page": 1,\n  "pageSize": 25\n}',
  },
  {
    method: "POST",
    path: "/api/verify",
    description: "Verify email addresses with 10-layer verification",
    category: "Email",
    body: '{\n  "email": "john@example.com"\n}',
    response: '{\n  "email": "john@example.com",\n  "score": 85,\n  "status": "valid",\n  "layers": [\n    { "layer": 1, "name": "Syntax", "passed": true, "score": 15 },\n    { "layer": 2, "name": "Domain", "passed": true, "score": 10 },\n    { "layer": 3, "name": "MX Records", "passed": true, "score": 15 }\n  ]\n}',
  },
  {
    method: "POST",
    path: "/api/research",
    description: "Deep company research with tech stack, funding, people",
    category: "Research",
    body: '{\n  "query": "Stripe"\n}',
    response: '{\n  "name": "Stripe",\n  "industry": "FinTech",\n  "size": "5000+",\n  "founded": "2010",\n  "techStack": ["Ruby", "React", "AWS"],\n  "keyPeople": [...],\n  "funding": [...],\n  "competitors": [...]\n}',
  },
  {
    method: "POST",
    path: "/api/export",
    description: "Export leads to CSV, JSON, Excel, vCard, or PDF",
    category: "Export",
    body: '{\n  "format": "csv",\n  "template": "leads-hubspot",\n  "filters": { "source": "LinkedIn" }\n}',
    response: '{\n  "url": "/exports/keelead-export-2024-01-15.csv",\n  "count": 42,\n  "format": "csv"\n}',
  },
  {
    method: "POST",
    path: "/api/chat",
    description: "Send a chat message; search intents run the lead engine and persist the leads",
    category: "AI",
    body: '{\n  "message": "healthcare clinics in Mumbai"\n}',
    response: '{\n  "content": "I found **5 leads** matching your query — clinics in Mumbai.",\n  "metadata": {\n    "total": 5,\n    "sources": ["OpenStreetMap", "Brave Search"],\n    "intent": "local",\n    "filtered": 0,\n    "saved": 5\n  }\n}',
  },
  {
    method: "GET",
    path: "/api/sources",
    description: "List every registered data source with its live enabled state and the routing policy",
    category: "Sources",
    response: '{\n  "sources": [\n    { "id": "openstreetmap", "name": "OpenStreetMap", "category": "local", "requiresApiKey": false, "enabled": true },\n    { "id": "google", "name": "Google", "category": "search", "requiresApiKey": true, "enabled": false }\n  ],\n  "total": 67,\n  "enabled": 10,\n  "free": 33,\n  "policy": { "note": "…sources that fabricate records stay disabled…" }\n}',
  },
  {
    method: "GET",
    path: "/api/settings",
    description: "Get current settings and configuration",
    category: "Settings",
    response: '{\n  "ai": { "provider": "openai", "model": "gpt-4o-mini" },\n  "sources": { ... },\n  "notifications": { ... }\n}',
  },
]

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  POST: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  PUT: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  DELETE: "bg-red-500/20 text-red-400 border-red-500/30",
}

export default function ApiDocsPage() {
  const [copied, setCopied] = useState<string | null>(null)
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null)
  const [tryItQuery, setTryItQuery] = useState("")
  const [tryItResult, setTryItResult] = useState<string | null>(null)
  const [tryItLoading, setTryItLoading] = useState(false)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const tryItOut = async () => {
    if (!tryItQuery.trim()) return
    setTryItLoading(true)
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: tryItQuery, count: 5 }),
      })
      const data = await res.json()
      setTryItResult(JSON.stringify(data, null, 2))
    } catch {
      setTryItResult("Error: Could not connect to API")
    }
    setTryItLoading(false)
  }

  const categories = [...new Set(ENDPOINTS.map((e) => e.category))]

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Code className="w-5 h-5" />
            </div>
            <h1 className="text-3xl font-bold">KeeLead API</h1>
            <Badge className="bg-blue-500/20 text-blue-400 border-0">v2.0</Badge>
          </div>
          <p className="text-zinc-400 text-lg max-w-2xl">
            REST API for lead generation, email verification, company research, and more.
            Real data only — see /api/sources for the sources this deployment enables.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            { icon: Database, label: "Registered Sources", value: "67" },
            { icon: Globe, label: "API Endpoints", value: "8+" },
            { icon: Zap, label: "AI Providers", value: "6" },
            { icon: Users, label: "Categories", value: "11" },
          ].map((stat) => (
            <Card key={stat.label} className="bg-[#0a0a0a] border-white/10">
              <CardContent className="p-4 flex items-center gap-3">
                <stat.icon className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-xl font-bold">{stat.value}</p>
                  <p className="text-xs text-zinc-400">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Authentication */}
        <Card className="bg-[#0a0a0a] border-white/10 mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="w-4 h-4 text-amber-400" />
              Authentication
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-zinc-400 text-sm mb-3">
              Include your API key in the request header:
            </p>
            <div className="bg-black/50 rounded-lg p-3 font-mono text-sm flex items-center justify-between">
              <span className="text-emerald-400">Authorization: Bearer YOUR_API_KEY</span>
              <button onClick={() => copyToClipboard("Authorization: Bearer YOUR_API_KEY", "auth")} className="text-zinc-400 hover:text-white">
                {copied === "auth" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Try It Out */}
        <Card className="bg-[#0a0a0a] border-white/10 mb-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-4 h-4 text-blue-400" />
              Try It Out
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 mb-4">
              <Input
                value={tryItQuery}
                onChange={(e) => setTryItQuery(e.target.value)}
                placeholder="Enter a search query (e.g., 'SaaS founders in San Francisco')"
                className="bg-white/5 border-white/10 flex-1"
                onKeyDown={(e) => e.key === "Enter" && tryItOut()}
              />
              <Button onClick={tryItOut} disabled={tryItLoading} className="bg-blue-500 hover:bg-blue-600">
                {tryItLoading ? "Searching..." : "Search"}
              </Button>
            </div>
            {tryItResult && (
              <pre className="bg-black/50 rounded-lg p-4 text-sm overflow-x-auto text-zinc-300 max-h-64 overflow-y-auto">
                {tryItResult}
              </pre>
            )}
          </CardContent>
        </Card>

        {/* Endpoints by Category */}
        <Tabs defaultValue={categories[0]} className="space-y-6">
          <TabsList className="bg-white/5 border border-white/10 flex-wrap">
            {categories.map((cat) => (
              <TabsTrigger key={cat} value={cat} className="data-[state=active]:bg-white/10">
                {cat}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((cat) => (
            <TabsContent key={cat} value={cat} className="space-y-4">
              {ENDPOINTS.filter((e) => e.category === cat).map((endpoint) => {
                const key = `${endpoint.method}-${endpoint.path}`
                const isExpanded = expandedEndpoint === key
                return (
                  <Card key={key} className="bg-[#0a0a0a] border-white/10">
                    <CardHeader
                      className="cursor-pointer"
                      onClick={() => setExpandedEndpoint(isExpanded ? null : key)}
                    >
                      <div className="flex items-center gap-3">
                        <Badge className={`${METHOD_COLORS[endpoint.method]} border text-xs font-mono`}>
                          {endpoint.method}
                        </Badge>
                        <code className="text-sm font-mono text-zinc-300">{endpoint.path}</code>
                        <ChevronRight className={`w-4 h-4 text-zinc-400 ml-auto transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      </div>
                      <p className="text-sm text-zinc-400 mt-1">{endpoint.description}</p>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent className="space-y-4 pt-0">
                        {endpoint.body && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-medium text-zinc-400">Request Body</span>
                              <button
                                onClick={() => copyToClipboard(endpoint.body!, `body-${key}`)}
                                className="text-zinc-400 hover:text-white"
                              >
                                {copied === `body-${key}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                            <pre className="bg-black/50 rounded-lg p-3 text-xs font-mono text-emerald-400 overflow-x-auto">
                              {endpoint.body}
                            </pre>
                          </div>
                        )}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-zinc-400">Response</span>
                            <button
                              onClick={() => copyToClipboard(endpoint.response!, `res-${key}`)}
                              className="text-zinc-400 hover:text-white"
                            >
                              {copied === `res-${key}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                          <pre className="bg-black/50 rounded-lg p-3 text-xs font-mono text-blue-400 overflow-x-auto">
                            {endpoint.response}
                          </pre>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-xs border-white/10">
                            Rate limit: 100 req/min
                          </Badge>
                          <Badge variant="outline" className="text-xs border-white/10">
                            JSON
                          </Badge>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </TabsContent>
          ))}
        </Tabs>

        {/* Webhooks Section */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <Webhook className="w-6 h-6 text-purple-400" />
            Webhooks
          </h2>
          <Card className="bg-[#0a0a0a] border-white/10">
            <CardContent className="p-6 space-y-4">
              <p className="text-zinc-400">
                Receive real-time notifications when events happen. Configure webhook endpoints to receive POST requests.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  "lead.created", "lead.updated", "lead.enriched",
                  "email.verified", "email.sent", "email.opened",
                  "campaign.started", "campaign.completed",
                  "signal.detected", "export.completed",
                ].map((event) => (
                  <Badge key={event} variant="outline" className="text-xs border-white/10 justify-start font-mono">
                    {event}
                  </Badge>
                ))}
              </div>
              <div className="bg-black/50 rounded-lg p-4 font-mono text-sm">
                <p className="text-zinc-400 text-xs mb-2">Example webhook payload:</p>
                <pre className="text-emerald-400">{`{
  "id": "evt_abc123",
  "event": "lead.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "lead": { "firstName": "Example Clinic", "company": "Example Clinic", "source": "OpenStreetMap" }
  }
}`}</pre>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rate Limiting */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-amber-400" />
            Rate Limiting
          </h2>
          <Card className="bg-[#0a0a0a] border-white/10">
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { plan: "Free", limit: "100 req/min", sources: "all enabled" },
                  { plan: "Pro", limit: "1,000 req/min", sources: "all enabled" },
                  { plan: "Enterprise", limit: "Unlimited", sources: "all enabled + research" },
                ].map((tier) => (
                  <div key={tier.plan} className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <h3 className="font-medium mb-1">{tier.plan}</h3>
                    <p className="text-2xl font-bold text-blue-400">{tier.limit}</p>
                    <p className="text-xs text-zinc-400 mt-1">{tier.sources} sources</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
