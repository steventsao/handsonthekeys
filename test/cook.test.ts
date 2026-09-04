import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { TestClock } from "effect/testing"
import { maxZoom, minZoom, Recipe, steps } from "../src/cook/Recipe.ts"
import { parseCommand } from "../src/cook/voiceControl.ts"

describe("Recipe service", () => {
  it.effect("move_step clamps at the first and last steps", () =>
    Effect.gen(function* () {
      const recipe = yield* Recipe
      const first = yield* recipe.moveStep("previous")
      assert.strictEqual(first, 0)
      yield* recipe.goToStep(steps.length)
      const last = yield* recipe.moveStep("next")
      assert.strictEqual(last, steps.length - 1)
      const state = yield* recipe.snapshot
      assert.strictEqual(state.stepIndex, steps.length - 1)
    }).pipe(Effect.provide(Recipe.layer))
  )

  it.effect("go_to_step rejects out-of-range steps with RecipeRuleError", () =>
    Effect.gen(function* () {
      const recipe = yield* Recipe
      const tooHigh = yield* Effect.flip(recipe.goToStep(steps.length + 1))
      assert.strictEqual(tooHigh._tag, "RecipeRuleError")
      const zero = yield* Effect.flip(recipe.goToStep(0))
      assert.strictEqual(zero._tag, "RecipeRuleError")
      const fractional = yield* Effect.flip(recipe.goToStep(2.5))
      assert.strictEqual(fractional._tag, "RecipeRuleError")
    }).pipe(Effect.provide(Recipe.layer))
  )

  it.effect("adjust_zoom clamps between 0.8x and 2.0x", () =>
    Effect.gen(function* () {
      const recipe = yield* Recipe
      let zoom = 1
      for (let index = 0; index < 10; index += 1) {
        zoom = yield* recipe.zoom("in")
      }
      assert.strictEqual(zoom, maxZoom)
      zoom = yield* recipe.zoom("reset")
      assert.strictEqual(zoom, 1)
      for (let index = 0; index < 10; index += 1) {
        zoom = yield* recipe.zoom("out")
      }
      assert.strictEqual(zoom, minZoom)
    }).pipe(Effect.provide(Recipe.layer))
  )

  it.effect("startTimer fails on an untimed step", () =>
    Effect.gen(function* () {
      const recipe = yield* Recipe
      yield* recipe.goToStep(2)
      const error = yield* Effect.flip(recipe.startTimer)
      assert.strictEqual(error._tag, "RecipeRuleError")
    }).pipe(Effect.provide(Recipe.layer))
  )

  it.effect("startTimer ticks down as the TestClock advances", () =>
    Effect.gen(function* () {
      const recipe = yield* Recipe
      const timer = yield* recipe.startTimer
      assert.strictEqual(timer.remainingSeconds, 60)
      yield* Effect.yieldNow
      yield* TestClock.adjust("3 seconds")
      yield* Effect.yieldNow
      const state = yield* recipe.snapshot
      assert.strictEqual(state.timer?.remainingSeconds, 57)
      assert.strictEqual(state.timer?.done, false)
    }).pipe(Effect.provide(Recipe.layer))
  )

  it.effect("the timer completes with done and logs TIMER DONE", () =>
    Effect.gen(function* () {
      const recipe = yield* Recipe
      yield* recipe.startTimer
      yield* Effect.yieldNow
      yield* TestClock.adjust("60 seconds")
      yield* Effect.yieldNow
      const state = yield* recipe.snapshot
      assert.strictEqual(state.timer?.remainingSeconds, 0)
      assert.strictEqual(state.timer?.done, true)
      assert.isTrue(state.logs.some((entry) => entry.message.includes("TIMER DONE")))
    }).pipe(Effect.provide(Recipe.layer))
  )

  it.effect("stopTimer clears the running timer", () =>
    Effect.gen(function* () {
      const recipe = yield* Recipe
      yield* recipe.startTimer
      yield* recipe.stopTimer
      const state = yield* recipe.snapshot
      assert.strictEqual(state.timer, null)
    }).pipe(Effect.provide(Recipe.layer))
  )
})

describe("parseCommand", () => {
  it("maps movement phrases to move_step", () => {
    assert.deepStrictEqual(parseCommand("next step"), { tool: "move_step", input: { direction: "next" } })
    assert.deepStrictEqual(parseCommand("go on"), { tool: "move_step", input: { direction: "next" } })
    assert.deepStrictEqual(parseCommand("go back"), {
      tool: "move_step",
      input: { direction: "previous" }
    })
    assert.deepStrictEqual(parseCommand("previous please"), {
      tool: "move_step",
      input: { direction: "previous" }
    })
  })

  it("maps step numbers and number words to go_to_step", () => {
    assert.deepStrictEqual(parseCommand("step three"), { tool: "go_to_step", input: { step: 3 } })
    assert.deepStrictEqual(parseCommand("go to step 5"), { tool: "go_to_step", input: { step: 5 } })
    assert.strictEqual(parseCommand("step nine"), null)
  })

  it("maps view phrases to set_view", () => {
    assert.deepStrictEqual(parseCommand("show me the ingredients"), {
      tool: "set_view",
      input: { view: "ingredients" }
    })
    assert.deepStrictEqual(parseCommand("back to the steps"), {
      tool: "set_view",
      input: { view: "steps" }
    })
    assert.deepStrictEqual(parseCommand("overview"), { tool: "set_view", input: { view: "overview" } })
  })

  it("maps zoom and timer phrases", () => {
    assert.deepStrictEqual(parseCommand("zoom in"), { tool: "adjust_zoom", input: { direction: "in" } })
    assert.deepStrictEqual(parseCommand("zoom out"), { tool: "adjust_zoom", input: { direction: "out" } })
    assert.deepStrictEqual(parseCommand("reset zoom"), {
      tool: "adjust_zoom",
      input: { direction: "reset" }
    })
    assert.deepStrictEqual(parseCommand("start the timer"), { tool: "start_step_timer", input: {} })
    assert.deepStrictEqual(parseCommand("stop timer"), { tool: "stop_timer", input: {} })
  })

  it("returns null for unrecognized speech", () => {
    assert.strictEqual(parseCommand("what is for dinner"), null)
    assert.strictEqual(parseCommand(""), null)
  })
})
