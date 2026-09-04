import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Recipe, views } from "./Recipe.ts"

const EmptyInput = Schema.Struct({})
const GoToStepInput = Schema.Struct({ step: Schema.Number })
const MoveStepInput = Schema.Struct({ direction: Schema.Literals(["next", "previous"]) })
const SetViewInput = Schema.Struct({ view: Schema.Literals(views) })
const AdjustZoomInput = Schema.Struct({ direction: Schema.Literals(["in", "out", "reset"]) })

const jsonSchema = (schema: Schema.Top) => Schema.toJsonSchemaDocument(schema) as object

const withSnapshot = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const result = yield* effect
    const recipe = yield* Recipe
    const state = yield* recipe.snapshot
    return { result, state }
  })

export const recipeTools: ReadonlyArray<EffectTool<ToolInput, unknown, unknown, Recipe>> = [
  {
    name: "read_recipe_state",
    title: "Read recipe state",
    description: "Read the current step, view, zoom level, timer, and activity log for the recipe page.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const recipe = yield* Recipe
        return yield* recipe.snapshot
      })
  },
  {
    name: "go_to_step",
    title: "Go to step",
    description: "Jump the recipe to a specific 1-based step number.",
    inputSchema: jsonSchema(GoToStepInput),
    execute: (input) =>
      Effect.gen(function* () {
        const { step } = yield* Schema.decodeUnknownEffect(GoToStepInput)(input)
        const recipe = yield* Recipe
        return yield* withSnapshot(recipe.goToStep(step))
      })
  },
  {
    name: "move_step",
    title: "Move step",
    description: "Move to the next or previous recipe step, clamped at the first and last steps.",
    inputSchema: jsonSchema(MoveStepInput),
    execute: (input) =>
      Effect.gen(function* () {
        const { direction } = yield* Schema.decodeUnknownEffect(MoveStepInput)(input)
        const recipe = yield* Recipe
        return yield* withSnapshot(recipe.moveStep(direction))
      })
  },
  {
    name: "set_view",
    title: "Set view",
    description: "Switch the page between the overview, ingredients, and steps views.",
    inputSchema: jsonSchema(SetViewInput),
    execute: (input) =>
      Effect.gen(function* () {
        const { view } = yield* Schema.decodeUnknownEffect(SetViewInput)(input)
        const recipe = yield* Recipe
        return yield* withSnapshot(recipe.setView(view))
      })
  },
  {
    name: "adjust_zoom",
    title: "Adjust zoom",
    description: "Zoom the step card in or out in 0.2x increments between 0.8x and 2.0x, or reset to 1.0x.",
    inputSchema: jsonSchema(AdjustZoomInput),
    execute: (input) =>
      Effect.gen(function* () {
        const { direction } = yield* Schema.decodeUnknownEffect(AdjustZoomInput)(input)
        const recipe = yield* Recipe
        return yield* withSnapshot(recipe.zoom(direction))
      })
  },
  {
    name: "start_step_timer",
    title: "Start step timer",
    description: "Start the countdown timer for the current step. Fails if the step has no timer.",
    inputSchema: jsonSchema(EmptyInput),
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const recipe = yield* Recipe
        return yield* withSnapshot(recipe.startTimer)
      })
  },
  {
    name: "stop_timer",
    title: "Stop timer",
    description: "Stop and clear the running step timer.",
    inputSchema: jsonSchema(EmptyInput),
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const recipe = yield* Recipe
        return yield* withSnapshot(recipe.stopTimer)
      })
  }
]
