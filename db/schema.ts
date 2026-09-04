import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    prompt: text("prompt").notNull(),
    status: text("status", { enum: ["queued", "generating", "succeeded", "failed"] }).notNull(),
    revision: integer("revision").notNull(),
    ownerKey: text("owner_key").notNull(),
    outputJson: text("output_json"),
    errorJson: text("error_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("runs_status_created_idx").on(table.status, table.createdAt),
    index("runs_owner_status_idx").on(table.ownerKey, table.status),
    index("runs_updated_idx").on(table.updatedAt)
  ]
)

export const steeringEvents = sqliteTable(
  "steering_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    instruction: text("instruction").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [index("steering_run_revision_idx").on(table.runId, table.revision)]
)

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  requestKey: text("request_key").primaryKey(),
  kind: text("kind", { enum: ["queue", "steer"] }).notNull(),
  payloadHash: text("payload_hash").notNull(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  steeringId: text("steering_id").references(() => steeringEvents.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull()
})

export const studioShares = sqliteTable(
  "studio_shares",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull()
  },
  (table) => [
    uniqueIndex("studio_shares_request_id_unique").on(table.requestId),
    index("studio_shares_expires_idx").on(table.expiresAt),
    index("studio_shares_created_idx").on(table.createdAt)
  ]
)

export const relayRooms = sqliteTable("relay_rooms", {
  id: text("id").primaryKey(),
  goal: text("goal").notNull(),
  phase: text("phase", { enum: ["forming", "running", "completed"] }).notNull(),
  revision: integer("revision").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
})

export const relayParticipants = sqliteTable(
  "relay_participants",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => relayRooms.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["human", "agent"] }).notNull(),
    role: text("role", { enum: ["lead", "member"] }).notNull(),
    capability: text("capability", { enum: ["copy", "palette", "iconography"] }).notNull(),
    inputInterface: text("input_interface").notNull(),
    outputInterface: text("output_interface").notNull(),
    joinedAt: integer("joined_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull()
  },
  (table) => [
    uniqueIndex("relay_participants_token_hash_unique").on(table.tokenHash),
    index("relay_participants_room_joined_idx").on(table.roomId, table.joinedAt)
  ]
)

export const relayTasks = sqliteTable(
  "relay_tasks",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => relayRooms.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    capability: text("capability", { enum: ["copy", "palette", "iconography"] }).notNull(),
    status: text("status", { enum: ["offered", "working", "submitted", "accepted"] }).notNull(),
    suggestedParticipantId: text("suggested_participant_id").references(() => relayParticipants.id, {
      onDelete: "set null"
    }),
    suggestionReason: text("suggestion_reason").notNull(),
    claimedByParticipantId: text("claimed_by_participant_id").references(() => relayParticipants.id, {
      onDelete: "set null"
    }),
    outputJson: text("output_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("relay_tasks_room_position_unique").on(table.roomId, table.position),
    index("relay_tasks_room_status_idx").on(table.roomId, table.status)
  ]
)

export const relayEvents = sqliteTable(
  "relay_events",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => relayRooms.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    kind: text("kind", {
      enum: [
        "room_created",
        "cell_joined",
        "plan_created",
        "task_claimed",
        "task_submitted",
        "task_accepted",
        "task_reopened",
        "room_completed"
      ]
    }).notNull(),
    actorId: text("actor_id").references(() => relayParticipants.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [
    uniqueIndex("relay_events_room_revision_unique").on(table.roomId, table.revision),
    index("relay_events_room_created_idx").on(table.roomId, table.createdAt)
  ]
)
