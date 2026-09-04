import * as WebMcp from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { LocalModelContext } from "../LocalModelContext.ts"
import { Recipe, type CookLog, type RecipeState } from "./Recipe.ts"
import { recipeTools } from "./recipeTools.ts"

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

const CookLayer = Layer.merge(Recipe.layer, WebMcp.layerModelContext(modelContext))
const runtime = ManagedRuntime.make(CookLayer)

const registrationProgram = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.all(
      recipeTools.map((tool) => WebMcp.registerTool(tool)),
      { discard: true }
    )
    yield* Effect.never
  })
)

runtime.runFork(registrationProgram)

const waitUntilReady = Effect.gen(function* () {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const tools = yield* WebMcp.getTools()
    if (tools.length === recipeTools.length) return tools
    yield* Effect.sleep("20 millis")
  }
  return yield* Effect.die("Timed out while registering WebMCP recipe tools")
})

export const toolsReady = runtime.runPromise(waitUntilReady)

export const subscribeRecipe = (listener: (state: RecipeState) => void): (() => void) => {
  const fiber = runtime.runFork(
    Effect.flatMap(Recipe, (recipe) =>
      recipe.changes.pipe(Stream.runForEach((state) => Effect.sync(() => listener(state))))
    )
  )
  return () => {
    void Effect.runPromise(Fiber.interrupt(fiber))
  }
}

export const executeCookTool = async (name: string, input: WebMcp.ToolInput = {}): Promise<string> => {
  const tools = await toolsReady
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`WebMCP tool ${name} is not registered`)
  return runtime.runPromise(WebMcp.executeTool(tool, input))
}

export const logCookEvent = (actor: CookLog["actor"], message: string): Promise<void> =>
  runtime.runPromise(Effect.flatMap(Recipe, (recipe) => recipe.announce(actor, message)))

export const resetRecipe = (): Promise<void> =>
  runtime.runPromise(Effect.flatMap(Recipe, (recipe) => recipe.reset))
