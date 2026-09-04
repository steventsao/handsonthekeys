import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"
import { DawTimeline, type DawTimelineHandle } from "./DawTimeline.tsx"
import {
  initialStudioState,
  midiName,
  type StudioKaraokeGuideResult,
  type StudioPreview,
  type StudioState
} from "./Studio.ts"
import {
  applyStudioPreview,
  discardStudioPreview,
  loadStudioShareFromLocation,
  redoStudioEdit,
  stageStudioKaraokeGuide,
  studioModelContextMode,
  studioToolCount,
  studioToolsReady,
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
import { karaokePresetForSong } from "./songs/catalog.ts"
import { KaraokeRoomCanvas } from "./KaraokeRoomCanvas.tsx"
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

const initialState = initialStudioState()
const karaokePreset = karaokePresetForSong(initialState.songSlug)

const formatClock = (seconds: number): string => {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remainder = Math.floor(safe - minutes * 60)
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

const errorMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const previewLabel = (preview: StudioPreview): string => {
  if (preview.kind === "midi_transposition") {
    const direction = preview.semitones > 0 ? "+" : ""
    return `${direction}${preview.semitones} semitones · ${preview.notesAffected} notes`
  }
  if (preview.kind === "karaoke_guide") {
    return `${preview.guide.tokens.length} timed words · ${preview.guide.melodyTrackName}`
  }
  return `${preview.clip.name} · ${preview.targetTrackName}`
}

const keyOffsetFrom = (state: StudioState): number => {
  const baselinePitches = new Map(
    initialState.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => clip.notes.map((note) => [note.id, note.midi] as const))
    )
  )
  const offsets = state.tracks.flatMap((track) =>
    track.clips.flatMap((clip) =>
      clip.notes.flatMap((note) => {
        const baseline = baselinePitches.get(note.id)
        return baseline === undefined || baseline === note.midi ? [] : [note.midi - baseline]
      })
    )
  )
  if (offsets.length === 0) return 0
  const counts = new Map<number, number>()
  for (const offset of offsets) counts.set(offset, (counts.get(offset) ?? 0) + 1)
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0
}

export const KaraokeApp = () => {
  const [state, setState] = useState(initialState)
  const [engineStatus, setEngineStatus] = useState<"loading" | "ready" | "error">("loading")
  const [engineMessage, setEngineMessage] = useState<string | null>(null)
  const [toolsReady, setToolsReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(initialState.selection.start)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [karaokeSession, setKaraokeSession] = useState(getKaraokeSessionView)
  const [shareLoadComplete, setShareLoadComplete] = useState(false)
  const presentation = useSyncExternalStore(
    subscribeStudioPresentation,
    getStudioPresentationView,
    getStudioPresentationView
  )
  const timelineRef = useRef<DawTimelineHandle>(null)
  const stateRef = useRef(state)
  const playheadRef = useRef(playhead)
  const guidePreparedRef = useRef(false)
  const playbackStartedRef = useRef(false)
  const shareLoadStartedRef = useRef(false)

  useEffect(() => {
    const unsubscribe = subscribeStudio((next) => {
      stateRef.current = next
      setState(next)
    })
    void studioToolsReady.then(
      () => setToolsReady(true),
      (cause: unknown) => setError(errorMessage(cause))
    )
    return unsubscribe
  }, [])

  useEffect(() => subscribeKaraokeSession(setKaraokeSession), [])

  useEffect(() => {
    if (shareLoadStartedRef.current) return
    shareLoadStartedRef.current = true
    void loadStudioShareFromLocation()
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setShareLoadComplete(true))
  }, [])

  useEffect(() => configureKaraokeSession(state.karaokeGuide), [state.karaokeGuide])

  useEffect(() => {
    if (!shareLoadComplete) return
    if (guidePreparedRef.current) return
    guidePreparedRef.current = true
    let active = true

    const prepareGuide = async () => {
      try {
        if (!active || stateRef.current.karaokeGuide !== null || stateRef.current.preview !== null) return
        const current = stateRef.current
        const startBeat = (current.selection.start * current.bpm) / 60
        const endBeat = (current.selection.end * current.bpm) / 60
        const staged = (await stageStudioKaraokeGuide(
          karaokePreset.lyrics,
          karaokePreset.melodyTrackId,
          startBeat,
          endBeat,
          current.revision,
          karaokePreset.guideTitle
        )) as StudioKaraokeGuideResult
        if (!active) return
        await applyStudioPreview(staged.previewId, staged.revision)
      } catch (cause) {
        if (active) setError(errorMessage(cause))
      }
    }

    void prepareGuide()
    return () => {
      active = false
    }
  }, [shareLoadComplete])

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

  const guide = state.karaokeGuide
  const hasPlayablePassage = guide !== null || state.practiceBed !== null

  useEffect(() => {
    playbackStartedRef.current = false
  }, [guide?.id, state.karaokeCountInBeats, state.selection.end, state.selection.start])

  const playheadBeat = (playhead * state.bpm) / 60
  const activeTokenIndex =
    guide?.tokens.findIndex((token) => playheadBeat >= token.startBeat && playheadBeat < token.endBeat) ?? -1
  const activeToken = activeTokenIndex < 0 ? undefined : guide?.tokens[activeTokenIndex]
  const passageStartBeat = guide === null ? (state.selection.start * state.bpm) / 60 : guide.startBeat
  const passageEndBeat = guide === null ? (state.selection.end * state.bpm) / 60 : guide.endBeat
  const passageStartSeconds = (passageStartBeat * 60) / state.bpm
  const passageEndSeconds = (passageEndBeat * 60) / state.bpm
  const countInStartBeat = Math.max(0, passageStartBeat - state.karaokeCountInBeats)
  const countInStartSeconds = (countInStartBeat * 60) / state.bpm
  const inCountIn = playing && playheadBeat >= countInStartBeat && playheadBeat < passageStartBeat
  const countInRemaining = Math.min(
    state.karaokeCountInBeats,
    Math.max(1, Math.ceil(passageStartBeat - playheadBeat - 0.001))
  )
  const elapsedSeconds = Math.max(0, playhead - passageStartSeconds)
  const durationSeconds = Math.max(0.001, passageEndSeconds - passageStartSeconds)
  const overallProgress = Math.max(0, Math.min(1, elapsedSeconds / durationSeconds))
  const keyOffset = useMemo(() => keyOffsetFrom(state), [state])
  const latestLog = state.logs.at(-1)
  const activePresentationTransition = presentation.phase === "settled" ? null : presentation.transition

  useEffect(() => {
    updateStudioPresentationSurface("karaoke", "room", toolsReady)
  }, [toolsReady])

  useEffect(() => {
    updateStudioPresentationEngine(engineStatus, engineMessage)
  }, [engineMessage, engineStatus])

  useEffect(() => {
    updateStudioPresentationOperation(busy, error)
  }, [busy, error])

  useEffect(() => {
    const status = inCountIn
      ? "counting_in"
      : playing
        ? "playing"
        : playbackStartedRef.current
          ? "paused"
          : "stopped"
    updateStudioPresentationTransport(status, playheadBeat)
  }, [inCountIn, playing, playheadBeat])

  useEffect(() => {
    const status =
      busy === "microphone"
        ? karaokeSession.microphoneActive
          ? "scoring"
          : "requesting"
        : karaokeSession.status
    updateStudioPresentationMicrophone(status, karaokeSession.microphoneIssue)
  }, [busy, karaokeSession.microphoneActive, karaokeSession.microphoneIssue, karaokeSession.status])

  useEffect(() => {
    const status = inCountIn
      ? "counting_in"
      : activeToken === undefined
        ? guide !== null && playheadBeat >= passageEndBeat
          ? "complete"
          : "standby"
        : "active"
    updateStudioPresentationLyrics(status, activeToken?.id ?? null, inCountIn ? countInRemaining : null)
  }, [activeToken?.id, countInRemaining, guide, inCountIn, passageEndBeat, playheadBeat])

  const togglePlayback = () =>
    void run("transport", async () => {
      if (playing) {
        await timelineRef.current?.togglePlay()
        return
      }
      const canResume =
        playbackStartedRef.current &&
        playhead > countInStartSeconds + 0.02 &&
        playhead < passageEndSeconds - 0.02
      playbackStartedRef.current = true
      await timelineRef.current?.playRange(canResume ? playhead : countInStartSeconds, passageEndSeconds)
    })

  const toggleMicrophone = () => {
    if (karaokeSession.microphoneActive) {
      void run("microphone", stopKaraokeMicrophone)
      return
    }
    if (guide === null) {
      setError("The timed guide is still loading. Try again in a moment.")
      return
    }
    void run("microphone", async () => {
      try {
        await startKaraokeMicrophone(guide, () => (playheadRef.current * stateRef.current.bpm) / 60)
      } catch (cause) {
        await failKaraokeSession(cause)
        throw cause
      }
    })
  }

  const restart = () =>
    void run("transport", async () => {
      timelineRef.current?.stop()
      setPlayhead(countInStartSeconds)
      playheadRef.current = countInStartSeconds
      playbackStartedRef.current = true
      await timelineRef.current?.playRange(countInStartSeconds, passageEndSeconds)
    })

  return (
    <main
      className="karaoke-room"
      data-testid="karaoke-room"
      data-presentation-phase={presentation.phase}
      data-presentation-action={presentation.transition?.action ?? "none"}
      data-presentation-actor={presentation.transition?.actor ?? "ENGINE"}
      style={
        {
          "--presentation-duration": `${presentation.transition?.duration_ms ?? 560}ms`
        } as CSSProperties
      }
    >
      <KaraokeRoomCanvas playing={playing} microphoneActive={karaokeSession.microphoneActive} />
      <header className="karaoke-room-header">
        <a className="karaoke-wordmark" href="/" aria-label="Signal home">
          <span aria-hidden="true">S/</span>
          <strong>SIGNAL KARAOKE</strong>
        </a>
        <div className="room-number" aria-label="Karaoke room number">
          <span>ルーム</span>
          <strong>08</strong>
        </div>
        <nav className="song-bank" aria-label="Rights-cleared song library">
          <a
            className={state.songSlug === "afterglow" ? "active" : ""}
            href="/?mode=session&song=afterglow"
            aria-current={state.songSlug === "afterglow" ? "page" : undefined}
          >
            01 AFTERGLOW
          </a>
          <a
            className={state.songSlug === "korobeiniki" ? "active" : ""}
            href="/?mode=session&song=korobeiniki"
            aria-current={state.songSlug === "korobeiniki" ? "page" : undefined}
          >
            02 KOROBEINIKI
          </a>
        </nav>
        <div className="agent-link" data-ready={toolsReady}>
          <i aria-hidden="true" />
          <span>ROOM ENGINEER</span>
          <strong>{toolsReady ? "CONNECTED" : "LINKING"}</strong>
        </div>
        <a className="studio-link" href={`/?mode=daw&song=${state.songSlug}`}>
          OPEN STUDIO <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="karaoke-layout">
        <section className="tv-cabinet" aria-label="Karaoke television">
          <div className="tv-brandline">
            <span>通信カラオケ / DIGITAL JUKE</span>
            <strong>SIGNAL VISION · 2001</strong>
          </div>

          <div className="tv-body">
            <section className="tv-bezel">
              <div className="crt-screen" data-testid="karaoke-screen">
                <div className="screen-bloom" aria-hidden="true" />
                <div className="scanlines" aria-hidden="true" />

                <header className="song-chrome">
                  <span className="song-number">
                    予約 No.{" "}
                    {state.practiceBed !== null ? "PB" : state.songSlug === "afterglow" ? "001" : "002"}
                  </span>
                  <div>
                    <strong>
                      {guide?.title ??
                        (state.practiceBed === null ? "LOADING SONG" : "ORIGINAL PRACTICE BED")}
                    </strong>
                    <small>
                      {state.practiceBed === null
                        ? karaokePreset.screenSubtitle
                        : `${state.practiceBed.key} · ${state.practiceBed.approximate_bpm} BPM · FACTS-ONLY REFERENCE`}
                    </small>
                  </div>
                  <span className="song-key">
                    IN {state.karaokeCountInBeats} · KEY {keyOffset > 0 ? `+${keyOffset}` : keyOffset}
                  </span>
                </header>

                <div className="lyric-field" data-testid="karaoke-lyrics">
                  {inCountIn ? (
                    <div className="count-in-display" role="status" aria-live="polite">
                      <small>{state.karaokeCountInBeats} BEAT LEAD-IN</small>
                      <strong key={countInRemaining}>{countInRemaining}</strong>
                      <span>{guide === null ? "BEATS TO SELECTED PASSAGE" : "BEATS TO CHORUS"}</span>
                      <div aria-hidden="true">
                        {Array.from({ length: state.karaokeCountInBeats }, (_, index) => {
                          const elapsed = state.karaokeCountInBeats - countInRemaining
                          const className = index < elapsed ? "passed" : index === elapsed ? "active" : ""
                          return <i className={className} key={index} />
                        })}
                      </div>
                    </div>
                  ) : guide === null ? (
                    <div
                      className={`song-loading${state.practiceBed === null ? "" : " practice-bed-screen"}`}
                      role="status"
                    >
                      <span>{state.practiceBed === null ? "曲を準備中" : "練習トラック / PRACTICE"}</span>
                      <strong>
                        {state.practiceBed === null
                          ? "Preparing the room…"
                          : state.practiceBed.reference_title}
                      </strong>
                      {state.practiceBed !== null && (
                        <small>New accompaniment · select a passage, then count in</small>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="pitch-lane" aria-hidden="true">
                        {guide.tokens.map((token, index) => (
                          <i
                            className={
                              index === activeTokenIndex ? "active" : index < activeTokenIndex ? "passed" : ""
                            }
                            key={token.id}
                            style={{
                              width: `${Math.max(2.5, ((token.endBeat - token.startBeat) / (guide.endBeat - guide.startBeat)) * 92)}%`,
                              transform: `translateY(${(token.expectedMidi % 7) * -2}px)`
                            }}
                          />
                        ))}
                      </div>
                      <div
                        className="karaoke-words"
                        aria-label={guide.tokens.map((token) => token.text).join(" ")}
                      >
                        {guide.tokens.map((token, index) => {
                          const progress =
                            playheadBeat <= token.startBeat
                              ? 0
                              : playheadBeat >= token.endBeat
                                ? 100
                                : ((playheadBeat - token.startBeat) / (token.endBeat - token.startBeat)) * 100
                          return (
                            <span
                              className={
                                index === activeTokenIndex
                                  ? "active"
                                  : index < activeTokenIndex
                                    ? "passed"
                                    : ""
                              }
                              key={token.id}
                              style={{ "--word-progress": `${progress}%` } as CSSProperties}
                            >
                              {index === activeTokenIndex && <i aria-hidden="true">♪</i>}
                              {token.text}
                            </span>
                          )
                        })}
                      </div>
                      <p className="romaji-line" aria-live="polite">
                        {activeToken === undefined ? karaokePreset.standbyLine : `♪ ${activeToken.text}`}
                      </p>
                    </>
                  )}
                </div>

                <footer className="screen-footer">
                  <div className="time-readout">
                    <strong>
                      {inCountIn
                        ? `-${formatClock((passageStartBeat - playheadBeat) * (60 / state.bpm))}`
                        : formatClock(elapsedSeconds)}
                    </strong>
                    <span>/ {formatClock(durationSeconds)}</span>
                  </div>
                  <div
                    className="song-progress"
                    aria-label={`${Math.round(overallProgress * 100)} percent complete`}
                  >
                    <span style={{ width: `${overallProgress * 100}%` }} />
                  </div>
                  <div className="pitch-readout">
                    <span>GUIDE</span>
                    <strong>{activeToken === undefined ? "—" : midiName(activeToken.expectedMidi)}</strong>
                    <span>YOU</span>
                    <strong className={karaokeSession.latestPitch === null ? "waiting" : "listening"}>
                      {karaokeSession.latestPitch === null
                        ? "—"
                        : midiName(karaokeSession.latestPitch.nearestMidi)}
                    </strong>
                  </div>
                </footer>
              </div>
            </section>

            <aside className="tv-controls" aria-label="Singer controls">
              <div className="power-light">
                <i /> POWER
              </div>
              <button
                className={playing ? "cabinet-control pause" : "cabinet-control play"}
                type="button"
                disabled={!hasPlayablePassage || engineStatus !== "ready" || busy !== null}
                onClick={togglePlayback}
                aria-label={playing ? "Pause karaoke" : "Play karaoke"}
              >
                <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
                <strong>{playing ? "PAUSE" : "PLAY"}</strong>
              </button>
              <button
                className={
                  karaokeSession.microphoneActive ? "cabinet-control mic active" : "cabinet-control mic"
                }
                type="button"
                disabled={guide === null || busy !== null}
                onClick={toggleMicrophone}
                aria-label={
                  karaokeSession.microphoneActive
                    ? "Stop singing and score take"
                    : karaokeSession.microphoneIssue === null
                      ? "Start microphone"
                      : "Retry microphone"
                }
              >
                <span aria-hidden="true">●</span>
                <strong>
                  {karaokeSession.microphoneActive
                    ? "SCORE"
                    : karaokeSession.microphoneIssue === null
                      ? "MIC"
                      : "RETRY"}
                </strong>
              </button>
              <button
                className="restart-control"
                type="button"
                disabled={!hasPlayablePassage || engineStatus !== "ready" || busy !== null}
                onClick={restart}
              >
                ↶ REPLAY
              </button>
              <div className="speaker-grille" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
            </aside>
          </div>

          <footer className="tv-caption">
            <span>♪</span>
            <p>
              <strong>{state.title}</strong>
              {state.attribution !== null && (
                <>
                  Song source:{" "}
                  <a href={state.attribution.sourceUrl} target="_blank" rel="noreferrer">
                    {state.attribution.title} by {state.attribution.creator}
                  </a>
                  {" · "}
                  <a href={state.attribution.licenseUrl} target="_blank" rel="noreferrer">
                    {state.attribution.licenseName}
                  </a>
                  {` · ${state.attribution.changes}`}
                </>
              )}
            </p>
            <div className="local-badge">MIC STAYS LOCAL</div>
          </footer>
        </section>

        <aside className="engineer-console" aria-label="Agent audio engineer status">
          <header>
            <div>
              <small>通信 / WEBMCP + EFFECT</small>
              <strong>ROOM CONTROL</strong>
            </div>
            <span className="deck-status">
              <i /> LIVE
            </span>
          </header>

          <section className="engine-state-card">
            <div className="state-orbit" aria-hidden="true">
              <span>通信</span>
            </div>
            {activePresentationTransition !== null ? (
              <p>
                {activePresentationTransition.actor === "AGENT" ? "Agent engineer" : "Room engineer"}:{" "}
                {studioPresentationActionLabel(activePresentationTransition.action).toLowerCase()}.
              </p>
            ) : state.practiceBed === null ? (
              <p>The engineer sees the same key, tempo, count-in, stems, and MIDI session.</p>
            ) : (
              <p>
                Facts-only reference: {state.practiceBed.reference_title} · {state.practiceBed.key} ·{" "}
                {state.practiceBed.meter.numerator}/{state.practiceBed.meter.denominator}. No source lyrics,
                melody, riffs, notation, or recordings.
              </p>
            )}
            <strong>
              {activePresentationTransition !== null
                ? `${presentation.phase.toUpperCase()} · REV ${activePresentationTransition.revision_after}`
                : state.practiceBed === null
                  ? `${studioToolCount} ${studioToolCount === 1 ? "CHANNEL" : "CHANNELS"} · CODE MODE`
                  : "REFERENCE FACTS → ORIGINAL MIDI"}
            </strong>
          </section>

          <dl className="mix-readouts">
            <div>
              <dt>KEY</dt>
              <dd>
                {keyOffset > 0 ? `+${keyOffset}` : keyOffset}
                <small>ST</small>
              </dd>
            </div>
            <div>
              <dt>SPEED</dt>
              <dd>
                {state.bpm}
                <small>BPM</small>
              </dd>
            </div>
            <div>
              <dt>MIX</dt>
              <dd>
                {state.tracks.length}
                <small>STEMS</small>
              </dd>
            </div>
            <div>
              <dt>STATE</dt>
              <dd>
                {state.revision}
                <small>REV</small>
              </dd>
            </div>
            <div>
              <dt>COUNT-IN</dt>
              <dd>
                {state.karaokeCountInBeats}
                <small>BEATS</small>
              </dd>
            </div>
            <div>
              <dt>GUIDE</dt>
              <dd>
                {guide?.tokens.length ?? 0}
                <small>WORDS</small>
              </dd>
            </div>
          </dl>

          <div className="live-meter" aria-label="Studio playback engine status">
            <span>STUDIO MIX</span>
            <div aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => (
                <i key={index} />
              ))}
            </div>
            <strong>{engineStatus === "ready" ? "READY" : engineStatus.toUpperCase()}</strong>
          </div>

          {state.preview !== null ? (
            <section className="staged-change" data-testid="karaoke-preview">
              <small>ENGINEER CHANGE / 待機中</small>
              <strong>{previewLabel(state.preview)}</strong>
              <p>Audition the change. Apply it when it feels right.</p>
              <div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("apply", () => applyStudioPreview(state.preview!.id, state.revision))
                  }
                >
                  APPLY
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("discard", () => discardStudioPreview(state.preview!.id, state.revision))
                  }
                >
                  KEEP CURRENT
                </button>
              </div>
            </section>
          ) : (
            <section className="agent-feed">
              <small>ROOM LOG / 通信記録</small>
              <p>{latestLog?.message ?? "The room is ready."}</p>
              <span>
                {latestLog?.actor ?? "ENGINE"} · {studioModelContextMode}
              </span>
            </section>
          )}

          <section className="score-card">
            <small>VOCAL SCORE / LOCAL ONLY</small>
            <div>
              <strong>{karaokeSession.result?.score ?? "—"}</strong>
              <span>
                {karaokeSession.result?.score === null || karaokeSession.result === null
                  ? "SING TO SCORE"
                  : "POINTS"}
              </span>
            </div>
            <p>{karaokeSession.message}</p>
          </section>

          <footer className="history-controls">
            <button
              type="button"
              disabled={state.historyDepth === 0 || busy !== null}
              onClick={() => void run("undo", () => undoStudioEdit(state.revision))}
            >
              UNDO
            </button>
            <span>{state.mutationCount} EDITS</span>
            <button
              type="button"
              disabled={state.redoDepth === 0 || busy !== null}
              onClick={() => void run("redo", () => redoStudioEdit(state.revision))}
            >
              REDO
            </button>
          </footer>
        </aside>
      </section>

      {(error !== null || engineStatus === "error") && (
        <div className="karaoke-error" role="alert">
          <strong>ROOM CHECK</strong>
          <span>{error ?? engineMessage ?? "The audio engine could not start."}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <div
        className="karaoke-audio-engine"
        data-project-id={state.projectId}
        data-revision={state.revision}
        data-track-count={state.tracks.length}
        aria-hidden="true"
      >
        <DawTimeline
          ref={timelineRef}
          state={state}
          onSelection={() => undefined}
          onTrackMix={() => undefined}
          onClipEdit={() => undefined}
          onTime={(time) => {
            playheadRef.current = time
            setPlayhead(time)
          }}
          onPlaying={setPlaying}
          onEngineStatus={(status, message) => {
            setEngineStatus(status)
            setEngineMessage(message ?? null)
          }}
        />
      </div>
    </main>
  )
}
