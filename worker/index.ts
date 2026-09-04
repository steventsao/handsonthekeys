import type { ChannelSnapshot, PublicRun, RunStatus, SteeringEvent, VisualOutput } from "../src/slop/types.ts"
import { handleRelayApi } from "./relay.ts"
import { handleStudioShareApi } from "./studioShares.ts"

interface Env {
  readonly DB: D1Database
  readonly ASSETS: Fetcher
}

interface RunRow {
  readonly id: string
  readonly prompt: string
  readonly status: RunStatus
  readonly revision: number
  readonly owner_key: string
  readonly output_json: string | null
  readonly error_json: string | null
  readonly created_at: string
  readonly updated_at: string
}

interface SteeringRow {
  readonly id: string
  readonly run_id: string
  readonly instruction: string
  readonly revision: number
  readonly created_at: string
}

interface IdempotencyRow {
  readonly request_key: string
  readonly payload_hash: string
  readonly run_id: string
  readonly steering_id: string | null
}

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

const MAX_PROMPT_LENGTH = 1_200
const MAX_STEERING_LENGTH = 600
const MAX_BATCH_SIZE = 6
const MAX_ACTIVE_GLOBAL = 36
const MAX_ACTIVE_PER_CLIENT = 6
const MAX_STEERING_EVENTS = 6
const GENERATION_MILLIS = 4_200
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const RUN_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

const palettes: ReadonlyArray<ReadonlyArray<string>> = [
  ["#09090b", "#f43f5e", "#fbbf24", "#38bdf8"],
  ["#071a17", "#2dd4bf", "#a3e635", "#fef08a"],
  ["#160b22", "#c084fc", "#fb7185", "#67e8f9"],
  ["#150d06", "#fb923c", "#fde047", "#4ade80"],
  ["#061225", "#60a5fa", "#e879f9", "#f8fafc"]
]

const falDemoUrl = "https://v3b.fal.media/files/b/0aa87cff/CWlKQoroNjJ5WwQO-0WyU_minimax-h3.mp4"

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === "/healthz") {
        return json({ ok: true, status: "healthy", service: "infinite-slop-webmcp" })
      }

      if (url.pathname.startsWith("/api/")) {
        const response = await handleApi(request, env, url)
        return withSecurityHeaders(response)
      }

      return withSecurityHeaders(await env.ASSETS.fetch(request))
    } catch (cause) {
      const error =
        cause instanceof ApiError
          ? cause
          : new ApiError("INTERNAL_ERROR", "The shared channel could not complete that request.", 500)
      return withSecurityHeaders(
        json({ ok: false, error: { code: error.code, message: error.message } }, error.status)
      )
    }
  }
} satisfies ExportedHandler<Env>

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  await ensureSchema(env.DB)

  const studioShareResponse = await handleStudioShareApi(request, env.DB, url)
  if (studioShareResponse !== null) return studioShareResponse

  if (url.pathname.startsWith("/api/relay/")) {
    return handleRelayApi(request, env, url)
  }

  await ensureSeedRuns(env.DB)
  await advanceQueue(env.DB)

  if (request.method === "GET" && url.pathname === "/api/channel") {
    return json({ ok: true, channel: await loadChannel(env.DB) })
  }

  if (request.method === "POST" && url.pathname === "/api/runs") {
    assertSameOrigin(request)
    const body = await readBody(request)
    const ownerKey = readClientIdentity(request, body)
    const [result] = await queueRuns(env.DB, ownerKey, [
      {
        prompt: normalizeText(body.prompt, "prompt", 3, MAX_PROMPT_LENGTH),
        clientRequestId: normalizeIdentifier(body.client_request_id, "client_request_id")
      }
    ])
    if (result === undefined) throw new ApiError("QUEUE_WRITE_FAILED", "The prompt was not queued.", 500)
    return json({
      ok: true,
      run: result.run,
      idempotent: result.idempotent,
      visual_result: {
        mode: "on_page_card",
        message: `Queued ${result.run.id}; its live result card is visible in the channel.`
      }
    })
  }

  if (request.method === "POST" && url.pathname === "/api/runs/batch") {
    assertSameOrigin(request)
    const body = await readBody(request)
    const ownerKey = readClientIdentity(request, body)
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_BATCH_SIZE) {
      throw new ApiError("INVALID_BATCH", `items must contain 1–${MAX_BATCH_SIZE} prompts.`)
    }
    const items = body.items.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new ApiError("INVALID_BATCH", "Every batch item must be an object.")
      }
      const record = item as Record<string, unknown>
      return {
        prompt: normalizeText(record.prompt, "prompt", 3, MAX_PROMPT_LENGTH),
        clientRequestId: normalizeIdentifier(record.client_request_id, "client_request_id")
      }
    })
    const requestIds = new Set(items.map((item) => item.clientRequestId))
    if (requestIds.size !== items.length) {
      throw new ApiError("DUPLICATE_REQUEST_ID", "Batch client_request_id values must be unique.")
    }
    const results = await queueRuns(env.DB, ownerKey, items)
    return json({
      ok: true,
      runs: results.map((result) => result.run),
      idempotent: results.map((result) => result.idempotent),
      visual_result: {
        mode: "on_page_cards",
        message: `Queued ${results.length} prompts; their live cards are visible in input order.`
      }
    })
  }

  const runRoute = url.pathname.match(/^\/api\/runs\/([A-Za-z0-9_-]+)$/)
  if (request.method === "GET" && runRoute?.[1] !== undefined) {
    const run = await loadRun(env.DB, normalizeRunId(runRoute[1]))
    return json({
      ok: true,
      run,
      visual_result: {
        mode: "on_page_card",
        message: `${run.id} is ${run.status}; the channel has painted this status into its activity stream.`
      }
    })
  }

  const steerRoute = url.pathname.match(/^\/api\/runs\/([A-Za-z0-9_-]+)\/steer$/)
  if (request.method === "POST" && steerRoute?.[1] !== undefined) {
    assertSameOrigin(request)
    const body = await readBody(request)
    const ownerKey = readClientIdentity(request, body)
    const result = await steerRun(env.DB, ownerKey, normalizeRunId(steerRoute[1]), {
      instruction: normalizeText(body.instruction, "instruction", 2, MAX_STEERING_LENGTH),
      expectedRevision: normalizePositiveInteger(body.expected_revision, "expected_revision"),
      clientRequestId: normalizeIdentifier(body.client_request_id, "client_request_id")
    })
    return json({
      ok: true,
      ...result,
      visual_result: {
        mode: "on_page_card",
        message: `Steering revision ${result.run.revision} is visible on ${result.run.id}.`
      }
    })
  }

  throw new ApiError("NOT_FOUND", "API route not found.", 404)
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, owner_key TEXT NOT NULL, output_json TEXT, error_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS steering_events (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, instruction TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS idempotency_keys (request_key TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, payload_hash TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, steering_id TEXT REFERENCES steering_events(id) ON DELETE CASCADE, created_at TEXT NOT NULL)"
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_status_created_idx ON runs (status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_owner_status_idx ON runs (owner_key, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_updated_idx ON runs (updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS steering_run_revision_idx ON steering_events (run_id, revision)"),
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

async function ensureSeedRuns(db: D1Database): Promise<void> {
  const exists = await db.prepare("SELECT id FROM runs LIMIT 1").first<{ readonly id: string }>()
  if (exists !== null) return

  const now = Date.now()
  const at = (offset: number) => new Date(now + offset).toISOString()
  const videoOutput: VisualOutput = {
    kind: "video",
    url: falDemoUrl,
    posterUrl: null,
    palette: palettes[2] ?? palettes[0] ?? ["#09090b", "#f43f5e"],
    seed: 73491,
    title: "ORBITAL BLOOM / H3 MAX"
  }
  const proceduralOutput = createProceduralOutput(
    "demo-signal-bloom",
    "A field of amber signals blooming through a midnight data garden",
    []
  )

  await db.batch([
    seedStatement(db, {
      id: "demo-signal-bloom",
      prompt: "A field of amber signals blooming through a midnight data garden",
      status: "succeeded",
      revision: 3,
      output: proceduralOutput,
      createdAt: at(-44_000),
      updatedAt: at(-28_000)
    }),
    seedStatement(db, {
      id: "demo-orbital-bloom",
      prompt: "An orbital greenhouse opening its petals above a storm-lit planet",
      status: "succeeded",
      revision: 4,
      output: videoOutput,
      createdAt: at(-31_000),
      updatedAt: at(-12_000)
    }),
    seedStatement(db, {
      id: "demo-velvet-transit",
      prompt: "A velvet maglev slipping between impossible coral towers at blue hour",
      status: "generating",
      revision: 2,
      output: null,
      createdAt: at(-7_000),
      updatedAt: at(-1_500)
    }),
    seedStatement(db, {
      id: "demo-afterimage-market",
      prompt: "A night market made from afterimages, chrome rain, and floating lantern code",
      status: "queued",
      revision: 1,
      output: null,
      createdAt: at(-500),
      updatedAt: at(-500)
    })
  ])
}

function seedStatement(
  db: D1Database,
  seed: {
    readonly id: string
    readonly prompt: string
    readonly status: RunStatus
    readonly revision: number
    readonly output: VisualOutput | null
    readonly createdAt: string
    readonly updatedAt: string
  }
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT OR IGNORE INTO runs (id, prompt, status, revision, owner_key, output_json, error_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)"
    )
    .bind(
      seed.id,
      seed.prompt,
      seed.status,
      seed.revision,
      "__demo_channel__",
      seed.output === null ? null : JSON.stringify(seed.output),
      seed.createdAt,
      seed.updatedAt
    )
}

async function advanceQueue(db: D1Database): Promise<void> {
  const generating = await db
    .prepare("SELECT * FROM runs WHERE status = 'generating' ORDER BY updated_at ASC LIMIT 1")
    .first<RunRow>()

  if (generating !== null) {
    const elapsed = Date.now() - Date.parse(generating.updated_at)
    if (elapsed < GENERATION_MILLIS) return
    const steering = await loadSteering(db, generating.id)
    const output = createProceduralOutput(generating.id, generating.prompt, steering)
    await db
      .prepare(
        "UPDATE runs SET status = 'succeeded', revision = revision + 1, output_json = ?, error_json = NULL, updated_at = ? WHERE id = ? AND status = 'generating'"
      )
      .bind(JSON.stringify(output), new Date().toISOString(), generating.id)
      .run()
  }

  const active = await db
    .prepare("SELECT id FROM runs WHERE status = 'generating' LIMIT 1")
    .first<{ readonly id: string }>()
  if (active !== null) return

  const next = await db
    .prepare("SELECT id FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
    .first<{ readonly id: string }>()
  if (next === null) return
  await db
    .prepare(
      "UPDATE runs SET status = 'generating', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'queued'"
    )
    .bind(new Date().toISOString(), next.id)
    .run()
}

async function queueRuns(
  db: D1Database,
  ownerKey: string,
  items: ReadonlyArray<{ readonly prompt: string; readonly clientRequestId: string }>
): Promise<ReadonlyArray<{ readonly run: PublicRun; readonly idempotent: boolean }>> {
  const existing: Array<{ readonly run: PublicRun; readonly idempotent: boolean } | null> = []
  const newItems: Array<{
    readonly index: number
    readonly prompt: string
    readonly clientRequestId: string
    readonly payloadHash: string
  }> = []

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item === undefined) continue
    const payloadHash = await sha256(item.prompt)
    const key = requestKey("queue", ownerKey, item.clientRequestId)
    const prior = await db
      .prepare(
        "SELECT request_key, payload_hash, run_id, steering_id FROM idempotency_keys WHERE request_key = ?"
      )
      .bind(key)
      .first<IdempotencyRow>()
    if (prior !== null) {
      if (prior.payload_hash !== payloadHash) {
        throw new ApiError(
          "IDEMPOTENCY_CONFLICT",
          "client_request_id was already used with a different prompt.",
          409
        )
      }
      existing[index] = { run: await loadRun(db, prior.run_id), idempotent: true }
    } else {
      existing[index] = null
      newItems.push({ index, ...item, payloadHash })
    }
  }

  if (newItems.length > 0) {
    const [globalCount, ownerCount] = await Promise.all([
      countRuns(db, "SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued', 'generating')"),
      countRuns(
        db,
        "SELECT COUNT(*) AS count FROM runs WHERE owner_key = ? AND status IN ('queued', 'generating')",
        ownerKey
      )
    ])
    if (globalCount + newItems.length > MAX_ACTIVE_GLOBAL) {
      throw new ApiError("QUEUE_FULL", "The shared queue is full; try again after a run completes.", 429)
    }
    if (ownerCount + newItems.length > MAX_ACTIVE_PER_CLIENT) {
      throw new ApiError(
        "CLIENT_QUEUE_LIMIT",
        `A browser may have at most ${MAX_ACTIVE_PER_CLIENT} active runs.`,
        429
      )
    }

    const now = new Date().toISOString()
    const statements: Array<D1PreparedStatement> = []
    const newIds = new Map<number, string>()
    for (const item of newItems) {
      const id = `run-${crypto.randomUUID()}`
      newIds.set(item.index, id)
      statements.push(
        db
          .prepare(
            "INSERT INTO runs (id, prompt, status, revision, owner_key, output_json, error_json, created_at, updated_at) VALUES (?, ?, 'queued', 1, ?, NULL, NULL, ?, ?)"
          )
          .bind(id, item.prompt, ownerKey, now, now),
        db
          .prepare(
            "INSERT INTO idempotency_keys (request_key, kind, payload_hash, run_id, steering_id, created_at) VALUES (?, 'queue', ?, ?, NULL, ?)"
          )
          .bind(requestKey("queue", ownerKey, item.clientRequestId), item.payloadHash, id, now)
      )
    }
    await db.batch(statements)
    await db
      .prepare(
        "DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE status IN ('succeeded', 'failed') AND owner_key != '__demo_channel__' ORDER BY updated_at DESC LIMIT -1 OFFSET 40)"
      )
      .run()
    await advanceQueue(db)
    for (const [index, id] of newIds) {
      existing[index] = { run: await loadRun(db, id), idempotent: false }
    }
  }

  return existing.map((item) => {
    if (item === null || item === undefined) {
      throw new ApiError("QUEUE_WRITE_FAILED", "A batch item was not queued.", 500)
    }
    return item
  })
}

async function steerRun(
  db: D1Database,
  ownerKey: string,
  runId: string,
  input: {
    readonly instruction: string
    readonly expectedRevision: number
    readonly clientRequestId: string
  }
): Promise<{
  readonly run: PublicRun
  readonly steering: SteeringEvent
  readonly idempotent: boolean
}> {
  const payloadHash = await sha256(`${runId}\n${input.expectedRevision}\n${input.instruction}`)
  const key = requestKey("steer", ownerKey, input.clientRequestId)
  const prior = await db
    .prepare(
      "SELECT request_key, payload_hash, run_id, steering_id FROM idempotency_keys WHERE request_key = ?"
    )
    .bind(key)
    .first<IdempotencyRow>()
  if (prior !== null) {
    if (prior.payload_hash !== payloadHash || prior.run_id !== runId || prior.steering_id === null) {
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        "client_request_id was already used for a different steering request.",
        409
      )
    }
    const event = await db
      .prepare("SELECT * FROM steering_events WHERE id = ?")
      .bind(prior.steering_id)
      .first<SteeringRow>()
    if (event === null) throw new ApiError("STEERING_NOT_FOUND", "Steering event not found.", 500)
    return { run: await loadRun(db, runId), steering: toSteeringEvent(event), idempotent: true }
  }

  const row = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first<RunRow>()
  if (row === null) throw new ApiError("RUN_NOT_FOUND", "Run not found.", 404)
  if (row.owner_key !== ownerKey) {
    throw new ApiError("RUN_NOT_OWNED", "Only the browser that queued this run may steer it.", 403)
  }
  if (row.revision !== input.expectedRevision) {
    throw new ApiError(
      "REVISION_CONFLICT",
      `Run revision changed; retry with expected_revision ${row.revision}.`,
      409
    )
  }
  const steeringCount = await countRuns(
    db,
    "SELECT COUNT(*) AS count FROM steering_events WHERE run_id = ?",
    runId
  )
  if (steeringCount >= MAX_STEERING_EVENTS) {
    throw new ApiError("STEERING_LIMIT", `A run may be steered at most ${MAX_STEERING_EVENTS} times.`, 429)
  }
  if (row.status === "succeeded" || row.status === "failed") {
    const active = await countRuns(
      db,
      "SELECT COUNT(*) AS count FROM runs WHERE owner_key = ? AND status IN ('queued', 'generating')",
      ownerKey
    )
    if (active >= MAX_ACTIVE_PER_CLIENT) {
      throw new ApiError("CLIENT_QUEUE_LIMIT", "Finish an active run before requeuing this one.", 429)
    }
  }

  const id = `steer-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const status = row.status === "succeeded" || row.status === "failed" ? "queued" : row.status
  const results = await db.batch([
    db
      .prepare(
        "UPDATE runs SET status = ?, revision = revision + 1, output_json = CASE WHEN ? = 'queued' THEN NULL ELSE output_json END, error_json = NULL, updated_at = ? WHERE id = ? AND owner_key = ? AND revision = ?"
      )
      .bind(status, status, now, runId, ownerKey, input.expectedRevision),
    db
      .prepare(
        "INSERT INTO steering_events (id, run_id, instruction, revision, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(id, runId, input.instruction, input.expectedRevision + 1, now),
    db
      .prepare(
        "INSERT INTO idempotency_keys (request_key, kind, payload_hash, run_id, steering_id, created_at) VALUES (?, 'steer', ?, ?, ?, ?)"
      )
      .bind(key, payloadHash, runId, id, now)
  ])
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new ApiError("REVISION_CONFLICT", "The run changed while steering; refresh and retry.", 409)
  }
  await advanceQueue(db)
  return {
    run: await loadRun(db, runId),
    steering: { id, instruction: input.instruction, revision: input.expectedRevision + 1, created_at: now },
    idempotent: false
  }
}

async function loadChannel(db: D1Database): Promise<ChannelSnapshot> {
  const allRuns = await loadRuns(db)
  const queue = allRuns.filter((run) => run.status === "queued")
  const recent = allRuns
    .filter((run) => run.status === "succeeded" || run.status === "failed")
    .slice()
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, 12)
  return {
    generated_at: new Date().toISOString(),
    now_playing: recent.find((run) => run.status === "succeeded") ?? null,
    generating: allRuns.find((run) => run.status === "generating") ?? null,
    playing_next: queue[0] ?? null,
    queue,
    recent,
    all_runs: allRuns
  }
}

async function loadRun(db: D1Database, runId: string): Promise<PublicRun> {
  const run = (await loadRuns(db)).find((candidate) => candidate.id === runId)
  if (run === undefined) throw new ApiError("RUN_NOT_FOUND", "Run not found.", 404)
  return run
}

async function loadRuns(db: D1Database): Promise<ReadonlyArray<PublicRun>> {
  const [runResult, steeringResult] = await Promise.all([
    db.prepare("SELECT * FROM runs ORDER BY created_at ASC LIMIT 80").all<RunRow>(),
    db.prepare("SELECT * FROM steering_events ORDER BY revision ASC").all<SteeringRow>()
  ])
  const steeringByRun = new Map<string, Array<SteeringEvent>>()
  for (const row of steeringResult.results) {
    const events = steeringByRun.get(row.run_id) ?? []
    events.push(toSteeringEvent(row))
    steeringByRun.set(row.run_id, events)
  }
  const queued = runResult.results.filter((row) => row.status === "queued")
  const positions = new Map(queued.map((row, index) => [row.id, index + 1]))
  return runResult.results.map((row) =>
    toPublicRun(row, positions.get(row.id) ?? null, steeringByRun.get(row.id) ?? [])
  )
}

async function loadSteering(db: D1Database, runId: string): Promise<ReadonlyArray<SteeringEvent>> {
  const result = await db
    .prepare("SELECT * FROM steering_events WHERE run_id = ? ORDER BY revision ASC")
    .bind(runId)
    .all<SteeringRow>()
  return result.results.map(toSteeringEvent)
}

function toPublicRun(
  row: RunRow,
  position: number | null,
  steering: ReadonlyArray<SteeringEvent>
): PublicRun {
  const output = parseJson<VisualOutput>(row.output_json)
  const error = parseJson<{ readonly code: string; readonly message: string }>(row.error_json)
  const elapsed = Math.max(0, Date.now() - Date.parse(row.updated_at))
  const progress =
    row.status === "queued"
      ? 0
      : row.status === "generating"
        ? Math.min(94, Math.round((elapsed / GENERATION_MILLIS) * 100))
        : 100
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status,
    revision: row.revision,
    position,
    progress,
    output,
    error,
    steering,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function toSteeringEvent(row: SteeringRow): SteeringEvent {
  return {
    id: row.id,
    instruction: row.instruction,
    revision: row.revision,
    created_at: row.created_at
  }
}

function createProceduralOutput(
  id: string,
  prompt: string,
  steering: ReadonlyArray<SteeringEvent>
): VisualOutput {
  const combined = `${prompt} ${steering.map((event) => event.instruction).join(" ")}`
  const seed = stableHash(`${id}:${combined}`)
  return {
    kind: "procedural",
    url: null,
    posterUrl: null,
    palette: palettes[seed % palettes.length] ?? palettes[0] ?? ["#09090b", "#f43f5e"],
    seed,
    title: createTitle(prompt)
  }
}

function createTitle(prompt: string): string {
  return prompt
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 3)
    .join(" ")
    .toUpperCase()
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash
}

async function countRuns(db: D1Database, query: string, binding?: string): Promise<number> {
  const statement = binding === undefined ? db.prepare(query) : db.prepare(query).bind(binding)
  const row = await statement.first<{ readonly count: number }>()
  return row?.count ?? 0
}

function requestKey(kind: "queue" | "steer", ownerKey: string, requestId: string): string {
  return `${kind}:${ownerKey}:${requestId}`
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function normalizeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new ApiError("INVALID_IDENTIFIER", `${field} must be a safe 1–128 character identifier.`)
  }
  return value
}

function normalizeRunId(value: string): string {
  if (!RUN_IDENTIFIER.test(value)) throw new ApiError("INVALID_RUN_ID", "run_id is invalid.")
  return value
}

function normalizeText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new ApiError("INVALID_TEXT", `${field} must be text.`)
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  if (normalized.length < minimum || normalized.length > maximum || CONTROL_CHARACTERS.test(normalized)) {
    throw new ApiError("INVALID_TEXT", `${field} must contain ${minimum}–${maximum} safe characters.`)
  }
  return normalized
}

function normalizePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ApiError("INVALID_REVISION", `${field} must be a positive integer.`)
  }
  return value
}

function readClientIdentity(request: Request, body: Record<string, unknown>): string {
  const header = normalizeIdentifier(request.headers.get("x-client-id"), "x-client-id")
  const bodyId = normalizeIdentifier(body.client_id, "client_id")
  if (header !== bodyId) throw new ApiError("CLIENT_ID_MISMATCH", "Client identity does not match.", 403)
  return header
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.startsWith("application/json")) {
    throw new ApiError("INVALID_CONTENT_TYPE", "Use application/json.", 415)
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > 32_000) {
    throw new ApiError("BODY_TOO_LARGE", "Request body is too large.", 413)
  }
  const text = await request.text()
  if (text.length > 32_000) throw new ApiError("BODY_TOO_LARGE", "Request body is too large.", 413)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ApiError("INVALID_JSON", "Request body must be valid JSON.")
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("INVALID_BODY", "Request body must be a JSON object.")
  }
  return value as Record<string, unknown>
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  if (origin !== null && origin !== new URL(request.url).origin) {
    throw new ApiError("ORIGIN_REJECTED", "Cross-origin mutations are not accepted.", 403)
  }
}

function parseJson<A>(value: string | null): A | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as A
  } catch {
    return null
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8"
    }
  })
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response)
  secured.headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: https://v3b.fal.media; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
  )
  secured.headers.set("permissions-policy", "tools=(self), camera=(), microphone=(self), geolocation=()")
  secured.headers.set("referrer-policy", "strict-origin-when-cross-origin")
  secured.headers.set("x-content-type-options", "nosniff")
  secured.headers.set("origin-agent-cluster", "?1")
  return secured
}
