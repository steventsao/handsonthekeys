import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { notationProjectionOf, type InstrumentNotationProjection } from "./MusicNotation.ts"
import { Studio, midiName, type StudioState, type StudioTrack } from "./Studio.ts"

export const instrumentLearningModes = ["session", "tab", "daw"] as const
export type InstrumentLearningMode = (typeof instrumentLearningModes)[number]
const InstrumentLearningModeSchema = Schema.Literals(instrumentLearningModes)

export const learningTransportActions = ["play", "play_range", "pause", "stop", "seek", "set_loop"] as const
export type LearningTransportAction = (typeof learningTransportActions)[number]

export interface GuitarString {
  readonly number: number
  readonly name: string
  readonly openMidi: number
}

// Tab is rendered from string 1 (the visually highest string) down to string 6.
export const guitarStandardTuning: ReadonlyArray<GuitarString> = [
  { number: 1, name: "E4", openMidi: 64 },
  { number: 2, name: "B3", openMidi: 59 },
  { number: 3, name: "G3", openMidi: 55 },
  { number: 4, name: "D3", openMidi: 50 },
  { number: 5, name: "A2", openMidi: 45 },
  { number: 6, name: "E2", openMidi: 40 }
]

export interface InstrumentLessonConfiguration {
  readonly instrument: "guitar"
  readonly tuning: "standard"
  readonly trackId: string
  readonly startBeat: number
  readonly endBeat: number
  readonly handPosition: number
  readonly maxFret: number
}

export interface InstrumentLearningState {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly lessonRevision: number
  readonly mode: InstrumentLearningMode
  readonly metronomeEnabled: boolean
  readonly metronomeRamp: LearningMetronomeRamp | null
  readonly transportLoop: LearningTransportLoop
  readonly lesson: InstrumentLessonConfiguration
}

export interface LearningMetronomeRamp {
  readonly bpmPerBar: number
  readonly barCount: number
}

export interface LearningTransportLoop {
  readonly enabled: boolean
  readonly startBeat: number
  readonly endBeat: number
}

export interface InstrumentLearningOptions {
  readonly requestId: string
  readonly expectedLessonRevision?: number
}

export interface InstrumentLearningResult {
  readonly requestId: string
  readonly lessonRevision: number
  readonly replayed: boolean
  readonly change: string
}

export type LearningTransportCommand =
  | { readonly action: "play" }
  | { readonly action: "play_range"; readonly startBeat: number; readonly endBeat: number }
  | { readonly action: "pause" }
  | { readonly action: "stop" }
  | { readonly action: "seek"; readonly beat: number }
  | {
      readonly action: "set_loop"
      readonly enabled: boolean
      readonly startBeat: number
      readonly endBeat: number
    }

export interface LearningTransportEngineReceipt {
  readonly action: LearningTransportAction
  readonly status: "playing" | "paused" | "stopped"
  readonly playheadBeat: number
}

export interface LearningTransportReceipt extends LearningTransportEngineReceipt {
  readonly lessonRevision: number
  readonly loop: LearningTransportLoop
}

export interface LearningTransportController {
  readonly execute: (command: LearningTransportCommand) => Promise<LearningTransportEngineReceipt>
}

export interface LearningMetronomeController {
  readonly setMetronomeEnabled: (enabled: boolean, ramp: LearningMetronomeRamp | null) => Promise<void>
}

export interface InstrumentTabEvent {
  readonly noteId: string
  readonly pitch: number
  readonly pitchName: string
  readonly startBeat: number
  readonly durationBeats: number
  readonly stringNumber: number | null
  readonly stringName: string | null
  readonly fret: number | null
  readonly playable: boolean
}

export interface InstrumentTabView {
  readonly schema_version: 1
  readonly representation: "derived_from_canonical_midi"
  readonly project_id: string
  readonly project_revision: number
  readonly lesson_revision: number
  readonly mode: InstrumentLearningMode
  readonly metronome: {
    readonly enabled: boolean
    readonly follows_project_tempo: true
    readonly accented_downbeat: true
    readonly included_in_export: false
    readonly independently_enabled: true
    readonly clock_source: "shared_daw_transport"
    readonly rephases_with_track_start: true
  }
  readonly transport: {
    readonly shared_engine: "canonical_daw"
    readonly loop_enabled: boolean
    readonly loop_start_beat: number
    readonly loop_end_beat: number
  }
  readonly instrument: "guitar"
  readonly tuning: "standard"
  readonly source_track: { readonly track_id: string; readonly name: string }
  readonly range: { readonly start_beat: number; readonly end_beat: number }
  readonly hand_position: number
  readonly max_fret: number
  readonly strings: ReadonlyArray<{
    readonly number: number
    readonly name: string
    readonly open_midi: number
  }>
  readonly events: ReadonlyArray<{
    readonly note_id: string
    readonly pitch: number
    readonly pitch_name: string
    readonly start_beat: number
    readonly duration_beats: number
    readonly string_number: number | null
    readonly string_name: string | null
    readonly fret: number | null
    readonly playable: boolean
  }>
  readonly notation: InstrumentNotationProjection
  readonly summary: {
    readonly event_count: number
    readonly returned_event_count: number
    readonly playable_event_count: number
    readonly unplayable_event_count: number
    readonly truncated: boolean
  }
  readonly rights: {
    readonly policy: "original_or_cleared_material_only"
    readonly source_kind: "original" | "licensed_or_public_domain" | "original_practice_bed"
    readonly attribution: null | {
      readonly title: string
      readonly creator: string
      readonly license_name: string
      readonly source_url: string
      readonly license_url: string
    }
  }
}

interface SeenLearningRequest {
  readonly fingerprint: string
  readonly result: InstrumentLearningResult | LearningTransportReceipt
}

export class InstrumentLearningRuleError extends Schema.TaggedError<InstrumentLearningRuleError>()(
  "InstrumentLearningRuleError",
  {
    code: Schema.Literals([
      "invalid_lesson_range",
      "invalid_fretboard",
      "missing_track",
      "unsupported_track",
      "lesson_revision_conflict",
      "request_id_conflict",
      "invalid_metronome_ramp",
      "metronome_unavailable",
      "metronome_failed",
      "transport_unavailable",
      "transport_failed"
    ]),
    message: Schema.String,
    lessonRevision: Schema.Int
  }
) {}

const LearningStateSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  projectId: Schema.String,
  lessonRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  mode: Schema.Literals(instrumentLearningModes),
  metronomeEnabled: Schema.optional(Schema.Boolean),
  metronomeRamp: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        bpmPerBar: Schema.Finite.check(Schema.isBetween({ minimum: -20, maximum: 20 })),
        barCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }))
      })
    )
  ),
  transportLoop: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      startBeat: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 })),
      endBeat: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 }))
    })
  ),
  lesson: Schema.Struct({
    instrument: Schema.Literal("guitar"),
    tuning: Schema.Literal("standard"),
    trackId: Schema.NonEmptyString,
    startBeat: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 })),
    endBeat: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 })),
    handPosition: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
    maxFret: Schema.Int.check(Schema.isBetween({ minimum: 12, maximum: 24 }))
  })
})

const LearningStateJson = Schema.fromJsonString(LearningStateSchema)
const learningStoragePrefix = "signal-studio:instrument-learning:"
const tabEventLimit = 192

const cleanBeat = (beat: number): number => Math.round(beat * 1_000_000) / 1_000_000

export const instrumentLearningModeOfLocation = (pathname: string, search = ""): InstrumentLearningMode => {
  const requestedMode = new URLSearchParams(search).get("mode")
  if (Schema.is(InstrumentLearningModeSchema)(requestedMode)) return requestedMode

  const normalizedPath = pathname.replace(/\/+$/, "") || "/"
  if (
    normalizedPath === "/studio" ||
    normalizedPath === "/studio.html" ||
    normalizedPath.startsWith("/studio/")
  ) {
    return "daw"
  }
  if (normalizedPath === "/tab" || normalizedPath === "/tab.html") return "tab"
  return "session"
}

export const canonicalInstrumentLearningUrl = (
  mode: InstrumentLearningMode,
  search = "",
  hash = "",
  legacySongSlug?: string
): string => {
  const current = new URLSearchParams(search)
  const canonical = new URLSearchParams({ mode })
  for (const [key, value] of current) {
    if (key !== "mode") canonical.append(key, value)
  }
  if (!canonical.has("song") && legacySongSlug !== undefined && legacySongSlug !== "untitled") {
    canonical.set("song", legacySongSlug)
  }
  const canonicalHash = hash.length === 0 || hash.startsWith("#") ? hash : `#${hash}`
  return `/?${canonical.toString()}${canonicalHash}`
}

const locationMode = (): InstrumentLearningMode =>
  typeof window === "undefined"
    ? "session"
    : instrumentLearningModeOfLocation(window.location.pathname, window.location.search)

const isMelodicTrack = (track: StudioTrack): boolean =>
  track.kind === "midi" &&
  track.clips.some((clip) => clip.kind === "midi" && (clip.midiChannel ?? 0) !== 9 && clip.notes.length > 0)

export const preferredLessonTrack = (state: StudioState): StudioTrack | undefined => {
  const melodic = state.tracks.filter(isMelodicTrack)
  return (
    melodic.find((track) => /guide|melody|lead|guitar/i.test(track.name)) ??
    melodic.find((track) => !/bass/i.test(track.name)) ??
    melodic[0]
  )
}

const defaultLearningState = (state: StudioState): InstrumentLearningState => {
  const track = preferredLessonTrack(state)
  const startBeat = cleanBeat((state.selection.start * state.bpm) / 60)
  const endBeat = cleanBeat((state.selection.end * state.bpm) / 60)
  const lessonEndBeat = Math.max(startBeat + 4, endBeat)
  return {
    schemaVersion: 1,
    projectId: state.projectId,
    lessonRevision: 1,
    mode: locationMode(),
    metronomeEnabled: false,
    metronomeRamp: null,
    transportLoop: {
      enabled: false,
      startBeat,
      endBeat: lessonEndBeat
    },
    lesson: {
      instrument: "guitar",
      tuning: "standard",
      trackId: track?.id ?? "",
      startBeat,
      endBeat: lessonEndBeat,
      handPosition: 0,
      maxFret: 24
    }
  }
}

export const initialInstrumentLearningState = (state: StudioState): InstrumentLearningState =>
  defaultLearningState(state)

const browserSessionStorage = (): Storage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

const learningStorageKey = (projectId: string): string => `${learningStoragePrefix}${projectId}`

const restoreLearningState = (fallback: InstrumentLearningState): InstrumentLearningState => {
  const storage = browserSessionStorage()
  if (storage === undefined) return fallback
  try {
    const encoded = storage.getItem(learningStorageKey(fallback.projectId))
    if (encoded === null) return fallback
    const decoded = Schema.decodeUnknownSync(LearningStateJson)(encoded)
    if (decoded.projectId !== fallback.projectId) return fallback
    if (
      decoded.lesson.endBeat <= decoded.lesson.startBeat ||
      decoded.lesson.endBeat - decoded.lesson.startBeat > 64 ||
      decoded.lesson.handPosition > decoded.lesson.maxFret ||
      (decoded.transportLoop !== undefined &&
        (decoded.transportLoop.endBeat <= decoded.transportLoop.startBeat ||
          decoded.transportLoop.endBeat - decoded.transportLoop.startBeat > 64))
    ) {
      return fallback
    }
    return {
      ...(decoded as InstrumentLearningState),
      metronomeEnabled: decoded.metronomeEnabled ?? fallback.metronomeEnabled,
      metronomeRamp: decoded.metronomeRamp ?? fallback.metronomeRamp,
      transportLoop: decoded.transportLoop ?? fallback.transportLoop,
      // The route establishes the initial surface after a real page navigation.
      mode: fallback.mode
    }
  } catch {
    return fallback
  }
}

const persistLearningState = (state: InstrumentLearningState): void => {
  const storage = browserSessionStorage()
  if (storage === undefined) return
  try {
    storage.setItem(learningStorageKey(state.projectId), Schema.encodeSync(LearningStateJson)(state))
  } catch {
    // A blocked or full session store must never make the lesson unusable.
  }
}

interface LogicalLessonNote {
  readonly noteId: string
  readonly midi: number
  readonly startBeat: number
  readonly durationBeats: number
}

const lessonNotesOf = (
  state: StudioState,
  track: StudioTrack,
  startBeat: number,
  endBeat: number
): ReadonlyArray<LogicalLessonNote> =>
  track.clips
    .flatMap((clip) =>
      clip.kind !== "midi"
        ? []
        : clip.notes.map((note) => {
            const noteStart = cleanBeat(note.startBeat ?? ((clip.start + note.time) * state.bpm) / 60)
            const duration = cleanBeat(note.durationBeats ?? (note.duration * state.bpm) / 60)
            return {
              noteId: note.id,
              midi: note.midi,
              startBeat: noteStart,
              durationBeats: duration
            }
          })
    )
    .filter((note) => note.startBeat >= startBeat && note.startBeat < endBeat)
    .sort(
      (left, right) =>
        left.startBeat - right.startBeat || right.midi - left.midi || left.noteId.localeCompare(right.noteId)
    )

const candidatesFor = (
  midi: number,
  handPosition: number,
  maxFret: number,
  usedStrings: ReadonlySet<number>
): ReadonlyArray<{ readonly string: GuitarString; readonly fret: number; readonly score: number }> =>
  guitarStandardTuning
    .map((string) => ({ string, fret: midi - string.openMidi }))
    .filter(({ fret }) => fret >= 0 && fret <= maxFret)
    .map(({ string, fret }) => {
      const abovePosition = Math.max(0, fret - (handPosition + 4))
      const belowPosition = Math.max(0, handPosition - fret)
      return {
        string,
        fret,
        score:
          (usedStrings.has(string.number) ? 10_000 : 0) +
          (abovePosition + belowPosition) * 20 +
          fret * 0.1 +
          string.number * 0.001
      }
    })
    .sort((left, right) => left.score - right.score)

export const guitarTabEvents = (
  notes: ReadonlyArray<LogicalLessonNote>,
  handPosition: number,
  maxFret: number
): ReadonlyArray<InstrumentTabEvent> => {
  const groups = new Map<number, Array<LogicalLessonNote>>()
  for (const note of notes) {
    const group = groups.get(note.startBeat) ?? []
    group.push(note)
    groups.set(note.startBeat, group)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, onsetNotes]) => {
      const usedStrings = new Set<number>()
      return [...onsetNotes]
        .sort((left, right) => right.midi - left.midi || left.noteId.localeCompare(right.noteId))
        .map((note): InstrumentTabEvent => {
          const candidate = candidatesFor(note.midi, handPosition, maxFret, usedStrings)[0]
          if (candidate === undefined || usedStrings.has(candidate.string.number)) {
            return {
              noteId: note.noteId,
              pitch: note.midi,
              pitchName: midiName(note.midi),
              startBeat: note.startBeat,
              durationBeats: note.durationBeats,
              stringNumber: null,
              stringName: null,
              fret: null,
              playable: false
            }
          }
          usedStrings.add(candidate.string.number)
          return {
            noteId: note.noteId,
            pitch: note.midi,
            pitchName: midiName(note.midi),
            startBeat: note.startBeat,
            durationBeats: note.durationBeats,
            stringNumber: candidate.string.number,
            stringName: candidate.string.name,
            fret: candidate.fret,
            playable: true
          }
        })
    })
}

const resolvedLessonTrack = (
  state: StudioState,
  learning: InstrumentLearningState
): StudioTrack | undefined => {
  const configured = state.tracks.find((track) => track.id === learning.lesson.trackId)
  return configured !== undefined && isMelodicTrack(configured) ? configured : preferredLessonTrack(state)
}

export const instrumentTabViewOf = (
  state: StudioState,
  learning: InstrumentLearningState
): InstrumentTabView => {
  const track = resolvedLessonTrack(state, learning)
  const notes =
    track === undefined ? [] : lessonNotesOf(state, track, learning.lesson.startBeat, learning.lesson.endBeat)
  const allEvents = guitarTabEvents(notes, learning.lesson.handPosition, learning.lesson.maxFret)
  const events = allEvents.slice(0, tabEventLimit)
  const playableEventCount = allEvents.filter((event) => event.playable).length
  const sourceKind =
    state.practiceBed !== null
      ? "original_practice_bed"
      : state.attribution === null || /project-authored original/i.test(state.attribution.licenseName)
        ? "original"
        : "licensed_or_public_domain"
  const viewEvents = events.map((event) => ({
    note_id: event.noteId,
    pitch: event.pitch,
    pitch_name: event.pitchName,
    start_beat: event.startBeat,
    duration_beats: event.durationBeats,
    string_number: event.stringNumber,
    string_name: event.stringName,
    fret: event.fret,
    playable: event.playable
  }))

  return {
    schema_version: 1,
    representation: "derived_from_canonical_midi",
    project_id: state.projectId,
    project_revision: state.revision,
    lesson_revision: learning.lessonRevision,
    mode: learning.mode,
    metronome: {
      enabled: learning.metronomeEnabled,
      follows_project_tempo: true,
      accented_downbeat: true,
      included_in_export: false,
      independently_enabled: true,
      clock_source: "shared_daw_transport",
      rephases_with_track_start: true
    },
    transport: {
      shared_engine: "canonical_daw",
      loop_enabled: learning.transportLoop.enabled,
      loop_start_beat: learning.transportLoop.startBeat,
      loop_end_beat: learning.transportLoop.endBeat
    },
    instrument: "guitar",
    tuning: "standard",
    source_track: { track_id: track?.id ?? "", name: track?.name ?? "No melodic MIDI track" },
    range: {
      start_beat: learning.lesson.startBeat,
      end_beat: learning.lesson.endBeat
    },
    hand_position: learning.lesson.handPosition,
    max_fret: learning.lesson.maxFret,
    strings: guitarStandardTuning.map((string) => ({
      number: string.number,
      name: string.name,
      open_midi: string.openMidi
    })),
    events: viewEvents,
    notation: notationProjectionOf({
      events: viewEvents,
      startBeat: learning.lesson.startBeat,
      endBeat: learning.lesson.endBeat,
      timeSignature: state.timeSignature
    }),
    summary: {
      event_count: allEvents.length,
      returned_event_count: events.length,
      playable_event_count: playableEventCount,
      unplayable_event_count: allEvents.length - playableEventCount,
      truncated: allEvents.length > events.length
    },
    rights: {
      policy: "original_or_cleared_material_only",
      source_kind: sourceKind,
      attribution:
        state.attribution === null
          ? null
          : {
              title: state.attribution.title,
              creator: state.attribution.creator,
              license_name: state.attribution.licenseName,
              source_url: state.attribution.sourceUrl,
              license_url: state.attribution.licenseUrl
            }
    }
  }
}

const fingerprintOf = (kind: string, value: unknown): string => JSON.stringify({ kind, value })

const rememberRequest = (
  seen: ReadonlyMap<string, SeenLearningRequest>,
  requestId: string,
  value: SeenLearningRequest
): ReadonlyMap<string, SeenLearningRequest> => {
  const next = new Map(seen)
  next.set(requestId, value)
  if (next.size > 128) {
    const oldest = next.keys().next().value as string | undefined
    if (oldest !== undefined) next.delete(oldest)
  }
  return next
}

const replayLearningResult = (result: InstrumentLearningResult): InstrumentLearningResult => ({
  ...result,
  replayed: true
})

export class InstrumentLearning extends Context.Service<
  InstrumentLearning,
  {
    readonly changes: Stream.Stream<InstrumentLearningState>
    readonly snapshot: Effect.Effect<InstrumentLearningState>
    readonly tab: Effect.Effect<InstrumentTabView>
    readonly setMode: (
      mode: InstrumentLearningMode,
      options: InstrumentLearningOptions
    ) => Effect.Effect<InstrumentLearningResult, InstrumentLearningRuleError>
    readonly configureLesson: (
      configuration: InstrumentLessonConfiguration,
      options: InstrumentLearningOptions
    ) => Effect.Effect<InstrumentLearningResult, InstrumentLearningRuleError>
    readonly setMetronome: (
      enabled: boolean,
      options: InstrumentLearningOptions,
      ramp?: LearningMetronomeRamp | null
    ) => Effect.Effect<InstrumentLearningResult, InstrumentLearningRuleError>
    readonly attachMetronome: (controller: LearningMetronomeController) => Effect.Effect<void>
    readonly detachMetronome: (controller: LearningMetronomeController) => Effect.Effect<void>
    readonly attachTransport: (controller: LearningTransportController) => Effect.Effect<void>
    readonly detachTransport: (controller: LearningTransportController) => Effect.Effect<void>
    readonly controlTransport: (
      command: LearningTransportCommand,
      requestId: string,
      expectedLessonRevision?: number
    ) => Effect.Effect<LearningTransportReceipt, InstrumentLearningRuleError>
  }
>()("signal-studio/InstrumentLearning") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const studio = yield* Studio
      const studioState = yield* studio.snapshot
      const stateRef = yield* SubscriptionRef.make(restoreLearningState(defaultLearningState(studioState)))
      const seenRef = yield* Ref.make<ReadonlyMap<string, SeenLearningRequest>>(new Map())
      const metronomeRef = yield* Ref.make<LearningMetronomeController | null>(null)
      const transportRef = yield* Ref.make<LearningTransportController | null>(null)

      const setMode = Effect.fn("InstrumentLearning.setMode")(function* (
        mode: InstrumentLearningMode,
        options: InstrumentLearningOptions
      ) {
        const fingerprint = fingerprintOf("set_mode", {
          mode,
          expectedLessonRevision: options.expectedLessonRevision ?? null
        })
        const seen = yield* Ref.get(seenRef)
        const previous = seen.get(options.requestId)
        if (previous !== undefined) {
          if (previous.fingerprint !== fingerprint || !("replayed" in previous.result)) {
            return yield* new InstrumentLearningRuleError({
              code: "request_id_conflict",
              message: `Request ID ${options.requestId} was already used for a different learning action.`,
              lessonRevision: (yield* SubscriptionRef.get(stateRef)).lessonRevision
            })
          }
          return replayLearningResult(previous.result)
        }

        const current = yield* SubscriptionRef.get(stateRef)
        if (
          options.expectedLessonRevision !== undefined &&
          options.expectedLessonRevision !== current.lessonRevision
        ) {
          return yield* new InstrumentLearningRuleError({
            code: "lesson_revision_conflict",
            message: `Expected lesson revision ${options.expectedLessonRevision}, but the current lesson revision is ${current.lessonRevision}.`,
            lessonRevision: current.lessonRevision
          })
        }
        const next =
          current.mode === mode ? current : { ...current, mode, lessonRevision: current.lessonRevision + 1 }
        const result: InstrumentLearningResult = {
          requestId: options.requestId,
          lessonRevision: next.lessonRevision,
          replayed: false,
          change: current.mode === mode ? "mode_unchanged" : "mode_changed"
        }
        yield* SubscriptionRef.set(stateRef, next)
        yield* Effect.sync(() => persistLearningState(next))
        yield* Ref.set(seenRef, rememberRequest(seen, options.requestId, { fingerprint, result }))
        return result
      })

      const setMetronome = Effect.fn("InstrumentLearning.setMetronome")(function* (
        enabled: boolean,
        options: InstrumentLearningOptions,
        ramp?: LearningMetronomeRamp | null
      ) {
        const fingerprint = fingerprintOf("set_metronome", {
          enabled,
          ramp: ramp === undefined ? "preserve" : ramp,
          expectedLessonRevision: options.expectedLessonRevision ?? null
        })
        const seen = yield* Ref.get(seenRef)
        const previous = seen.get(options.requestId)
        if (previous !== undefined) {
          if (previous.fingerprint !== fingerprint || !("replayed" in previous.result)) {
            return yield* new InstrumentLearningRuleError({
              code: "request_id_conflict",
              message: `Request ID ${options.requestId} was already used for a different learning action.`,
              lessonRevision: (yield* SubscriptionRef.get(stateRef)).lessonRevision
            })
          }
          return replayLearningResult(previous.result)
        }

        const current = yield* SubscriptionRef.get(stateRef)
        if (
          options.expectedLessonRevision !== undefined &&
          options.expectedLessonRevision !== current.lessonRevision
        ) {
          return yield* new InstrumentLearningRuleError({
            code: "lesson_revision_conflict",
            message: `Expected lesson revision ${options.expectedLessonRevision}, but the current lesson revision is ${current.lessonRevision}.`,
            lessonRevision: current.lessonRevision
          })
        }

        const nextRamp = ramp === undefined ? current.metronomeRamp : ramp
        if (
          nextRamp !== null &&
          (!Number.isFinite(nextRamp.bpmPerBar) ||
            nextRamp.bpmPerBar === 0 ||
            nextRamp.bpmPerBar < -20 ||
            nextRamp.bpmPerBar > 20 ||
            !Number.isInteger(nextRamp.barCount) ||
            nextRamp.barCount < 1 ||
            nextRamp.barCount > 32)
        ) {
          return yield* new InstrumentLearningRuleError({
            code: "invalid_metronome_ramp",
            message: "Use a non-zero -20 to 20 BPM change for 1–32 bars.",
            lessonRevision: current.lessonRevision
          })
        }

        const controller = yield* Ref.get(metronomeRef)
        if (controller === null) {
          return yield* new InstrumentLearningRuleError({
            code: "metronome_unavailable",
            message: "The shared Studio transport metronome has not attached yet.",
            lessonRevision: current.lessonRevision
          })
        }
        yield* Effect.tryPromise({
          try: () => controller.setMetronomeEnabled(enabled, nextRamp),
          catch: (cause) =>
            new InstrumentLearningRuleError({
              code: "metronome_failed",
              message: cause instanceof Error ? cause.message : String(cause),
              lessonRevision: current.lessonRevision
            })
        })

        const rampChanged = JSON.stringify(current.metronomeRamp) !== JSON.stringify(nextRamp)
        const next =
          current.metronomeEnabled === enabled && !rampChanged
            ? current
            : {
                ...current,
                metronomeEnabled: enabled,
                metronomeRamp: nextRamp,
                lessonRevision: current.lessonRevision + 1
              }
        const result: InstrumentLearningResult = {
          requestId: options.requestId,
          lessonRevision: next.lessonRevision,
          replayed: false,
          change:
            current.metronomeEnabled === enabled && !rampChanged
              ? "metronome_unchanged"
              : rampChanged
                ? "metronome_configured"
                : enabled
                  ? "metronome_enabled"
                  : "metronome_disabled"
        }
        yield* SubscriptionRef.set(stateRef, next)
        yield* Effect.sync(() => persistLearningState(next))
        yield* Ref.set(seenRef, rememberRequest(seen, options.requestId, { fingerprint, result }))
        return result
      })

      const configureLesson = Effect.fn("InstrumentLearning.configureLesson")(function* (
        configuration: InstrumentLessonConfiguration,
        options: InstrumentLearningOptions
      ) {
        const fingerprint = fingerprintOf("configure_lesson", {
          configuration,
          expectedLessonRevision: options.expectedLessonRevision ?? null
        })
        const seen = yield* Ref.get(seenRef)
        const previous = seen.get(options.requestId)
        if (previous !== undefined) {
          if (previous.fingerprint !== fingerprint || !("replayed" in previous.result)) {
            return yield* new InstrumentLearningRuleError({
              code: "request_id_conflict",
              message: `Request ID ${options.requestId} was already used for a different learning action.`,
              lessonRevision: (yield* SubscriptionRef.get(stateRef)).lessonRevision
            })
          }
          return replayLearningResult(previous.result)
        }

        const current = yield* SubscriptionRef.get(stateRef)
        if (
          options.expectedLessonRevision !== undefined &&
          options.expectedLessonRevision !== current.lessonRevision
        ) {
          return yield* new InstrumentLearningRuleError({
            code: "lesson_revision_conflict",
            message: `Expected lesson revision ${options.expectedLessonRevision}, but the current lesson revision is ${current.lessonRevision}.`,
            lessonRevision: current.lessonRevision
          })
        }
        if (
          !Number.isFinite(configuration.startBeat) ||
          !Number.isFinite(configuration.endBeat) ||
          configuration.startBeat < 0 ||
          configuration.endBeat <= configuration.startBeat ||
          configuration.endBeat - configuration.startBeat > 64 ||
          configuration.endBeat > 4096
        ) {
          return yield* new InstrumentLearningRuleError({
            code: "invalid_lesson_range",
            message: "Choose a positive lesson range no longer than 64 beats and ending by beat 4096.",
            lessonRevision: current.lessonRevision
          })
        }
        if (
          !Number.isInteger(configuration.handPosition) ||
          configuration.handPosition < 0 ||
          configuration.handPosition > 20 ||
          !Number.isInteger(configuration.maxFret) ||
          configuration.maxFret < 12 ||
          configuration.maxFret > 24 ||
          configuration.handPosition > configuration.maxFret
        ) {
          return yield* new InstrumentLearningRuleError({
            code: "invalid_fretboard",
            message: "Hand position must be 0–20 and max fret must be 12–24 at or above that position.",
            lessonRevision: current.lessonRevision
          })
        }

        const project = yield* studio.snapshot
        const track = project.tracks.find((candidate) => candidate.id === configuration.trackId)
        if (track === undefined) {
          return yield* new InstrumentLearningRuleError({
            code: "missing_track",
            message: `Track ${configuration.trackId} does not exist in the canonical MIDI session.`,
            lessonRevision: current.lessonRevision
          })
        }
        if (!isMelodicTrack(track)) {
          return yield* new InstrumentLearningRuleError({
            code: "unsupported_track",
            message: `Track ${configuration.trackId} must be a non-drum MIDI track containing notes.`,
            lessonRevision: current.lessonRevision
          })
        }

        const normalized: InstrumentLessonConfiguration = {
          ...configuration,
          startBeat: cleanBeat(configuration.startBeat),
          endBeat: cleanBeat(configuration.endBeat)
        }
        const unchanged = JSON.stringify(current.lesson) === JSON.stringify(normalized)
        const next = unchanged
          ? current
          : { ...current, lesson: normalized, lessonRevision: current.lessonRevision + 1 }
        const result: InstrumentLearningResult = {
          requestId: options.requestId,
          lessonRevision: next.lessonRevision,
          replayed: false,
          change: unchanged ? "lesson_unchanged" : "lesson_configured"
        }
        yield* SubscriptionRef.set(stateRef, next)
        yield* Effect.sync(() => persistLearningState(next))
        yield* Ref.set(seenRef, rememberRequest(seen, options.requestId, { fingerprint, result }))
        return result
      })

      const attachTransport = Effect.fn("InstrumentLearning.attachTransport")(
        (controller: LearningTransportController) => Ref.set(transportRef, controller)
      )

      const attachMetronome = Effect.fn("InstrumentLearning.attachMetronome")(
        (controller: LearningMetronomeController) => Ref.set(metronomeRef, controller)
      )

      const detachMetronome = Effect.fn("InstrumentLearning.detachMetronome")(function* (
        controller: LearningMetronomeController
      ) {
        const current = yield* Ref.get(metronomeRef)
        if (current === controller) yield* Ref.set(metronomeRef, null)
      })

      const detachTransport = Effect.fn("InstrumentLearning.detachTransport")(function* (
        controller: LearningTransportController
      ) {
        const current = yield* Ref.get(transportRef)
        if (current === controller) yield* Ref.set(transportRef, null)
      })

      const controlTransport = Effect.fn("InstrumentLearning.controlTransport")(function* (
        command: LearningTransportCommand,
        requestId: string,
        expectedLessonRevision?: number
      ) {
        const fingerprint = fingerprintOf("control_transport", {
          command,
          expectedLessonRevision: expectedLessonRevision ?? null
        })
        const seen = yield* Ref.get(seenRef)
        const previous = seen.get(requestId)
        if (previous !== undefined) {
          if (previous.fingerprint !== fingerprint || "replayed" in previous.result) {
            return yield* new InstrumentLearningRuleError({
              code: "request_id_conflict",
              message: `Request ID ${requestId} was already used for a different learning action.`,
              lessonRevision: (yield* SubscriptionRef.get(stateRef)).lessonRevision
            })
          }
          return previous.result
        }
        if (
          (command.action === "play_range" || command.action === "set_loop") &&
          (command.startBeat < 0 ||
            command.endBeat <= command.startBeat ||
            command.endBeat > 4096 ||
            command.endBeat - command.startBeat > 64)
        ) {
          return yield* new InstrumentLearningRuleError({
            code: "invalid_lesson_range",
            message: `${command.action === "set_loop" ? "Loop" : "Playback"} range must be positive, no longer than 64 beats, and end by beat 4096.`,
            lessonRevision: (yield* SubscriptionRef.get(stateRef)).lessonRevision
          })
        }
        if (command.action === "seek" && (command.beat < 0 || command.beat > 4096)) {
          return yield* new InstrumentLearningRuleError({
            code: "invalid_lesson_range",
            message: "Seek beat must be between 0 and 4096.",
            lessonRevision: (yield* SubscriptionRef.get(stateRef)).lessonRevision
          })
        }

        const learningState = yield* SubscriptionRef.get(stateRef)
        if (expectedLessonRevision !== undefined && expectedLessonRevision !== learningState.lessonRevision) {
          return yield* new InstrumentLearningRuleError({
            code: "lesson_revision_conflict",
            message: `Expected lesson revision ${expectedLessonRevision}, but the current lesson revision is ${learningState.lessonRevision}.`,
            lessonRevision: learningState.lessonRevision
          })
        }

        const controller = yield* Ref.get(transportRef)
        if (controller === null) {
          return yield* new InstrumentLearningRuleError({
            code: "transport_unavailable",
            message: "The persistent shared browser Studio transport has not attached yet.",
            lessonRevision: learningState.lessonRevision
          })
        }
        const engineReceipt = yield* Effect.tryPromise({
          try: () => controller.execute(command),
          catch: (cause) =>
            new InstrumentLearningRuleError({
              code: "transport_failed",
              message: cause instanceof Error ? cause.message : String(cause),
              lessonRevision: learningState.lessonRevision
            })
        })

        const normalizedLoop =
          command.action === "set_loop"
            ? {
                enabled: command.enabled,
                startBeat: cleanBeat(command.startBeat),
                endBeat: cleanBeat(command.endBeat)
              }
            : learningState.transportLoop
        const loopChanged =
          command.action === "set_loop" &&
          JSON.stringify(normalizedLoop) !== JSON.stringify(learningState.transportLoop)
        const next = loopChanged
          ? {
              ...learningState,
              transportLoop: normalizedLoop,
              lessonRevision: learningState.lessonRevision + 1
            }
          : learningState
        if (loopChanged) {
          yield* SubscriptionRef.set(stateRef, next)
          yield* Effect.sync(() => persistLearningState(next))
        }
        const receipt: LearningTransportReceipt = {
          ...engineReceipt,
          lessonRevision: next.lessonRevision,
          loop: next.transportLoop
        }
        yield* Ref.set(seenRef, rememberRequest(seen, requestId, { fingerprint, result: receipt }))
        return receipt
      })

      return {
        changes: SubscriptionRef.changes(stateRef),
        snapshot: SubscriptionRef.get(stateRef),
        tab: Effect.gen(function* () {
          const [project, learning] = yield* Effect.all([studio.snapshot, SubscriptionRef.get(stateRef)])
          return instrumentTabViewOf(project, learning)
        }),
        setMode,
        setMetronome,
        configureLesson,
        attachMetronome,
        detachMetronome,
        attachTransport,
        detachTransport,
        controlTransport
      }
    })
  )
}
