import * as WebMcp from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schedule from "effect/Schedule"
import { LocalModelContext } from "../LocalModelContext.ts"
import type { CreateRoomInput, JoinRoomInput, RoomSnapshot, TaskOutput } from "./domain.ts"
import { loadRelayIdentity, RelayApi } from "./RelayApi.ts"
import { relayToolResultEvent, relayTools } from "./relayTools.ts"

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

const AppLayer = Layer.merge(RelayApi.layer, WebMcp.layerModelContext(modelContext))
const runtime = ManagedRuntime.make(AppLayer)

runtime.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.all(
        relayTools.map((tool) => WebMcp.registerTool(tool)),
        { discard: true }
      )
      yield* Effect.never
    })
  )
)

const waitUntilReady = WebMcp.getTools().pipe(
  Effect.repeat({
    schedule: Schedule.spaced("20 millis"),
    until: (tools) => tools.length === relayTools.length
  }),
  Effect.timeoutOrElse({
    duration: "2 seconds",
    orElse: () => Effect.die("Timed out while registering Hex Relay WebMCP tools")
  })
)

export const toolsReady = runtime.runPromise(waitUntilReady)

const withApi = <A, E>(f: (api: RelayApi["Service"]) => Effect.Effect<A, E>) =>
  runtime.runPromise(Effect.flatMap(RelayApi, f))

export const createRoom = (input: CreateRoomInput) => withApi((api) => api.create(input))
export const joinRoom = (roomId: string, input: JoinRoomInput) => withApi((api) => api.join(roomId, input))
export const loadRoom = (roomId: string) => withApi((api) => api.snapshot(roomId))
export const heartbeat = (roomId: string) => withApi((api) => api.heartbeat(roomId))
export const planRoom = (roomId: string) => withApi((api) => api.plan(roomId))
export const claimTask = (roomId: string, taskId: string) => withApi((api) => api.claim(roomId, taskId))
export const submitTask = (roomId: string, taskId: string, output: TaskOutput) =>
  withApi((api) => api.submit(roomId, taskId, output))
export const reviewTask = (roomId: string, taskId: string, decision: "accept" | "reopen") =>
  withApi((api) => api.review(roomId, taskId, decision))

export const getIdentity = loadRelayIdentity

export const executeRelayTool = async (name: string, input: WebMcp.ToolInput = {}): Promise<string> => {
  const tools = await toolsReady
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`WebMCP tool ${name} is not registered`)
  return runtime.runPromise(WebMcp.executeTool(tool, input))
}

export const subscribeToolResults = (
  listener: (detail: { readonly tool: string; readonly room: RoomSnapshot }) => void
): (() => void) => {
  const handler = (event: Event) => {
    if (event instanceof CustomEvent) {
      listener(event.detail as { readonly tool: string; readonly room: RoomSnapshot })
    }
  }
  window.addEventListener(relayToolResultEvent, handler)
  return () => window.removeEventListener(relayToolResultEvent, handler)
}
