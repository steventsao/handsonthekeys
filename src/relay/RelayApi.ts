import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  CreateRoomResponse,
  JoinRoomResponse,
  RoomResponse,
  type CreateRoomInput,
  type JoinRoomInput,
  type RoomSnapshot,
  type TaskOutput
} from "./domain.ts"

export class RelayApiError extends Schema.TaggedError<RelayApiError>()("RelayApiError", {
  code: Schema.String,
  message: Schema.String,
  status: Schema.Int,
  cause: Schema.optional(Schema.Defect())
}) {}

const ApiErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String
  })
})

export interface RelayIdentity {
  readonly actorId: string
  readonly token: string
}

const identityKey = (roomId: string) => `hex-relay-identity:${roomId}`

export const loadRelayIdentity = (roomId: string): RelayIdentity | null => {
  const stored = window.sessionStorage.getItem(identityKey(roomId))
  if (stored === null) return null
  try {
    const value = JSON.parse(stored) as Partial<RelayIdentity>
    return typeof value.actorId === "string" && typeof value.token === "string"
      ? { actorId: value.actorId, token: value.token }
      : null
  } catch {
    return null
  }
}

const saveRelayIdentity = (roomId: string, identity: RelayIdentity): void => {
  window.sessionStorage.setItem(identityKey(roomId), JSON.stringify(identity))
}

export const currentRelayRoomId = (): string | null => new URL(window.location.href).searchParams.get("room")

export class RelayApi extends Context.Service<
  RelayApi,
  {
    readonly create: (input: CreateRoomInput) => Effect.Effect<RoomSnapshot, RelayApiError>
    readonly join: (roomId: string, input: JoinRoomInput) => Effect.Effect<RoomSnapshot, RelayApiError>
    readonly snapshot: (roomId: string) => Effect.Effect<RoomSnapshot, RelayApiError>
    readonly heartbeat: (roomId: string) => Effect.Effect<RoomSnapshot, RelayApiError>
    readonly plan: (roomId: string) => Effect.Effect<RoomSnapshot, RelayApiError>
    readonly claim: (roomId: string, taskId: string) => Effect.Effect<RoomSnapshot, RelayApiError>
    readonly submit: (
      roomId: string,
      taskId: string,
      output: TaskOutput
    ) => Effect.Effect<RoomSnapshot, RelayApiError>
    readonly review: (
      roomId: string,
      taskId: string,
      decision: "accept" | "reopen"
    ) => Effect.Effect<RoomSnapshot, RelayApiError>
  }
>()("webmcp-challenge/relay/RelayApi") {
  static readonly layer = Layer.sync(this, () => {
    const requestJson = Effect.fn("RelayApi.requestJson")(function* (path: string, init?: RequestInit) {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(path, { ...init, signal }),
        catch: (cause) =>
          new RelayApiError({
            code: "NETWORK_ERROR",
            message: "The shared relay is unreachable.",
            status: 0,
            cause
          })
      })
      const value = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) =>
          new RelayApiError({
            code: "INVALID_RESPONSE",
            message: "The relay returned an unreadable response.",
            status: response.status,
            cause
          })
      })
      if (!response.ok) {
        const envelope = yield* Schema.decodeUnknownEffect(ApiErrorEnvelope)(value).pipe(
          Effect.catch(() =>
            Effect.succeed({
              error: { code: "REQUEST_FAILED", message: `Relay request failed (${response.status}).` }
            })
          )
        )
        return yield* new RelayApiError({
          code: envelope.error.code,
          message: envelope.error.message,
          status: response.status
        })
      }
      return value
    })

    const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError(
          (cause) =>
            new RelayApiError({
              code: "CONTRACT_ERROR",
              message: "The relay response did not match its Effect Schema contract.",
              status: 500,
              cause
            })
        )
      )

    const post = (path: string, body: unknown, token?: string) =>
      requestJson(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
        },
        body: JSON.stringify(body)
      })

    const tokenFor = Effect.fn("RelayApi.tokenFor")(function* (roomId: string) {
      const identity = yield* Effect.sync(() => loadRelayIdentity(roomId))
      if (identity === null) {
        return yield* new RelayApiError({
          code: "NO_CELL",
          message: "Offer this tab as a cell before acting.",
          status: 401
        })
      }
      return identity.token
    })

    const create = Effect.fn("RelayApi.create")(function* (input: CreateRoomInput) {
      const value = yield* post("/api/relay/rooms", input)
      const response = yield* decode(CreateRoomResponse, value)
      yield* Effect.sync(() => {
        saveRelayIdentity(response.room.room.id, {
          actorId: response.actorId,
          token: response.actorToken
        })
        const url = new URL(window.location.href)
        url.searchParams.set("room", response.room.room.id)
        window.history.replaceState({}, "", url)
      })
      return response.room
    })

    const join = Effect.fn("RelayApi.join")(function* (roomId: string, input: JoinRoomInput) {
      const value = yield* post(`/api/relay/rooms/${encodeURIComponent(roomId)}/join`, input)
      const response = yield* decode(JoinRoomResponse, value)
      yield* Effect.sync(() =>
        saveRelayIdentity(roomId, { actorId: response.actorId, token: response.actorToken })
      )
      return response.room
    })

    const snapshot = Effect.fn("RelayApi.snapshot")(function* (roomId: string) {
      const value = yield* requestJson(`/api/relay/rooms/${encodeURIComponent(roomId)}`)
      return (yield* decode(RoomResponse, value)).room
    })

    const authenticatedPost = Effect.fn("RelayApi.authenticatedPost")(function* (
      roomId: string,
      suffix: string,
      body: unknown
    ) {
      const token = yield* tokenFor(roomId)
      const value = yield* post(`/api/relay/rooms/${encodeURIComponent(roomId)}${suffix}`, body, token)
      return (yield* decode(RoomResponse, value)).room
    })

    const heartbeat = (roomId: string) => authenticatedPost(roomId, "/heartbeat", {})
    const plan = (roomId: string) => authenticatedPost(roomId, "/plan", {})
    const claim = (roomId: string, taskId: string) =>
      authenticatedPost(roomId, `/tasks/${encodeURIComponent(taskId)}/claim`, {})
    const submit = (roomId: string, taskId: string, output: TaskOutput) =>
      authenticatedPost(roomId, `/tasks/${encodeURIComponent(taskId)}/submit`, { output })
    const review = (roomId: string, taskId: string, decision: "accept" | "reopen") =>
      authenticatedPost(roomId, `/tasks/${encodeURIComponent(taskId)}/review`, { decision })

    return RelayApi.of({ create, join, snapshot, heartbeat, plan, claim, submit, review })
  })
}
