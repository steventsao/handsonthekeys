import * as Schema from "effect/Schema"
import {
  CreateStudioShareRequest,
  StudioSharePayload,
  isStudioShareId,
  studioShareRetentionDays,
  type StudioSharePayload as StudioSharePayloadType,
  type StudioShareRecord
} from "../src/studio/studioShareContract.ts"

interface StudioShareRow {
  readonly id: string
  readonly request_id: string
  readonly payload_hash: string
  readonly payload_json: string
  readonly created_at: number
  readonly expires_at: number
}

class StudioShareRouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

const MAX_SHARE_BODY_BYTES = 750_000
const MAX_SHARED_NOTES = 20_000
const MAX_ACTIVE_SHARES = 1_000
const MAX_SHARES_PER_MINUTE = 30

const ensureStudioShareSchema = async (db: D1Database): Promise<void> => {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS studio_shares (id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS studio_shares_request_id_unique ON studio_shares (request_id)"
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS studio_shares_expires_idx ON studio_shares (expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS studio_shares_created_idx ON studio_shares (created_at)")
  ])
}

const json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8"
    }
  })

const errorResponse = (error: StudioShareRouteError): Response =>
  json({ ok: false, error: { code: error.code, message: error.message } }, error.status)

const readJson = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.startsWith("application/json")) {
    throw new StudioShareRouteError("INVALID_CONTENT_TYPE", "Use application/json.", 415)
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SHARE_BODY_BYTES) {
    throw new StudioShareRouteError("BODY_TOO_LARGE", "The structured share payload is too large.", 413)
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_SHARE_BODY_BYTES) {
    throw new StudioShareRouteError("BODY_TOO_LARGE", "The structured share payload is too large.", 413)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new StudioShareRouteError("INVALID_JSON", "Request body must be valid JSON.")
  }
}

const assertSameOrigin = (request: Request): void => {
  const origin = request.headers.get("origin")
  if (origin !== null && origin !== new URL(request.url).origin) {
    throw new StudioShareRouteError("ORIGIN_REJECTED", "Cross-origin share creation is not accepted.", 403)
  }
}

const decodeCreateRequest = (value: unknown) => {
  try {
    return Schema.decodeUnknownSync(CreateStudioShareRequest, { onExcessProperty: "error" })(value)
  } catch {
    throw new StudioShareRouteError(
      "INVALID_SHARE",
      "The share payload does not match the current Effect Schema contract."
    )
  }
}

const decodePayload = (value: unknown): StudioSharePayloadType => {
  try {
    return Schema.decodeUnknownSync(StudioSharePayload, { onExcessProperty: "error" })(value)
  } catch {
    throw new StudioShareRouteError("CORRUPT_SHARE", "This stored share is unreadable.", 500)
  }
}

const payloadHash = async (payloadJson: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payloadJson))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const recordOf = (row: StudioShareRow): StudioShareRecord => {
  let value: unknown
  try {
    value = JSON.parse(row.payload_json) as unknown
  } catch {
    throw new StudioShareRouteError("CORRUPT_SHARE", "This stored share is unreadable.", 500)
  }
  return {
    id: row.id,
    created_at: new Date(row.created_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    payload: decodePayload(value)
  }
}

const loadByRequestId = (db: D1Database, requestId: string) =>
  db
    .prepare(
      "SELECT id, request_id, payload_hash, payload_json, created_at, expires_at FROM studio_shares WHERE request_id = ? LIMIT 1"
    )
    .bind(requestId)
    .first<StudioShareRow>()

const loadById = (db: D1Database, shareId: string) =>
  db
    .prepare(
      "SELECT id, request_id, payload_hash, payload_json, created_at, expires_at FROM studio_shares WHERE id = ? LIMIT 1"
    )
    .bind(shareId)
    .first<StudioShareRow>()

const createShare = async (request: Request, db: D1Database): Promise<Response> => {
  assertSameOrigin(request)
  const decoded = decodeCreateRequest(await readJson(request))
  const noteCount = decoded.payload.tracks.reduce(
    (total, track) => total + track.clips.reduce((clips, clip) => clips + clip.notes.length, 0),
    0
  )
  if (noteCount > MAX_SHARED_NOTES) {
    throw new StudioShareRouteError(
      "SHARE_TOO_COMPLEX",
      `A share may contain at most ${MAX_SHARED_NOTES.toLocaleString()} MIDI notes.`,
      413
    )
  }
  const payloadJson = JSON.stringify(decoded.payload)
  const hash = await payloadHash(payloadJson)
  const createdAt = Date.now()
  await db.prepare("DELETE FROM studio_shares WHERE expires_at <= ?").bind(createdAt).run()
  const prior = await loadByRequestId(db, decoded.request_id)
  if (prior !== null) {
    if (prior.payload_hash !== hash) {
      throw new StudioShareRouteError(
        "REQUEST_ID_CONFLICT",
        "That request_id was already used for a different share payload.",
        409
      )
    }
    return json({ ok: true, share: recordOf(prior), idempotent: true })
  }

  const capacity = await db
    .prepare(
      "SELECT COUNT(*) AS active_count, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent_count FROM studio_shares"
    )
    .bind(createdAt - 60_000)
    .first<{ readonly active_count: number; readonly recent_count: number | null }>()
  if ((capacity?.recent_count ?? 0) >= MAX_SHARES_PER_MINUTE) {
    throw new StudioShareRouteError(
      "SHARE_RATE_LIMITED",
      "The share service is receiving too many new links. Wait a minute and retry with the same request_id.",
      429
    )
  }
  if ((capacity?.active_count ?? 0) >= MAX_ACTIVE_SHARES) {
    throw new StudioShareRouteError(
      "SHARE_CAPACITY_REACHED",
      "The unlisted share service is at capacity. Existing links remain readable; try again later.",
      503
    )
  }

  const expiresAt = createdAt + studioShareRetentionDays * 24 * 60 * 60 * 1_000
  const shareId = `share_${crypto.randomUUID().replaceAll("-", "")}`
  try {
    await db
      .prepare(
        "INSERT INTO studio_shares (id, request_id, payload_hash, payload_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(shareId, decoded.request_id, hash, payloadJson, createdAt, expiresAt)
      .run()
  } catch (cause) {
    const raced = await loadByRequestId(db, decoded.request_id)
    if (raced !== null && raced.payload_hash === hash) {
      return json({ ok: true, share: recordOf(raced), idempotent: true })
    }
    throw new StudioShareRouteError(
      "SHARE_WRITE_FAILED",
      "The structured share could not be saved. Your browser-local project is unchanged.",
      500
    )
  }
  const row: StudioShareRow = {
    id: shareId,
    request_id: decoded.request_id,
    payload_hash: hash,
    payload_json: payloadJson,
    created_at: createdAt,
    expires_at: expiresAt
  }
  return json({ ok: true, share: recordOf(row), idempotent: false }, 201)
}

const readShare = async (db: D1Database, shareId: string): Promise<Response> => {
  if (!isStudioShareId(shareId)) {
    throw new StudioShareRouteError("INVALID_SHARE_ID", "The Signal share link is malformed.")
  }
  const row = await loadById(db, shareId)
  if (row === null) {
    throw new StudioShareRouteError("SHARE_NOT_FOUND", "This Signal share does not exist.", 404)
  }
  if (row.expires_at <= Date.now()) {
    await db.prepare("DELETE FROM studio_shares WHERE id = ?").bind(shareId).run()
    throw new StudioShareRouteError("SHARE_EXPIRED", "This Signal share has expired.", 410)
  }
  return json({ ok: true, share: recordOf(row) })
}

export const handleStudioShareApi = async (
  request: Request,
  db: D1Database,
  url: URL
): Promise<Response | null> => {
  if (!url.pathname.startsWith("/api/studio-shares")) return null
  try {
    await ensureStudioShareSchema(db)
    if (request.method === "POST" && url.pathname === "/api/studio-shares") {
      return await createShare(request, db)
    }
    const match = url.pathname.match(/^\/api\/studio-shares\/(share_[a-f0-9]+)$/)
    if (request.method === "GET" && match?.[1] !== undefined) {
      return await readShare(db, match[1])
    }
    throw new StudioShareRouteError("NOT_FOUND", "Share API route not found.", 404)
  } catch (cause) {
    const error =
      cause instanceof StudioShareRouteError
        ? cause
        : new StudioShareRouteError(
            "INTERNAL_ERROR",
            "The share service could not complete that request.",
            500
          )
    return errorResponse(error)
  }
}
