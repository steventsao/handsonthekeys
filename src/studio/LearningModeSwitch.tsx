import type { InstrumentLearningMode } from "./InstrumentLearning.ts"

interface LearningModeSwitchProps {
  readonly mode: InstrumentLearningMode
  readonly onChange: (mode: InstrumentLearningMode) => void
}

export const LearningModeSwitch = ({ mode, onChange }: LearningModeSwitchProps) => (
  <nav className="learning-mode-switch" aria-label="Learning workspace mode">
    <button
      type="button"
      className={mode === "session" ? "active" : ""}
      aria-label="SESSION MODE"
      aria-pressed={mode === "session"}
      onClick={() => onChange("session")}
    >
      SESSION
    </button>
    <button
      type="button"
      className={mode === "tab" ? "active" : ""}
      aria-label="TAB MODE"
      aria-pressed={mode === "tab"}
      onClick={() => onChange("tab")}
    >
      TAB
    </button>
    <button
      type="button"
      className={mode === "daw" ? "active" : ""}
      aria-label="STUDIO MODE"
      aria-pressed={mode === "daw"}
      onClick={() => onChange("daw")}
    >
      STUDIO
    </button>
  </nav>
)
