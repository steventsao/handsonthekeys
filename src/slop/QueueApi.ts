import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  BatchQueueResultSchema,
  ChannelSnapshotSchema,
  QueueResultSchema,
  StatusResultSchema,
  SteerResultSchema
} from "./schemas.ts"
import type { BatchQueueResult, ChannelSnapshot, QueueResult, StatusResult, SteerResult } from "./types.ts"

export class QueueApiError extends Schema.TaggedError<QueueApiError>()("QueueApiError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

const ApiErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String
  })
})

const loadClientId = (): string => {
  const storageKey = "infinite-slop-client-id"
  const existing = window.localStorage.getItem(storageKey)
  if (existing !== null) return existing
  const created = `browser-${crypto.randomUUID()}`
  window.localStorage.setItem(storageKey, created)
  return created
}

export class QueueApi extends Context.Service<
  QueueApi,
  {
    readonly clientId: string
    readonly channel: Effect.Effect<ChannelSnapshot, QueueApiError>
    readonly queuePrompt: (
      prompt: string,
      clientRequestId: string
    ) => Effect.Effect<QueueResult, QueueApiError>
    readonly getStatus: (runId: string) => Effect.Effect<StatusResult, QueueApiError>
    readonly batchQueue: (
      items: ReadonlyArray<{ readonly prompt: string; readonly client_request_id: string }>
    ) => Effect.Effect<BatchQueueResult, QueueApiError>
    readonly steerPrompt: (input: {
      readonly runId: string
      readonly instruction: string
      readonly expectedRevision: number
      readonly clientRequestId: string
    }) => Effect.Effect<SteerResult, QueueApiError>
  }
>()("webmcp-challenge/slop/QueueApi") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const clientId = yield* Effect.sync(loadClientId)

      const requestJson = Effect.fn("QueueApi.requestJson")(function* (path: string, init?: RequestInit) {
        const response = yield* Effect.tryPromise({
          try: (signal) => fetch(path, { ...init, signal }),
          catch: (cause) => new QueueApiError({ message: "The shared visual channel is unreachable.", cause })
        })
        const value = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: (cause) =>
            new QueueApiError({ message: "The queue returned an unreadable response.", cause })
        })
        if (!response.ok) {
          const envelope = yield* Schema.decodeUnknownEffect(ApiErrorEnvelope)(value).pipe(
            Effect.catch(() =>
              Effect.succeed({
                error: { code: "REQUEST_FAILED", message: `Queue request failed (${response.status}).` }
              })
            )
          )
          return yield* new QueueApiError({ message: envelope.error.message })
        }
        return value
      })

      const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
        Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError(
            (cause) => new QueueApiError({ message: "The queue response did not match its contract.", cause })
          )
        )

      const post = (path: string, body: Record<string, unknown>) =>
        requestJson(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-client-id": clientId
          },
          body: JSON.stringify({ ...body, client_id: clientId })
        })

      const channel = Effect.gen(function* () {
        const value = yield* requestJson("/api/channel")
        const envelope = yield* decode(Schema.Struct({ channel: ChannelSnapshotSchema }), value)
        return envelope.channel
      }).pipe(Effect.withSpan("QueueApi.channel"))

      const queuePrompt = Effect.fn("QueueApi.queuePrompt")(function* (
        prompt: string,
        clientRequestId: string
      ) {
        const value = yield* post("/api/runs", {
          prompt,
          client_request_id: clientRequestId
        })
        return yield* decode(QueueResultSchema, value)
      })

      const getStatus = Effect.fn("QueueApi.getStatus")(function* (runId: string) {
        const value = yield* requestJson(`/api/runs/${encodeURIComponent(runId)}`)
        return yield* decode(StatusResultSchema, value)
      })

      const batchQueue = Effect.fn("QueueApi.batchQueue")(function* (
        items: ReadonlyArray<{ readonly prompt: string; readonly client_request_id: string }>
      ) {
        const value = yield* post("/api/runs/batch", { items })
        return yield* decode(BatchQueueResultSchema, value)
      })

      const steerPrompt = Effect.fn("QueueApi.steerPrompt")(function* (input: {
        readonly runId: string
        readonly instruction: string
        readonly expectedRevision: number
        readonly clientRequestId: string
      }) {
        const value = yield* post(`/api/runs/${encodeURIComponent(input.runId)}/steer`, {
          instruction: input.instruction,
          expected_revision: input.expectedRevision,
          client_request_id: input.clientRequestId
        })
        return yield* decode(SteerResultSchema, value)
      })

      return QueueApi.of({ clientId, channel, queuePrompt, getStatus, batchQueue, steerPrompt })
    })
  )
}
