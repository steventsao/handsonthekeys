import { useEffect, useState } from "react"
import type { BrowserMetronomeSnapshot } from "./browserMetronome.ts"
import type { SessionInstrumentTileView, SessionInstrumentView } from "./sessionInstrumentView.ts"
import type { StudioState } from "./Studio.ts"
import { controlInstrumentLearningTransport, setStudioTempo } from "./studioRuntime.ts"
import { ThreeMetronome } from "./ThreeMetronome.tsx"
import {
  updateStudioPresentationEngine,
  updateStudioPresentationOperation,
  updateStudioPresentationSurface,
  updateStudioPresentationTransport
} from "./studioPresentation.ts"

interface SessionModeProps {
  readonly state: StudioState
  readonly instruments: SessionInstrumentView
  readonly toolsReady: boolean
  readonly metronome: BrowserMetronomeSnapshot
  readonly metronomeError: string | null
  readonly engineStatus: "loading" | "ready" | "error"
  readonly engineMessage: string | null
  readonly playing: boolean
  readonly playheadBeat: number
  readonly onToggleMetronome: () => Promise<void>
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error
    ? cause.message
    : typeof cause === "object" && cause !== null && "message" in cause
      ? String(cause.message)
      : String(cause)

const beatLabel = (beat: number): string =>
  Number.isInteger(beat) ? String(beat) : String(Math.round(beat * 100) / 100)

const activityLabel = (instrument: SessionInstrumentTileView): string => {
  switch (instrument.activity) {
    case "playing_now":
      return "Playing now"
    case "muted":
      return "Muted"
    case "ready":
      return "Ready"
    case "silent":
      return "Not sounding"
    case "idle":
      return "Idle"
  }
}

const instrumentDetail = (instrument: SessionInstrumentTileView): string => {
  if (instrument.instrument_id === "metronome") return "Shared Studio clock"
  if (instrument.current_segment !== null) return instrument.current_segment.track_name
  if (instrument.next_segment !== null) return `Waiting for ${instrument.next_segment.track_name}`
  return instrument.available ? "No segment at this beat" : "No mapped MIDI segment"
}

const instrumentPrediction = (
  instrument: SessionInstrumentTileView,
  metronome: BrowserMetronomeSnapshot
): { readonly label: string; readonly value: string } | null => {
  if (instrument.instrument_id === "metronome") {
    if (instrument.playing_now) {
      return {
        label: "BEAT",
        value: `${metronome.beat} / ${metronome.meter[0]}`
      }
    }
    return null
  }
  if (instrument.next_segment !== null) {
    return {
      label: "NEXT",
      value: `BEAT ${beatLabel(instrument.next_segment.start_beat)}`
    }
  }
  if (instrument.current_segment !== null) {
    return {
      label: "RANGE",
      value: `${beatLabel(instrument.current_segment.start_beat)}–${beatLabel(instrument.current_segment.end_beat)}`
    }
  }
  return null
}

const InstrumentArt = ({
  instrument,
  metronome
}: {
  readonly instrument: SessionInstrumentTileView
  readonly metronome: BrowserMetronomeSnapshot
}) => {
  if (instrument.instrument_id === "piano") {
    return (
      <div className="session-piano-keys" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} />
        ))}
        {Array.from({ length: 5 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
    )
  }
  if (instrument.instrument_id === "drums") {
    return (
      <div className="session-drum-kit" aria-hidden="true">
        <span className="session-drum-kick" />
        <span className="session-drum-snare" />
        <span className="session-drum-tom" />
        <i className="session-drum-cymbal" />
      </div>
    )
  }
  return (
    <div
      className="session-card-metronome"
      data-testid="session-metronome"
      data-beat={metronome.beat}
      data-accented={metronome.accented}
      role="img"
      aria-label={
        instrument.playing_now
          ? `Metronome running at ${metronome.bpm} beats per minute, beat ${metronome.beat} of ${metronome.meter[0]}`
          : `Metronome stopped at ${metronome.bpm} beats per minute`
      }
    >
      <ThreeMetronome
        running={instrument.playing_now}
        bpm={metronome.bpm}
        meter={metronome.meter}
        beat={metronome.beat}
        accented={metronome.accented}
        sequence={metronome.sequence}
      />
    </div>
  )
}

export const SessionMode = ({
  state,
  instruments,
  toolsReady,
  metronome,
  metronomeError,
  engineStatus,
  engineMessage,
  playing,
  playheadBeat,
  onToggleMetronome
}: SessionModeProps) => {
  const [tempo, setTempo] = useState(String(state.bpm))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = metronome.status === "running"
  const [numerator, denominator] = state.timeSignature

  useEffect(() => setTempo(String(state.bpm)), [state.bpm])

  useEffect(() => {
    updateStudioPresentationSurface("session", "instrument_rack", toolsReady)
    updateStudioPresentationEngine(engineStatus, engineMessage)
    updateStudioPresentationTransport(
      playing ? "playing" : running ? "click_only" : playheadBeat > 0 ? "paused" : "stopped",
      playheadBeat
    )
  }, [engineMessage, engineStatus, playheadBeat, playing, running, toolsReady])

  useEffect(() => {
    updateStudioPresentationOperation(busy, error ?? metronomeError)
  }, [busy, error, metronomeError])

  const run = async (label: string, operation: () => Promise<unknown>) => {
    if (busy !== null) return
    setBusy(label)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(null)
    }
  }

  const saveTempo = () => {
    const bpm = Number(tempo)
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
      setError("Tempo must be between 40 and 240 BPM.")
      return
    }
    if (bpm !== state.bpm) void run("tempo", () => setStudioTempo(bpm, state.revision))
  }

  return (
    <main
      className="learning-shell session-shell"
      data-testid="session-mode"
      data-metronome-status={metronome.status}
      data-metronome-sequence={metronome.sequence}
      data-project-revision={instruments.project_revision}
    >
      <section className="session-stage" aria-label="Shared transport instrument session">
        <header className="session-project">
          <div className="session-project-transport" aria-label="Session musical transport">
            <button
              type="button"
              aria-label={playing ? "Pause lesson" : "Play lesson"}
              disabled={busy !== null || engineStatus !== "ready" || state.tracks.length === 0}
              onClick={() =>
                void run("transport", () =>
                  controlInstrumentLearningTransport(playing ? { action: "pause" } : { action: "play" })
                )
              }
            >
              <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
              {playing ? "PAUSE" : "PLAY"}
            </button>
            <button
              type="button"
              aria-label="Stop lesson"
              disabled={busy !== null || engineStatus !== "ready" || state.tracks.length === 0}
              onClick={() =>
                void run("transport", () => controlInstrumentLearningTransport({ action: "stop" }))
              }
            >
              <span aria-hidden="true">■</span>
              STOP
            </button>
          </div>
        </header>

        <section className="session-instrument-grid" aria-label="Piano, Drums, and Metronome">
          {instruments.instruments.map((instrument, index) => {
            const prediction = instrumentPrediction(instrument, metronome)
            return (
              <article
                className="session-instrument-card"
                data-testid={`session-instrument-${instrument.instrument_id}`}
                data-instrument={instrument.instrument_id}
                data-activity={instrument.activity}
                data-playing-now={instrument.playing_now}
                data-muted={instrument.muted}
                data-idle-no-current-segment={instrument.idle_no_current_segment}
                data-current-segment-id={instrument.current_segment?.clip_id}
                data-next-segment-id={instrument.next_segment?.clip_id}
                aria-label={`${instrument.label}: ${activityLabel(instrument)}. ${instrumentDetail(instrument)}.`}
                key={instrument.instrument_id}
              >
                <header>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{instrument.label}</strong>
                  <i aria-hidden="true" />
                </header>
                <div className="session-instrument-art">
                  <InstrumentArt instrument={instrument} metronome={metronome} />
                </div>
                <div className="session-instrument-state">
                  <strong>{activityLabel(instrument)}</strong>
                  {(instrument.current_segment !== null || instrument.next_segment !== null) && (
                    <span>
                      {instrument.current_segment?.track_name ?? instrument.next_segment?.track_name}
                    </span>
                  )}
                </div>
                {prediction !== null && (
                  <footer>
                    <span>{prediction.label}</span>
                    <strong>{prediction.value}</strong>
                  </footer>
                )}
              </article>
            )
          })}
        </section>

        <footer className="session-console">
          <div className="session-beat-panel">
            <div className="session-beat-readout" aria-label={`Beat ${metronome.beat || 0} of ${numerator}`}>
              <strong>
                {running && metronome.beat > 0 ? String(metronome.beat).padStart(2, "0") : "00"}
              </strong>
              <span>/ {String(numerator).padStart(2, "0")}</span>
            </div>
            <div
              className="session-beat-strip"
              role="group"
              aria-label={`${numerator}/${denominator} meter beat position`}
            >
              {Array.from({ length: numerator }, (_, index) => (
                <span
                  className={running && metronome.beat === index + 1 ? "active" : ""}
                  data-downbeat={index === 0}
                  key={index}
                >
                  {index + 1}
                </span>
              ))}
            </div>
          </div>

          <div className="session-controls">
            <label className="session-tempo">
              <span>BPM</span>
              <span className="session-tempo-value">
                <input
                  aria-label="Session tempo in beats per minute"
                  inputMode="numeric"
                  min="40"
                  max="240"
                  type="number"
                  value={tempo}
                  onChange={(event) => setTempo(event.target.value)}
                  onBlur={saveTempo}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur()
                  }}
                />
              </span>
              {metronome.ramp !== null && (
                <small>
                  {metronome.ramp.bpmPerBar > 0 ? "+" : ""}
                  {metronome.ramp.bpmPerBar}/BAR · {metronome.ramp.barCount} BARS
                </small>
              )}
            </label>
            <div className="session-meter">
              <span>METER</span>
              <strong>
                {numerator}/{denominator}
              </strong>
            </div>
            <button
              className={running ? "session-metronome-toggle running" : "session-metronome-toggle"}
              type="button"
              aria-label={running ? "Stop metronome" : "Start metronome"}
              aria-pressed={running}
              disabled={busy !== null}
              onClick={() => void run("metronome", onToggleMetronome)}
            >
              <span aria-hidden="true">{running ? "■" : "▶"}</span>
              <small>{busy === "metronome" ? "WAIT" : running ? "STOP CLICK" : "START CLICK"}</small>
            </button>
          </div>
        </footer>

        <div className="session-status" role="status" aria-live="polite">
          <span>
            {running
              ? `${
                  playing
                    ? "Shared metronome and musical tracks running"
                    : "Shared metronome running in click-only transport mode"
                } · bar ${metronome.bar || 1}, beat ${metronome.beat || 1} · ${metronome.bpm} BPM${
                  metronome.ramp === null ? "." : " · practice ramp active."
                }`
              : metronome.status === "audio_locked"
                ? "Audio is locked. Press Start once."
                : "Metronome stopped."}
          </span>
        </div>
      </section>

      {(error !== null || metronomeError !== null) && (
        <div className="learning-error" role="alert">
          <strong>SESSION CHECK</strong>
          <span>{error ?? metronomeError}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
    </main>
  )
}
