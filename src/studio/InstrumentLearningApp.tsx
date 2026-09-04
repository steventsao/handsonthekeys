import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { createBrowserMetronome, type BrowserMetronomeSnapshot } from "./browserMetronome.ts"
import {
  canonicalInstrumentLearningUrl,
  initialInstrumentLearningState,
  instrumentTabViewOf,
  type InstrumentLearningMode,
  type InstrumentLearningState,
  type LearningMetronomeRamp,
  type LearningMetronomeController,
  type LearningTransportCommand
} from "./InstrumentLearning.ts"
import { LearningModeSwitch } from "./LearningModeSwitch.tsx"
import { SessionMode } from "./SessionMode.tsx"
import { sessionInstrumentViewOf } from "./sessionInstrumentView.ts"
import { initialStudioState, type StudioState } from "./Studio.ts"
import { StudioApp, type SharedLearningTransportState } from "./StudioApp.tsx"
import { createStudioPlayoutAdapter } from "./studioPlayout.ts"
import {
  attachLearningMetronome,
  configureInstrumentLesson,
  controlInstrumentLearningTransport,
  loadStudioShareFromLocation,
  setInstrumentLearningMetronome,
  setInstrumentLearningMode,
  setStudioTempo,
  studioToolsReady,
  subscribeInstrumentLearning,
  subscribeStudio
} from "./studioRuntime.ts"
import {
  updateStudioPresentationEngine,
  updateStudioPresentationLoop,
  updateStudioPresentationOperation,
  updateStudioPresentationSessionInstruments,
  updateStudioPresentationSurface,
  updateStudioPresentationTransport
} from "./studioPresentation.ts"

const NotationTabScore = lazy(() =>
  import("./NotationTabScore.tsx").then((module) => ({ default: module.NotationTabScore }))
)

const messageOf = (cause: unknown): string =>
  cause instanceof Error
    ? cause.message
    : typeof cause === "object" && cause !== null && "message" in cause
      ? String(cause.message)
      : String(cause)

const melodicTracksOf = (state: StudioState) =>
  state.tracks.filter(
    (track) =>
      track.kind === "midi" &&
      track.clips.some(
        (clip) => clip.kind === "midi" && (clip.midiChannel ?? 0) !== 9 && clip.notes.length > 0
      )
  )

interface TabLearningAppProps {
  readonly learning: InstrumentLearningState
  readonly metronome: BrowserMetronomeSnapshot
  readonly transport: SharedLearningTransportState
  readonly onToggleMetronome: () => Promise<void>
  readonly modeError?: string | null
}

const TabLearningApp = ({
  learning,
  metronome,
  transport,
  onToggleMetronome,
  modeError = null
}: TabLearningAppProps) => {
  const initialState = useMemo(initialStudioState, [])
  const [state, setState] = useState(initialState)
  const [toolsReady, setToolsReady] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trackId, setTrackId] = useState(learning.lesson.trackId)
  const [startBeat, setStartBeat] = useState(String(learning.lesson.startBeat))
  const [endBeat, setEndBeat] = useState(String(learning.lesson.endBeat))
  const [handPosition, setHandPosition] = useState(String(learning.lesson.handPosition))
  const [tempo, setTempo] = useState(String(initialState.bpm))
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const { engineStatus, engineMessage, playing, playheadSeconds: playhead, playheadBeat } = transport

  useEffect(() => {
    const unsubscribe = subscribeStudio(setState)
    void studioToolsReady.then(
      () => setToolsReady(true),
      (cause: unknown) => setError(messageOf(cause))
    )
    return unsubscribe
  }, [])

  useEffect(() => setTempo(String(state.bpm)), [state.bpm])

  useEffect(() => {
    if (modeError !== null) setError(modeError)
  }, [modeError])

  useEffect(() => {
    setTrackId(learning.lesson.trackId)
    setStartBeat(String(learning.lesson.startBeat))
    setEndBeat(String(learning.lesson.endBeat))
    setHandPosition(String(learning.lesson.handPosition))
  }, [learning.lesson])

  const tab = useMemo(() => instrumentTabViewOf(state, learning), [learning, state])
  const melodicTracks = useMemo(() => melodicTracksOf(state), [state])
  const activeEvent = tab.events.find(
    (event) => playheadBeat >= event.start_beat && playheadBeat < event.start_beat + event.duration_beats
  )

  useEffect(() => {
    if (tab.source_track.track_id.length > 0 && !melodicTracks.some((track) => track.id === trackId)) {
      setTrackId(tab.source_track.track_id)
    }
  }, [melodicTracks, tab.source_track.track_id, trackId])

  useEffect(() => {
    if (!playing || activeEvent === undefined) return
    const scroll = tabScrollRef.current
    const note = scroll?.querySelector<HTMLElement>(`[data-tab-note-id="${activeEvent.note_id}"]`)
    if (scroll === null || scroll === undefined || note === null || note === undefined) return
    const target = Math.max(0, note.offsetLeft - scroll.clientWidth * 0.35)
    scroll.scrollTo({ left: target, behavior: "auto" })
  }, [activeEvent, playing])

  useEffect(() => {
    updateStudioPresentationSurface("tab", "fretboard", toolsReady)
  }, [toolsReady])

  useEffect(() => {
    updateStudioPresentationEngine(engineStatus, engineMessage)
  }, [engineMessage, engineStatus])

  useEffect(() => {
    updateStudioPresentationOperation(busy, error)
  }, [busy, error])

  useEffect(() => {
    updateStudioPresentationTransport(
      playing
        ? "playing"
        : metronome.status === "running"
          ? "click_only"
          : playhead > 0
            ? "paused"
            : "stopped",
      playheadBeat
    )
  }, [metronome.status, playhead, playheadBeat, playing])

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

  const control = (command: LearningTransportCommand) =>
    void run("transport", () => controlInstrumentLearningTransport(command))

  const toggleMetronome = () => void run("metronome", onToggleMetronome)

  const saveLesson = () => {
    const start = Number(startBeat)
    const end = Number(endBeat)
    const position = Number(handPosition)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setError("Choose an end beat after the start beat.")
      return
    }
    void run("lesson", () =>
      configureInstrumentLesson(
        {
          instrument: "guitar",
          tuning: "standard",
          trackId,
          startBeat: start,
          endBeat: end,
          handPosition: position,
          maxFret: learning.lesson.maxFret
        },
        learning.lessonRevision
      )
    )
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
    <main className="learning-shell" data-testid="instrument-learning-app">
      <section className="learning-layout">
        <aside className="lesson-setup" aria-label="Tab lesson setup">
          <div className="lesson-context" aria-label="Guitar in standard tuning">
            <span>GUITAR</span>
            <strong>E A D G B E</strong>
          </div>

          <label>
            <span>SOURCE TRACK</span>
            <select value={trackId} onChange={(event) => setTrackId(event.target.value)}>
              {melodicTracks.map((track) => (
                <option value={track.id} key={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </label>

          <div className="lesson-number-row">
            <label>
              <span>START BEAT</span>
              <input
                inputMode="decimal"
                value={startBeat}
                onChange={(event) => setStartBeat(event.target.value)}
              />
            </label>
            <label>
              <span>END BEAT</span>
              <input
                inputMode="decimal"
                value={endBeat}
                onChange={(event) => setEndBeat(event.target.value)}
              />
            </label>
          </div>

          <label>
            <span>HAND POSITION</span>
            <input
              type="range"
              min="0"
              max="20"
              value={handPosition}
              onChange={(event) => setHandPosition(event.target.value)}
            />
            <output>FRET {handPosition}</output>
          </label>

          <button
            className="lesson-apply"
            type="button"
            disabled={busy !== null || trackId.length === 0}
            onClick={saveLesson}
          >
            {busy === "lesson" ? "UPDATING…" : "UPDATE TAB"}
          </button>
        </aside>

        <section className="tab-workspace" aria-label="Guitar standard notation and tablature workspace">
          <header className="tab-titlebar">
            <div>
              <h1>{state.title}</h1>
              <p>
                BEATS {tab.range.start_beat}–{tab.range.end_beat} ·{" "}
                {tab.source_track.track_id.length > 0 ? tab.source_track.name : "TRACK —"}
              </p>
            </div>
            <dl>
              <div>
                <dt>PROJECT</dt>
                <dd>REV {state.revision}</dd>
              </div>
              <div>
                <dt>NOTES</dt>
                <dd>{tab.summary.event_count}</dd>
              </div>
              <div>
                <dt>TUNING</dt>
                <dd>E A D G B E</dd>
              </div>
            </dl>
          </header>

          <section className="learning-transport" aria-label="Shared Studio transport controls">
            <button
              className={metronome.status === "running" ? "lesson-metronome active" : "lesson-metronome"}
              type="button"
              aria-label={metronome.status === "running" ? "Stop metronome" : "Start metronome"}
              aria-pressed={metronome.status === "running"}
              title={
                metronome.status === "running" ? "Shared transport metronome running" : "Start metronome"
              }
              disabled={busy !== null}
              onClick={toggleMetronome}
            >
              ♩
            </button>
            <button
              className={learning.transportLoop.enabled ? "lesson-loop active" : "lesson-loop"}
              type="button"
              data-testid="transport-loop-toggle"
              aria-label={learning.transportLoop.enabled ? "Disable lesson loop" : "Loop lesson range"}
              aria-pressed={learning.transportLoop.enabled}
              title={
                learning.transportLoop.enabled
                  ? `Looping beats ${learning.transportLoop.startBeat}–${learning.transportLoop.endBeat}`
                  : `Loop lesson beats ${tab.range.start_beat}–${tab.range.end_beat}`
              }
              disabled={engineStatus !== "ready" || busy !== null}
              onClick={() =>
                void run("transport", () =>
                  controlInstrumentLearningTransport(
                    learning.transportLoop.enabled
                      ? {
                          action: "set_loop",
                          enabled: false,
                          startBeat: learning.transportLoop.startBeat,
                          endBeat: learning.transportLoop.endBeat
                        }
                      : {
                          action: "set_loop",
                          enabled: true,
                          startBeat: tab.range.start_beat,
                          endBeat: tab.range.end_beat
                        },
                    learning.lessonRevision
                  )
                )
              }
            >
              ↻ LOOP
            </button>
            <button
              type="button"
              aria-label="Restart lesson"
              disabled={engineStatus !== "ready" || busy !== null}
              onClick={() =>
                control({
                  action: "play_range",
                  startBeat: tab.range.start_beat,
                  endBeat: tab.range.end_beat
                })
              }
            >
              ↶
            </button>
            <button
              className="lesson-play"
              type="button"
              aria-label={playing ? "Pause lesson" : "Play lesson"}
              disabled={engineStatus !== "ready" || busy !== null || tab.events.length === 0}
              onClick={() => control(playing ? { action: "pause" } : { action: "play" })}
            >
              {playing ? "Ⅱ PAUSE" : "▶ PLAY"}
            </button>
            <button
              type="button"
              aria-label="Stop lesson"
              disabled={engineStatus !== "ready" || busy !== null}
              onClick={() => control({ action: "stop" })}
            >
              ■
            </button>
            <div className="lesson-playhead">
              <span>BEAT</span>
              <strong>{playheadBeat.toFixed(2)}</strong>
            </div>
            <label className="lesson-tempo">
              <span>TEMPO</span>
              <input
                aria-label="Lesson tempo in beats per minute"
                inputMode="numeric"
                value={tempo}
                onChange={(event) => setTempo(event.target.value)}
                onBlur={saveTempo}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur()
                }}
              />
              <strong>BPM</strong>
            </label>
          </section>

          <section className="now-playing-note" aria-live="polite">
            <small>NOTE</small>
            <strong>{activeEvent?.pitch_name ?? "—"}</strong>
            {activeEvent !== undefined && (
              <span>
                {activeEvent.playable
                  ? `STRING ${activeEvent.string_number} · FRET ${activeEvent.fret}`
                  : "OUT OF RANGE"}
              </span>
            )}
          </section>

          <div className="tab-scroll" data-testid="tab-scroll" tabIndex={0} ref={tabScrollRef}>
            <Suspense
              fallback={
                <div className="notation-loading" role="status">
                  LOADING…
                </div>
              }
            >
              <NotationTabScore
                tab={tab}
                activeEventId={activeEvent?.note_id}
                playheadBeat={playheadBeat}
                onSeek={(beat) => control({ action: "seek", beat })}
              />
            </Suspense>
          </div>

          <footer className="tab-statusbar">
            <span>
              {tab.summary.playable_event_count} PLAYABLE · {tab.summary.unplayable_event_count} OUT OF RANGE
            </span>
            {tab.rights.attribution !== null && (
              <a
                className="lesson-provenance"
                data-testid="lesson-provenance"
                href={tab.rights.attribution.license_url}
                target="_blank"
                rel="noreferrer"
                title={`${tab.rights.attribution.license_name} · ${tab.rights.attribution.creator}`}
                aria-label={`Rights: ${tab.rights.attribution.license_name}`}
              >
                RIGHTS
              </a>
            )}
          </footer>
        </section>
      </section>

      {(error !== null || engineStatus === "error") && (
        <div className="learning-error" role="alert">
          <strong>ERROR</strong>
          <span>{error ?? engineMessage ?? "The browser Studio audio engine could not start."}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
    </main>
  )
}

export const InstrumentLearningApp = () => {
  const fallbackStudio = useMemo(initialStudioState, [])
  const fallbackLearning = useMemo(() => initialInstrumentLearningState(fallbackStudio), [fallbackStudio])
  const fallbackPlayheadSeconds =
    fallbackLearning.mode === "tab" ? (fallbackLearning.lesson.startBeat * 60) / fallbackStudio.bpm : 0
  const [studio, setStudio] = useState(fallbackStudio)
  const [learning, setLearning] = useState(fallbackLearning)
  const startupPlayheadSeconds =
    fallbackLearning.mode === "tab" ? (learning.lesson.startBeat * 60) / studio.bpm : 0
  const [toolsReady, setToolsReady] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)
  const [metronomeError, setMetronomeError] = useState<string | null>(null)
  const [playoutAdapter] = useState(() =>
    createStudioPlayoutAdapter({
      initial: {
        bpm: fallbackStudio.bpm,
        meter: fallbackStudio.timeSignature,
        playheadSeconds: fallbackPlayheadSeconds
      }
    })
  )
  const [metronome] = useState(() =>
    createBrowserMetronome({
      transport: playoutAdapter,
      initial: {
        bpm: fallbackStudio.bpm,
        meter: fallbackStudio.timeSignature,
        ramp: learning.metronomeRamp
      }
    })
  )
  const [metronomeSnapshot, setMetronomeSnapshot] = useState(() => metronome.snapshot())
  const [transportState, setTransportState] = useState<SharedLearningTransportState>({
    engineStatus: "loading",
    engineMessage: null,
    playing: false,
    playheadSeconds: fallbackPlayheadSeconds,
    playheadBeat: fallbackLearning.mode === "tab" ? fallbackLearning.lesson.startBeat : 0
  })
  const [transportHostMounted, setTransportHostMounted] = useState(
    () => fallbackStudio.tracks.length > 0 || fallbackLearning.mode !== "session"
  )
  const sessionInstruments = useMemo(
    () =>
      sessionInstrumentViewOf(studio, {
        playheadBeat: transportState.playheadBeat,
        musicalPlaybackRunning: transportState.playing,
        metronomeEnabled: metronomeSnapshot.enabled,
        metronomeRunning: metronomeSnapshot.status === "running"
      }),
    [
      metronomeSnapshot.enabled,
      metronomeSnapshot.status,
      studio,
      transportState.playheadBeat,
      transportState.playing
    ]
  )
  const studioRef = useRef(studio)
  const shareLoadStartedRef = useRef(false)

  studioRef.current = studio

  useEffect(() => subscribeInstrumentLearning(setLearning), [])
  useEffect(() => subscribeStudio(setStudio), [])
  useEffect(() => metronome.subscribe(setMetronomeSnapshot), [metronome])

  useEffect(() => {
    if (studio.tracks.length > 0 || learning.mode !== "session") setTransportHostMounted(true)
  }, [learning.mode, studio.tracks.length])

  useEffect(() => updateStudioPresentationSessionInstruments(sessionInstruments), [sessionInstruments])

  useEffect(() => {
    updateStudioPresentationLoop(
      learning.transportLoop.enabled,
      learning.transportLoop.startBeat,
      learning.transportLoop.endBeat
    )
  }, [learning.transportLoop])

  useEffect(() => {
    void studioToolsReady.then(
      () => setToolsReady(true),
      (cause: unknown) => setModeError(messageOf(cause))
    )
  }, [])

  useEffect(() => {
    let active = true
    let detach: (() => void) | undefined
    const controller: LearningMetronomeController = {
      setMetronomeEnabled: async (enabled, ramp: LearningMetronomeRamp | null) => {
        const current = studioRef.current
        await metronome.sync({ enabled, bpm: current.bpm, meter: current.timeSignature, ramp })
      }
    }
    void attachLearningMetronome(controller).then((cleanup) => {
      if (active) detach = cleanup
      else cleanup()
    })
    return () => {
      active = false
      detach?.()
    }
  }, [metronome])

  useEffect(() => {
    let active = true
    void metronome
      .sync({
        enabled: learning.metronomeEnabled,
        bpm: studio.bpm,
        meter: studio.timeSignature,
        ramp: learning.metronomeRamp
      })
      .then(() => {
        if (active) setMetronomeError(null)
      })
      .catch((cause: unknown) => {
        if (active && learning.metronomeEnabled) setMetronomeError(messageOf(cause))
      })
    return () => {
      active = false
    }
  }, [learning.metronomeEnabled, learning.metronomeRamp, metronome, studio.bpm, studio.timeSignature])

  useEffect(
    () => () => {
      metronome.dispose()
      playoutAdapter.dispose()
    },
    [metronome, playoutAdapter]
  )

  useEffect(() => {
    if (shareLoadStartedRef.current) return
    shareLoadStartedRef.current = true
    void loadStudioShareFromLocation().catch((cause: unknown) => setModeError(messageOf(cause)))
  }, [])

  useEffect(() => {
    const legacySongSlug = window.location.pathname === "/" ? undefined : studio.songSlug
    const nextUrl = canonicalInstrumentLearningUrl(
      learning.mode,
      window.location.search,
      window.location.hash,
      legacySongSlug
    )
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (currentUrl !== nextUrl) {
      window.history.replaceState(window.history.state, "", nextUrl)
    }
    document.title =
      learning.mode === "daw" ? "Studio Mode" : learning.mode === "tab" ? "Tab Mode" : "Session Mode"
  }, [learning.mode, studio.songSlug])

  const changeMode = (mode: InstrumentLearningMode) => {
    setModeError(null)
    void setInstrumentLearningMode(mode, learning.lessonRevision).catch((cause: unknown) =>
      setModeError(messageOf(cause))
    )
  }

  const toggleMetronome = async () => {
    const enabled = metronomeSnapshot.status !== "running"
    setMetronomeError(null)
    if (enabled) await metronome.unlock()
    await setInstrumentLearningMetronome(enabled, learning.lessonRevision)
  }

  return (
    <div
      className="learning-app-shell"
      data-mode={learning.mode}
      data-project-id={studio.projectId}
      data-project-revision={studio.revision}
    >
      <header className="learning-header learning-app-header" data-testid="learning-mode-shell">
        <LearningModeSwitch mode={learning.mode} onChange={changeMode} />
      </header>

      <div className="learning-mode-surface">
        {learning.mode === "session" && (
          <SessionMode
            state={studio}
            instruments={sessionInstruments}
            toolsReady={toolsReady}
            metronome={metronomeSnapshot}
            metronomeError={metronomeError}
            engineStatus={transportState.engineStatus}
            engineMessage={transportState.engineMessage}
            playing={transportState.playing}
            playheadBeat={transportState.playheadBeat}
            onToggleMetronome={toggleMetronome}
          />
        )}
        {learning.mode === "tab" && (
          <TabLearningApp
            learning={learning}
            metronome={metronomeSnapshot}
            transport={transportState}
            onToggleMetronome={toggleMetronome}
            modeError={modeError}
          />
        )}
        {transportHostMounted && (
          <StudioApp
            learning={learning}
            active={learning.mode === "daw"}
            metronome={metronomeSnapshot}
            onToggleMetronome={toggleMetronome}
            playoutAdapter={playoutAdapter}
            initialPlayheadSeconds={startupPlayheadSeconds}
            onTransportState={setTransportState}
            modeError={modeError}
          />
        )}
      </div>
    </div>
  )
}
