import * as Array from "effect/Array"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"

export interface RecipeStep {
  readonly title: string
  readonly detail: string
  readonly durationSeconds?: number
}

export interface RecipeIngredient {
  readonly name: string
  readonly amount: string
  readonly note?: string
}

export const dish = {
  title: "Dad's Tomato Egg Stir-Fry",
  chef: "Chef Steven's dad, in the Made With Lau spirit",
  blurb:
    "Silky scrambled eggs folded into a jammy tomato sauce — the Cantonese weeknight classic. " +
    "Everything on this page, from the step card to the countdown timer, is driven by Effect services " +
    "and reachable through WebMCP tools, so an agent (or your voice) can run the kitchen."
} as const

export const ingredients: ReadonlyArray<RecipeIngredient> = [
  { name: "Eggs", amount: "4 large", note: "room temperature" },
  { name: "Roma tomatoes", amount: "3", note: "ripe but firm" },
  { name: "Garlic", amount: "2 cloves", note: "minced" },
  { name: "Ginger", amount: "1 thin slice", note: "smashed" },
  { name: "Scallion", amount: "1 stalk", note: "cut into 1-inch pieces" },
  { name: "Sugar", amount: "2 tsp" },
  { name: "Salt", amount: "1/2 tsp, plus a pinch for the eggs" },
  { name: "Ketchup", amount: "1 tbsp", note: "dad's shortcut" },
  { name: "Cornstarch slurry", amount: "1 tsp starch + 1 tbsp water" },
  { name: "Neutral oil", amount: "3 tbsp" },
  { name: "Steamed jasmine rice", amount: "for serving" }
]

export const steps: ReadonlyArray<RecipeStep> = [
  {
    title: "Blanch & peel the tomatoes",
    detail:
      "Score a shallow X on the bottom of each tomato. Drop them into boiling water, then lift them out and slip off the skins. Cut into wedges.",
    durationSeconds: 60
  },
  {
    title: "Beat the eggs",
    detail:
      "Crack the eggs into a bowl with a pinch of salt. Beat with chopsticks until no streaks of white remain — dad says this is what makes them silky."
  },
  {
    title: "Scramble the eggs",
    detail:
      "Get the wok smoking hot, add 2 tbsp oil, and pour in the eggs. Push gently until soft curds just set, then plate them while still glossy."
  },
  {
    title: "Bloom the aromatics",
    detail:
      "Add the remaining oil, then the ginger and garlic. Stir until fragrant — about 20 seconds. Don't let the garlic brown."
  },
  {
    title: "Cook down the tomatoes",
    detail:
      "Add the tomato wedges and let them simmer, pressing occasionally, until they collapse into a chunky sauce.",
    durationSeconds: 180
  },
  {
    title: "Season the sauce",
    detail:
      "Stir in the sugar, salt, and ketchup. Add the cornstarch slurry and cook until the sauce turns glossy and clings to the spatula."
  },
  {
    title: "Bring it together",
    detail:
      "Return the eggs to the wok with the scallions. Fold gently two or three times — just enough to coat the curds without breaking them."
  },
  {
    title: "Plate & garnish",
    detail:
      "Slide everything over hot jasmine rice, shower with extra scallion, and serve immediately. Serves two, generously."
  }
]

export const views = ["overview", "ingredients", "steps"] as const
export type RecipeView = (typeof views)[number]

export type StepDirection = "next" | "previous"
export type ZoomDirection = "in" | "out" | "reset"

export const minZoom = 0.8
export const maxZoom = 2
export const defaultZoom = 1
export const zoomStep = 0.2

export interface RecipeTimer {
  readonly stepIndex: number
  readonly label: string
  readonly remainingSeconds: number
  readonly totalSeconds: number
  readonly done: boolean
}

export interface CookLog {
  readonly id: number
  readonly actor: "VOICE" | "AGENT" | "COOK"
  readonly message: string
}

export interface RecipeState {
  readonly stepIndex: number
  readonly view: RecipeView
  readonly zoom: number
  readonly timer: RecipeTimer | null
  readonly logs: ReadonlyArray<CookLog>
}

export class RecipeRuleError extends Data.TaggedError("RecipeRuleError")<{
  readonly message: string
}> {}

export const initialRecipeState = (): RecipeState => ({
  stepIndex: 0,
  view: "overview",
  zoom: defaultZoom,
  timer: null,
  logs: [
    {
      id: 1,
      actor: "COOK",
      message: "Wok station online. Seven WebMCP tools registered — say “next step” to begin."
    }
  ]
})

const stepLabel = (stepIndex: number) => `Step ${stepIndex + 1} of ${steps.length}`

const requireStep = (stepIndex: number) =>
  Effect.fromOption(
    Array.get(steps, stepIndex),
    () => new RecipeRuleError({ message: `No step exists at index ${stepIndex + 1}.` })
  )

const withLog = (
  state: RecipeState,
  actor: CookLog["actor"],
  message: string,
  changes: Partial<RecipeState> = {}
): RecipeState => ({
  ...state,
  ...changes,
  logs: [...state.logs, { id: state.logs.length + 1, actor, message }]
})

export class Recipe extends Context.Service<
  Recipe,
  {
    readonly changes: Stream.Stream<RecipeState>
    readonly snapshot: Effect.Effect<RecipeState>
    readonly reset: Effect.Effect<void>
    readonly announce: (actor: CookLog["actor"], message: string) => Effect.Effect<void>
    readonly goToStep: (step: number) => Effect.Effect<number, RecipeRuleError>
    readonly moveStep: (direction: StepDirection) => Effect.Effect<number, RecipeRuleError>
    readonly setView: (view: RecipeView) => Effect.Effect<RecipeView>
    readonly zoom: (direction: ZoomDirection) => Effect.Effect<number>
    readonly startTimer: Effect.Effect<RecipeTimer, RecipeRuleError>
    readonly stopTimer: Effect.Effect<void>
  }
>()("cook/Recipe") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make(initialRecipeState())
      const timerFiber = yield* Ref.make<Fiber.Fiber<void> | null>(null)
      const layerScope = yield* Effect.scope

      const interruptTimerFiber = Effect.gen(function* () {
        const fiber = yield* Ref.get(timerFiber)
        if (fiber !== null) {
          yield* Fiber.interrupt(fiber)
          yield* Ref.set(timerFiber, null)
        }
      })

      const announce = Effect.fn("Recipe.announce")(function* (actor: CookLog["actor"], message: string) {
        yield* SubscriptionRef.update(state, (current) => withLog(current, actor, message))
      })

      const goToStep = Effect.fn("Recipe.goToStep")(function* (step: number) {
        if (!Number.isInteger(step) || step < 1 || step > steps.length) {
          return yield* new RecipeRuleError({
            message: `Step must be a whole number between 1 and ${steps.length}.`
          })
        }
        const stepIndex = step - 1
        const current = yield* SubscriptionRef.get(state)
        const stepAtIndex = yield* requireStep(stepIndex)
        yield* SubscriptionRef.set(
          state,
          withLog(current, "AGENT", `${stepLabel(stepIndex)}: ${stepAtIndex.title}.`, {
            stepIndex,
            view: "steps"
          })
        )
        return stepIndex
      })

      const moveStep = Effect.fn("Recipe.moveStep")(function* (direction: StepDirection) {
        const current = yield* SubscriptionRef.get(state)
        const delta = direction === "next" ? 1 : -1
        const stepIndex = Math.min(Math.max(current.stepIndex + delta, 0), steps.length - 1)
        const stepAtIndex = yield* requireStep(stepIndex)
        const message =
          stepIndex === current.stepIndex
            ? `${stepLabel(stepIndex)}: already ${direction === "next" ? "at the last" : "on the first"} step — ${stepAtIndex.title}.`
            : `${stepLabel(stepIndex)}: ${stepAtIndex.title}.`
        yield* SubscriptionRef.set(state, withLog(current, "AGENT", message, { stepIndex, view: "steps" }))
        return stepIndex
      })

      const setView = Effect.fn("Recipe.setView")(function* (view: RecipeView) {
        yield* SubscriptionRef.update(state, (current) =>
          withLog(current, "AGENT", `View switched to ${view}.`, { view })
        )
        return view
      })

      const zoom = Effect.fn("Recipe.zoom")(function* (direction: ZoomDirection) {
        const current = yield* SubscriptionRef.get(state)
        const requested =
          direction === "reset"
            ? defaultZoom
            : Math.round((current.zoom + (direction === "in" ? zoomStep : -zoomStep)) * 10) / 10
        const next = Math.min(Math.max(requested, minZoom), maxZoom)
        const message =
          next === current.zoom
            ? `Zoom stays at ${next.toFixed(1)}x — the ${direction === "in" ? "maximum" : "minimum"} is already set.`
            : `Zoom adjusted to ${next.toFixed(1)}x.`
        yield* SubscriptionRef.set(state, withLog(current, "AGENT", message, { zoom: next }))
        return next
      })

      const tick = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        const timer = current.timer
        if (timer === null) return false
        const remaining = timer.remainingSeconds - 1
        if (remaining <= 0) {
          yield* SubscriptionRef.update(state, (latest) =>
            latest.timer === null
              ? latest
              : withLog(latest, "COOK", `TIMER DONE — ${latest.timer.label} is ready.`, {
                  timer: { ...latest.timer, remainingSeconds: 0, done: true }
                })
          )
          yield* Ref.set(timerFiber, null)
          return false
        }
        yield* SubscriptionRef.update(state, (latest) =>
          latest.timer === null
            ? latest
            : { ...latest, timer: { ...latest.timer, remainingSeconds: remaining } }
        )
        return true
      })

      const startTimer = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        const step = yield* requireStep(current.stepIndex)
        if (step.durationSeconds === undefined) {
          return yield* new RecipeRuleError({
            message: `${stepLabel(current.stepIndex)} (${step.title}) has no timer.`
          })
        }
        yield* interruptTimerFiber
        const timer: RecipeTimer = {
          stepIndex: current.stepIndex,
          label: step.title,
          remainingSeconds: step.durationSeconds,
          totalSeconds: step.durationSeconds,
          done: false
        }
        yield* SubscriptionRef.set(
          state,
          withLog(current, "COOK", `Timer started: ${step.title} — ${step.durationSeconds}s.`, { timer })
        )
        const fiber = yield* Effect.forkIn(
          Stream.tick("1 second").pipe(
            Stream.drop(1),
            Stream.runForEachWhile(() => tick)
          ),
          layerScope
        )
        yield* Ref.set(timerFiber, fiber)
        return timer
      }).pipe(Effect.withSpan("Recipe.startTimer"))

      const stopTimer = Effect.gen(function* () {
        yield* interruptTimerFiber
        yield* SubscriptionRef.update(state, (current) =>
          current.timer === null
            ? current
            : withLog(current, "COOK", `Timer stopped: ${current.timer.label}.`, { timer: null })
        )
      }).pipe(Effect.withSpan("Recipe.stopTimer"))

      const reset = Effect.gen(function* () {
        yield* interruptTimerFiber
        yield* SubscriptionRef.set(state, initialRecipeState())
      }).pipe(Effect.withSpan("Recipe.reset"))

      return Recipe.of({
        changes: SubscriptionRef.changes(state),
        snapshot: SubscriptionRef.get(state),
        reset,
        announce,
        goToStep,
        moveStep,
        setView,
        zoom,
        startTimer,
        stopTimer
      })
    })
  )
}
