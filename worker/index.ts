import { handleStudioShareApi } from "./studioShares.ts"

interface Env {
  readonly DB: D1Database
  readonly ASSETS: Fetcher
}

const json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8"
    }
  })

const withSecurityHeaders = (response: Response): Response => {
  const secured = new Response(response.body, response)
  secured.headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
  )
  secured.headers.set("permissions-policy", "tools=(self), camera=(), microphone=(self), geolocation=()")
  secured.headers.set("referrer-policy", "strict-origin-when-cross-origin")
  secured.headers.set("x-content-type-options", "nosniff")
  secured.headers.set("origin-agent-cluster", "?1")
  return secured
}

const handleApi = async (request: Request, env: Env, url: URL): Promise<Response> => {
  const shareResponse = await handleStudioShareApi(request, env.DB, url)
  return (
    shareResponse ?? json({ ok: false, error: { code: "NOT_FOUND", message: "API route not found." } }, 404)
  )
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === "/healthz") {
        return withSecurityHeaders(json({ ok: true, status: "healthy", service: "hands-on-the-keys" }))
      }
      if (url.pathname.startsWith("/api/")) {
        return withSecurityHeaders(await handleApi(request, env, url))
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request))
    } catch {
      return withSecurityHeaders(
        json(
          {
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "The session service could not complete that request."
            }
          },
          500
        )
      )
    }
  }
} satisfies ExportedHandler<Env>
