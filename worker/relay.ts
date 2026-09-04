import * as D1Client from "@effect/sql-d1/D1Client"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as Statement from "effect/unstable/sql/Statement"
import {
  capabilityInterfaces,
  CreateRoomInput,
  type CreateRoomInput as CreateRoomInputType,
  type EventKind,
  JoinRoomInput,
  type JoinRoomInput as JoinRoomInputType,
  type Participant,
  type ParticipantKind,
  type ParticipantRole,
  ReviewTaskInput,
  RoomSnapshot,
  type RoomSnapshot as RoomSnapshotType,
  SubmitTaskInput,
  type TaskOutput,
  type TaskStatus
} from "../src/relay/domain.ts"
import { canMoveRoom, canMoveTask } from "../src/relay/machine.ts"
import { planPosterTasks } from "../src/relay/planner.ts"

export interface RelayEnv {
  readonly DB: D1Database
}

interface RoomRow {
  readonly id: string
  readonly goal: string
  readonly phase: "forming" | "running" | "completed"
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

interface ParticipantRow {
  readonly id: string
  readonly roomId: string
  readonly name: string
  readonly kind: ParticipantKind
  readonly role: ParticipantRole
  readonly capability: Participant["capability"]
  readonly inputInterface: string
  readonly outputInterface: string
  readonly joinedAt: number
  readonly lastSeenAt: number
}

interface TaskRow {
  readonly id: string
  readonly roomId: string
  readonly position: number
  readonly title: string
  readonly brief: string
  readonly capability: Participant["capability"]
  readonly status: TaskStatus
  readonly suggestedParticipantId: string | null
  readonly suggestionReason: string
  readonly claimedByParticipantId: string | null
  readonly outputJson: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

interface EventRow {
  readonly id: string
  readonly revision: number
  readonly kind: EventKind
  readonly actorId: string | null
  readonly message: string
  readonly createdAt: number
}

export class RelayRuleError extends Schema.TaggedError<RelayRuleError>()("RelayRuleError", {
  code: Schema.String,
  message: Schema.String,
  status: Schema.Int
}) {}

export class RelayStorageError extends Schema.TaggedError<RelayStorageError>()("RelayStorageError", {
  message: Schema.String,
  cause: Schema.Defect()
}) {}

const roomSelect =
  "SELECT id, goal, phase, revision, created_at AS createdAt, updated_at AS updatedAt FROM relay_rooms WHERE id = ?"

const participantSelect =
  "SELECT id, room_id AS roomId, name, kind, role, capability, input_interface AS inputInterface, output_interface AS outputInterface, joined_at AS joinedAt, last_seen_at AS lastSeenAt FROM relay_participants WHERE room_id = ? ORDER BY joined_at, id"

const taskSelect =
  "SELECT id, room_id AS roomId, position, title, brief, capability, status, suggested_participant_id AS suggestedParticipantId, suggestion_reason AS suggestionReason, claimed_by_participant_id AS claimedByParticipantId, output_json AS outputJson, created_at AS createdAt, updated_at AS updatedAt FROM relay_tasks WHERE room_id = ? ORDER BY position, id"

const eventSelect =
  "SELECT id, revision, kind, actor_id AS actorId, message, created_at AS createdAt FROM relay_events WHERE room_id = ? ORDER BY revision DESC LIMIT 80"

const storageFailure = (message: string, cause: unknown) => new RelayStorageError({ message, cause })

const first = <T extends object>(statement: Statement.Statement<T>, message: string) =>
  statement.pipe(
    Effect.map((rows) => rows[0] ?? null),
    Effect.mapError((cause) => storageFailure(message, cause))
  )

const all = <T extends object>(statement: Statement.Statement<T>, message: string) =>
  statement.pipe(Effect.mapError((cause) => storageFailure(message, cause)))

const run = (statement: Statement.Statement<Record<string, unknown>>, message: string) =>
  statement.pipe(
    Effect.asVoid,
    Effect.mapError((cause) => storageFailure(message, cause))
  )

const batch = (
  client: D1Client.D1Client,
  statements: ReadonlyArray<Statement.Statement<Record<string, unknown>>>
) =>
  client.batch(statements).pipe(
    Effect.mapError((cause) => {
      const underlying = cause.reason.cause
      const message = underlying instanceof Error ? underlying.message : String(underlying)
      if (message.includes("relay_events.room_id") || message.includes("relay_events_room_revision")) {
        return new RelayRuleError({
          code: "REVISION_CONFLICT",
          message: "The room changed before this action committed. Refresh and try again.",
          status: 409
        })
      }
      return storageFailure("The room mutation could not be committed.", cause)
    })
  )

const makeId = (prefix: string) => Effect.sync(() => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`)

const makeToken = Effect.sync(
  () => `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`
)

const hashToken = Effect.fn("RelayService.hashToken")(function* (token: string) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    catch: (cause) => storageFailure("The participant token could not be secured.", cause)
  })
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
})

const jsonOutput = (value: TaskOutput): string => JSON.stringify(value)

const parseOutput = (value: string | null): TaskOutput | null => {
  if (value === null) return null
  return JSON.parse(value) as TaskOutput
}

const invalid = (code: string, message: string, status = 400) => new RelayRuleError({ code, message, status })

export class RelayService extends Context.Service<
  RelayService,
  {
    readonly create: (
      input: CreateRoomInputType
    ) => Effect.Effect<
      { readonly room: RoomSnapshotType; readonly actorToken: string; readonly actorId: string },
      RelayRuleError | RelayStorageError
    >
    readonly join: (
      roomId: string,
      input: JoinRoomInputType
    ) => Effect.Effect<
      { readonly room: RoomSnapshotType; readonly actorToken: string; readonly actorId: string },
      RelayRuleError | RelayStorageError
    >
    readonly snapshot: (roomId: string) => Effect.Effect<RoomSnapshotType, RelayRuleError | RelayStorageError>
    readonly heartbeat: (
      roomId: string,
      token: string
    ) => Effect.Effect<RoomSnapshotType, RelayRuleError | RelayStorageError>
    readonly plan: (
      roomId: string,
      token: string
    ) => Effect.Effect<RoomSnapshotType, RelayRuleError | RelayStorageError>
    readonly claim: (
      roomId: string,
      taskId: string,
      token: string
    ) => Effect.Effect<RoomSnapshotType, RelayRuleError | RelayStorageError>
    readonly submit: (
      roomId: string,
      taskId: string,
      token: string,
      output: TaskOutput
    ) => Effect.Effect<RoomSnapshotType, RelayRuleError | RelayStorageError>
    readonly review: (
      roomId: string,
      taskId: string,
      token: string,
      decision: "accept" | "reopen"
    ) => Effect.Effect<RoomSnapshotType, RelayRuleError | RelayStorageError>
  }
>()("hex-relay/worker/RelayService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const sql = yield* D1Client.D1Client
      const query = <T extends object>(text: string, params: ReadonlyArray<unknown>) =>
        sql.unsafe<T>(text, params)
      const command = (text: string, params: ReadonlyArray<unknown>) =>
        sql.unsafe<Record<string, unknown>>(text, params)

      yield* batch(sql, [
        command(
          "CREATE TABLE IF NOT EXISTS relay_rooms (id TEXT PRIMARY KEY NOT NULL, goal TEXT NOT NULL, phase TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
          []
        ),
        command(
          "CREATE TABLE IF NOT EXISTS relay_participants (id TEXT PRIMARY KEY NOT NULL, room_id TEXT NOT NULL REFERENCES relay_rooms(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL, capability TEXT NOT NULL, input_interface TEXT NOT NULL, output_interface TEXT NOT NULL, joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)",
          []
        ),
        command(
          "CREATE TABLE IF NOT EXISTS relay_events (id TEXT PRIMARY KEY NOT NULL, room_id TEXT NOT NULL REFERENCES relay_rooms(id) ON DELETE CASCADE, revision INTEGER NOT NULL, kind TEXT NOT NULL, actor_id TEXT REFERENCES relay_participants(id) ON DELETE SET NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL)",
          []
        ),
        command(
          "CREATE TABLE IF NOT EXISTS relay_tasks (id TEXT PRIMARY KEY NOT NULL, room_id TEXT NOT NULL REFERENCES relay_rooms(id) ON DELETE CASCADE, position INTEGER NOT NULL, title TEXT NOT NULL, brief TEXT NOT NULL, capability TEXT NOT NULL, status TEXT NOT NULL, suggested_participant_id TEXT REFERENCES relay_participants(id) ON DELETE SET NULL, suggestion_reason TEXT NOT NULL, claimed_by_participant_id TEXT REFERENCES relay_participants(id) ON DELETE SET NULL, output_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
          []
        ),
        command(
          "CREATE UNIQUE INDEX IF NOT EXISTS relay_events_room_revision_unique ON relay_events (room_id, revision)",
          []
        ),
        command(
          "CREATE INDEX IF NOT EXISTS relay_events_room_created_idx ON relay_events (room_id, created_at)",
          []
        ),
        command(
          "CREATE INDEX IF NOT EXISTS relay_participants_room_joined_idx ON relay_participants (room_id, joined_at)",
          []
        ),
        command(
          "CREATE UNIQUE INDEX IF NOT EXISTS relay_tasks_room_position_unique ON relay_tasks (room_id, position)",
          []
        ),
        command("CREATE INDEX IF NOT EXISTS relay_tasks_room_status_idx ON relay_tasks (room_id, status)", [])
      ])

      const loadRoomRow = Effect.fn("RelayService.loadRoomRow")(function* (roomId: string) {
        const room = yield* first<RoomRow>(
          query<RoomRow>(roomSelect, [roomId]),
          "The room could not be loaded."
        )
        if (room === null) {
          return yield* invalid("ROOM_NOT_FOUND", "This relay room does not exist.", 404)
        }
        return room
      })

      const loadParticipantRows = (roomId: string) =>
        all<ParticipantRow>(
          query<ParticipantRow>(participantSelect, [roomId]),
          "The room participants could not be loaded."
        )

      const loadTaskRows = (roomId: string) =>
        all<TaskRow>(query<TaskRow>(taskSelect, [roomId]), "The room tasks could not be loaded.")

      const loadSnapshot = Effect.fn("RelayService.loadSnapshot")(function* (
        roomId: string
      ): Effect.fn.Return<RoomSnapshotType, RelayRuleError | RelayStorageError> {
        const now = yield* Clock.currentTimeMillis
        const room = yield* loadRoomRow(roomId)
        const [participantRows, taskRows, eventRows] = yield* Effect.all(
          [
            loadParticipantRows(roomId),
            loadTaskRows(roomId),
            all<EventRow>(query<EventRow>(eventSelect, [roomId]), "The room history could not be loaded.")
          ],
          { concurrency: "unbounded" }
        )
        const participants = participantRows.map((participant) => {
          const ownedTasks = taskRows.filter((task) => task.claimedByParticipantId === participant.id)
          const runtimeState =
            now - participant.lastSeenAt > 30_000
              ? "offline"
              : room.phase === "completed"
                ? "done"
                : ownedTasks.some((task) => task.status === "submitted")
                  ? "blocked"
                  : ownedTasks.some((task) => task.status === "working")
                    ? "working"
                    : ownedTasks.some((task) => task.status === "accepted")
                      ? "done"
                      : "idle"
          return { ...participant, runtimeState }
        })
        const candidate = {
          room,
          participants,
          tasks: taskRows.map((task) => ({ ...task, output: parseOutput(task.outputJson) })),
          events: [...eventRows].reverse()
        }
        return yield* Schema.decodeUnknownEffect(RoomSnapshot)(candidate).pipe(
          Effect.mapError((cause) => storageFailure("Stored room data failed validation.", cause))
        )
      })

      const authorize = Effect.fn("RelayService.authorize")(function* (roomId: string, token: string) {
        if (token.length < 32) {
          return yield* invalid("UNAUTHORIZED", "Offer this tab as a cell before acting.", 401)
        }
        const tokenHash = yield* hashToken(token)
        const participant = yield* first<ParticipantRow>(
          query<ParticipantRow>(
            "SELECT id, room_id AS roomId, name, kind, role, capability, input_interface AS inputInterface, output_interface AS outputInterface, joined_at AS joinedAt, last_seen_at AS lastSeenAt FROM relay_participants WHERE room_id = ? AND token_hash = ?",
            [roomId, tokenHash]
          ),
          "The participant session could not be checked."
        )
        if (participant === null) {
          return yield* invalid("UNAUTHORIZED", "This tab does not own a cell in the room.", 401)
        }
        return participant
      })

      const create = Effect.fn("RelayService.create")(function* (input: CreateRoomInputType) {
        const now = yield* Clock.currentTimeMillis
        const roomId = (yield* makeId("room")).slice(0, 21)
        const actorId = (yield* makeId("cell")).slice(0, 21)
        const eventId = (yield* makeId("event")).slice(0, 22)
        const actorToken = yield* makeToken
        const tokenHash = yield* hashToken(actorToken)
        const interfaces = capabilityInterfaces[input.capability]
        yield* batch(sql, [
          command(
            "INSERT INTO relay_rooms (id, goal, phase, revision, created_at, updated_at) VALUES (?, ?, 'forming', 1, ?, ?)",
            [roomId, input.goal, now, now]
          ),
          command(
            "INSERT INTO relay_participants (id, room_id, token_hash, name, kind, role, capability, input_interface, output_interface, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 'lead', ?, ?, ?, ?, ?)",
            [
              actorId,
              roomId,
              tokenHash,
              input.name,
              input.kind,
              input.capability,
              interfaces.input,
              interfaces.output,
              now,
              now
            ]
          ),
          command(
            "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, 1, 'room_created', ?, ?, ?)",
            [eventId, roomId, actorId, `${input.name} opened the relay and became lead.`, now]
          )
        ])
        return { room: yield* loadSnapshot(roomId), actorToken, actorId }
      })

      const join = Effect.fn("RelayService.join")(function* (roomId: string, input: JoinRoomInputType) {
        const room = yield* loadRoomRow(roomId)
        const now = yield* Clock.currentTimeMillis
        const actorId = (yield* makeId("cell")).slice(0, 21)
        const eventId = (yield* makeId("event")).slice(0, 22)
        const actorToken = yield* makeToken
        const tokenHash = yield* hashToken(actorToken)
        const interfaces = capabilityInterfaces[input.capability]
        const nextRevision = room.revision + 1
        yield* batch(sql, [
          command("UPDATE relay_rooms SET revision = ?, updated_at = ? WHERE id = ? AND revision = ?", [
            nextRevision,
            now,
            roomId,
            room.revision
          ]),
          command(
            "INSERT INTO relay_participants (id, room_id, token_hash, name, kind, role, capability, input_interface, output_interface, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 'member', ?, ?, ?, ?, ?)",
            [
              actorId,
              roomId,
              tokenHash,
              input.name,
              input.kind,
              input.capability,
              interfaces.input,
              interfaces.output,
              now,
              now
            ]
          ),
          command(
            "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, ?, 'cell_joined', ?, ?, ?)",
            [
              eventId,
              roomId,
              nextRevision,
              actorId,
              `${input.name} offered a ${input.capability} interface.`,
              now
            ]
          )
        ])
        return { room: yield* loadSnapshot(roomId), actorToken, actorId }
      })

      const heartbeat = Effect.fn("RelayService.heartbeat")(function* (roomId: string, token: string) {
        const actor = yield* authorize(roomId, token)
        const now = yield* Clock.currentTimeMillis
        yield* run(
          command("UPDATE relay_participants SET last_seen_at = ? WHERE id = ? AND room_id = ?", [
            now,
            actor.id,
            roomId
          ]),
          "The cell heartbeat could not be recorded."
        )
        return yield* loadSnapshot(roomId)
      })

      const plan = Effect.fn("RelayService.plan")(function* (roomId: string, token: string) {
        const actor = yield* authorize(roomId, token)
        if (actor.role !== "lead") {
          return yield* invalid("NOT_LEAD", "Only the room creator can define the task plan.", 403)
        }
        const room = yield* loadRoomRow(roomId)
        if (!canMoveRoom(room.phase, "running")) {
          return yield* invalid("ROOM_ALREADY_PLANNED", "This room already has an active plan.", 409)
        }
        const participants = yield* loadParticipantRows(roomId)
        const tasks = planPosterTasks(
          participants.map((participant) => ({ ...participant, runtimeState: "idle" as const }))
        )
        const now = yield* Clock.currentTimeMillis
        const nextRevision = room.revision + 1
        const eventId = (yield* makeId("event")).slice(0, 22)
        const taskStatements: Array<Statement.Statement<Record<string, unknown>>> = []
        for (const [position, task] of tasks.entries()) {
          const taskId = (yield* makeId("task")).slice(0, 21)
          taskStatements.push(
            command(
              "INSERT INTO relay_tasks (id, room_id, position, title, brief, capability, status, suggested_participant_id, suggestion_reason, claimed_by_participant_id, output_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'offered', ?, ?, NULL, NULL, ?, ?)",
              [
                taskId,
                roomId,
                position,
                task.title,
                task.brief,
                task.capability,
                task.suggestedParticipantId,
                task.suggestionReason,
                now,
                now
              ]
            )
          )
        }
        yield* batch(sql, [
          command(
            "UPDATE relay_rooms SET phase = 'running', revision = ?, updated_at = ? WHERE id = ? AND revision = ? AND phase = 'forming'",
            [nextRevision, now, roomId, room.revision]
          ),
          ...taskStatements,
          command(
            "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, ?, 'plan_created', ?, ?, ?)",
            [
              eventId,
              roomId,
              nextRevision,
              actor.id,
              `Lead opened three typed tasks across ${participants.length} available cells.`,
              now
            ]
          )
        ])
        return yield* loadSnapshot(roomId)
      })

      const loadTask = Effect.fn("RelayService.loadTask")(function* (roomId: string, taskId: string) {
        const task = yield* first<TaskRow>(
          query<TaskRow>(taskSelect.replace(" WHERE room_id = ?", " WHERE room_id = ? AND id = ?"), [
            roomId,
            taskId
          ]),
          "The task could not be loaded."
        )
        if (task === null) return yield* invalid("TASK_NOT_FOUND", "That task is not in this room.", 404)
        return task
      })

      const claim = Effect.fn("RelayService.claim")(function* (
        roomId: string,
        taskId: string,
        token: string
      ) {
        const actor = yield* authorize(roomId, token)
        const room = yield* loadRoomRow(roomId)
        const task = yield* loadTask(roomId, taskId)
        if (room.phase !== "running" || !canMoveTask(task.status, "working")) {
          return yield* invalid("TASK_NOT_AVAILABLE", "This task is not available to claim.", 409)
        }
        const now = yield* Clock.currentTimeMillis
        const nextRevision = room.revision + 1
        const eventId = (yield* makeId("event")).slice(0, 22)
        yield* batch(sql, [
          command("UPDATE relay_rooms SET revision = ?, updated_at = ? WHERE id = ? AND revision = ?", [
            nextRevision,
            now,
            roomId,
            room.revision
          ]),
          command(
            "UPDATE relay_tasks SET status = 'working', claimed_by_participant_id = ?, updated_at = ? WHERE id = ? AND room_id = ? AND status = 'offered'",
            [actor.id, now, taskId, roomId]
          ),
          command(
            "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, ?, 'task_claimed', ?, ?, ?)",
            [eventId, roomId, nextRevision, actor.id, `${actor.name} claimed “${task.title}”.`, now]
          )
        ])
        return yield* loadSnapshot(roomId)
      })

      const submit = Effect.fn("RelayService.submit")(function* (
        roomId: string,
        taskId: string,
        token: string,
        output: TaskOutput
      ) {
        const actor = yield* authorize(roomId, token)
        const room = yield* loadRoomRow(roomId)
        const task = yield* loadTask(roomId, taskId)
        if (task.claimedByParticipantId !== actor.id) {
          return yield* invalid("NOT_TASK_OWNER", "Only the claiming cell can submit this task.", 403)
        }
        if (!canMoveTask(task.status, "submitted")) {
          return yield* invalid("INVALID_TASK_STATE", "Claim this task before submitting output.", 409)
        }
        if (output.kind !== task.capability) {
          return yield* invalid(
            "OUTPUT_INTERFACE_MISMATCH",
            `This task requires the ${task.capability} output interface.`
          )
        }
        const now = yield* Clock.currentTimeMillis
        const nextRevision = room.revision + 1
        const eventId = (yield* makeId("event")).slice(0, 22)
        yield* batch(sql, [
          command("UPDATE relay_rooms SET revision = ?, updated_at = ? WHERE id = ? AND revision = ?", [
            nextRevision,
            now,
            roomId,
            room.revision
          ]),
          command(
            "UPDATE relay_tasks SET status = 'submitted', output_json = ?, updated_at = ? WHERE id = ? AND room_id = ? AND status = 'working' AND claimed_by_participant_id = ?",
            [jsonOutput(output), now, taskId, roomId, actor.id]
          ),
          command(
            "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, ?, 'task_submitted', ?, ?, ?)",
            [eventId, roomId, nextRevision, actor.id, `${actor.name} submitted “${task.title}”.`, now]
          )
        ])
        return yield* loadSnapshot(roomId)
      })

      const review = Effect.fn("RelayService.review")(function* (
        roomId: string,
        taskId: string,
        token: string,
        decision: "accept" | "reopen"
      ) {
        const actor = yield* authorize(roomId, token)
        if (actor.role !== "lead") {
          return yield* invalid("NOT_LEAD", "Only the room creator can review submissions.", 403)
        }
        const room = yield* loadRoomRow(roomId)
        const task = yield* loadTask(roomId, taskId)
        const nextStatus = decision === "accept" ? "accepted" : "offered"
        if (!canMoveTask(task.status, nextStatus)) {
          return yield* invalid("INVALID_TASK_STATE", "Only submitted work can be reviewed.", 409)
        }
        const now = yield* Clock.currentTimeMillis
        const eventId = (yield* makeId("event")).slice(0, 22)
        if (decision === "reopen") {
          const nextRevision = room.revision + 1
          yield* batch(sql, [
            command("UPDATE relay_rooms SET revision = ?, updated_at = ? WHERE id = ? AND revision = ?", [
              nextRevision,
              now,
              roomId,
              room.revision
            ]),
            command(
              "UPDATE relay_tasks SET status = 'offered', claimed_by_participant_id = NULL, output_json = NULL, updated_at = ? WHERE id = ? AND room_id = ? AND status = 'submitted'",
              [now, taskId, roomId]
            ),
            command(
              "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, ?, 'task_reopened', ?, ?, ?)",
              [eventId, roomId, nextRevision, actor.id, `Lead reopened “${task.title}”.`, now]
            )
          ])
          return yield* loadSnapshot(roomId)
        }

        const remaining = yield* first<{ readonly count: number }>(
          query<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM relay_tasks WHERE room_id = ? AND id != ? AND status != 'accepted'",
            [roomId, taskId]
          ),
          "The completion state could not be checked."
        )
        const isComplete = remaining?.count === 0
        const nextRevision = room.revision + (isComplete ? 2 : 1)
        const acceptedRevision = room.revision + 1
        const statements: Array<Statement.Statement<Record<string, unknown>>> = [
          command(
            "UPDATE relay_rooms SET phase = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
            [isComplete ? "completed" : room.phase, nextRevision, now, roomId, room.revision]
          ),
          command(
            "UPDATE relay_tasks SET status = 'accepted', updated_at = ? WHERE id = ? AND room_id = ? AND status = 'submitted'",
            [now, taskId, roomId]
          ),
          command(
            "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, ?, 'task_accepted', ?, ?, ?)",
            [eventId, roomId, acceptedRevision, actor.id, `Lead accepted “${task.title}”.`, now]
          )
        ]
        if (isComplete) {
          const completeEventId = (yield* makeId("event")).slice(0, 22)
          statements.push(
            command(
              "INSERT INTO relay_events (id, room_id, revision, kind, actor_id, message, created_at) VALUES (?, ?, ?, 'room_completed', ?, 'All three interfaces resolved. The poster is complete.', ?)",
              [completeEventId, roomId, nextRevision, actor.id, now]
            )
          )
        }
        yield* batch(sql, statements)
        return yield* loadSnapshot(roomId)
      })

      return RelayService.of({
        create,
        join,
        snapshot: loadSnapshot,
        heartbeat,
        plan,
        claim,
        submit,
        review
      })
    })
  )
}

const readJson = Effect.fn("RelayHttp.readJson")(function* (request: Request) {
  return yield* Effect.tryPromise({
    try: () => request.json(),
    catch: () => invalid("INVALID_JSON", "The request body must be valid JSON.")
  })
})

const bearerToken = (request: Request): string => {
  const header = request.headers.get("authorization")
  return header?.startsWith("Bearer ") === true ? header.slice(7) : ""
}

const roomJson = (room: RoomSnapshotType, status = 200) => Response.json({ ok: true, room }, { status })

const routeRelay = Effect.fn("RelayHttp.route")(function* (request: Request, url: URL) {
  const relay = yield* RelayService

  if (request.method === "POST" && url.pathname === "/api/relay/rooms") {
    const input = yield* Schema.decodeUnknownEffect(CreateRoomInput)(yield* readJson(request))
    const result = yield* relay.create(input)
    return Response.json({ ok: true, ...result }, { status: 201 })
  }

  const roomRoute = url.pathname.match(/^\/api\/relay\/rooms\/([A-Za-z0-9_]+)$/)
  if (request.method === "GET" && roomRoute?.[1] !== undefined) {
    return roomJson(yield* relay.snapshot(roomRoute[1]))
  }

  const joinRoute = url.pathname.match(/^\/api\/relay\/rooms\/([A-Za-z0-9_]+)\/join$/)
  if (request.method === "POST" && joinRoute?.[1] !== undefined) {
    const input = yield* Schema.decodeUnknownEffect(JoinRoomInput)(yield* readJson(request))
    const result = yield* relay.join(joinRoute[1], input)
    return Response.json({ ok: true, ...result }, { status: 201 })
  }

  const actionRoute = url.pathname.match(/^\/api\/relay\/rooms\/([A-Za-z0-9_]+)\/(heartbeat|plan)$/)
  if (request.method === "POST" && actionRoute?.[1] !== undefined && actionRoute[2] !== undefined) {
    const room =
      actionRoute[2] === "heartbeat"
        ? yield* relay.heartbeat(actionRoute[1], bearerToken(request))
        : yield* relay.plan(actionRoute[1], bearerToken(request))
    return roomJson(room)
  }

  const taskRoute = url.pathname.match(
    /^\/api\/relay\/rooms\/([A-Za-z0-9_]+)\/tasks\/([A-Za-z0-9_]+)\/(claim|submit|review)$/
  )
  if (
    request.method === "POST" &&
    taskRoute?.[1] !== undefined &&
    taskRoute[2] !== undefined &&
    taskRoute[3] !== undefined
  ) {
    const [roomId, taskId, action] = [taskRoute[1], taskRoute[2], taskRoute[3]]
    const token = bearerToken(request)
    if (action === "claim") return roomJson(yield* relay.claim(roomId, taskId, token))
    if (action === "submit") {
      const { output } = yield* Schema.decodeUnknownEffect(SubmitTaskInput)(yield* readJson(request))
      return roomJson(yield* relay.submit(roomId, taskId, token, output))
    }
    const { decision } = yield* Schema.decodeUnknownEffect(ReviewTaskInput)(yield* readJson(request))
    return roomJson(yield* relay.review(roomId, taskId, token, decision))
  }

  return yield* invalid("NOT_FOUND", "Relay API route not found.", 404)
})

export const handleRelayApi = async (request: Request, env: RelayEnv, url: URL): Promise<Response> => {
  const serviceLayer = RelayService.layer.pipe(
    Layer.provide(D1Client.layer({ db: env.DB, spanAttributes: { service: "hex-relay" } }))
  )
  return Effect.runPromise(
    routeRelay(request, url).pipe(
      Effect.provide(serviceLayer),
      Effect.catch((cause) => {
        if (cause instanceof RelayRuleError) {
          return Effect.succeed(
            Response.json(
              { ok: false, error: { code: cause.code, message: cause.message } },
              { status: cause.status }
            )
          )
        }
        if (cause instanceof RelayStorageError) {
          return Effect.succeed(
            Response.json(
              {
                ok: false,
                error: {
                  code: "STORAGE_ERROR",
                  message: "The shared relay could not complete that request."
                }
              },
              { status: 500 }
            )
          )
        }
        return Effect.succeed(
          Response.json(
            { ok: false, error: { code: "INVALID_INPUT", message: "The request did not match its schema." } },
            { status: 400 }
          )
        )
      })
    )
  )
}
