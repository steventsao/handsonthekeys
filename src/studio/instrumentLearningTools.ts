import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  InstrumentLearning,
  instrumentLearningModes,
  type InstrumentLessonConfiguration,
  type LearningTransportCommand
} from "./InstrumentLearning.ts"

const RequestId = Schema.Trim.check(Schema.isLengthBetween(1, 128))
const LessonRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const Beat = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 }))
const HandPosition = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 }))
const MaxFret = Schema.Int.check(Schema.isBetween({ minimum: 12, maximum: 24 }))

const EmptyInput = Schema.Struct({})
const SetLearningModeInput = Schema.Struct({
  request_id: RequestId,
  expected_lesson_revision: Schema.optional(LessonRevision),
  mode: Schema.Literals(instrumentLearningModes)
})
const SetLearningMetronomeInput = Schema.Struct({
  request_id: RequestId,
  expected_lesson_revision: Schema.optional(LessonRevision),
  enabled: Schema.Boolean
})
const ConfigureTabLessonInput = Schema.Struct({
  request_id: RequestId,
  expected_lesson_revision: Schema.optional(LessonRevision),
  instrument: Schema.Literal("guitar"),
  tuning: Schema.Literal("standard"),
  track_id: Schema.NonEmptyString,
  start_beat: Beat,
  end_beat: Beat,
  hand_position: Schema.optional(HandPosition),
  max_fret: Schema.optional(MaxFret)
})
const TransportRequestFields = {
  request_id: RequestId,
  expected_lesson_revision: Schema.optional(LessonRevision)
} as const
const ControlLearningTransportInput = Schema.Union([
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("play") }),
  Schema.Struct({
    ...TransportRequestFields,
    action: Schema.Literal("play_range"),
    start_beat: Beat,
    end_beat: Beat
  }),
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("pause") }),
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("stop") }),
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("seek"), beat: Beat }),
  Schema.Struct({
    ...TransportRequestFields,
    action: Schema.Literal("set_loop"),
    enabled: Schema.Boolean,
    start_beat: Beat,
    end_beat: Beat
  })
])

const jsonSchema = (schema: Schema.Top): object => {
  const document = Schema.toJsonSchemaDocument(schema)
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions }
}

const optionsOf = (input: {
  readonly request_id: string
  readonly expected_lesson_revision?: number | undefined
}) => ({
  requestId: input.request_id,
  ...(input.expected_lesson_revision === undefined
    ? {}
    : { expectedLessonRevision: input.expected_lesson_revision })
})

export const instrumentLearningTools: ReadonlyArray<
  EffectTool<ToolInput, unknown, unknown, InstrumentLearning>
> = [
  {
    name: "get_tab_lesson",
    title: "Read the current notation and tab lesson",
    description:
      "Read a bounded paired standard-notation and guitar-tablature projection of the current canonical Studio MIDI track, including the current shared-transport loop region. The Effect-validated notation object uses MusicXML 4.0 guitar semantics and references the exact same stable event IDs returned with pitch, performed MIDI gate, string, fret, tuning, lesson range, project and lesson revisions, playability counts, and rights provenance. Written rhythm and any engraving quantization are explicit; playback timing remains canonical MIDI. Score and tab are derived live from the same MIDI edited in Studio Mode, not a second arrangement. This app permits only original, user-authored, licensed, or public-domain material. Calling something educational does not license protected melodies, riffs, arrangements, or third-party tabs.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const learning = yield* InstrumentLearning
        return yield* learning.tab
      })
  },
  {
    name: "configure_tab_lesson",
    title: "Configure the instrument tab lesson",
    description:
      "Choose one stable non-drum MIDI track, an exact absolute quarter-note beat range, and a guitar hand position for Tab Mode. Standard six-string tuning is E4 B3 G3 D3 A2 E2 from string 1 to 6. The operation is retry-safe and revision-checked against lesson state; it does not copy or alter the MIDI arrangement. Read get_studio_midi first for track IDs and get_tab_lesson first for the current lesson revision. Do not configure lessons from unlicensed third-party tabs, protected melodies, or signature riffs.",
    inputSchema: jsonSchema(ConfigureTabLessonInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConfigureTabLessonInput)(input)
        const learning = yield* InstrumentLearning
        const current = yield* learning.snapshot
        const configuration: InstrumentLessonConfiguration = {
          instrument: decoded.instrument,
          tuning: decoded.tuning,
          trackId: decoded.track_id,
          startBeat: decoded.start_beat,
          endBeat: decoded.end_beat,
          handPosition: decoded.hand_position ?? current.lesson.handPosition,
          maxFret: decoded.max_fret ?? current.lesson.maxFret
        }
        const result = yield* learning.configureLesson(configuration, optionsOf(decoded))
        const tab = yield* learning.tab
        return {
          change: result.change,
          request_id: result.requestId,
          lesson_revision: result.lessonRevision,
          replayed: result.replayed,
          project_revision: tab.project_revision,
          source_track: tab.source_track,
          range: tab.range,
          hand_position: tab.hand_position,
          max_fret: tab.max_fret,
          event_count: tab.summary.event_count,
          unplayable_event_count: tab.summary.unplayable_event_count
        }
      })
  },
  {
    name: "set_learning_mode",
    title: "Switch the learning workspace mode",
    description:
      "Switch the visible Signal learning surface among the fixed Piano/Drums/Metronome Session rack, Tab Mode, and Studio Mode without changing the canonical MIDI, project revision, undo history, or mix. Agent callers should use this semantic WebMCP tool rather than infer navigation from the presentation-first visual interface. The same Effect session and WebMCP tool set remain active in every mode. This view mutation is retry-safe and can be guarded with expected_lesson_revision.",
    inputSchema: jsonSchema(SetLearningModeInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(SetLearningModeInput)(input)
        const learning = yield* InstrumentLearning
        const result = yield* learning.setMode(decoded.mode, optionsOf(decoded))
        return {
          change: result.change,
          request_id: result.requestId,
          lesson_revision: result.lessonRevision,
          replayed: result.replayed,
          mode: decoded.mode,
          music_changed: false
        }
      })
  },
  {
    name: "set_learning_metronome",
    title: "Start or stop the shared Session metronome",
    description:
      "Start or stop the audible browser metronome at the current project tempo and meter, with an accented downbeat and a synchronized Session-mode pulse. Agent callers should invoke this semantic WebMCP tool instead of inspecting, locating, or clicking the intentionally visual Session interface. The click is independently enabled from musical-track playback but uses the same persistent Studio AudioContext, clock, playhead phase, and native scheduler. When tracks are stopped the engine runs click-only; starting tracks atomically rephases the click and music at the Studio playhead instead of launching mid-beat. This retry-safe lesson preference is available from Session, Tab, and Studio modes, does not create a MIDI track, does not change the musical project revision, and is excluded from export. Browser autoplay rules still require a person to press the visible Start action once when audio has not yet been unlocked; the tool reports that boundary instead of bypassing it. For a requested song, use a researched tempo fact with set_studio_tempo, then enable this metronome; do not import protected melody, riffs, recordings, notation, or tablature.",
    inputSchema: jsonSchema(SetLearningMetronomeInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(SetLearningMetronomeInput)(input)
        const learning = yield* InstrumentLearning
        const result = yield* learning.setMetronome(decoded.enabled, optionsOf(decoded))
        const tab = yield* learning.tab
        return {
          change: result.change,
          request_id: result.requestId,
          lesson_revision: result.lessonRevision,
          replayed: result.replayed,
          enabled: decoded.enabled,
          follows_project_tempo: true,
          accented_downbeat: true,
          included_in_export: false,
          project_revision: tab.project_revision,
          music_changed: false,
          musical_playback_changed: false,
          metronome_engine: "shared_daw_transport",
          clock_source: "shared_daw_transport",
          click_only_when_tracks_stopped: true,
          rephases_with_track_start: true,
          starts_immediately: true,
          browser_audio_policy_respected: true
        }
      })
  },
  {
    name: "control_learning_transport",
    title: "Control shared musical playback",
    description:
      "Control musical-track playback on the persistent shared browser Studio transport from Session, Tab, or Studio Mode. Play or pause the current position, stop, seek to an exact absolute beat, play an exact range, or enable/disable a persistent loop region of at most 64 beats. Looping delegates to the package transport engine and does not duplicate MIDI, change the musical project revision, or add undo history. Setting loop state is retry-safe and can be guarded with expected_lesson_revision. The call reaches the same attached Studio audio engine as the visible controls and waits for its acknowledgement. The independently enabled metronome remains on that transport in click-only mode when tracks pause or stop. A browser may still require one visible human audio-unlock gesture under its autoplay policy; this tool never bypasses browser permission or activation rules.",
    inputSchema: jsonSchema(ControlLearningTransportInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ControlLearningTransportInput)(input)
        const command: LearningTransportCommand =
          decoded.action === "set_loop"
            ? {
                action: decoded.action,
                startBeat: decoded.start_beat,
                endBeat: decoded.end_beat,
                enabled: decoded.enabled
              }
            : decoded.action === "play_range"
              ? {
                  action: decoded.action,
                  startBeat: decoded.start_beat,
                  endBeat: decoded.end_beat
                }
              : decoded.action === "seek"
                ? { action: decoded.action, beat: decoded.beat }
                : { action: decoded.action }
        const learning = yield* InstrumentLearning
        const receipt = yield* learning.controlTransport(
          command,
          decoded.request_id,
          decoded.expected_lesson_revision
        )
        const tab = yield* learning.tab
        return {
          accepted: true,
          action: receipt.action,
          status: receipt.status,
          playhead_beat: receipt.playheadBeat,
          lesson_revision: receipt.lessonRevision,
          loop_enabled: receipt.loop.enabled,
          loop_start_beat: receipt.loop.startBeat,
          loop_end_beat: receipt.loop.endBeat,
          project_revision: tab.project_revision,
          music_changed: false,
          shared_engine: "canonical_daw",
          browser_audio_policy_respected: true
        }
      })
  }
]
