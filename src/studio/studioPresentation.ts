import { assign, createActor, setup, type ActorOptions } from "xstate"
import type { KaraokeMicrophoneIssue } from "./karaokeSession.ts"
import type {
  StudioActor,
  StudioMutationAction,
  StudioMutationEvent,
  StudioMutationTargets
} from "./Studio.ts"
import type { SessionInstrumentView } from "./sessionInstrumentView.ts"

export type StudioPresentationPhase = "settled" | "announcing" | "animating"
export type StudioPresentationSurface = "unknown" | "session" | "karaoke" | "tab" | "studio"
export type StudioTransportStatus = "stopped" | "click_only" | "counting_in" | "playing" | "paused"
export type StudioEngineStatus = "loading" | "ready" | "error"
export type StudioMicrophoneStatus =
  "idle" | "ready" | "requesting" | "listening" | "scoring" | "complete" | "error"
export type StudioLyricsStatus = "standby" | "counting_in" | "active" | "complete"

export const studioPresentationAnnouncementMs = 140
export const studioPresentationAnimationMs = 560

interface StudioPresentationTransition {
  readonly id: string
  readonly actor: StudioActor
  readonly action: StudioMutationAction
  readonly requestId: string
  readonly revisionBefore: number
  readonly revisionAfter: number
  readonly targets: StudioMutationTargets
  readonly durationMs: number
}

interface StudioPresentationContext {
  readonly reducedMotion: boolean
  readonly surface: StudioPresentationSurface
  readonly activePanel: string | null
  readonly toolsReady: boolean
  readonly transition: StudioPresentationTransition | null
  readonly transport: {
    readonly status: StudioTransportStatus
    readonly playheadBeat: number
    readonly loopEnabled: boolean
    readonly loopStartBeat: number
    readonly loopEndBeat: number
  }
  readonly engine: {
    readonly status: StudioEngineStatus
    readonly message: string | null
  }
  readonly operation: {
    readonly busy: string | null
    readonly error: string | null
  }
  readonly microphone: {
    readonly status: StudioMicrophoneStatus
    readonly issue: KaraokeMicrophoneIssue | null
  }
  readonly lyrics: {
    readonly status: StudioLyricsStatus
    readonly activeTokenId: string | null
    readonly countInRemaining: number | null
  }
  readonly sessionInstruments: SessionInstrumentView | null
}

type StudioPresentationEvent =
  | { readonly type: "studio.mutation.committed"; readonly mutation: StudioMutationEvent }
  | { readonly type: "studio.preference.updated"; readonly reducedMotion: boolean }
  | {
      readonly type: "studio.surface.updated"
      readonly surface: StudioPresentationSurface
      readonly activePanel: string | null
      readonly toolsReady: boolean
    }
  | {
      readonly type: "studio.transport.updated"
      readonly status: StudioTransportStatus
      readonly playheadBeat: number
    }
  | {
      readonly type: "studio.transport.loop.updated"
      readonly enabled: boolean
      readonly startBeat: number
      readonly endBeat: number
    }
  | {
      readonly type: "studio.engine.updated"
      readonly status: StudioEngineStatus
      readonly message: string | null
    }
  | {
      readonly type: "studio.operation.updated"
      readonly busy: string | null
      readonly error: string | null
    }
  | {
      readonly type: "studio.microphone.updated"
      readonly status: StudioMicrophoneStatus
      readonly issue: KaraokeMicrophoneIssue | null
    }
  | {
      readonly type: "studio.lyrics.updated"
      readonly status: StudioLyricsStatus
      readonly activeTokenId: string | null
      readonly countInRemaining: number | null
    }
  | {
      readonly type: "studio.session_instruments.updated"
      readonly view: SessionInstrumentView
    }

const conciseText = (value: string | null): string | null =>
  value === null ? null : value.trim().slice(0, 240)

const animationDurationOf = (action: StudioMutationAction): number => {
  switch (action) {
    case "select_time_range":
    case "select_beat_range":
      return 280
    case "set_track_mix":
    case "move_clip":
      return 420
    case "write_midi":
    case "compose_midi":
      return 680
    default:
      return studioPresentationAnimationMs
  }
}

const initialContext = (reducedMotion: boolean): StudioPresentationContext => ({
  reducedMotion,
  surface: "unknown",
  activePanel: null,
  toolsReady: false,
  transition: null,
  transport: {
    status: "stopped",
    playheadBeat: 0,
    loopEnabled: false,
    loopStartBeat: 0,
    loopEndBeat: 4
  },
  engine: { status: "loading", message: null },
  operation: { busy: null, error: null },
  microphone: { status: "idle", issue: null },
  lyrics: { status: "standby", activeTokenId: null, countInRemaining: null },
  sessionInstruments: null
})

export const studioPresentationMachine = setup({
  types: {
    context: {} as StudioPresentationContext,
    events: {} as StudioPresentationEvent,
    input: {} as { readonly reducedMotion: boolean }
  },
  delays: {
    announcement: studioPresentationAnnouncementMs,
    animation: ({ context }) => context.transition?.durationMs ?? studioPresentationAnimationMs
  },
  guards: {
    reducesMotion: ({ context }) => context.reducedMotion
  },
  actions: {
    rememberMutation: assign(({ event }) => {
      if (event.type !== "studio.mutation.committed") return {}
      const { mutation } = event
      return {
        transition: {
          id: `transition-${mutation.sequence}`,
          actor: mutation.actor,
          action: mutation.action,
          requestId: mutation.requestId,
          revisionBefore: mutation.revisionBefore,
          revisionAfter: mutation.revisionAfter,
          targets: mutation.targets,
          durationMs: animationDurationOf(mutation.action)
        }
      }
    }),
    updatePreference: assign(({ event }) =>
      event.type === "studio.preference.updated" ? { reducedMotion: event.reducedMotion } : {}
    ),
    updateSurface: assign(({ event }) =>
      event.type === "studio.surface.updated"
        ? {
            surface: event.surface,
            activePanel: event.activePanel,
            toolsReady: event.toolsReady
          }
        : {}
    ),
    updateTransport: assign(({ context, event }) =>
      event.type === "studio.transport.updated"
        ? {
            transport: {
              ...context.transport,
              status: event.status,
              playheadBeat: Math.max(0, Math.round(event.playheadBeat * 100) / 100)
            }
          }
        : {}
    ),
    updateTransportLoop: assign(({ context, event }) =>
      event.type === "studio.transport.loop.updated"
        ? {
            transport: {
              ...context.transport,
              loopEnabled: event.enabled,
              loopStartBeat: Math.max(0, Math.round(event.startBeat * 100) / 100),
              loopEndBeat: Math.max(0, Math.round(event.endBeat * 100) / 100)
            }
          }
        : {}
    ),
    updateEngine: assign(({ event }) =>
      event.type === "studio.engine.updated"
        ? { engine: { status: event.status, message: conciseText(event.message) } }
        : {}
    ),
    updateOperation: assign(({ event }) =>
      event.type === "studio.operation.updated"
        ? {
            operation: {
              busy: conciseText(event.busy),
              error: conciseText(event.error)
            }
          }
        : {}
    ),
    updateMicrophone: assign(({ event }) =>
      event.type === "studio.microphone.updated"
        ? { microphone: { status: event.status, issue: event.issue } }
        : {}
    ),
    updateLyrics: assign(({ event }) =>
      event.type === "studio.lyrics.updated"
        ? {
            lyrics: {
              status: event.status,
              activeTokenId: event.activeTokenId,
              countInRemaining: event.countInRemaining
            }
          }
        : {}
    ),
    updateSessionInstruments: assign(({ event }) =>
      event.type === "studio.session_instruments.updated" ? { sessionInstruments: event.view } : {}
    )
  }
}).createMachine({
  id: "studio-presentation",
  context: ({ input }) => initialContext(input.reducedMotion),
  initial: "settled",
  on: {
    "studio.preference.updated": { actions: "updatePreference" },
    "studio.surface.updated": { actions: "updateSurface" },
    "studio.transport.updated": { actions: "updateTransport" },
    "studio.transport.loop.updated": { actions: "updateTransportLoop" },
    "studio.engine.updated": { actions: "updateEngine" },
    "studio.operation.updated": { actions: "updateOperation" },
    "studio.microphone.updated": { actions: "updateMicrophone" },
    "studio.lyrics.updated": { actions: "updateLyrics" },
    "studio.session_instruments.updated": { actions: "updateSessionInstruments" }
  },
  states: {
    settled: {
      on: {
        "studio.mutation.committed": [
          { guard: "reducesMotion", actions: "rememberMutation" },
          { target: "announcing", actions: "rememberMutation" }
        ]
      }
    },
    announcing: {
      after: { announcement: "animating" },
      on: {
        "studio.mutation.committed": [
          { guard: "reducesMotion", target: "settled", actions: "rememberMutation" },
          { target: "announcing", reenter: true, actions: "rememberMutation" }
        ]
      }
    },
    animating: {
      after: { animation: "settled" },
      on: {
        "studio.mutation.committed": [
          { guard: "reducesMotion", target: "settled", actions: "rememberMutation" },
          { target: "announcing", actions: "rememberMutation" }
        ]
      }
    }
  }
})

type StudioPresentationClock = NonNullable<ActorOptions<typeof studioPresentationMachine>["clock"]>

export const createStudioPresentationActor = (options?: {
  readonly reducedMotion?: boolean
  readonly clock?: StudioPresentationClock
}) =>
  createActor(studioPresentationMachine, {
    input: { reducedMotion: options?.reducedMotion ?? false },
    ...(options?.clock === undefined ? {} : { clock: options.clock })
  })

const initialReducedMotion =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false

const studioPresentationActor = createStudioPresentationActor({
  reducedMotion: initialReducedMotion
}).start()

const phaseOf = (value: unknown): StudioPresentationPhase =>
  value === "announcing" || value === "animating" ? value : "settled"

export interface StudioPresentationView {
  readonly schema_version: 2
  readonly manager: "xstate-v5"
  readonly phase: StudioPresentationPhase
  readonly reduced_motion: boolean
  readonly surface: StudioPresentationSurface
  readonly active_panel: string | null
  readonly tools_ready: boolean
  readonly transition: null | {
    readonly id: string
    readonly actor: StudioActor
    readonly action: StudioMutationAction
    readonly request_id: string
    readonly revision_before: number
    readonly revision_after: number
    readonly targets: {
      readonly track_id?: string
      readonly clip_id?: string
      readonly preview_id?: string
    }
    readonly duration_ms: number
  }
  readonly transport: {
    readonly status: StudioTransportStatus
    readonly playhead_beat: number
    readonly loop_enabled: boolean
    readonly loop_start_beat: number
    readonly loop_end_beat: number
  }
  readonly engine: {
    readonly status: StudioEngineStatus
    readonly message: string | null
  }
  readonly operation: {
    readonly busy: string | null
    readonly error: string | null
  }
  readonly microphone: {
    readonly status: StudioMicrophoneStatus
    readonly issue: KaraokeMicrophoneIssue | null
  }
  readonly lyrics: {
    readonly status: StudioLyricsStatus
    readonly active_token_id: string | null
    readonly count_in_remaining: number | null
  }
  readonly session_instruments: SessionInstrumentView | null
}

export const studioPresentationViewOf = (
  snapshot: ReturnType<typeof studioPresentationActor.getSnapshot>
): StudioPresentationView => {
  const { context } = snapshot
  return {
    schema_version: 2,
    manager: "xstate-v5",
    phase: phaseOf(snapshot.value),
    reduced_motion: context.reducedMotion,
    surface: context.surface,
    active_panel: context.activePanel,
    tools_ready: context.toolsReady,
    transition:
      context.transition === null
        ? null
        : {
            id: context.transition.id,
            actor: context.transition.actor,
            action: context.transition.action,
            request_id: context.transition.requestId,
            revision_before: context.transition.revisionBefore,
            revision_after: context.transition.revisionAfter,
            targets: {
              ...(context.transition.targets.trackId === undefined
                ? {}
                : { track_id: context.transition.targets.trackId }),
              ...(context.transition.targets.clipId === undefined
                ? {}
                : { clip_id: context.transition.targets.clipId }),
              ...(context.transition.targets.previewId === undefined
                ? {}
                : { preview_id: context.transition.targets.previewId })
            },
            duration_ms: context.transition.durationMs
          },
    transport: {
      status: context.transport.status,
      playhead_beat: context.transport.playheadBeat,
      loop_enabled: context.transport.loopEnabled,
      loop_start_beat: context.transport.loopStartBeat,
      loop_end_beat: context.transport.loopEndBeat
    },
    engine: context.engine,
    operation: context.operation,
    microphone: context.microphone,
    lyrics: {
      status: context.lyrics.status,
      active_token_id: context.lyrics.activeTokenId,
      count_in_remaining: context.lyrics.countInRemaining
    },
    session_instruments: context.sessionInstruments
  }
}

let currentView = studioPresentationViewOf(studioPresentationActor.getSnapshot())
const listeners = new Set<() => void>()

studioPresentationActor.subscribe((snapshot) => {
  currentView = studioPresentationViewOf(snapshot)
  for (const listener of listeners) listener()
})

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  reducedMotionQuery.addEventListener?.("change", (event) => {
    studioPresentationActor.send({
      type: "studio.preference.updated",
      reducedMotion: event.matches
    })
  })
}

export const getStudioPresentationView = (): StudioPresentationView => currentView

export const subscribeStudioPresentation = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const presentStudioMutation = (mutation: StudioMutationEvent): void => {
  studioPresentationActor.send({ type: "studio.mutation.committed", mutation })
}

export const updateStudioPresentationSurface = (
  surface: StudioPresentationSurface,
  activePanel: string | null,
  toolsReady: boolean
): void => {
  studioPresentationActor.send({
    type: "studio.surface.updated",
    surface,
    activePanel,
    toolsReady
  })
}

export const updateStudioPresentationTransport = (
  status: StudioTransportStatus,
  playheadBeat: number
): void => {
  studioPresentationActor.send({ type: "studio.transport.updated", status, playheadBeat })
}

export const updateStudioPresentationLoop = (enabled: boolean, startBeat: number, endBeat: number): void => {
  studioPresentationActor.send({
    type: "studio.transport.loop.updated",
    enabled,
    startBeat,
    endBeat
  })
}

export const updateStudioPresentationEngine = (status: StudioEngineStatus, message: string | null): void => {
  studioPresentationActor.send({ type: "studio.engine.updated", status, message })
}

export const updateStudioPresentationOperation = (busy: string | null, error: string | null): void => {
  studioPresentationActor.send({ type: "studio.operation.updated", busy, error })
}

export const updateStudioPresentationMicrophone = (
  status: StudioMicrophoneStatus,
  issue: KaraokeMicrophoneIssue | null
): void => {
  studioPresentationActor.send({ type: "studio.microphone.updated", status, issue })
}

export const updateStudioPresentationLyrics = (
  status: StudioLyricsStatus,
  activeTokenId: string | null,
  countInRemaining: number | null
): void => {
  studioPresentationActor.send({
    type: "studio.lyrics.updated",
    status,
    activeTokenId,
    countInRemaining
  })
}

export const updateStudioPresentationSessionInstruments = (view: SessionInstrumentView): void => {
  studioPresentationActor.send({ type: "studio.session_instruments.updated", view })
}

export const studioPresentationActionLabel = (action: StudioMutationAction): string => {
  switch (action) {
    case "set_tempo":
      return "SETTING TEMPO"
    case "set_track_mix":
      return "RIDING THE MIX"
    case "set_karaoke_count_in":
      return "SETTING COUNT-IN"
    case "stage_midi_transposition":
      return "PREPARING KEY CHANGE"
    case "stage_karaoke_guide":
      return "TIMING THE LYRICS"
    case "apply_preview":
      return "APPLYING THE TAKE"
    case "discard_preview":
      return "RESTORING CURRENT TAKE"
    case "select_time_range":
    case "select_beat_range":
      return "FRAMING THE PASSAGE"
    case "stage_part":
      return "PREPARING A TAKE"
    case "write_midi":
    case "compose_midi":
      return "WRITING THE ARRANGEMENT"
    case "move_clip":
      return "MOVING THE CLIP"
    case "add_uploaded_track":
      return "ADDING THE TRACK"
    case "import_shared_session":
      return "LOADING THE SHARED COPY"
    case "undo":
      return "UNDOING THE EDIT"
    case "redo":
      return "REDOING THE EDIT"
  }
}
