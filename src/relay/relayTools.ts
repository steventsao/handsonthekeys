import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { CreateRoomInput, JoinRoomInput, ReviewTaskInput, SubmitTaskInput } from "./domain.ts"
import { currentRelayRoomId, RelayApi } from "./RelayApi.ts"

const EmptyInput = Schema.Struct({})
const TaskInput = Schema.Struct({ taskId: Schema.String })
const SubmitInput = Schema.Struct({ taskId: Schema.String, ...SubmitTaskInput.fields })
const ReviewInput = Schema.Struct({ taskId: Schema.String, ...ReviewTaskInput.fields })
const jsonSchema = (schema: Schema.Top) => Schema.toJsonSchemaDocument(schema) as object

export const relayToolResultEvent = "hex-relay:tool-result"

const currentRoom = Effect.fn("RelayTools.currentRoom")(function* () {
  const roomId = yield* Effect.sync(currentRelayRoomId)
  if (roomId === null) return yield* Effect.fail(new Error("Open or create a relay room first."))
  return roomId
})

const visible = <A>(tool: string, effect: Effect.Effect<A, unknown, RelayApi>) =>
  effect.pipe(
    Effect.tap((room) =>
      Effect.sync(() =>
        window.dispatchEvent(new CustomEvent(relayToolResultEvent, { detail: { tool, room } }))
      )
    )
  )

export const relayTools: ReadonlyArray<EffectTool<ToolInput, unknown, unknown, RelayApi>> = [
  {
    name: "create_relay_room",
    title: "Create relay room",
    description:
      "Create a shareable Hex Relay poster room. The current browser tab becomes the lead and task definer.",
    inputSchema: jsonSchema(CreateRoomInput),
    execute: (input) =>
      visible(
        "create_relay_room",
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(CreateRoomInput)(input)
          const api = yield* RelayApi
          return yield* api.create(decoded)
        })
      )
  },
  {
    name: "inspect_relay_room",
    title: "Inspect relay room",
    description:
      "Read the current room phase, available cells, typed tasks, submissions, and ordered event history.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) =>
      visible(
        "inspect_relay_room",
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(EmptyInput)(input)
          const roomId = yield* currentRoom()
          const api = yield* RelayApi
          return yield* api.snapshot(roomId)
        })
      )
  },
  {
    name: "offer_agent_cell",
    title: "Offer agent cell",
    description:
      "Register this browser tab as an available copy, palette, or iconography cell in the open room.",
    inputSchema: jsonSchema(JoinRoomInput),
    execute: (input) =>
      visible(
        "offer_agent_cell",
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(JoinRoomInput)(input)
          const roomId = yield* currentRoom()
          const api = yield* RelayApi
          return yield* api.join(roomId, decoded)
        })
      )
  },
  {
    name: "plan_relay_tasks",
    title: "Plan relay tasks",
    description:
      "Lead-only: decompose the poster into its three known typed tasks and suggest cells from available capabilities.",
    inputSchema: jsonSchema(EmptyInput),
    execute: (input) =>
      visible(
        "plan_relay_tasks",
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(EmptyInput)(input)
          const roomId = yield* currentRoom()
          const api = yield* RelayApi
          return yield* api.plan(roomId)
        })
      )
  },
  {
    name: "claim_relay_task",
    title: "Claim relay task",
    description: "Claim one offered task for this tab's registered cell and move it to working.",
    inputSchema: jsonSchema(TaskInput),
    execute: (input) =>
      visible(
        "claim_relay_task",
        Effect.gen(function* () {
          const { taskId } = yield* Schema.decodeUnknownEffect(TaskInput)(input)
          const roomId = yield* currentRoom()
          const api = yield* RelayApi
          return yield* api.claim(roomId, taskId)
        })
      )
  },
  {
    name: "submit_relay_task",
    title: "Submit relay task",
    description: "Submit typed copy, palette, or iconography output for a task claimed by this tab's cell.",
    inputSchema: jsonSchema(SubmitInput),
    execute: (input) =>
      visible(
        "submit_relay_task",
        Effect.gen(function* () {
          const { taskId, output } = yield* Schema.decodeUnknownEffect(SubmitInput)(input)
          const roomId = yield* currentRoom()
          const api = yield* RelayApi
          return yield* api.submit(roomId, taskId, output)
        })
      )
  },
  {
    name: "review_relay_task",
    title: "Review relay task",
    description: "Lead-only: accept a submitted task into the poster or reopen it for another cell.",
    inputSchema: jsonSchema(ReviewInput),
    execute: (input) =>
      visible(
        "review_relay_task",
        Effect.gen(function* () {
          const { taskId, decision } = yield* Schema.decodeUnknownEffect(ReviewInput)(input)
          const roomId = yield* currentRoom()
          const api = yield* RelayApi
          return yield* api.review(roomId, taskId, decision)
        })
      )
  }
]
