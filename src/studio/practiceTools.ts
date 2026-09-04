import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  BrowserRecording,
  stopAndCommitBrowserRecording,
  type BrowserRecordingOptions
} from "./BrowserRecording.ts"
import {
  InstrumentLearning,
  type InstrumentLearningOptions,
  type LearningTransportCommand
} from "./InstrumentLearning.ts"
import { Studio, StudioRuleError, type StudioMidiWriteNote, type StudioMutationOptions } from "./Studio.ts"
import { StudioShareApi } from "./StudioShareApi.ts"

const RequestId = Schema.Trim.check(
  Schema.isLengthBetween(1, 80),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
)
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const Bpm = Schema.Finite.check(Schema.isBetween({ minimum: 40, maximum: 240 }))
const BpmPerBar = Schema.Finite.check(Schema.isBetween({ minimum: -20, maximum: 20 }))
const RampBarCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }))
const DrumBarCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 }))
const RecordingBarCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))
const RecordingName = Schema.Trim.check(Schema.isLengthBetween(1, 80))
const Beat = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 }))

const SetMetronomeInput = Schema.Struct({
  request_id: RequestId,
  enabled: Schema.Boolean,
  bpm: Schema.optional(Bpm),
  bpm_step_per_bar: Schema.optional(BpmPerBar),
  ramp_bar_count: Schema.optional(RampBarCount),
  expected_revision: Schema.optional(Revision),
  expected_lesson_revision: Schema.optional(Revision)
})

const AddDrumBeatInput = Schema.Struct({
  request_id: RequestId,
  bars: Schema.optional(DrumBarCount),
  expected_revision: Schema.optional(Revision)
})

const RecordTakeInput = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("prepare"),
    request_id: RequestId,
    name: Schema.optional(RecordingName),
    count_in_bars: Schema.optional(RecordingBarCount),
    expected_recording_revision: Schema.optional(Revision)
  }),
  Schema.Struct({
    action: Schema.Literal("stop"),
    request_id: RequestId,
    expected_recording_revision: Schema.optional(Revision),
    expected_revision: Schema.optional(Revision)
  })
])

const ShareSessionInput = Schema.Struct({
  request_id: RequestId,
  expected_revision: Schema.optional(Revision)
})

const TransportRequestFields = {
  request_id: RequestId,
  expected_lesson_revision: Schema.optional(Revision)
} as const
const ControlTransportInput = Schema.Union([
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("play") }),
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("pause") }),
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("stop") }),
  Schema.Struct({ ...TransportRequestFields, action: Schema.Literal("seek"), beat: Beat }),
  Schema.Struct({
    ...TransportRequestFields,
    action: Schema.Literal("play_range"),
    start_beat: Beat,
    end_beat: Beat
  }),
  Schema.Struct({
    ...TransportRequestFields,
    action: Schema.Literal("set_loop"),
    enabled: Schema.Boolean,
    start_beat: Beat,
    end_beat: Beat
  })
])

const projectOptions = (requestId: string, expectedRevision?: number): StudioMutationOptions => ({
  requestId,
  ...(expectedRevision === undefined ? {} : { expectedRevision }),
  actor: "AGENT"
})

const lessonOptions = (requestId: string, expectedLessonRevision?: number): InstrumentLearningOptions => ({
  requestId,
  ...(expectedLessonRevision === undefined ? {} : { expectedLessonRevision })
})

const recordingOptions = (
  requestId: string,
  expectedRecordingRevision?: number
): BrowserRecordingOptions => ({
  requestId,
  ...(expectedRecordingRevision === undefined ? {} : { expectedRecordingRevision })
})

const drumNotes = (bars: number, meter: readonly [number, number]): ReadonlyArray<StudioMidiWriteNote> => {
  const [beatsPerBar, denominator] = meter
  const beatLength = 4 / denominator
  const notes: Array<StudioMidiWriteNote> = []

  for (let bar = 0; bar < bars; bar += 1) {
    const barStart = bar * beatsPerBar * beatLength
    for (let beat = 0; beat < beatsPerBar; beat += 1) {
      const startBeat = barStart + beat * beatLength
      if (beat === 0 || (beatsPerBar >= 4 && beat === 2)) {
        notes.push({ pitch: 36, startBeat, durationBeats: Math.min(0.18, beatLength), velocity: 112 })
      }
      if (beat === 1 || (beatsPerBar >= 4 && beat === 3)) {
        notes.push({ pitch: 38, startBeat, durationBeats: Math.min(0.16, beatLength), velocity: 104 })
      }
      notes.push({ pitch: 42, startBeat, durationBeats: Math.min(0.1, beatLength / 2), velocity: 66 })
      notes.push({
        pitch: 42,
        startBeat: startBeat + beatLength / 2,
        durationBeats: Math.min(0.1, beatLength / 2),
        velocity: 58
      })
    }
  }

  return notes
}

export const practiceToolSchemas = {
  setMetronome: {
    type: "object",
    properties: {
      request_id: { type: "string", maxLength: 80, description: "Unique retry-safe ID for this request." },
      enabled: { type: "boolean", description: "True to run the metronome; false to stop it." },
      bpm: { type: "number", minimum: 40, maximum: 240, description: "Optional starting tempo in BPM." },
      bpm_step_per_bar: {
        type: "number",
        minimum: -20,
        maximum: 20,
        description:
          "Signed BPM change after each bar. Positive speeds up; negative slows down; zero disables."
      },
      ramp_bar_count: {
        type: "integer",
        minimum: 1,
        maximum: 32,
        description: "Number of per-bar tempo changes; defaults to 8."
      },
      expected_revision: {
        type: "integer",
        minimum: 1,
        description: "Optional current project revision for changing BPM."
      },
      expected_lesson_revision: {
        type: "integer",
        minimum: 1,
        description: "Optional current lesson revision for metronome state."
      }
    },
    required: ["request_id", "enabled"],
    additionalProperties: false
  },
  addDrumBeat: {
    type: "object",
    properties: {
      request_id: { type: "string", maxLength: 80, description: "Unique retry-safe ID for this request." },
      bars: {
        type: "integer",
        minimum: 1,
        maximum: 16,
        description: "Length of the original straight-eighth drum part; defaults to 4 bars."
      },
      expected_revision: {
        type: "integer",
        minimum: 1,
        description: "Optional current project revision."
      }
    },
    required: ["request_id"],
    additionalProperties: false
  },
  recordTake: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["prepare", "stop"],
        description: "Prepare a human-started take, or stop and add the active take to Studio."
      },
      request_id: { type: "string", maxLength: 80, description: "Unique retry-safe ID for this request." },
      name: { type: "string", maxLength: 80, description: "Optional take name when preparing." },
      count_in_bars: {
        type: "integer",
        minimum: 1,
        maximum: 4,
        description: "Metronome count-in before capture; defaults to 1 bar."
      },
      expected_recording_revision: {
        type: "integer",
        minimum: 1,
        description: "Optional current recording revision."
      },
      expected_revision: {
        type: "integer",
        minimum: 1,
        description: "Optional current project revision when stopping."
      }
    },
    required: ["action", "request_id"],
    additionalProperties: false
  },
  shareSession: {
    type: "object",
    properties: {
      request_id: { type: "string", maxLength: 80, description: "Unique retry-safe ID for this share." },
      expected_revision: {
        type: "integer",
        minimum: 1,
        description: "Optional current project revision."
      }
    },
    required: ["request_id"],
    additionalProperties: false
  },
  controlTransport: {
    type: "object",
    properties: {
      request_id: { type: "string", maxLength: 80, description: "Unique retry-safe ID for this request." },
      action: {
        type: "string",
        enum: ["play", "pause", "stop", "seek", "play_range", "set_loop"],
        description: "Transport operation to perform. Range fields are required for play_range and set_loop."
      },
      beat: { type: "number", minimum: 0, maximum: 4096, description: "Absolute beat required for seek." },
      enabled: { type: "boolean", description: "Whether set_loop enables or disables the loop region." },
      start_beat: {
        type: "number",
        minimum: 0,
        maximum: 4096,
        description: "Inclusive absolute start beat for play_range or set_loop."
      },
      end_beat: {
        type: "number",
        minimum: 0,
        maximum: 4096,
        description: "Exclusive absolute end beat, after start_beat and no more than 64 beats later."
      },
      expected_lesson_revision: {
        type: "integer",
        minimum: 1,
        description: "Optional current lesson revision; recommended for set_loop."
      }
    },
    required: ["request_id", "action"],
    additionalProperties: false
  }
} as const

export const practiceTools: ReadonlyArray<
  EffectTool<ToolInput, unknown, unknown, Studio | InstrumentLearning | BrowserRecording | StudioShareApi>
> = [
  {
    name: "set_metronome",
    title: "Set the practice metronome",
    description:
      "Start or stop the visible browser metronome, optionally set 40–240 BPM, and optionally change tempo by a signed BPM step after each bar. Positive steps speed up; negative steps slow down; zero disables the ramp. It uses the real page metronome and project tempo. A song name may supply a tempo fact only; this tool never imports protected music. Browser autoplay may still require one visible Start press.",
    inputSchema: practiceToolSchemas.setMetronome,
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(SetMetronomeInput)(input)
        const studio = yield* Studio
        const learning = yield* InstrumentLearning
        const before = yield* studio.snapshot
        if (
          decoded.bpm === undefined &&
          decoded.expected_revision !== undefined &&
          decoded.expected_revision !== before.revision
        ) {
          return yield* new StudioRuleError({
            code: "revision_conflict",
            message: `Expected project revision ${decoded.expected_revision}, but the current revision is ${before.revision}.`,
            currentRevision: before.revision
          })
        }
        if (
          decoded.bpm !== undefined &&
          (decoded.bpm !== before.bpm ||
            (decoded.expected_revision !== undefined && decoded.expected_revision !== before.revision))
        ) {
          yield* studio.setTempo(
            decoded.bpm,
            projectOptions(`${decoded.request_id}:tempo`, decoded.expected_revision)
          )
        }
        const ramp =
          decoded.bpm_step_per_bar === undefined
            ? undefined
            : decoded.bpm_step_per_bar === 0
              ? null
              : {
                  bpmPerBar: decoded.bpm_step_per_bar,
                  barCount: decoded.ramp_bar_count ?? 8
                }
        const metronome = yield* learning.setMetronome(
          decoded.enabled,
          lessonOptions(`${decoded.request_id}:metronome`, decoded.expected_lesson_revision),
          ramp
        )
        const project = yield* studio.snapshot
        const lesson = yield* learning.snapshot
        return {
          change: metronome.change,
          replayed: metronome.replayed,
          enabled: lesson.metronomeEnabled,
          base_bpm: project.bpm,
          ramp:
            lesson.metronomeRamp === null
              ? null
              : {
                  bpm_step_per_bar: lesson.metronomeRamp.bpmPerBar,
                  bar_count: lesson.metronomeRamp.barCount
                },
          project_revision: project.revision,
          lesson_revision: lesson.lessonRevision,
          browser_audio_policy_respected: true,
          music_imported: false
        }
      })
  },
  {
    name: "add_drum_beat",
    title: "Add a simple drum beat",
    description:
      "Add 1–16 bars of an original straight-eighth kick, snare, and hi-hat pattern as exact channel-10 MIDI. The retry-safe, revision-checked edit is undoable and switches the visible workspace to Studio Mode for review. It adds no copyrighted recording or source rhythm and does not start playback automatically.",
    inputSchema: practiceToolSchemas.addDrumBeat,
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AddDrumBeatInput)(input)
        const studio = yield* Studio
        const learning = yield* InstrumentLearning
        const project = yield* studio.snapshot
        const bars = decoded.bars ?? 4
        const notes = drumNotes(bars, project.timeSignature)
        const write = yield* studio.writeMidi(
          {
            mode: "create",
            notes,
            trackName: "Practice Drums",
            clipName: `${bars}-Bar Straight Beat`,
            program: 0,
            channel: 9
          },
          projectOptions(decoded.request_id, decoded.expected_revision)
        )
        const mode = yield* learning.setMode("daw", lessonOptions(`${decoded.request_id}:show-daw`))
        return {
          change: write.change,
          replayed: write.replayed,
          project_revision: write.revision,
          lesson_revision: mode.lessonRevision,
          mode_replayed: mode.replayed,
          track_id: write.trackId,
          clip_id: write.clipId,
          bars,
          notes_written: write.notesWritten,
          midi_channel: 10,
          visible_mode: "daw",
          playback_started: false,
          rights_basis: "project-authored original rhythm"
        }
      })
  },
  {
    name: "control_transport",
    title: "Control song playback and looping",
    description:
      "Play, pause, stop, seek, play a beat range, or set a persistent beat loop on the same browser Studio engine as the visible controls. Use after Studio or Tab is visible; add_drum_beat opens Studio for review. Looping delegates to the installed transport packages, never duplicates MIDI, and never changes project revision or undo history. Calls are retry-safe; browser autoplay may still require a visible Play press.",
    inputSchema: practiceToolSchemas.controlTransport,
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ControlTransportInput)(input)
        const command: LearningTransportCommand =
          decoded.action === "set_loop"
            ? {
                action: decoded.action,
                enabled: decoded.enabled,
                startBeat: decoded.start_beat,
                endBeat: decoded.end_beat
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
        const studio = yield* Studio
        const receipt = yield* learning.controlTransport(
          command,
          decoded.request_id,
          decoded.expected_lesson_revision
        )
        const project = yield* studio.snapshot
        return {
          accepted: true,
          action: receipt.action,
          status: receipt.status,
          playhead_beat: receipt.playheadBeat,
          loop_enabled: receipt.loop.enabled,
          loop_start_beat: receipt.loop.startBeat,
          loop_end_beat: receipt.loop.endBeat,
          lesson_revision: receipt.lessonRevision,
          project_revision: project.revision,
          music_changed: false,
          shared_engine: "canonical_daw",
          browser_audio_policy_respected: true
        }
      })
  },
  {
    name: "record_take",
    title: "Prepare or stop a recording",
    description:
      "Prepare a named browser-microphone take with a 1–4 bar metronome count-in, or stop an active take and add it to Studio. Preparing switches to the obvious recording panel but never starts capture or opens permission: a person must press its visible Start button. Raw audio never enters tool output, and share links omit local takes.",
    inputSchema: practiceToolSchemas.recordTake,
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(RecordTakeInput)(input)
        if (decoded.action === "prepare") {
          const studio = yield* Studio
          const learning = yield* InstrumentLearning
          const recording = yield* BrowserRecording
          const project = yield* studio.snapshot
          const countInBars = decoded.count_in_bars ?? 1
          const countInBeats = countInBars * project.timeSignature[0]
          const armed = yield* recording.arm(
            decoded.name ?? "Practice Take",
            countInBeats,
            recordingOptions(decoded.request_id, decoded.expected_recording_revision)
          )
          const mode = yield* learning.setMode("daw", lessonOptions(`${decoded.request_id}:show-recording`))
          return {
            change: armed.change,
            replayed: armed.idempotent,
            status: "armed",
            recording_id: armed.recordingId,
            recording_revision: armed.recordingRevision,
            lesson_revision: mode.lessonRevision,
            count_in_bars: countInBars,
            count_in_beats: countInBeats,
            visible_mode: "daw",
            human_action_required: true,
            next_action: "Press the visible Start button; the metronome counts in, then recording begins.",
            raw_audio_shared: false
          }
        }

        const committed = yield* stopAndCommitBrowserRecording(
          recordingOptions(decoded.request_id, decoded.expected_recording_revision),
          projectOptions(`${decoded.request_id}:project`, decoded.expected_revision)
        )
        return {
          change: committed.change,
          replayed: committed.recording.idempotent,
          status: "complete",
          project_revision: committed.projectRevision,
          recording_revision: committed.recording.recordingRevision,
          take: {
            recording_id: committed.recording.take.recordingId,
            name: committed.recording.take.name,
            duration_seconds: committed.recording.take.durationSeconds,
            byte_length: committed.recording.take.byteLength,
            mime_type: committed.recording.take.mimeType
          },
          raw_audio_shared: false,
          share_links_include_take: false
        }
      })
  },
  {
    name: "share_session",
    title: "Share the MIDI session",
    description:
      "Create an immutable, unlisted 30-day link for the visible canonical MIDI session and lesson settings. The retry-safe call may revision-check the project. Anyone with the URL can read that structured snapshot until expiry. Browser microphone takes and uploaded audio stay page-local and are explicitly omitted.",
    inputSchema: practiceToolSchemas.shareSession,
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ShareSessionInput)(input)
        const shares = yield* StudioShareApi
        const result = yield* shares.create(decoded.request_id, decoded.expected_revision)
        return {
          change: "share_created",
          replayed: result.idempotent,
          url: result.url,
          expires_at: result.expiresAt,
          source_revision: result.sourceRevision,
          midi_track_count: result.midiTrackCount,
          note_count: result.noteCount,
          omitted_audio_asset_count: result.omittedAudioAssetCount,
          raw_audio_shared: false
        }
      })
  }
]
