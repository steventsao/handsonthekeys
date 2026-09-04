import {
  DawEditorElement,
  type ClipConfig,
  type DawClipMoveDetail,
  type DawClipTrimDetail,
  type DawSelectionDetail,
  type DawTrackControlDetail,
  type DawTrackElement
} from "@dawcore/components"
import type { PlayoutAdapter } from "@waveform-playlist/engine"
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import type { LearningTransportLoop } from "./InstrumentLearning.ts"
import type { StudioClip, StudioState } from "./Studio.ts"
import { audioBufferToWavBlob, resolveClipAudioUrl } from "./audioAssets.ts"
import { createStudioPlayoutAdapter, studioTransportSecondsAtBeat } from "./studioPlayout.ts"
import type { StudioViewFocus } from "./studioView.ts"

interface ClipBinding {
  readonly domainId: string
  readonly dawId: string
  readonly element: HTMLElement & {
    readonly clipId: string
    start: number
    duration: number
    color: string
  }
}

interface TrackBinding {
  readonly domainId: string
  readonly dawId: string
  readonly element: DawTrackElement
  readonly clips: Map<string, ClipBinding>
}

export interface DawTimelineHandle {
  readonly togglePlay: (start?: number) => Promise<void>
  readonly playSelection: () => Promise<void>
  readonly playRange: (start: number, end: number) => Promise<void>
  readonly setLoop: (enabled: boolean, start: number, end: number) => Promise<void>
  readonly pause: () => void
  readonly stop: () => void
  readonly seekTo: (time: number) => void
  readonly seekToStart: () => void
  readonly zoomIn: () => void
  readonly zoomOut: () => void
  readonly focusView: (focus: StudioViewFocus) => Promise<void>
  readonly clearViewFocus: () => void
  readonly exportWav: () => Promise<Blob>
}

interface DawTimelineProps {
  readonly state: StudioState
  readonly transportLoop?: LearningTransportLoop
  readonly playoutAdapter?: PlayoutAdapter
  readonly onSelection: (start: number, end: number) => void
  readonly onTrackMix: (
    trackId: string,
    changes: {
      readonly volume?: number
      readonly pan?: number
      readonly muted?: boolean
      readonly soloed?: boolean
    }
  ) => void
  readonly onClipEdit: (trackId: string, clipId: string, start: number, duration: number) => void
  readonly onTime: (time: number) => void
  readonly onPlaying: (playing: boolean) => void
  readonly onEngineStatus: (status: "loading" | "ready" | "error", message?: string) => void
}

const clipConfig = (clip: StudioClip, bpm: number): ClipConfig =>
  clip.kind === "midi"
    ? {
        start: clip.start,
        duration: clip.duration,
        gain: clip.gain,
        name: clip.name,
        midiNotes: [...clip.notes],
        midiChannel:
          clip.midiChannel ?? (clip.source.kind !== "upload" && clip.source.sound === "drums" ? 9 : 0),
        midiProgram:
          clip.midiProgram ?? (clip.source.kind !== "upload" && clip.source.sound === "bass" ? 38 : 81)
      }
    : {
        src: resolveClipAudioUrl(clip, bpm),
        start: clip.start,
        duration: clip.duration,
        gain: clip.gain,
        name: clip.name
      }

const findDomainTrackId = (bindings: ReadonlyMap<string, TrackBinding>, dawTrackId: string) =>
  Array.from(bindings.values()).find((binding) => binding.dawId === dawTrackId)?.domainId

const findDomainClip = (
  bindings: ReadonlyMap<string, TrackBinding>,
  dawTrackId: string,
  dawClipId: string
): { readonly track: TrackBinding; readonly clip: ClipBinding } | undefined => {
  const track = Array.from(bindings.values()).find((binding) => binding.dawId === dawTrackId)
  if (track === undefined) return undefined
  const clip = Array.from(track.clips.values()).find((binding) => binding.dawId === dawClipId)
  return clip === undefined ? undefined : { track, clip }
}

const studioComponentContract = `
  :host {
    accent-color: #58a6ff;
    caret-color: transparent;
    user-select: none;
    -webkit-user-select: none;
  }

  :focus-visible {
    outline: 1px solid #58a6ff !important;
    outline-offset: 2px !important;
  }

  ::selection {
    background: #58a6ff;
    color: #101318;
  }

  .ruler-viewport,
  .timeline {
    cursor: crosshair !important;
    user-select: none;
    -webkit-user-select: none;
  }

  .scroll-area {
    min-height: 0 !important;
    overflow-x: auto !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
    scrollbar-color: rgba(167, 171, 177, 0.72) rgba(20, 22, 25, 0.92);
    scrollbar-gutter: stable;
    scrollbar-width: thin;
  }

  .scroll-area::-webkit-scrollbar {
    width: 12px;
    height: 12px;
  }

  .scroll-area::-webkit-scrollbar-track {
    background: rgba(20, 22, 25, 0.92);
  }

  .scroll-area::-webkit-scrollbar-thumb {
    border: 3px solid rgba(20, 22, 25, 0.92);
    border-radius: 999px;
    background: rgba(167, 171, 177, 0.72);
  }

  .scroll-area::-webkit-scrollbar-thumb:hover {
    background: rgba(217, 221, 226, 0.88);
  }

  .track-row.selected,
  .track-row[data-track-drag-source] {
    background: rgba(88, 166, 255, 0.09) !important;
  }

  :host([data-studio-track-color]) {
    box-shadow: inset 4px 0 var(--studio-track-color, #58a6ff);
  }

  .clip-container[data-studio-color] {
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--studio-clip-color) 78%, #ffffff) !important;
    border-radius: 4px;
    background: color-mix(in srgb, var(--studio-clip-color) 48%, #17191d) !important;
    box-shadow: inset 0 1px color-mix(in srgb, var(--studio-clip-color) 46%, #ffffff) !important;
  }

  .clip-container[data-studio-color] .clip-header {
    background: color-mix(in srgb, var(--studio-clip-color) 28%, #17191d) !important;
    border-bottom-color: color-mix(in srgb, var(--studio-clip-color) 48%, transparent) !important;
  }

  .clip-container[data-studio-color] daw-piano-roll {
    --daw-piano-roll-background: color-mix(in srgb, var(--studio-clip-color) 24%, #17191d);
    --daw-piano-roll-note-color: color-mix(in srgb, var(--studio-clip-color) 74%, #ffffff);
    --daw-piano-roll-selected-note-color: #ffffff;
  }

  :host([data-agent-track-focus]) .track-row:not([data-agent-focus-track]),
  :host([data-agent-track-focus]) daw-track-controls:not([data-agent-focus-track]) {
    opacity: 0.38;
  }

  .agent-focus-range {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 6;
    box-sizing: border-box;
    pointer-events: none;
    background: rgba(243, 200, 75, 0.15);
    border-inline: 1px dashed rgba(243, 200, 75, 0.96);
    box-shadow:
      inset 0 1px rgba(243, 200, 75, 0.78),
      inset 0 -1px rgba(243, 200, 75, 0.78);
  }

  .transport-loop-range {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 5;
    box-sizing: border-box;
    pointer-events: none;
    background: rgba(99, 199, 102, 0.08);
    border-inline: 2px solid rgba(99, 199, 102, 0.92);
    box-shadow:
      inset 0 2px rgba(99, 199, 102, 0.78),
      inset 0 -1px rgba(99, 199, 102, 0.4);
  }

  .track-row[data-agent-focus-track] .clip-container {
    box-shadow:
      inset 0 0 0 1px rgba(243, 200, 75, 0.9),
      inset 0 0 0 1000px rgba(243, 200, 75, 0.08) !important;
  }

  daw-track-controls[data-agent-focus-track] {
    filter: brightness(1.42);
  }

  :host([scale-mode="beats"]) .track-row.selected .clip-container {
    box-shadow:
      inset 0 0 0 1px rgba(88, 166, 255, 0.72),
      inset 0 0 0 1000px rgba(88, 166, 255, 0.08) !important;
  }

  .btn.active {
    border-color: rgba(243, 200, 75, 0.7) !important;
    background: rgba(243, 200, 75, 0.22) !important;
    color: #ffe78d !important;
  }

  .btn.muted-active {
    border-color: rgba(88, 166, 255, 0.52) !important;
    background: rgba(88, 166, 255, 0.13) !important;
    color: #9dccff !important;
  }

  .remove-btn:hover {
    color: #ff625f !important;
  }

  button[data-recording] {
    border-color: #ff625f !important;
    background: rgba(255, 98, 95, 0.16) !important;
    color: #ff8a87 !important;
  }

  @media (max-width: 620px) {
    :host {
      -webkit-tap-highlight-color: transparent;
    }

    .scroll-area {
      overscroll-behavior: contain;
      scrollbar-gutter: auto;
      touch-action: pan-x pan-y;
    }

    .scroll-area::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    .scroll-area::-webkit-scrollbar-thumb {
      border: 1px solid rgba(20, 22, 25, 0.92);
    }

    .grip,
    .remove-btn,
    .reorder-up,
    .reorder-down {
      display: none !important;
    }

    .header {
      min-height: 1.25rem;
    }

    .buttons {
      gap: 4px;
    }

    .btn {
      min-width: 0;
      min-height: 1.8rem;
      flex: 1;
      padding-inline: 4px !important;
    }

    .slider-label {
      width: 2.75rem;
    }
  }
`

const installStudioComponentContract = (editor: DawEditorElement): void => {
  const visit = (root: Pick<ParentNode, "querySelectorAll">): void => {
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot === null) continue
      if (element.shadowRoot.querySelector("style[data-studio-contract]") === null) {
        const style = document.createElement("style")
        style.dataset.studioContract = ""
        style.textContent = studioComponentContract
        element.shadowRoot.append(style)
      }
      visit(element.shadowRoot)
    }
  }

  if (editor.shadowRoot !== null && editor.shadowRoot.querySelector("style[data-studio-contract]") === null) {
    const style = document.createElement("style")
    style.dataset.studioContract = ""
    style.textContent = studioComponentContract
    editor.shadowRoot.append(style)
  }
  if (editor.shadowRoot !== null) visit(editor.shadowRoot)
  visit(editor)
}

const applyStudioTrackColors = (
  editor: DawEditorElement,
  bindings: ReadonlyMap<string, TrackBinding>,
  tracks: StudioState["tracks"]
): void => {
  const trackRows = Array.from(editor.shadowRoot?.querySelectorAll<HTMLElement>(".track-row") ?? [])
  const trackControls = Array.from(
    editor.shadowRoot?.querySelectorAll<HTMLElement>("daw-track-controls") ?? []
  )
  const clipContainers = Array.from(
    editor.shadowRoot?.querySelectorAll<HTMLElement>(".clip-container[data-clip-id]") ?? []
  )

  for (const track of tracks) {
    const binding = bindings.get(track.id)
    if (binding === undefined) continue
    binding.element.style.setProperty("--studio-track-color", track.color)

    const row = trackRows.find((candidate) => candidate.dataset.trackId === binding.dawId)
    if (row !== undefined) {
      row.dataset.studioTrackColor = ""
      row.style.setProperty("--studio-track-color", track.color)
    }

    const controls = trackControls.find(
      (candidate) => (candidate as HTMLElement & { readonly trackId?: string }).trackId === binding.dawId
    )
    if (controls !== undefined) {
      controls.dataset.studioTrackColor = ""
      controls.style.setProperty("--studio-track-color", track.color)
    }

    for (const clip of track.clips) {
      const clipBinding = binding.clips.get(clip.id)
      if (clipBinding === undefined) continue
      clipBinding.element.color = clip.color
      const container = clipContainers.find((candidate) => candidate.dataset.clipId === clipBinding.dawId)
      if (container === undefined) continue
      container.dataset.studioColor = ""
      container.style.setProperty("--studio-clip-color", clip.color)
    }
  }
}

const renderStudioViewFocus = (
  editor: DawEditorElement,
  bindings: ReadonlyMap<string, TrackBinding>,
  focus: StudioViewFocus
): ReadonlyArray<HTMLElement> => {
  editor.toggleAttribute("data-agent-view-focus", true)
  editor.toggleAttribute("data-agent-track-focus", focus.trackIds.length > 0)

  const focusedTrackIds = new Set(focus.trackIds)
  const focusedDawTrackIds = new Set(
    Array.from(bindings.values())
      .filter((binding) => focusedTrackIds.has(binding.domainId))
      .map((binding) => binding.dawId)
  )
  const trackRows = Array.from(editor.shadowRoot?.querySelectorAll<HTMLElement>(".track-row") ?? [])
  const trackControls = Array.from(
    editor.shadowRoot?.querySelectorAll<HTMLElement>("daw-track-controls") ?? []
  )

  for (const range of editor.shadowRoot?.querySelectorAll(".agent-focus-range") ?? []) range.remove()
  const focusedRows: HTMLElement[] = []
  for (const row of trackRows) {
    const explicitlyFocused = focusedDawTrackIds.has(row.dataset.trackId ?? "")
    row.toggleAttribute("data-agent-focus-track", explicitlyFocused)
    if (focus.trackIds.length > 0 && !explicitlyFocused) continue

    focusedRows.push(row)
    const range = document.createElement("div")
    range.className = "agent-focus-range"
    range.dataset.agentFocusRange = ""
    range.setAttribute("aria-hidden", "true")
    range.style.left = `${(focus.startBeat * editor.ppqn) / editor.ticksPerPixel}px`
    range.style.width = `${((focus.endBeat - focus.startBeat) * editor.ppqn) / editor.ticksPerPixel}px`
    row.appendChild(range)
  }
  for (const controls of trackControls) {
    const dawTrackId = (controls as HTMLElement & { readonly trackId?: string }).trackId ?? ""
    controls.toggleAttribute("data-agent-focus-track", focusedDawTrackIds.has(dawTrackId))
  }
  return focusedRows
}

const clearStudioViewFocusRendering = (editor: DawEditorElement): void => {
  editor.removeAttribute("data-agent-view-focus")
  editor.removeAttribute("data-agent-track-focus")
  for (const element of editor.shadowRoot?.querySelectorAll<HTMLElement>("[data-agent-focus-track]") ?? []) {
    element.removeAttribute("data-agent-focus-track")
  }
  for (const range of editor.shadowRoot?.querySelectorAll(".agent-focus-range") ?? []) range.remove()
}

const renderTransportLoop = (editor: DawEditorElement, loop: LearningTransportLoop): void => {
  for (const range of editor.shadowRoot?.querySelectorAll(".transport-loop-range") ?? []) range.remove()
  editor.toggleAttribute("data-transport-loop", loop.enabled)
  if (!loop.enabled) return

  const trackRows = Array.from(editor.shadowRoot?.querySelectorAll<HTMLElement>(".track-row") ?? [])
  for (const row of trackRows) {
    const range = document.createElement("div")
    range.className = "transport-loop-range"
    range.dataset.transportLoopRange = ""
    range.setAttribute("aria-hidden", "true")
    range.style.left = `${(loop.startBeat * editor.ppqn) / editor.ticksPerPixel}px`
    range.style.width = `${((loop.endBeat - loop.startBeat) * editor.ppqn) / editor.ticksPerPixel}px`
    row.appendChild(range)
  }
}

interface TransportLoopSeconds {
  readonly enabled: boolean
  readonly start: number
  readonly end: number
}

const loopSecondsOf = (
  loop: LearningTransportLoop,
  bpm: number,
  adapter?: PlayoutAdapter
): TransportLoopSeconds => ({
  enabled: loop.enabled,
  start:
    adapter === undefined
      ? (loop.startBeat * 60) / bpm
      : studioTransportSecondsAtBeat(adapter, loop.startBeat, bpm),
  end:
    adapter === undefined
      ? (loop.endBeat * 60) / bpm
      : studioTransportSecondsAtBeat(adapter, loop.endBeat, bpm)
})

const playsActiveLoop = (loop: TransportLoopSeconds, start: number, end: number): boolean =>
  loop.enabled && Math.abs(loop.start - start) <= 0.01 && Math.abs(loop.end - end) <= 0.01

const disabledTransportLoop: LearningTransportLoop = { enabled: false, startBeat: 0, endBeat: 4 }

export const DawTimeline = forwardRef<DawTimelineHandle, DawTimelineProps>(function DawTimeline(
  {
    state,
    transportLoop = disabledTransportLoop,
    playoutAdapter,
    onSelection,
    onTrackMix,
    onClipEdit,
    onTime,
    onPlaying,
    onEngineStatus
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<DawEditorElement | null>(null)
  const bindingsRef = useRef(new Map<string, TrackBinding>())
  const latestStateRef = useRef(state)
  const latestTransportLoopRef = useRef(transportLoop)
  const loopSecondsRef = useRef(loopSecondsOf(transportLoop, state.bpm, playoutAdapter))
  const callbacksRef = useRef({ onSelection, onTrackMix, onClipEdit, onTime, onPlaying, onEngineStatus })
  const syncQueueRef = useRef(Promise.resolve())
  const clipCommitTimersRef = useRef(new Map<string, number>())
  const programmaticSelectionRef = useRef<StudioState["selection"] | null>(null)
  const viewFocusRef = useRef<StudioViewFocus | null>(null)
  const engineReadyReportedRef = useRef(false)
  const [engineReady, setEngineReady] = useState(false)

  latestStateRef.current = state
  latestTransportLoopRef.current = transportLoop
  callbacksRef.current = { onSelection, onTrackMix, onClipEdit, onTime, onPlaying, onEngineStatus }

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    engineReadyReportedRef.current = false

    const editor = document.createElement("daw-editor")
    editor.id = "signal-studio-daw"
    editor.eagerResume = "document"
    editor.scaleMode = "beats"
    editor.ticksPerPixel = 20
    editor.waveHeight = 74
    editor.timescale = true
    editor.clipHeaders = true
    editor.interactiveClips = true
    editor.trackReordering = true
    editor.fillViewport = true
    editor.snapTo = "1/4"
    editor.bpm = latestStateRef.current.bpm
    editor.timeSignature = [...latestStateRef.current.timeSignature]
    editor.adapter = playoutAdapter ?? createStudioPlayoutAdapter()
    editor.style.setProperty("--daw-background", "#17191d")
    editor.style.setProperty("--daw-controls-background", "#24272c")
    editor.style.setProperty("--daw-controls-text", "#d9dde2")
    editor.style.setProperty("--daw-border-color", "rgba(255, 255, 255, 0.13)")
    editor.style.setProperty("--daw-wave-color", "#67b6ff")
    editor.style.setProperty("--daw-waveform-color", "#67b6ff")
    editor.style.setProperty("--daw-progress-color", "#63c766")
    editor.style.setProperty("--daw-playhead-color", "#f4f6f8")
    editor.style.setProperty("--daw-ruler-color", "#aeb3ba")
    editor.style.setProperty("--daw-ruler-background", "#202328")
    editor.style.setProperty("--daw-selection-color", "rgba(88, 166, 255, 0.2)")
    editor.style.setProperty("--daw-clip-header-background", "rgba(20, 22, 25, 0.72)")
    editor.style.setProperty("--daw-clip-header-text", "#f2f5f7")
    editor.style.setProperty("--daw-annotation-list-background", "#202328")
    editor.style.setProperty("--daw-annotation-text-color", "#d9dde2")
    editor.style.setProperty("--daw-annotation-box-border", "#58a6ff")
    editor.style.setProperty("--daw-annotation-box-background", "rgba(88, 166, 255, 0.1)")
    editor.style.setProperty("--daw-annotation-playing-background", "rgba(99, 199, 102, 0.14)")
    editor.style.setProperty("--daw-annotation-active-background", "rgba(88, 166, 255, 0.2)")
    editor.style.setProperty("--daw-piano-roll-background", "#1d2024")
    editor.style.setProperty("--daw-piano-roll-note-color", "#67b6ff")
    editor.style.setProperty("--daw-piano-roll-selected-note-color", "#ffffff")
    editor.style.cursor = "default"
    editor.style.userSelect = "none"

    const shortcuts = document.createElement("daw-keyboard-shortcuts")
    shortcuts.setAttribute("playback", "")
    shortcuts.setAttribute("splitting", "")
    shortcuts.setAttribute("undo", "")
    editor.appendChild(shortcuts)

    const selectionListener = (event: Event) => {
      const detail = (event as CustomEvent<DawSelectionDetail>).detail
      if (
        !Number.isFinite(detail.start) ||
        !Number.isFinite(detail.end) ||
        detail.start < 0 ||
        detail.end <= detail.start
      ) {
        return
      }
      const programmatic = programmaticSelectionRef.current
      if (
        programmatic !== null &&
        Math.abs(detail.start - programmatic.start) <= 0.01 &&
        Math.abs(detail.end - programmatic.end) <= 0.01
      ) {
        programmaticSelectionRef.current = null
        return
      }
      const current = latestStateRef.current.selection
      if (Math.abs(detail.start - current.start) > 0.01 || Math.abs(detail.end - current.end) > 0.01) {
        callbacksRef.current.onSelection(detail.start, detail.end)
      }
    }
    const timeListener = (event: Event) =>
      callbacksRef.current.onTime((event as CustomEvent<{ readonly time: number }>).detail.time)
    const playListener = () => callbacksRef.current.onPlaying(true)
    const stopListener = () => callbacksRef.current.onPlaying(false)
    const mixListener = (event: Event) => {
      const detail = (event as CustomEvent<DawTrackControlDetail>).detail
      const domainId = findDomainTrackId(bindingsRef.current, detail.trackId)
      if (domainId === undefined) return
      switch (detail.prop) {
        case "volume":
          callbacksRef.current.onTrackMix(domainId, { volume: Number(detail.value) })
          break
        case "pan":
          callbacksRef.current.onTrackMix(domainId, { pan: Number(detail.value) })
          break
        case "muted":
          callbacksRef.current.onTrackMix(domainId, { muted: Boolean(detail.value) })
          break
        case "soloed":
          callbacksRef.current.onTrackMix(domainId, { soloed: Boolean(detail.value) })
          break
      }
    }
    const scheduleClipCommit = (event: Event) => {
      const detail = (event as CustomEvent<DawClipMoveDetail | DawClipTrimDetail>).detail
      const binding = findDomainClip(bindingsRef.current, detail.trackId, detail.clipId)
      if (binding === undefined) return
      const key = `${binding.track.domainId}:${binding.clip.domainId}`
      const existing = clipCommitTimersRef.current.get(key)
      if (existing !== undefined) window.clearTimeout(existing)
      const timer = window.setTimeout(() => {
        clipCommitTimersRef.current.delete(key)
        const domainTrack = latestStateRef.current.tracks.find((track) => track.id === binding.track.domainId)
        const domainClip = domainTrack?.clips.find((clip) => clip.id === binding.clip.domainId)
        if (
          domainClip !== undefined &&
          (Math.abs(domainClip.start - binding.clip.element.start) > 0.01 ||
            Math.abs(domainClip.duration - binding.clip.element.duration) > 0.01)
        ) {
          callbacksRef.current.onClipEdit(
            binding.track.domainId,
            binding.clip.domainId,
            binding.clip.element.start,
            binding.clip.element.duration
          )
        }
      }, 140)
      clipCommitTimersRef.current.set(key, timer)
    }

    editor.addEventListener("daw-selection", selectionListener)
    editor.addEventListener("daw-timeupdate", timeListener)
    editor.addEventListener("daw-play", playListener)
    editor.addEventListener("daw-pause", stopListener)
    editor.addEventListener("daw-stop", stopListener)
    editor.addEventListener("daw-ended", stopListener)
    editor.addEventListener("daw-track-control", mixListener)
    editor.addEventListener("daw-clip-move", scheduleClipCommit)
    editor.addEventListener("daw-clip-trim", scheduleClipCommit)

    host.replaceChildren(editor)
    editorRef.current = editor
    callbacksRef.current.onEngineStatus("loading")
    void editor
      .ready()
      .then(() => {
        if (editorRef.current !== editor) return
        installStudioComponentContract(editor)
        setEngineReady(true)
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        callbacksRef.current.onEngineStatus("error", message)
      })

    return () => {
      for (const timer of clipCommitTimersRef.current.values()) window.clearTimeout(timer)
      clipCommitTimersRef.current.clear()
      editor.removeEventListener("daw-selection", selectionListener)
      editor.removeEventListener("daw-timeupdate", timeListener)
      editor.removeEventListener("daw-play", playListener)
      editor.removeEventListener("daw-pause", stopListener)
      editor.removeEventListener("daw-stop", stopListener)
      editor.removeEventListener("daw-ended", stopListener)
      editor.removeEventListener("daw-track-control", mixListener)
      editor.removeEventListener("daw-clip-move", scheduleClipCommit)
      editor.removeEventListener("daw-clip-trim", scheduleClipCommit)
      bindingsRef.current.clear()
      engineReadyReportedRef.current = false
      editor.remove()
      editorRef.current = null
      setEngineReady(false)
    }
  }, [playoutAdapter])

  useEffect(() => {
    if (!engineReady) return
    const editor = editorRef.current
    if (editor === null) return

    const synchronize = async () => {
      editor.bpm = state.bpm
      editor.timeSignature = [...state.timeSignature]

      for (const [domainId, binding] of bindingsRef.current) {
        if (!state.tracks.some((track) => track.id === domainId)) {
          editor.removeTrack(binding.dawId)
          bindingsRef.current.delete(domainId)
        }
      }

      for (const track of state.tracks) {
        let binding = bindingsRef.current.get(track.id)
        if (binding === undefined) {
          const element = await editor.addTrack({
            name: track.name,
            volume: track.volume,
            pan: track.pan,
            muted: track.muted,
            soloed: track.soloed,
            renderMode: track.kind === "midi" ? "piano-roll" : "waveform",
            clips: track.clips.map((clip) => clipConfig(clip, state.bpm))
          })
          element.dataset.domainTrackId = track.id
          const clipElements = Array.from(element.querySelectorAll("daw-clip"))
          const clips = new Map<string, ClipBinding>()
          track.clips.forEach((clip, index) => {
            const clipElement = clipElements[index]
            if (clipElement === undefined) return
            clipElement.dataset.domainClipId = clip.id
            clips.set(clip.id, {
              domainId: clip.id,
              dawId: clipElement.clipId,
              element: clipElement
            })
          })
          binding = { domainId: track.id, dawId: element.trackId, element, clips }
          bindingsRef.current.set(track.id, binding)
        } else {
          editor.updateTrack(binding.dawId, {
            name: track.name,
            volume: track.volume,
            pan: track.pan,
            muted: track.muted,
            soloed: track.soloed,
            renderMode: track.kind === "midi" ? "piano-roll" : "waveform"
          })

          for (const [clipId, clipBinding] of binding.clips) {
            if (!track.clips.some((clip) => clip.id === clipId)) {
              editor.removeClip(binding.dawId, clipBinding.dawId)
              binding.clips.delete(clipId)
            }
          }

          for (const clip of track.clips) {
            const currentClip = binding.clips.get(clip.id)
            if (currentClip === undefined) {
              const dawId = await editor.addClip(binding.dawId, clipConfig(clip, state.bpm))
              const element = Array.from(binding.element.querySelectorAll("daw-clip")).find(
                (candidate) => candidate.clipId === dawId
              )
              if (element !== undefined) {
                element.dataset.domainClipId = clip.id
                binding.clips.set(clip.id, { domainId: clip.id, dawId, element })
              }
            } else {
              editor.updateClip(binding.dawId, currentClip.dawId, {
                start: clip.start,
                duration: clip.duration,
                gain: clip.gain,
                name: clip.name,
                ...(clip.kind === "midi" ? { midiNotes: [...clip.notes] } : {})
              })
            }
          }
        }
      }

      const currentSelection = editor.selection
      const synchronizedSelection = state.selection
      if (
        currentSelection === null ||
        Math.abs(currentSelection.start - synchronizedSelection.start) > 0.01 ||
        Math.abs(currentSelection.end - synchronizedSelection.end) > 0.01
      ) {
        programmaticSelectionRef.current = synchronizedSelection
        editor.setSelection(synchronizedSelection.start, synchronizedSelection.end)
      }

      await editor.updateComplete
      installStudioComponentContract(editor)
      applyStudioTrackColors(editor, bindingsRef.current, state.tracks)
      const loopSeconds = loopSecondsOf(transportLoop, state.bpm, playoutAdapter)
      loopSecondsRef.current = loopSeconds
      const engine = await editor.ready()
      engine.setLoopRegion(loopSeconds.start, loopSeconds.end)
      engine.setLoopEnabled(loopSeconds.enabled)
      renderTransportLoop(editor, transportLoop)
      const viewFocus = viewFocusRef.current
      if (viewFocus !== null) renderStudioViewFocus(editor, bindingsRef.current, viewFocus)
      if (!engineReadyReportedRef.current) {
        engineReadyReportedRef.current = true
        callbacksRef.current.onEngineStatus("ready")
      }
    }

    syncQueueRef.current = syncQueueRef.current.then(synchronize).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      callbacksRef.current.onEngineStatus("error", message)
    })
  }, [engineReady, playoutAdapter, state, transportLoop])

  useImperativeHandle(
    ref,
    () => ({
      togglePlay: async (requestedStart) => {
        const editor = editorRef.current
        if (editor === null) return
        if (editor.isPlaying) {
          editor.pause()
          return
        }

        await syncQueueRef.current
        const duration = editor.duration
        if (!Number.isFinite(duration) || duration <= 0) return
        const loop = loopSecondsRef.current
        if (loop.enabled) {
          const candidate = requestedStart ?? editor.currentTime
          const start = candidate >= loop.start && candidate < loop.end ? candidate : loop.start
          await editor.play(start)
          return
        }
        const current = requestedStart ?? editor.currentTime
        const start = current >= duration ? 0 : Math.max(0, current)
        await editor.play(start, duration)
      },
      playSelection: async () => {
        const editor = editorRef.current
        if (editor === null) return
        await syncQueueRef.current
        const loop = loopSecondsRef.current
        if (playsActiveLoop(loop, state.selection.start, state.selection.end)) {
          await editor.play(state.selection.start)
        } else {
          await editor.play(state.selection.start, state.selection.end)
        }
      },
      playRange: async (start, end) => {
        const editor = editorRef.current
        if (editor === null) return
        await syncQueueRef.current
        const safeStart = Math.max(0, start)
        const safeEnd = Math.min(editor.duration, end)
        if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart) return
        if (playsActiveLoop(loopSecondsRef.current, safeStart, safeEnd)) {
          await editor.play(safeStart)
        } else {
          await editor.play(safeStart, safeEnd)
        }
      },
      setLoop: async (enabled, start, end) => {
        const editor = editorRef.current
        if (editor === null) return
        await syncQueueRef.current
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
          throw new Error("Choose a valid loop range with an end after its start.")
        }
        const loop = { enabled, start, end }
        loopSecondsRef.current = loop
        const engine = await editor.ready()
        engine.setLoopRegion(start, end)
        engine.setLoopEnabled(enabled)
      },
      pause: () => editorRef.current?.pause(),
      stop: () => editorRef.current?.stop(),
      seekTo: (time) => editorRef.current?.seekTo(Math.max(0, time)),
      seekToStart: () => editorRef.current?.seekTo(0),
      zoomIn: () => {
        const editor = editorRef.current
        if (editor !== null) {
          editor.ticksPerPixel = Math.max(4, editor.ticksPerPixel * 0.8)
          void editor.updateComplete.then(() => renderTransportLoop(editor, latestTransportLoopRef.current))
        }
      },
      zoomOut: () => {
        const editor = editorRef.current
        if (editor !== null) {
          editor.ticksPerPixel = Math.min(96, editor.ticksPerPixel * 1.25)
          void editor.updateComplete.then(() => renderTransportLoop(editor, latestTransportLoopRef.current))
        }
      },
      focusView: async (focus) => {
        viewFocusRef.current = focus
        await syncQueueRef.current
        const editor = editorRef.current
        if (editor === null) return

        const scrollArea = editor.shadowRoot?.querySelector<HTMLElement>(".scroll-area")
        if (scrollArea === null || scrollArea === undefined) return
        const paddedStartBeat = Math.max(0, focus.startBeat - focus.paddingBeats)
        const paddedEndBeat = focus.endBeat + focus.paddingBeats
        const viewportWidth = Math.max(240, scrollArea.clientWidth)
        editor.ticksPerPixel = Math.min(
          96,
          Math.max(4, ((paddedEndBeat - paddedStartBeat) * editor.ppqn) / viewportWidth)
        )

        await editor.updateComplete
        renderTransportLoop(editor, latestTransportLoopRef.current)
        const focusedRows = renderStudioViewFocus(editor, bindingsRef.current, focus)
        const focusStartPixels = (focus.startBeat * editor.ppqn) / editor.ticksPerPixel
        const focusWidthPixels = ((focus.endBeat - focus.startBeat) * editor.ppqn) / editor.ticksPerPixel
        const targetScrollLeft = Math.max(
          0,
          focusStartPixels - Math.max(0, scrollArea.clientWidth - focusWidthPixels) / 2
        )

        let targetScrollTop = scrollArea.scrollTop

        if (focus.trackIds.length > 0) {
          const firstRow = focusedRows.at(0)
          const lastRow = focusedRows.at(-1)
          if (firstRow !== undefined && lastRow !== undefined) {
            const focusTop = firstRow.offsetTop
            const focusBottom = lastRow.offsetTop + lastRow.offsetHeight
            const centeredScrollTop =
              focusTop - Math.max(0, scrollArea.clientHeight - (focusBottom - focusTop)) / 2
            targetScrollTop = Math.min(
              Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight),
              Math.max(0, centeredScrollTop)
            )
          }
        }

        scrollArea.scrollTo({
          left: targetScrollLeft,
          top: targetScrollTop,
          behavior: "auto"
        })
      },
      clearViewFocus: () => {
        viewFocusRef.current = null
        const editor = editorRef.current
        if (editor === null) return
        clearStudioViewFocusRendering(editor)
        const selection = latestStateRef.current.selection
        const currentSelection = editor.selection
        if (
          currentSelection === null ||
          Math.abs(currentSelection.start - selection.start) > 0.01 ||
          Math.abs(currentSelection.end - selection.end) > 0.01
        ) {
          programmaticSelectionRef.current = selection
          editor.setSelection(selection.start, selection.end)
        }
      },
      exportWav: async () => {
        const editor = editorRef.current
        if (editor === null) throw new Error("Audio engine is not ready.")
        return audioBufferToWavBlob(await editor.exportAudio())
      }
    }),
    [state.selection.end, state.selection.start]
  )

  return <div className="dawcore-host" ref={hostRef} data-testid="dawcore-host" />
})
