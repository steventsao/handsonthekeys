import * as WebMcp from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { LocalModelContext } from "./LocalModelContext.ts"
import { Mission, type MissionState, type Sector } from "./Mission.ts"
import { missionTools } from "./missionTools.ts"

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

const AppLayer = Layer.merge(Mission.layer, WebMcp.layerModelContext(modelContext))
const runtime = ManagedRuntime.make(AppLayer)

const registrationProgram = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.all(
      missionTools.map((tool) => WebMcp.registerTool(tool)),
      { discard: true }
    )
    yield* Effect.never
  })
)

runtime.runFork(registrationProgram)

const waitUntilReady = Effect.gen(function* () {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const tools = yield* WebMcp.getTools()
    if (tools.length === missionTools.length) return tools
    yield* Effect.sleep("20 millis")
  }
  return yield* Effect.die("Timed out while registering WebMCP mission tools")
})

export const toolsReady = runtime.runPromise(waitUntilReady)

export const subscribeMission = (listener: (state: MissionState) => void): (() => void) => {
  const fiber = runtime.runFork(
    Effect.flatMap(Mission, (mission) =>
      mission.changes.pipe(Stream.runForEach((state) => Effect.sync(() => listener(state))))
    )
  )
  return () => {
    void Effect.runPromise(Fiber.interrupt(fiber))
  }
}

export const executeMissionTool = async (name: string, input: WebMcp.ToolInput = {}): Promise<string> => {
  const tools = await toolsReady
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`WebMCP tool ${name} is not registered`)
  return runtime.runPromise(WebMcp.executeTool(tool, input))
}

const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 160))

export const runAgentSequence = async (onStep: (name: string, output: string) => void): Promise<void> => {
  const sequence: ReadonlyArray<readonly [string, WebMcp.ToolInput]> = [
    ["read_mission_telemetry", {}],
    ["scan_signal_sector", { sector: "B2" }],
    ["scan_signal_sector", { sector: "D4" }],
    ["scan_signal_sector", { sector: "F6" }],
    ["reroute_ship_power", { from: "shields", to: "decoder", units: 12 }],
    ["decode_distress_signal", {}],
    ["propose_rescue_vector", {}]
  ]

  for (const [name, input] of sequence) {
    const output = await executeMissionTool(name, input)
    onStep(name, output)
    await pause()
  }
}

export const scanSector = (sector: Sector) => executeMissionTool("scan_signal_sector", { sector })

export const confirmRescue = () =>
  runtime.runPromise(Effect.flatMap(Mission, (mission) => mission.confirmBurn))

export const resetMission = () => runtime.runPromise(Effect.flatMap(Mission, (mission) => mission.reset))
