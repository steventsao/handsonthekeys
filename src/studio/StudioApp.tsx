import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"
import type { BrowserMetronomeSnapshot } from "./browserMetronome.ts"
import { DawTimeline, type DawTimelineHandle } from "./DawTimeline.tsx"
import type { InstrumentLearningState, LearningTransportController } from "./InstrumentLearning.ts"
import { initialStudioState, midiName, type StudioClip } from "./Studio.ts"
import { resolveClipAudioUrl } from "./audioAssets.ts"
import { initialBrowserRecordingState, type BrowserRecordingTake } from "./BrowserRecording.ts"
import type { StudioShareReceipt } from "./StudioShareApi.ts"
import {
  attachLearningTransport,
  applyStudioPreview,
  controlInstrumentLearningTransport,
  createStudioShareLink,
  discardStudioPreview,
  getBrowserRecordingBlob,
  moveStudioClip,
  redoStudioEdit,
  selectStudioTimeRange,
  setStudioTempo,
  setStudioTrackMix,
  stageStudioKaraokeGuide,
  stageStudioPart,
  stageStudioTransposition,
  startBrowserRecordingFromHumanGesture,
  studioModelContextMode,
  studioToolCount,
  studioToolsReady,
  stopBrowserRecordingAndCommit,
  subscribeBrowserRecording,
  subscribeStudioShare,
  subscribeStudio,
  undoStudioEdit
} from "./studioRuntime.ts"
import {
  configureKaraokeSession,
  failKaraokeSession,
  getKaraokeSessionView,
  startKaraokeMicrophone,
  stopKaraokeMicrophone,
  subscribeKaraokeSession
} from "./karaokeSession.ts"
import { clearStudioViewFocus, subscribeStudioViewFocus, type StudioViewFocus } from "./studioView.ts"
import {
  studioTransportBeatAtSeconds,
  studioTransportSecondsAtBeat,
  type StudioPlayoutAdapter
} from "./studioPlayout.ts"
import {
  getStudioPresentationView,
  studioPresentationActionLabel,
  subscribeStudioPresentation,
  updateStudioPresentationEngine,
  updateStudioPresentationLyrics,
  updateStudioPresentationMicrophone,
  updateStudioPresentationOperation,
  updateStudioPresentationSurface,
  updateStudioPresentationTransport
} from "./studioPresentation.ts"

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`
}

const errorMessage = (cause: unknown) => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === "object" && cause !== null && "message" in cause) return String(cause.message)
  return String(cause)
}

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

interface StudioAppProps {
  readonly learning: InstrumentLearningState
  readonly active: boolean
  readonly metronome: BrowserMetronomeSnapshot
  readonly onToggleMetronome: () => Promise<void>
  readonly playoutAdapter: StudioPlayoutAdapter
  readonly initialPlayheadSeconds: number
  readonly onTransportState: (state: SharedLearningTransportState) => void
  readonly modeError?: string | null
}

export interface SharedLearningTransportState {
  readonly engineStatus: "loading" | "ready" | "error"
  readonly engineMessage: string | null
  readonly playing: boolean
  readonly playheadSeconds: number
  readonly playheadBeat: number
}

export const StudioApp = ({
  learning,
  active,
  metronome,
  onToggleMetronome,
  playoutAdapter,
  initialPlayheadSeconds,
  onTransportState,
  modeError = null
}: StudioAppProps) => {
  const [state, setState] = useState(initialStudioState)
  const [toolsReady, setToolsReady] = useState(false)
  const [engineStatus, setEngineStatus] = useState<"loading" | "ready" | "error">("loading")
  const [engineMessage, setEngineMessage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [tempoDraft, setTempoDraft] = useState(String(state.bpm))
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [playheadBeat, setPlayheadBeat] = useState(() =>
    studioTransportBeatAtSeconds(playoutAdapter, initialPlayheadSeconds, state.bpm)
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewFocus, setViewFocus] = useState<StudioViewFocus | null>(null)
  const [bottomPanel, setBottomPanel] = useState<"karaoke" | "plugins" | "automation" | "clip" | "takes">(
    "plugins"
  )
  const [karaokeLyrics, setKaraokeLyrics] = useState("")
  const [karaokeSemitones, setKaraokeSemitones] = useState("0")
  const [karaokeMelodyTrackId, setKaraokeMelodyTrackId] = useState("track-piano-lead")
  const [karaokeSession, setKaraokeSession] = useState(getKaraokeSessionView)
  const [recording, setRecording] = useState(initialBrowserRecordingState)
  const [shareReceipt, setShareReceipt] = useState<StudioShareReceipt | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [auditioning, setAuditioning] = useState<string | null>(null)
  const presentation = useSyncExternalStore(
    subscribeStudioPresentation,
    getStudioPresentationView,
    getStudioPresentationView
  )
  const timelineRef = useRef<DawTimelineHandle>(null)
  const auditionRef = useRef<HTMLAudioElement | null>(null)
  const playheadRef = useRef(0)
  const playheadBeatRef = useRef(playheadBeat)
  const stateRef = useRef(state)
  const playingRef = useRef(playing)
  const engineStatusRef = useRef(engineStatus)
  const engineInitializedRef = useRef(false)

  stateRef.current = state
  playingRef.current = playing
  playheadBeatRef.current = playheadBeat
  engineStatusRef.current = engineStatus

  useEffect(() => {
    const unsubscribe = subscribeStudio(setState)
    void studioToolsReady.then(
      () => setToolsReady(true),
      (cause: unknown) => setError(errorMessage(cause))
    )
    return unsubscribe
  }, [])

  useEffect(() => setTempoDraft(String(state.bpm)), [state.bpm])

  useEffect(() => subscribeStudioShare(setShareReceipt), [])

  useEffect(() => {
    if (["armed", "requesting", "counting_in", "recording", "stopping"].includes(recording.status)) {
      setBottomPanel("takes")
    }
  }, [recording.status])

  useEffect(() => {
    if (shareReceipt !== null) setBottomPanel("takes")
  }, [shareReceipt])

  useEffect(() => {
    if (modeError !== null) setError(modeError)
  }, [modeError])

  useEffect(() => {
    let active = true
    let detach: (() => void) | undefined
    const controller: LearningTransportController = {
      execute: async (command) => {
        const timeline = timelineRef.current
        if (timeline === null) throw new Error("The shared Studio audio engine is not mounted yet.")
        if (engineStatusRef.current !== "ready") {
          throw new Error(
            "The shared Studio audio engine is still preparing. Try the transport again shortly."
          )
        }
        const current = stateRef.current
        const bpm = current.bpm
        const secondsAt = (beat: number) => studioTransportSecondsAtBeat(playoutAdapter, beat, bpm)
        switch (command.action) {
          case "play":
            if (!playingRef.current) await timeline.togglePlay(secondsAt(playheadBeatRef.current))
            return {
              action: command.action,
              status: "playing",
              playheadBeat: playheadBeatRef.current
            }
          case "play_range":
            await timeline.playRange(secondsAt(command.startBeat), secondsAt(command.endBeat))
            return {
              action: command.action,
              status: "playing",
              playheadBeat: command.startBeat
            }
          case "pause":
            timeline.pause()
            return {
              action: command.action,
              status: "paused",
              playheadBeat: playheadBeatRef.current
            }
          case "stop":
            timeline.stop()
            return { action: command.action, status: "stopped", playheadBeat: 0 }
          case "seek":
            timeline.seekTo(secondsAt(command.beat))
            return { action: command.action, status: "paused", playheadBeat: command.beat }
          case "set_loop":
            await timeline.setLoop(command.enabled, secondsAt(command.startBeat), secondsAt(command.endBeat))
            return {
              action: command.action,
              status: playingRef.current ? "playing" : playheadRef.current > 0 ? "paused" : "stopped",
              playheadBeat: playheadBeatRef.current
            }
        }
      }
    }
    void attachLearningTransport(controller).then((cleanup) => {
      if (active) detach = cleanup
      else cleanup()
    })
    return () => {
      active = false
      detach?.()
    }
  }, [playoutAdapter])

  useEffect(() => subscribeStudioViewFocus(setViewFocus), [])

  useEffect(() => subscribeKaraokeSession(setKaraokeSession), [])

  useEffect(() => subscribeBrowserRecording(setRecording), [])

  useEffect(() => configureKaraokeSession(state.karaokeGuide), [state.karaokeGuide])

  useEffect(() => {
    if (engineStatus !== "ready") return
    if (viewFocus === null) {
      timelineRef.current?.clearViewFocus()
      return
    }
    void timelineRef.current?.focusView(viewFocus).catch((cause: unknown) => setError(errorMessage(cause)))
  }, [engineStatus, viewFocus])

  useEffect(
    () => () => {
      auditionRef.current?.pause()
    },
    []
  )

  const selectedDuration = state.selection.end - state.selection.start
  const selectedStartBeat = (state.selection.start * state.bpm) / 60
  const selectedEndBeat = (state.selection.end * state.bpm) / 60
  const melodyTracks = useMemo(
    () =>
      state.tracks.filter(
        (track) =>
          track.kind === "midi" && track.clips.some((clip) => clip.kind === "midi" && clip.midiChannel !== 9)
      ),
    [state.tracks]
  )
  const activeKaraokeToken = state.karaokeGuide?.tokens.find(
    (token) => playheadBeat >= token.startBeat && playheadBeat < token.endBeat
  )
  const activePresentationTransition = presentation.phase === "settled" ? null : presentation.transition

  useEffect(() => {
    if (!active) return
    updateStudioPresentationSurface("studio", bottomPanel, toolsReady)
  }, [active, bottomPanel, toolsReady])

  useEffect(() => {
    if (!active) return
    updateStudioPresentationEngine(engineStatus, engineMessage)
  }, [active, engineMessage, engineStatus])

  useEffect(() => {
    if (!active) return
    updateStudioPresentationOperation(busy, error)
  }, [active, busy, error])

  useEffect(() => {
    if (!active) return
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
  }, [active, metronome.status, playhead, playheadBeat, playing])

  useEffect(() => {
    if (!active) return
    const status =
      busy === "microphone"
        ? karaokeSession.microphoneActive
          ? "scoring"
          : "requesting"
        : karaokeSession.status
    updateStudioPresentationMicrophone(status, karaokeSession.microphoneIssue)
  }, [active, busy, karaokeSession.microphoneActive, karaokeSession.microphoneIssue, karaokeSession.status])

  useEffect(() => {
    if (!active) return
    updateStudioPresentationLyrics(
      activeKaraokeToken === undefined
        ? state.karaokeGuide !== null && playheadBeat >= state.karaokeGuide.endBeat
          ? "complete"
          : "standby"
        : "active",
      activeKaraokeToken?.id ?? null,
      null
    )
  }, [active, activeKaraokeToken?.id, playheadBeat, state.karaokeGuide])

  useEffect(() => {
    onTransportState({
      engineStatus,
      engineMessage,
      playing,
      playheadSeconds: playhead,
      playheadBeat
    })
  }, [engineMessage, engineStatus, onTransportState, playhead, playheadBeat, playing])

  const run = async (label: string, operation: () => Promise<unknown>) => {
    if (busy !== null) return
    setBusy(label)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const settleTimelineMutation = (operation: Promise<unknown>) => {
    setError(null)
    void operation.catch((cause: unknown) => setError(errorMessage(cause)))
  }

  const auditionClip = async (clip: StudioClip) => {
    auditionRef.current?.pause()
    if (auditioning === clip.id) {
      setAuditioning(null)
      return
    }
    try {
      const audio = new Audio(resolveClipAudioUrl(clip, state.bpm))
      auditionRef.current = audio
      setAuditioning(clip.id)
      audio.addEventListener("ended", () => setAuditioning(null), { once: true })
      audio.addEventListener("pause", () => setAuditioning(null), { once: true })
      await audio.play()
    } catch (cause) {
      setAuditioning(null)
      setError(errorMessage(cause))
    }
  }

  const commitTempo = () => {
    const bpm = Number(tempoDraft)
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
      setTempoDraft(String(state.bpm))
      setError("Tempo must be between 40 and 240 BPM.")
      return
    }
    if (bpm !== state.bpm) void run("tempo", () => setStudioTempo(bpm, state.revision))
  }

  const stagePart = () => {
    const normalized = prompt.trim()
    if (normalized.length < 3) {
      setError("Describe the part you want to stage.")
      return
    }
    void run("stage", () => stageStudioPart(normalized, state.revision))
  }

  const stageTransposition = () => {
    const semitones = Number(karaokeSemitones)
    if (!Number.isInteger(semitones) || semitones === 0 || semitones < -24 || semitones > 24) {
      setError("Choose a non-zero whole-number key change from -24 to 24 semitones.")
      return
    }
    void run("transpose", () =>
      stageStudioTransposition(semitones, selectedStartBeat, selectedEndBeat, state.revision)
    )
  }

  const stageKaraokeGuide = () => {
    const lyrics = karaokeLyrics.trim()
    if (lyrics.length < 1) {
      setError("Enter authorized or original lyrics for the karaoke guide.")
      return
    }
    void run("karaoke", () =>
      stageStudioKaraokeGuide(
        lyrics,
        karaokeMelodyTrackId,
        selectedStartBeat,
        selectedEndBeat,
        state.revision
      )
    )
  }

  const toggleKaraokeMicrophone = () => {
    if (karaokeSession.microphoneActive) {
      void run("microphone", stopKaraokeMicrophone)
      return
    }
    if (state.karaokeGuide === null) {
      setError("Stage and apply a karaoke guide before starting the microphone.")
      return
    }
    if (
      recording.status === "recording" ||
      recording.status === "requesting" ||
      recording.status === "counting_in"
    ) {
      setError("Stop the browser recording before starting karaoke pitch capture.")
      return
    }
    void run("microphone", async () => {
      try {
        await startKaraokeMicrophone(state.karaokeGuide!, () => playheadBeatRef.current)
      } catch (cause) {
        await failKaraokeSession(cause)
        throw cause
      }
    })
  }

  const shiftSelection = (direction: -1 | 1) => {
    const start = Math.max(0, state.selection.start + selectedDuration * direction)
    void run("selection", () => selectStudioTimeRange(start, start + selectedDuration))
  }

  const toggleBrowserRecording = () => {
    if (recording.status === "recording") {
      void run("recording", () => stopBrowserRecordingAndCommit(recording.recordingRevision))
      return
    }
    if (recording.status === "requesting" || recording.status === "counting_in") return
    if (karaokeSession.microphoneActive) {
      setError("Stop karaoke pitch capture before starting a browser recording.")
      return
    }
    void run("recording", async () => {
      const recordingStart = startBrowserRecordingFromHumanGesture(state.bpm)
      const metronomeStart = metronome.status === "running" ? Promise.resolve() : onToggleMetronome()
      await Promise.all([recordingStart, metronomeStart])
    })
  }

  const downloadRecording = (take: BrowserRecordingTake) =>
    run("download-recording", async () => {
      const blob = await getBrowserRecordingBlob(take.recordingId)
      if (blob === null) throw new Error("This page-local recording is no longer available.")
      const extension = take.mimeType.includes("mp4") ? "m4a" : take.mimeType.includes("wav") ? "wav" : "webm"
      downloadBlob(blob, `${take.name.replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase()}.${extension}`)
    })

  const shareStudio = () =>
    run("share", async () => {
      const receipt = await createStudioShareLink(state.revision)
      setShareReceipt(receipt)
      let copied = false
      try {
        await navigator.clipboard.writeText(receipt.url)
        copied = true
      } catch {
        // The visible link remains available when clipboard access is blocked.
      }
      setShareCopied(copied)
    })

  const exportMix = () =>
    run("export", async () => {
      const blob = await timelineRef.current?.exportWav()
      if (blob === undefined) throw new Error("The audio engine is not ready.")
      downloadBlob(blob, "signal-studio-mix.wav")
    })

  return (
    <main
      className="studio-shell"
      hidden={!active}
      data-presentation-phase={presentation.phase}
      data-presentation-action={presentation.transition?.action ?? "none"}
      data-presentation-actor={presentation.transition?.actor ?? "ENGINE"}
      style={
        {
          "--presentation-duration": `${presentation.transition?.duration_ms ?? 560}ms`
        } as CSSProperties
      }
    >
      <header className="studio-topbar">
        {state.attribution === null ? (
          <div className="project-switcher" aria-label="Current song">
            {state.title.toUpperCase()}
          </div>
        ) : (
          <a
            className="project-switcher"
            href={state.attribution.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`${state.title}; source MIDI by ${state.attribution.creator}`}
          >
            {state.title.toUpperCase()} <span>{state.attribution.licenseName} ↗</span>
          </a>
        )}
        <span className="save-state">REV {state.revision}</span>
        <div className="transport" aria-label="Transport controls">
          <button
            className={metronome.status === "running" ? "metronome-button active" : "metronome-button"}
            type="button"
            aria-label={metronome.status === "running" ? "Stop metronome" : "Start metronome"}
            aria-pressed={metronome.status === "running"}
            title={metronome.status === "running" ? "Shared transport metronome running" : "Start metronome"}
            disabled={busy !== null}
            onClick={() => void run("metronome", onToggleMetronome)}
          >
            ♩
          </button>
          <button
            className={learning.transportLoop.enabled ? "loop-button active" : "loop-button"}
            type="button"
            data-testid="transport-loop-toggle"
            aria-label={learning.transportLoop.enabled ? "Disable transport loop" : "Loop selected range"}
            aria-pressed={learning.transportLoop.enabled}
            title={
              learning.transportLoop.enabled
                ? `Looping beats ${learning.transportLoop.startBeat}–${learning.transportLoop.endBeat}`
                : `Loop selected beats ${selectedStartBeat.toFixed(2)}–${selectedEndBeat.toFixed(2)}`
            }
            disabled={busy !== null || engineStatus !== "ready"}
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
                        startBeat: selectedStartBeat,
                        endBeat: selectedEndBeat
                      },
                  learning.lessonRevision
                )
              )
            }
          >
            ↻
          </button>
          <button
            className={
              recording.status === "recording"
                ? "record-button active"
                : recording.status === "counting_in" || recording.status === "armed"
                  ? "record-button prepared"
                  : "record-button"
            }
            type="button"
            aria-label={
              recording.status === "recording"
                ? "Stop browser recording"
                : recording.status === "counting_in"
                  ? `Recording count-in, ${recording.countInRemaining} beats remaining`
                  : recording.status === "armed"
                    ? `Start armed recording with ${recording.countInBeats}-beat count-in`
                    : "Start browser recording"
            }
            aria-pressed={recording.status === "recording"}
            disabled={
              busy !== null ||
              recording.status === "requesting" ||
              recording.status === "counting_in" ||
              recording.status === "stopping"
            }
            onClick={toggleBrowserRecording}
          >
            ●
          </button>
          {recording.status !== "idle" && recording.status !== "complete" && (
            <span
              className={`recording-state-chip ${recording.status}`}
              data-testid="recording-state"
              role="status"
              aria-live="polite"
            >
              {recording.status === "counting_in"
                ? `COUNT-IN ${recording.countInRemaining}`
                : recording.status === "recording"
                  ? "● RECORDING"
                  : recording.status.toUpperCase()}
            </span>
          )}
          <button
            type="button"
            aria-label="Play selected range"
            title="Play selected range"
            disabled={busy !== null || engineStatus !== "ready" || state.tracks.length === 0}
            onClick={() =>
              void run("transport", () =>
                controlInstrumentLearningTransport({
                  action: "play_range",
                  startBeat: selectedStartBeat,
                  endBeat: selectedEndBeat
                })
              )
            }
          >
            ◇▶
          </button>
          <span className="transport-time">{formatTime(playhead)}</span>
        </div>
        <label className="tempo-button">
          <input
            aria-label="Tempo in beats per minute"
            inputMode="numeric"
            value={tempoDraft}
            onChange={(event) => setTempoDraft(event.target.value)}
            onBlur={commitTempo}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
          />
          BPM
        </label>
        <button className="meter-button" type="button" title="Project meter">
          {state.timeSignature[0]} / {state.timeSignature[1]}
        </button>
        <button
          className="export-button"
          type="button"
          disabled={busy !== null || engineStatus !== "ready"}
          onClick={() => void exportMix()}
        >
          {busy === "export" ? "RENDERING…" : "EXPORT WAV ↗"}
        </button>
      </header>

      <section className="studio-workspace">
        <section className="arrangement-panel" aria-label="Song arrangement">
          <div className="arrangement-toolbar">
            <div>
              <button className="active" type="button">
                SELECT
              </button>
              <button type="button" onClick={() => shiftSelection(-1)} aria-label="Move selection left">
                ← RANGE
              </button>
              <button type="button" onClick={() => shiftSelection(1)} aria-label="Move selection right">
                RANGE →
              </button>
            </div>
            <span>
              {selectedDuration.toFixed(1)}S SELECTED · {formatTime(state.selection.start).slice(0, 5)}–
              {formatTime(state.selection.end).slice(0, 5)}
            </span>
            <div>
              <button
                type="button"
                disabled={state.historyDepth === 0 || busy !== null}
                onClick={() => void run("undo", () => undoStudioEdit(state.revision))}
              >
                UNDO
              </button>
              <button
                type="button"
                disabled={state.redoDepth === 0 || busy !== null}
                onClick={() => void run("redo", () => redoStudioEdit(state.revision))}
              >
                REDO
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void shareStudio()}>
                {busy === "share" ? "SHARING…" : "SHARE LINK"}
              </button>
            </div>
          </div>

          <div className="timeline-frame">
            <DawTimeline
              ref={timelineRef}
              state={state}
              transportLoop={learning.transportLoop}
              playoutAdapter={playoutAdapter}
              onSelection={(start, end) => settleTimelineMutation(selectStudioTimeRange(start, end))}
              onTrackMix={(trackId, changes) => settleTimelineMutation(setStudioTrackMix(trackId, changes))}
              onClipEdit={(trackId, clipId, start, duration) =>
                settleTimelineMutation(moveStudioClip(trackId, clipId, start, duration))
              }
              onTime={(time) => {
                const beat = studioTransportBeatAtSeconds(playoutAdapter, time, stateRef.current.bpm)
                playheadRef.current = time
                playheadBeatRef.current = beat
                setPlayhead(time)
                setPlayheadBeat(beat)
              }}
              onPlaying={(next) => {
                playingRef.current = next
                setPlaying(next)
              }}
              onEngineStatus={(status, message) => {
                if (status === "ready" && !engineInitializedRef.current) {
                  engineInitializedRef.current = true
                  timelineRef.current?.seekTo(initialPlayheadSeconds)
                  const beat = studioTransportBeatAtSeconds(
                    playoutAdapter,
                    initialPlayheadSeconds,
                    stateRef.current.bpm
                  )
                  playheadRef.current = initialPlayheadSeconds
                  playheadBeatRef.current = beat
                  setPlayhead(initialPlayheadSeconds)
                  setPlayheadBeat(beat)
                }
                setEngineStatus(status)
                setEngineMessage(message ?? null)
              }}
            />
            {viewFocus !== null && (
              <aside className="studio-view-focus" data-testid="studio-view-focus" role="status">
                <span>AGENT FOCUS</span>
                <strong>{viewFocus.label}</strong>
                <small>
                  BEATS {viewFocus.startBeat}–{viewFocus.endBeat} ·{" "}
                  {viewFocus.trackNames.length === 0
                    ? "ALL TRACKS"
                    : viewFocus.trackNames.join(" + ").toUpperCase()}
                </small>
                <button type="button" onClick={clearStudioViewFocus} aria-label="Clear agent focus">
                  ×
                </button>
              </aside>
            )}
            {engineStatus !== "ready" && (
              <div className={`engine-state engine-${engineStatus}`} role="status">
                <span>{engineStatus === "loading" ? "◌" : "!"}</span>
                <b>{engineStatus === "loading" ? "STARTING AUDIO ENGINE" : "AUDIO ENGINE ERROR"}</b>
                {engineMessage !== null && <small>{engineMessage}</small>}
              </div>
            )}
          </div>

          {(bottomPanel === "karaoke" || state.karaokeGuide !== null) && (
            <section className="karaoke-console" data-testid="karaoke-console" aria-label="Browser karaoke">
              <header>
                <strong>{state.karaokeGuide?.title ?? "KARAOKE"}</strong>
                <span>MIC · LOCAL ONLY</span>
              </header>

              <div className="karaoke-setup">
                <label>
                  <span>KEY</span>
                  <input
                    aria-label="Karaoke semitone change"
                    inputMode="numeric"
                    value={karaokeSemitones}
                    onChange={(event) => setKaraokeSemitones(event.target.value)}
                  />
                  <small>SEMITONES</small>
                </label>
                <button type="button" disabled={busy !== null} onClick={stageTransposition}>
                  {busy === "transpose" ? "STAGING…" : "STAGE KEY CHANGE"}
                </button>
                <label className="karaoke-lyrics-input">
                  <span>ORIGINAL LYRICS</span>
                  <input
                    aria-label="Authorized karaoke lyrics"
                    placeholder="Authorized lyrics"
                    value={karaokeLyrics}
                    onChange={(event) => setKaraokeLyrics(event.target.value)}
                  />
                </label>
                <label className="karaoke-melody-select">
                  <span>MELODY</span>
                  <select
                    aria-label="Karaoke melody track"
                    value={karaokeMelodyTrackId}
                    onChange={(event) => setKaraokeMelodyTrackId(event.target.value)}
                  >
                    {melodyTracks.map((track) => (
                      <option value={track.id} key={track.id}>
                        {track.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={busy !== null} onClick={stageKaraokeGuide}>
                  {busy === "karaoke" ? "STAGING…" : "STAGE GUIDE"}
                </button>
              </div>

              {state.karaokeGuide !== null && (
                <div className="karaoke-live">
                  <div className="karaoke-words" aria-label="Timed karaoke lyrics">
                    {state.karaokeGuide.tokens.map((token) => (
                      <span
                        className={
                          token.id === activeKaraokeToken?.id
                            ? "active"
                            : playheadBeat >= token.endBeat
                              ? "passed"
                              : ""
                        }
                        key={token.id}
                      >
                        {token.text}
                      </span>
                    ))}
                  </div>
                  <div className="karaoke-pitch">
                    <span>
                      EXPECTED
                      <strong>
                        {activeKaraokeToken === undefined ? "—" : midiName(activeKaraokeToken.expectedMidi)}
                      </strong>
                    </span>
                    <span>
                      DETECTED
                      <strong>
                        {karaokeSession.latestPitch === null
                          ? "—"
                          : midiName(karaokeSession.latestPitch.nearestMidi)}
                      </strong>
                    </span>
                    <span>
                      INTONATION
                      <strong>
                        {karaokeSession.latestPitch === null
                          ? "—"
                          : `${karaokeSession.latestPitch.cents > 0 ? "+" : ""}${karaokeSession.latestPitch.cents}¢`}
                      </strong>
                    </span>
                    <span>
                      SCORE
                      <strong>{karaokeSession.result?.score ?? "—"}</strong>
                    </span>
                  </div>
                  {karaokeSession.microphoneIssue !== null && <p role="alert">{karaokeSession.message}</p>}
                  <button
                    className={karaokeSession.microphoneActive ? "karaoke-stop" : "karaoke-start"}
                    type="button"
                    disabled={busy !== null}
                    onClick={toggleKaraokeMicrophone}
                  >
                    {karaokeSession.microphoneActive
                      ? "STOP + SCORE TAKE"
                      : karaokeSession.microphoneIssue === null
                        ? "START SINGING"
                        : "RETRY MICROPHONE"}
                  </button>
                </div>
              )}
            </section>
          )}

          {bottomPanel === "takes" && (
            <section
              className="recording-console"
              data-testid="recording-console"
              aria-label="Browser recording and sharing"
            >
              <header>
                <strong>{recording.name ?? "RECORD"}</strong>
                <span data-status={recording.status}>MIC LOCAL · {recording.status.toUpperCase()}</span>
              </header>
              <div className="recording-grid">
                <section className="recording-control-card">
                  <button
                    className={recording.status === "recording" ? "recording-stop" : "recording-start"}
                    type="button"
                    data-testid="browser-recording-control"
                    disabled={
                      busy !== null ||
                      recording.status === "requesting" ||
                      recording.status === "counting_in" ||
                      recording.status === "stopping"
                    }
                    onClick={toggleBrowserRecording}
                  >
                    <span aria-hidden="true">●</span>
                    <strong>
                      {recording.status === "recording"
                        ? "STOP + ADD TO STUDIO"
                        : recording.status === "counting_in"
                          ? `COUNT-IN ${recording.countInRemaining}`
                          : recording.status === "armed"
                            ? `START · ${recording.countInBeats}-BEAT COUNT-IN`
                            : `START · ${recording.countInBeats}-BEAT COUNT-IN`}
                    </strong>
                  </button>
                  {recording.microphoneIssue !== null && <p role="alert">{recording.message}</p>}
                </section>

                <section className="recording-takes" aria-label="Completed local recordings">
                  <header>
                    <span>LOCAL TAKES</span>
                    <strong>{String(recording.takes.length).padStart(2, "0")}</strong>
                  </header>
                  {recording.takes.length === 0 ? (
                    <span className="recording-empty" aria-label="No local takes">
                      —
                    </span>
                  ) : (
                    <ul>
                      {recording.takes.map((take) => (
                        <li key={take.recordingId}>
                          <span>
                            <strong>{take.name}</strong>
                            <small>
                              {formatTime(take.durationSeconds)} · {(take.byteLength / 1_024).toFixed(1)} KB
                            </small>
                          </span>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void downloadRecording(take)}
                          >
                            DOWNLOAD
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="studio-share-card" aria-label="Share structured Studio snapshot">
                  <header>
                    <span>UNLISTED · 30D</span>
                    <strong>MIDI + LESSON</strong>
                  </header>
                  <span className="studio-share-scope">AUDIO OMITTED</span>
                  <button
                    type="button"
                    data-testid="create-share-link"
                    disabled={busy !== null}
                    onClick={() => void shareStudio()}
                  >
                    {busy === "share" ? "CREATING LINK…" : "CREATE + COPY LINK"}
                  </button>
                  {shareReceipt !== null && (
                    <div className="studio-share-result" role="status">
                      <span>{shareCopied ? "COPIED" : "LINK READY"}</span>
                      <a href={shareReceipt.url} data-testid="studio-share-link">
                        OPEN SHARED COPY ↗
                      </a>
                      <small>
                        EXPIRES {new Date(shareReceipt.expiresAt).toLocaleDateString()} ·{" "}
                        {shareReceipt.omittedAudioAssetCount} AUDIO ASSET
                        {shareReceipt.omittedAudioAssetCount === 1 ? "" : "S"} OMITTED
                      </small>
                    </div>
                  )}
                </section>
              </div>
            </section>
          )}

          {state.preview !== null && (
            <section className="preview-drawer" data-testid="studio-preview" aria-label="Staged take preview">
              <div className="preview-heading">
                <span className="preview-pulse" />
                <div>
                  <small>STAGED · ARRANGEMENT UNCHANGED</small>
                  <strong>{state.preview.clip.name}</strong>
                </div>
                <span className="preview-kind">{state.preview.clip.kind.toUpperCase()}</span>
              </div>
              <ol>
                {state.preview.operations.map((operation) => (
                  <li key={operation}>{operation}</li>
                ))}
              </ol>
              <div className="preview-actions">
                <button type="button" onClick={() => void auditionClip(state.preview!.clip)}>
                  {auditioning === state.preview.clip.id ? "STOP PREVIEW" : "AUDITION"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("discard", () => discardStudioPreview(state.preview!.id, state.revision))
                  }
                >
                  DISCARD
                </button>
                <button
                  className="apply-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("apply", () => applyStudioPreview(state.preview!.id, state.revision))
                  }
                >
                  {busy === "apply" ? "APPLYING…" : "APPLY AS ONE EDIT"} ↗
                </button>
              </div>
            </section>
          )}

          <form
            className="magic-dock"
            onSubmit={(event) => {
              event.preventDefault()
              stagePart()
            }}
          >
            <label className="magic-copy">
              <small>
                BEATS {selectedStartBeat.toFixed(2)}–{selectedEndBeat.toFixed(2)}
              </small>
              <input
                aria-label="Describe the part to create"
                placeholder="Describe a part"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <span className="model-button" aria-label="Generated part type">
              MIDI SCORE
            </span>
            <button className="ask-button" type="submit" disabled={busy !== null}>
              {busy === "stage" ? "STAGING…" : "STAGE TAKE"} <span>↗</span>
            </button>
          </form>

          {(error !== null || state.logs.length > 0 || activePresentationTransition !== null) && (
            <div
              className={error === null ? "activity-toast" : "activity-toast activity-error"}
              role="status"
            >
              <span>
                {error !== null ? "ERROR" : (activePresentationTransition?.actor ?? state.logs.at(-1)?.actor)}
              </span>
              <p>
                {error ??
                  (activePresentationTransition === null
                    ? state.logs.at(-1)?.message
                    : `${studioPresentationActionLabel(activePresentationTransition.action)} · ${presentation.phase.toUpperCase()} · REV ${activePresentationTransition.revision_after}`)}
              </p>
              {error !== null && (
                <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
                  ×
                </button>
              )}
            </div>
          )}
        </section>
      </section>

      <footer className="studio-footer">
        <div>
          {(
            [
              ["plugins", "PLUGINS"],
              ["automation", "AUTOMATION"],
              ["clip", "CLIP EDITOR"],
              ["takes", "TAKE LANES"],
              ["karaoke", "KARAOKE"]
            ] as const
          ).map(([value, label]) => (
            <button
              className={bottomPanel === value ? "active" : ""}
              type="button"
              key={value}
              onClick={() => setBottomPanel(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="engine-badge"
          data-testid="studio-runtime"
          aria-label={`${
            toolsReady
              ? `${studioModelContextMode}, ${studioToolCount} ${studioToolCount === 1 ? "tool" : "tools"}`
              : "Registering tools"
          }, audio engine ${engineStatus}`}
        >
          <span className={toolsReady && engineStatus === "ready" ? "online" : ""} aria-hidden="true">
            ●
          </span>
          <button type="button" onClick={() => timelineRef.current?.zoomOut()} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => timelineRef.current?.zoomIn()} aria-label="Zoom in">
            +
          </button>
        </div>
      </footer>
    </main>
  )
}
