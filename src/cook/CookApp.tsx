import { useEffect, useMemo, useState, type CSSProperties } from "react"
import {
  executeCookTool,
  logCookEvent,
  modelContextMode,
  resetRecipe,
  subscribeRecipe,
  toolsReady
} from "./cookRuntime.ts"
import { dish, initialRecipeState, ingredients, steps, views, type RecipeView } from "./Recipe.ts"
import { makeVoiceControl, parseCommand, voiceUnavailableMessage } from "./voiceControl.ts"

const viewLabels: Readonly<Record<RecipeView, string>> = {
  overview: "OVERVIEW",
  ingredients: "INGREDIENTS",
  steps: "STEPS"
}

const formatSeconds = (total: number) => {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

declare global {
  interface Window {
    __cookVoice?: (transcript: string) => Promise<string | null>
  }
}

export const CookApp = () => {
  const [recipe, setRecipe] = useState(initialRecipeState)
  const [ready, setReady] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState("Voice idle — press the mic or call a WebMCP tool.")
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<ReadonlyArray<number>>([])

  useEffect(() => {
    const unsubscribe = subscribeRecipe(setRecipe)
    void toolsReady.then(() => setReady(true))
    return unsubscribe
  }, [])

  useEffect(() => {
    window.__cookVoice = async (spoken: string) => {
      const command = parseCommand(spoken)
      if (command === null) return null
      await logCookEvent("VOICE", `Heard “${spoken.trim()}”`)
      return executeCookTool(command.tool, command.input)
    }
    return () => {
      delete window.__cookVoice
    }
  }, [])

  const voice = useMemo(
    () =>
      makeVoiceControl({
        executeTool: executeCookTool,
        onTranscript: (text, isFinal) => {
          setTranscript(text.trim() === "" ? "…" : text)
          if (isFinal && parseCommand(text) !== null) {
            void logCookEvent("VOICE", `Heard “${text.trim()}”`)
          }
        },
        onListeningChange: setListening,
        onError: setError
      }),
    []
  )

  const currentStep = steps[recipe.stepIndex]

  const run = (name: string, input: Record<string, unknown> = {}) => {
    setError(null)
    executeCookTool(name, input).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const toggleMic = () => {
    setError(voice.supported ? null : voiceUnavailableMessage)
    if (listening) {
      void voice.stop()
    } else {
      setTranscript("Listening…")
      void voice.start()
    }
  }

  const toggleIngredient = (index: number) => {
    setChecked((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    )
  }

  const reset = () => {
    setError(null)
    setChecked([])
    void resetRecipe()
  }

  return (
    <main className="cook-shell">
      <header className="cook-topbar">
        <div className="cook-brand">
          <span className="cook-brand-mark" aria-hidden="true">
            炒
          </span>
          <span>WOK THIS WAY</span>
        </div>
        <nav className="view-tabs" aria-label="Recipe views">
          {views.map((view) => (
            <button
              className={recipe.view === view ? "active" : ""}
              data-testid={`view-tab-${view}`}
              key={view}
              type="button"
              onClick={() => run("set_view", { view })}
            >
              {viewLabels[view]}
            </button>
          ))}
        </nav>
        <div className="cook-topbar-right">
          <button className="cook-reset" type="button" onClick={reset}>
            RESET
          </button>
        </div>
      </header>

      <section className="dish-hero">
        <p className="dish-eyebrow">MADE WITH LAU, SORT OF // WEBMCP KITCHEN</p>
        <h1>{dish.title}</h1>
        <p className="dish-chef">{dish.chef}</p>
        <div className="runtime-badge">
          <span>{ready ? "●" : "○"}</span> {ready ? "7 TOOLS READY" : "REGISTERING"} / {modelContextMode}
        </div>
      </section>

      <section className="cook-body">
        {recipe.view === "overview" && (
          <div className="overview">
            <p className="dish-blurb">{dish.blurb}</p>
            <ol className="overview-steps">
              {steps.map((step, index) => (
                <li className={index === recipe.stepIndex ? "current" : ""} key={step.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{step.title}</p>
                  {step.durationSeconds !== undefined && <b>{formatSeconds(step.durationSeconds)}</b>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {recipe.view === "ingredients" && (
          <ul className="ingredient-list">
            {ingredients.map((ingredient, index) => (
              <li key={ingredient.name}>
                <label className={checked.includes(index) ? "checked" : ""}>
                  <input
                    type="checkbox"
                    checked={checked.includes(index)}
                    onChange={() => toggleIngredient(index)}
                  />
                  <span className="ingredient-name">{ingredient.name}</span>
                  <span className="ingredient-amount">{ingredient.amount}</span>
                  {ingredient.note !== undefined && <em>{ingredient.note}</em>}
                </label>
              </li>
            ))}
          </ul>
        )}

        {recipe.view === "steps" && currentStep !== undefined && (
          <article
            className="step-card"
            data-testid="step-card"
            style={{ "--zoom": recipe.zoom } as CSSProperties}
          >
            <div className="step-card-head">
              <span>
                STEP {recipe.stepIndex + 1} / {steps.length}
              </span>
              {currentStep.durationSeconds !== undefined && (
                <b>TIMER {formatSeconds(currentStep.durationSeconds)}</b>
              )}
            </div>
            <h2>{currentStep.title}</h2>
            <p className="step-detail">{currentStep.detail}</p>
            <div className="step-card-actions">
              <button type="button" onClick={() => run("move_step", { direction: "previous" })}>
                ← PREVIOUS
              </button>
              {currentStep.durationSeconds !== undefined && recipe.timer === null && (
                <button type="button" className="primary" onClick={() => run("start_step_timer")}>
                  START TIMER
                </button>
              )}
              {recipe.timer !== null && !recipe.timer.done && (
                <button type="button" onClick={() => run("stop_timer")}>
                  STOP TIMER
                </button>
              )}
              <button type="button" onClick={() => run("move_step", { direction: "next" })}>
                NEXT →
              </button>
            </div>
          </article>
        )}

        <aside className="cook-side">
          <div className="side-panel">
            <div className="side-heading">
              <span>ZOOM</span>
              <strong data-testid="zoom-level">{recipe.zoom.toFixed(1)}x</strong>
            </div>
            <div className="zoom-controls">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => run("adjust_zoom", { direction: "out" })}
              >
                −
              </button>
              <button type="button" onClick={() => run("adjust_zoom", { direction: "reset" })}>
                RESET
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => run("adjust_zoom", { direction: "in" })}
              >
                +
              </button>
            </div>
          </div>

          <div
            className={`side-panel timer-chip ${recipe.timer?.done === true ? "done" : ""}`}
            data-testid="timer"
          >
            <div className="side-heading">
              <span>TIMER</span>
              <strong>
                {recipe.timer === null
                  ? "IDLE"
                  : recipe.timer.done
                    ? "DONE"
                    : formatSeconds(recipe.timer.remainingSeconds)}
              </strong>
            </div>
            {recipe.timer !== null && <p>{recipe.timer.label}</p>}
          </div>

          <div className="side-panel voice-panel">
            <div className="side-heading">
              <span>VOICE</span>
              <strong>{voice.supported ? (listening ? "LISTENING" : "READY") : "UNAVAILABLE"}</strong>
            </div>
            <button
              className={`mic-toggle ${listening ? "listening" : ""}`}
              data-testid="mic-toggle"
              type="button"
              disabled={!ready}
              onClick={toggleMic}
            >
              {listening ? "◉ MIC ON — TAP TO STOP" : "◎ MIC OFF — TAP TO TALK"}
            </button>
            <p className="transcript" data-testid="transcript">
              {transcript}
            </p>
            <p className="voice-hints">
              try: “next step” · “step three” · “ingredients” · “zoom in” · “start timer”
            </p>
          </div>

          {error !== null && (
            <div className="cook-error" role="alert">
              {error}
            </div>
          )}
        </aside>
      </section>

      <section className="cook-log" aria-label="Activity log">
        <div className="side-heading">
          <span>ACTIVITY LOG</span>
          <strong>LIVE EFFECT STREAM</strong>
        </div>
        <div className="cook-log-grid" data-testid="voice-log">
          {recipe.logs.slice(-6).map((entry) => (
            <div className="cook-log-entry" key={entry.id}>
              <span>{String(entry.id).padStart(2, "0")}</span>
              <b>{entry.actor}</b>
              <p>{entry.message}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
