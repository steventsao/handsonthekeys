import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  Studio,
  StudioRuleError,
  midiName,
  studioBeatResolution,
  studioKaraokeCountInBeats,
  studioMidiView,
  studioMidiWriteModes,
  studioMutationActions,
  studioMutationView,
  studioOperationStateView
} from "./Studio.ts"
import { queryStudioTool } from "./studioCodeMode.ts"
import { composeStudioTool } from "./studioComposeCodeMode.ts"
import { getKaraokeSessionView } from "./karaokeSession.ts"
import { type InstrumentLearning } from "./InstrumentLearning.ts"
import { instrumentLearningTools } from "./instrumentLearningTools.ts"
import { studioSongCatalogView } from "./songs/rightsCatalog.ts"
import { setStudioViewFocus, type StudioViewFocus } from "./studioView.ts"
import { type BrowserRecording } from "./BrowserRecording.ts"
import { type StudioShareApi } from "./StudioShareApi.ts"
import { studioCollaborationTools } from "./studioCollaborationTools.ts"

const RequestId = Schema.Trim.check(Schema.isLengthBetween(1, 128))
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const Prompt = Schema.Trim.check(Schema.isLengthBetween(3, 500))
const Unit = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Pan = Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 }))
const MidiNumber = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 }))
const MidiPitchName = Schema.Trim.check(Schema.isPattern(/^[A-Ga-g][#b]?(-1|[0-9])$/))
const MidiPitch = Schema.Union([MidiNumber, MidiPitchName])
const Beat = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 }))
const BeatDuration = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(studioBeatResolution),
  Schema.isLessThanOrEqualTo(256)
)
const MidiVelocity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 127 }))
const MidiProgram = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 }))
const MidiChannel = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 }))
const MidiName = Schema.Trim.check(Schema.isLengthBetween(1, 80))
const MutationSequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const MutationLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
const ViewLabel = Schema.Trim.check(Schema.isLengthBetween(1, 160))
const ViewPadding = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 32 }))
const Semitones = Schema.Int.check(Schema.isBetween({ minimum: -24, maximum: 24 }))
const KaraokeLyrics = Schema.Trim.check(Schema.isLengthBetween(1, 500))
const KaraokeTitle = Schema.Trim.check(Schema.isLengthBetween(1, 80))
const KaraokeCountInBeats = Schema.Literals(studioKaraokeCountInBeats)

const mutationFields = {
  request_id: RequestId,
  expected_revision: Schema.optional(Revision)
} as const

const EmptyInput = Schema.Struct({})
const GetMutationsInput = Schema.Struct({
  after_sequence: Schema.optional(MutationSequence),
  limit: Schema.optional(MutationLimit),
  actions: Schema.optional(
    Schema.Array(Schema.Literals(studioMutationActions)).check(
      Schema.isLengthBetween(1, studioMutationActions.length)
    )
  )
})
const SelectBeatRangeInput = Schema.Struct({
  ...mutationFields,
  start_beat: Beat,
  end_beat: Beat
})
const StagePartInput = Schema.Struct({
  ...mutationFields,
  prompt: Prompt
})
const StageTranspositionInput = Schema.Struct({
  ...mutationFields,
  semitones: Semitones,
  start_beat: Beat,
  end_beat: Beat,
  track_ids: Schema.optional(Schema.Array(Schema.NonEmptyString).check(Schema.isLengthBetween(1, 32)))
})
const StageKaraokeGuideInput = Schema.Struct({
  ...mutationFields,
  lyrics: KaraokeLyrics,
  melody_track_id: Schema.NonEmptyString,
  start_beat: Beat,
  end_beat: Beat,
  title: Schema.optional(KaraokeTitle)
})
const PreviewInput = Schema.Struct({
  ...mutationFields,
  preview_id: Schema.NonEmptyString
})
const SetKaraokeCountInInput = Schema.Struct({
  ...mutationFields,
  beats: KaraokeCountInBeats
})
const TempoInput = Schema.Struct({
  ...mutationFields,
  bpm: Schema.Finite.check(Schema.isBetween({ minimum: 40, maximum: 240 }))
})
const trackMixFields = {
  ...mutationFields,
  track_id: Schema.NonEmptyString,
  volume: Schema.optional(Unit),
  pan: Schema.optional(Pan),
  muted: Schema.optional(Schema.Boolean),
  soloed: Schema.optional(Schema.Boolean)
} as const
const TrackMixInput = Schema.Union([
  Schema.Struct({ ...trackMixFields, volume: Unit }),
  Schema.Struct({ ...trackMixFields, pan: Pan }),
  Schema.Struct({ ...trackMixFields, muted: Schema.Boolean }),
  Schema.Struct({ ...trackMixFields, soloed: Schema.Boolean })
])
const MidiNoteInput = Schema.Struct({
  pitch: MidiPitch,
  start_beat: Beat,
  duration_beats: BeatDuration,
  velocity: Schema.optional(MidiVelocity)
})
const WriteMidiInput = Schema.Struct({
  ...mutationFields,
  mode: Schema.Literals(studioMidiWriteModes),
  notes: Schema.Array(MidiNoteInput).check(Schema.isLengthBetween(1, 512)),
  track_id: Schema.optional(Schema.NonEmptyString),
  clip_id: Schema.optional(Schema.NonEmptyString),
  track_name: Schema.optional(MidiName),
  clip_name: Schema.optional(MidiName),
  program: Schema.optional(MidiProgram),
  channel: Schema.optional(MidiChannel)
})
const HistoryInput = Schema.Struct(mutationFields)
const ZoomViewInput = Schema.Struct({
  start_beat: Beat,
  end_beat: Beat,
  padding_beats: Schema.optional(ViewPadding),
  track_ids: Schema.optional(Schema.Array(Schema.NonEmptyString).check(Schema.isLengthBetween(1, 32))),
  label: Schema.optional(ViewLabel)
})

const jsonSchema = (schema: Schema.Top): object => {
  const document = Schema.toJsonSchemaDocument(schema)
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions }
}

const optionsOf = (input: {
  readonly request_id: string
  readonly expected_revision?: number | undefined
}) => ({
  requestId: input.request_id,
  ...(input.expected_revision === undefined ? {} : { expectedRevision: input.expected_revision }),
  actor: "AGENT" as const
})

const conciseState = Effect.gen(function* () {
  const studio = yield* Studio
  const state = yield* studio.snapshot
  return studioOperationStateView(state)
})

const withConciseState = <A, E>(effect: Effect.Effect<A, E, Studio>) =>
  Effect.gen(function* () {
    const result = yield* effect
    const state = yield* conciseState
    return { result, state }
  })

export const studioTools: ReadonlyArray<
  EffectTool<ToolInput, unknown, unknown, Studio | InstrumentLearning | BrowserRecording | StudioShareApi>
> = [
  composeStudioTool,
  queryStudioTool,
  ...instrumentLearningTools,
  ...studioCollaborationTools,
  {
    name: "get_studio_song_catalog",
    title: "Read rights-cleared lesson music",
    description:
      "Read the source-controlled instrument-learning catalog and its complete rights ledger. Only playable_songs have documented composition, arrangement or MIDI, recording, any source notation or tab, lyrics/timing when used, and visual provenance; intake_sources are research leads and must never be treated as cleared songs. Use this before promising that Studio can teach or play a requested title. Calling a use educational, open source, nonprofit, or a prototype is not treated as copyright permission.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        return studioSongCatalogView()
      })
  },
  {
    name: "get_studio_mutations",
    title: "Get Studio mutation history",
    description:
      "Read the versioned, ordered Effect mutation journal for this browser session. Each accepted edit includes its origin actor, action, timestamp, request and revision boundaries, stable targets, and normalized input. Failed calls and idempotent retries are excluded. Omit after_sequence for the most recent page; pass the returned next_cursor as after_sequence to poll for newer edits. Filter with actions when an agent only needs selected behavior for auditing, next-action inference, or local preference learning. The response reports its bounded retention window explicitly.",
    inputSchema: jsonSchema(GetMutationsInput),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(GetMutationsInput)(input)
        const studio = yield* Studio
        const page = yield* studio.mutationHistory({
          ...(decoded.after_sequence === undefined ? {} : { afterSequence: decoded.after_sequence }),
          ...(decoded.limit === undefined ? {} : { limit: decoded.limit }),
          ...(decoded.actions === undefined ? {} : { actions: decoded.actions })
        })
        return studioMutationView(page)
      })
  },
  {
    name: "get_studio_midi",
    title: "Read complete Studio MIDI session",
    description:
      "Read the sole canonical representation of the complete musical session as structured MIDI event JSON. Always returns every symbolic track, clip, stable note ID, pitch, velocity, exact absolute quarter-note beat, tempo, meter, mix state, selection, and staged MIDI preview in one revisioned document. Referenced recordings are listed separately because MIDI cannot encode audio waveforms. Read this before exact raw-note edits with write_studio_midi. Do not call it before query_studio or compose_studio: those tools read the required live state internally so the full document does not enter model context. Never infer music from the GUI.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const studio = yield* Studio
        const state = yield* studio.snapshot
        return studioMidiView(state)
      })
  },
  {
    name: "zoom_studio_view",
    title: "Zoom, scroll, and highlight Studio passage",
    description:
      "Frame an exact beat range in the visible Studio timeline and highlight it with a short human-facing label. When track_ids are provided, the same view action vertically scrolls the arrangement to center those tracks and emphasizes them while dimming the others. Omit track_ids to preserve the current vertical track position and highlight the beat range across every track. Use this after describing a passage so the person can immediately see the bars and tracks you mean. This is an ephemeral view-only action: it does not change MIDI, canonical selection, project revision, undo history, or the mutation journal. Read get_studio_midi first for exact beats and track IDs.",
    inputSchema: jsonSchema(ZoomViewInput),
    annotations: { readOnlyHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ZoomViewInput)(input)
        const studio = yield* Studio
        const state = yield* studio.snapshot
        if (decoded.end_beat <= decoded.start_beat) {
          return yield* new StudioRuleError({
            code: "invalid_selection",
            message: "The view end beat must be greater than the start beat.",
            currentRevision: state.revision
          })
        }

        const requestedTrackIds = decoded.track_ids ?? []
        const requestedTracks = requestedTrackIds.map((trackId) =>
          state.tracks.find((track) => track.id === trackId)
        )
        const missingTrackIndex = requestedTracks.findIndex((track) => track === undefined)
        if (missingTrackIndex >= 0) {
          const missingTrackId = requestedTrackIds[missingTrackIndex]!
          return yield* new StudioRuleError({
            code: "missing_track",
            message: `Track ${missingTrackId} does not exist. Read get_studio_midi for stable track IDs.`,
            currentRevision: state.revision
          })
        }

        const focus: StudioViewFocus = {
          startBeat: decoded.start_beat,
          endBeat: decoded.end_beat,
          paddingBeats: decoded.padding_beats ?? 2,
          trackIds: requestedTrackIds,
          trackNames: requestedTracks.map((track) => track!.name),
          label: decoded.label ?? `Beats ${decoded.start_beat}–${decoded.end_beat}`
        }
        yield* Effect.sync(() => setStudioViewFocus(focus))

        return {
          change: "view_focused",
          project_id: state.projectId,
          revision: state.revision,
          persisted: false,
          music_changed: false,
          selection_changed: false,
          view: {
            start_beat: focus.startBeat,
            end_beat: focus.endBeat,
            padding_beats: focus.paddingBeats,
            track_ids: focus.trackIds,
            track_names: focus.trackNames,
            vertical_track_scroll: focus.trackIds.length > 0 ? "center_track_ids" : "preserve",
            label: focus.label
          },
          canonical_selection: studioOperationStateView(state).selection
        }
      })
  },
  {
    name: "write_studio_midi",
    title: "Write Studio MIDI",
    description:
      "Manipulate the canonical session document by writing 1–512 exact MIDI notes as one revision-checked, retry-safe, undoable transaction. Times are absolute zero-based quarter-note beats. Pitch may be MIDI 0–127 or a note name such as C4, F#3, or Bb2; velocity is 1–127. Use create to make a clip, append to add notes, or replace to atomically replace a clip's notes. Always read the complete get_studio_midi document first and read it again after the edit; never operate through GUI coordinates. Do not use this raw-note tool to transcribe commercial melodies, signature riffs, exact arrangements, or third-party tabs/MIDI; use compose_studio's reference_practice_bed contract for facts-only commercial-song requests.",
    inputSchema: jsonSchema(WriteMidiInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(WriteMidiInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(
          studio.writeMidi(
            {
              mode: decoded.mode,
              notes: decoded.notes.map((note) => ({
                pitch: note.pitch,
                startBeat: note.start_beat,
                durationBeats: note.duration_beats,
                ...(note.velocity === undefined ? {} : { velocity: note.velocity })
              })),
              ...(decoded.track_id === undefined ? {} : { trackId: decoded.track_id }),
              ...(decoded.clip_id === undefined ? {} : { clipId: decoded.clip_id }),
              ...(decoded.track_name === undefined ? {} : { trackName: decoded.track_name }),
              ...(decoded.clip_name === undefined ? {} : { clipName: decoded.clip_name }),
              ...(decoded.program === undefined ? {} : { program: decoded.program }),
              ...(decoded.channel === undefined ? {} : { channel: decoded.channel })
            },
            optionsOf(decoded)
          )
        )
      })
  },
  {
    name: "select_studio_beat_range",
    title: "Select Studio beat range",
    description:
      "Select an exact absolute quarter-note beat range for a later staged MIDI generation. This changes selection only, not clips.",
    inputSchema: jsonSchema(SelectBeatRangeInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(SelectBeatRangeInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(
          studio.selectBeatRange(decoded.start_beat, decoded.end_beat, optionsOf(decoded))
        )
      })
  },
  {
    name: "stage_studio_part",
    title: "Stage symbolic MIDI part",
    description:
      "Generate and stage one symbolic MIDI part inside the selected beat range. The preview contains exact note events in the canonical get_studio_midi document and does not alter the arrangement until apply_studio_preview is called.",
    inputSchema: jsonSchema(StagePartInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(StagePartInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(studio.stagePart(decoded.prompt, optionsOf(decoded)))
      })
  },
  {
    name: "stage_studio_transposition",
    title: "Stage an exact MIDI key change",
    description:
      "Stage a non-destructive semitone transposition over an exact absolute beat range. By default every melodic MIDI track is included and channel-10 drums are preserved; pass stable track_ids to target a smaller set. The preview changes exact MIDI pitches while preserving beats, durations, velocities, clip IDs, and the committed arrangement. Use get_studio_midi first to choose the range and optional track IDs, then call apply_studio_preview only after the person has reviewed or auditioned the stage.",
    inputSchema: jsonSchema(StageTranspositionInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(StageTranspositionInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(
          studio.stageMidiTransposition(
            {
              semitones: decoded.semitones,
              startBeat: decoded.start_beat,
              endBeat: decoded.end_beat,
              ...(decoded.track_ids === undefined ? {} : { trackIds: decoded.track_ids })
            },
            optionsOf(decoded)
          )
        )
      })
  },
  {
    name: "stage_karaoke_guide",
    title: "Stage a timed karaoke guide",
    description:
      "Stage authorized or user-authored lyric words against one canonical MIDI melody track over exact absolute beats. The browser deterministically maps 1–64 whitespace-separated words to the selected melody and exposes expected MIDI pitches without analyzing rendered audio. This does not activate the microphone and does not replace the active guide until apply_studio_preview is called. Read get_studio_midi first for the melody_track_id and beat range.",
    inputSchema: jsonSchema(StageKaraokeGuideInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(StageKaraokeGuideInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(
          studio.stageKaraokeGuide(
            {
              lyrics: decoded.lyrics,
              melodyTrackId: decoded.melody_track_id,
              startBeat: decoded.start_beat,
              endBeat: decoded.end_beat,
              ...(decoded.title === undefined ? {} : { title: decoded.title })
            },
            optionsOf(decoded)
          )
        )
      })
  },
  {
    name: "get_karaoke_guide",
    title: "Read the active karaoke guide",
    description:
      "Read the bounded active karaoke guide: authorized lyric tokens, exact beat timing, and expected MIDI pitch names. This never starts microphone capture and never returns raw or encoded audio, sample arrays, object URLs, or blob URLs. If no guide is active, stage_karaoke_guide and apply_studio_preview first.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const studio = yield* Studio
        const state = yield* studio.snapshot
        const session = getKaraokeSessionView()
        return {
          project_id: state.projectId,
          revision: state.revision,
          microphone_active: session.microphoneActive,
          raw_audio_shared: false,
          guide: studioMidiView(state).karaoke_guide
        }
      })
  },
  {
    name: "get_karaoke_result",
    title: "Read the local karaoke result",
    description:
      "Read one bounded summary of the browser-local karaoke session: status, any microphone issue code, latest detected pitch, evidence coverage, intonation score, cents error, detected range, and per-word phrase scores. This read-only tool cannot activate the microphone and never returns raw or encoded audio, sample arrays, continuous frame streams, object URLs, or blob URLs. A person must start and stop microphone capture through the visible Studio controls.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const session = getKaraokeSessionView()
        return {
          status: session.status,
          guide_id: session.guideId,
          microphone_active: session.microphoneActive,
          microphone_issue: session.microphoneIssue,
          raw_audio_shared: false,
          captured_pitch_frames: session.capturedPitchFrames,
          latest_pitch:
            session.latestPitch === null
              ? null
              : {
                  frequency_hz: session.latestPitch.frequencyHz,
                  midi: session.latestPitch.nearestMidi,
                  pitch_name: midiName(session.latestPitch.nearestMidi),
                  cents: session.latestPitch.cents,
                  confidence: session.latestPitch.confidence
                },
          result:
            session.result === null
              ? null
              : {
                  sufficient_evidence: session.result.sufficientEvidence,
                  matched_frames: session.result.matchedFrames,
                  confident_frames: session.result.confidentFrames,
                  coverage: session.result.coverage,
                  score: session.result.score,
                  in_tune_percent: session.result.inTunePercent,
                  median_error_cents: session.result.medianErrorCents,
                  detected_range:
                    session.result.detectedRange === null
                      ? null
                      : {
                          lowest_midi: session.result.detectedRange.lowestMidi,
                          lowest_pitch_name: midiName(session.result.detectedRange.lowestMidi),
                          highest_midi: session.result.detectedRange.highestMidi,
                          highest_pitch_name: midiName(session.result.detectedRange.highestMidi)
                        },
                  phrases: session.result.phrases.map((phrase) => ({
                    token_id: phrase.tokenId,
                    text: phrase.text,
                    matched_frames: phrase.matchedFrames,
                    score: phrase.score,
                    median_error_cents: phrase.medianErrorCents
                  }))
                },
          message: session.message
        }
      })
  },
  {
    name: "apply_studio_preview",
    title: "Apply Studio preview",
    description:
      "Commit the identified staged preview to the arrangement as one undoable project transaction.",
    inputSchema: jsonSchema(PreviewInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(PreviewInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(studio.applyPreview(decoded.preview_id, optionsOf(decoded)))
      })
  },
  {
    name: "discard_studio_preview",
    title: "Discard Studio preview",
    description: "Discard the identified staged preview without changing any committed track or clip.",
    inputSchema: jsonSchema(PreviewInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(PreviewInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(studio.discardPreview(decoded.preview_id, optionsOf(decoded)))
      })
  },
  {
    name: "set_karaoke_count_in",
    title: "Set karaoke count-in",
    description:
      "Configure playback to begin 4, 8, or 12 beats before the active karaoke passage, giving the singer musical context before its first lyric. For a requested chorus, select its beat range, stage and apply its karaoke guide, then call this tool before the person presses play. The setting is an undoable part of the shared Effect session and is visible in Code Mode. It does not start playback or microphone capture; the person starts those from the visible karaoke controls.",
    inputSchema: jsonSchema(SetKaraokeCountInInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(SetKaraokeCountInInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(studio.setKaraokeCountIn(decoded.beats, optionsOf(decoded)))
      })
  },
  {
    name: "set_studio_tempo",
    title: "Set Studio tempo",
    description: "Set the project tempo from 40 to 240 BPM as one undoable project transaction.",
    inputSchema: jsonSchema(TempoInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TempoInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(studio.setTempo(decoded.bpm, optionsOf(decoded)))
      })
  },
  {
    name: "set_studio_track_mix",
    title: "Set Studio track mix",
    description:
      "Update volume, pan, mute, or solo for one stable track ID as one undoable project transaction.",
    inputSchema: jsonSchema(TrackMixInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(TrackMixInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(
          studio.setTrackMix(
            decoded.track_id,
            {
              ...(decoded.volume === undefined ? {} : { volume: decoded.volume }),
              ...(decoded.pan === undefined ? {} : { pan: decoded.pan }),
              ...(decoded.muted === undefined ? {} : { muted: decoded.muted }),
              ...(decoded.soloed === undefined ? {} : { soloed: decoded.soloed })
            },
            optionsOf(decoded)
          )
        )
      })
  },
  {
    name: "undo_studio_edit",
    title: "Undo Studio edit",
    description: "Undo the most recent committed project transaction. Selection-only changes are not undone.",
    inputSchema: jsonSchema(HistoryInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(HistoryInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(studio.undo(optionsOf(decoded)))
      })
  },
  {
    name: "redo_studio_edit",
    title: "Redo Studio edit",
    description: "Redo the most recently undone committed project transaction.",
    inputSchema: jsonSchema(HistoryInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(HistoryInput)(input)
        const studio = yield* Studio
        return yield* withConciseState(studio.redo(optionsOf(decoded)))
      })
  }
]
