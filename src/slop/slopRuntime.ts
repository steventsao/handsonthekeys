import * as WebMcp from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schedule from "effect/Schedule"
import { LocalModelContext } from "../LocalModelContext.ts"
import { QueueApi } from "./QueueApi.ts"
import { slopTools, toolResultEvent } from "./slopTools.ts"
import type { ChannelSnapshot } from "./types.ts"

const documentWithModelContext = document as unknown as WebMcp.ModelContextDocument
const nativeModelContext = documentWithModelContext.modelContext
const localModelContext = new LocalModelContext()

export const modelContextMode =
  nativeModelContext?.executeTool === undefined ? "LOCAL EFFECT ADAPTER" : "NATIVE WEBMCP"
export const modelContext =
  nativeModelContext?.executeTool === undefined ? localModelContext : nativeModelContext

if (nativeModelContext === undefined) {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext
  })
}

const AppLayer = Layer.merge(QueueApi.layer, WebMcp.layerModelContext(modelContext))
const runtime = ManagedRuntime.make(AppLayer)

runtime.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.all(
        slopTools.map((tool) => WebMcp.registerTool(tool)),
        { discard: true }
      )
      yield* Effect.never
    })
  )
)

const waitUntilReady = WebMcp.getTools().pipe(
  Effect.repeat({
    schedule: Schedule.spaced("20 millis"),
    until: (tools) => tools.length === slopTools.length
  }),
  Effect.timeoutOrElse({
    duration: "2 seconds",
    orElse: () => Effect.die("Timed out while registering Infinite Slop WebMCP tools")
  })
)

export const toolsReady = runtime.runPromise(waitUntilReady)

export const loadChannel = (): Promise<ChannelSnapshot> =>
  runtime.runPromise(Effect.flatMap(QueueApi, (api) => api.channel))

export const executeSlopTool = async (name: string, input: WebMcp.ToolInput = {}): Promise<string> => {
  const tools = await toolsReady
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`WebMCP tool ${name} is not registered`)
  return runtime.runPromise(WebMcp.executeTool(tool, input))
}

export const makeRequestId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`

export const subscribeToolResults = (
  listener: (detail: { readonly tool: string; readonly result: unknown }) => void
): (() => void) => {
  const handler = (event: Event) => {
    if (event instanceof CustomEvent)
      listener(event.detail as { readonly tool: string; readonly result: unknown })
  }
  window.addEventListener(toolResultEvent, handler)
  return () => window.removeEventListener(toolResultEvent, handler)
}
