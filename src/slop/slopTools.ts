import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { QueueApi } from "./QueueApi.ts"
import {
  BatchQueueInputSchema,
  GetStatusInputSchema,
  jsonSchema,
  QueuePromptInputSchema,
  SteerPromptInputSchema
} from "./schemas.ts"

export const toolResultEvent = "infinite-slop:tool-result"

const publishResult = (tool: string, result: unknown) =>
  Effect.sync(() => {
    window.dispatchEvent(new CustomEvent(toolResultEvent, { detail: { tool, result } }))
    const channel = new BroadcastChannel("infinite-slop-channel")
    channel.postMessage({ type: "queue-changed" })
    channel.close()
  })

export const slopTools: ReadonlyArray<EffectTool<ToolInput, unknown, unknown, QueueApi>> = [
  {
    name: "queue_prompt",
    title: "Queue visual prompt",
    description:
      "Queue one visual-generation prompt on the shared channel. Returns immediately with a durable run ID; use get_status to follow it.",
    inputSchema: jsonSchema(QueuePromptInputSchema),
    annotations: { untrustedContentHint: true },
    execute: Effect.fn("queue_prompt")(function* (input) {
      const decoded = yield* Schema.decodeUnknownEffect(QueuePromptInputSchema)(input)
      const api = yield* QueueApi
      const result = yield* api.queuePrompt(decoded.prompt, decoded.client_request_id)
      yield* publishResult("queue_prompt", result)
      return result
    })
  },
  {
    name: "get_status",
    title: "Get visual run status",
    description:
      "Read one queued visual run, including queue position, generation progress, revision, steering history, and visual output when complete.",
    inputSchema: jsonSchema(GetStatusInputSchema),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: Effect.fn("get_status")(function* (input) {
      const decoded = yield* Schema.decodeUnknownEffect(GetStatusInputSchema)(input)
      const api = yield* QueueApi
      const result = yield* api.getStatus(decoded.run_id)
      yield* publishResult("get_status", result)
      return result
    })
  },
  {
    name: "batch_queue",
    title: "Queue a visual batch",
    description:
      "Atomically queue 1–6 visual prompts in input order. Every item needs its own retry-safe client_request_id.",
    inputSchema: jsonSchema(BatchQueueInputSchema),
    annotations: { untrustedContentHint: true },
    execute: Effect.fn("batch_queue")(function* (input) {
      const decoded = yield* Schema.decodeUnknownEffect(BatchQueueInputSchema)(input)
      const api = yield* QueueApi
      const result = yield* api.batchQueue(decoded.items)
      yield* publishResult("batch_queue", result)
      return result
    })
  },
  {
    name: "steer_prompt",
    title: "Steer visual prompt",
    description:
      "Add creative direction to a run you queued. Supply the exact current revision from get_status; a completed visual is revised and requeued.",
    inputSchema: jsonSchema(SteerPromptInputSchema),
    annotations: { untrustedContentHint: true },
    execute: Effect.fn("steer_prompt")(function* (input) {
      const decoded = yield* Schema.decodeUnknownEffect(SteerPromptInputSchema)(input)
      const api = yield* QueueApi
      const result = yield* api.steerPrompt({
        runId: decoded.run_id,
        instruction: decoded.instruction,
        expectedRevision: decoded.expected_revision,
        clientRequestId: decoded.client_request_id
      })
      yield* publishResult("steer_prompt", result)
      return result
    })
  }
]
