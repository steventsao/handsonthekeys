import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { createKaraokeTokens, type KaraokeToken } from "./karaoke.ts"
import { initialStudioSongState } from "./songs/catalog.ts"
import type { StudioCompositionBasis, StudioReferencePracticeBedBasis } from "./studioComposition.ts"
import { persistStudioSession, restoreStudioSession, restoreStudioSessionState } from "./studioSession.ts"
import type { StudioSharePayload } from "./studioShareContract.ts"

export const studioTrackKinds = ["audio", "midi"] as const
export type StudioTrackKind = (typeof studioTrackKinds)[number]

export const studioSounds = ["drums", "bass", "pad", "lead", "texture"] as const
export type StudioSound = (typeof studioSounds)[number]

export type StudioActor = "AGENT" | "HUMAN" | "ENGINE"

export const studioKaraokeCountInBeats = [4, 8, 12] as const
export type StudioKaraokeCountInBeats = (typeof studioKaraokeCountInBeats)[number]

export const studioMutationActions = [
  "select_time_range",
  "select_beat_range",
  "stage_part",
  "stage_midi_transposition",
  "stage_karaoke_guide",
  "apply_preview",
  "discard_preview",
  "set_karaoke_count_in",
  "set_tempo",
  "set_track_mix",
  "write_midi",
  "compose_midi",
  "add_uploaded_track",
  "import_shared_session",
  "move_clip",
  "undo",
  "redo"
] as const
export type StudioMutationAction = (typeof studioMutationActions)[number]
export const studioMutationSchemaVersion = 2
export const studioMutationRetentionLimit = 2_048

export type StudioMutationValue =
  | null
  | string
  | number
  | boolean
  | ReadonlyArray<StudioMutationValue>
  | { readonly [key: string]: StudioMutationValue }

export interface StudioMutationTargets {
  readonly trackId?: string
  readonly clipId?: string
  readonly previewId?: string
}

export interface StudioMutationEvent {
  readonly sequence: number
  readonly recordedAt: string
  readonly actor: StudioActor
  readonly action: StudioMutationAction
  readonly requestId: string
  readonly expectedRevision?: number
  readonly revisionBefore: number
  readonly revisionAfter: number
  readonly result: string
  readonly targets: StudioMutationTargets
  readonly input: Readonly<Record<string, StudioMutationValue>>
}

export interface StudioMutationQuery {
  readonly afterSequence?: number
  readonly limit?: number
  readonly actions?: ReadonlyArray<StudioMutationAction>
}

export interface StudioMutationPage {
  readonly schemaVersion: number
  readonly projectId: string
  readonly currentRevision: number
  readonly totalMutationCount: number
  readonly retentionLimit: number
  readonly retainedFromSequence: number | null
  readonly nextCursor: number
  readonly hasMore: boolean
  readonly hasOlder: boolean
  readonly context: {
    readonly bpm: number
    readonly selectionStartBeat: number
    readonly selectionEndBeat: number
    readonly previewId: string | null
    readonly canUndo: boolean
    readonly canRedo: boolean
    readonly trackCount: number
  }
  readonly mutations: ReadonlyArray<StudioMutationEvent>
}

export interface StudioNote {
  readonly id: string
  readonly midi: number
  readonly name: string
  readonly time: number
  readonly duration: number
  readonly velocity: number
  readonly startBeat?: number
  readonly durationBeats?: number
  readonly midiVelocity?: number
}

export type StudioClipSource =
  | {
      readonly kind: "generated"
      readonly sound: StudioSound
      readonly seed: number
    }
  | {
      readonly kind: "upload"
      readonly assetId: string
    }
  | {
      readonly kind: "midi_asset"
      readonly assetId: string
      readonly sourceTrackName: string
      readonly sound: StudioSound
      readonly seed: number
    }

export interface StudioClip {
  readonly id: string
  readonly kind: StudioTrackKind
  readonly name: string
  readonly start: number
  readonly duration: number
  readonly gain: number
  readonly color: string
  readonly source: StudioClipSource
  readonly notes: ReadonlyArray<StudioNote>
  readonly takeGroupId: string | null
  readonly startBeat?: number
  readonly durationBeats?: number
  readonly midiProgram?: number
  readonly midiChannel?: number
}

export interface StudioTrack {
  readonly id: string
  readonly kind: StudioTrackKind
  readonly name: string
  readonly color: string
  readonly volume: number
  readonly pan: number
  readonly muted: boolean
  readonly soloed: boolean
  readonly clips: ReadonlyArray<StudioClip>
}

export interface StudioSelection {
  readonly start: number
  readonly end: number
}

interface StudioPreviewBase {
  readonly id: string
  readonly prompt: string
  readonly clip: StudioClip
  readonly targetTrackId: string
  readonly targetTrackName: string
  readonly operations: ReadonlyArray<string>
}

export interface StudioGeneratedPartPreview extends StudioPreviewBase {
  readonly kind: "generated_part"
}

export interface StudioMidiTranspositionReplacement {
  readonly trackId: string
  readonly clipId: string
  readonly clip: StudioClip
}

export interface StudioMidiTranspositionPreview extends StudioPreviewBase {
  readonly kind: "midi_transposition"
  readonly semitones: number
  readonly startBeat: number
  readonly endBeat: number
  readonly notesAffected: number
  readonly replacements: ReadonlyArray<StudioMidiTranspositionReplacement>
}

export interface StudioKaraokeGuide {
  readonly id: string
  readonly title: string
  readonly melodyTrackId: string
  readonly melodyTrackName: string
  readonly startBeat: number
  readonly endBeat: number
  readonly tokens: ReadonlyArray<KaraokeToken>
}

export interface StudioKaraokeGuidePreview extends StudioPreviewBase {
  readonly kind: "karaoke_guide"
  readonly guide: StudioKaraokeGuide
}

export type StudioPreview =
  StudioGeneratedPartPreview | StudioMidiTranspositionPreview | StudioKaraokeGuidePreview

export interface StudioLog {
  readonly id: number
  readonly actor: StudioActor
  readonly message: string
}

export interface StudioSourceAttribution {
  readonly title: string
  readonly creator: string
  readonly sourceUrl: string
  readonly licenseName: string
  readonly licenseUrl: string
  readonly sourceMidiUrl: string
  readonly sourceMidiSha256: string
  readonly changes: string
}

export interface StudioState {
  readonly projectId: string
  readonly songSlug: string
  readonly title: string
  readonly attribution: StudioSourceAttribution | null
  readonly revision: number
  readonly bpm: number
  readonly timeSignature: readonly [number, number]
  readonly selection: StudioSelection
  readonly tracks: ReadonlyArray<StudioTrack>
  readonly preview: StudioPreview | null
  readonly karaokeGuide: StudioKaraokeGuide | null
  readonly karaokeCountInBeats: StudioKaraokeCountInBeats
  readonly practiceBed: StudioReferencePracticeBedBasis | null
  readonly historyDepth: number
  readonly redoDepth: number
  readonly mutationCount: number
  readonly logs: ReadonlyArray<StudioLog>
}

export interface StudioMutationOptions {
  readonly requestId: string
  readonly expectedRevision?: number
  readonly actor?: StudioActor
}

export interface StudioMutationResult {
  readonly requestId: string
  readonly revision: number
  readonly replayed: boolean
  readonly change: string
}

export const studioMidiWriteModes = ["create", "append", "replace"] as const
export type StudioMidiWriteMode = (typeof studioMidiWriteModes)[number]

export interface StudioMidiWriteNote {
  readonly pitch: number | string
  readonly startBeat: number
  readonly durationBeats: number
  readonly velocity?: number
}

export interface StudioMidiWrite {
  readonly mode: StudioMidiWriteMode
  readonly notes: ReadonlyArray<StudioMidiWriteNote>
  readonly trackId?: string
  readonly clipId?: string
  readonly trackName?: string
  readonly clipName?: string
  readonly program?: number
  readonly channel?: number
}

export interface StudioMidiMutationResult extends StudioMutationResult {
  readonly mode: StudioMidiWriteMode
  readonly trackId: string
  readonly clipId: string
  readonly notesWritten: number
  readonly totalNotes: number
}

export interface StudioMidiCompositionTrack {
  readonly trackName: string
  readonly clipName: string
  readonly program: number
  readonly channel: number
  readonly volume?: number
  readonly pan?: number
  readonly notes: ReadonlyArray<StudioMidiWriteNote>
}

export type StudioMidiComposition =
  | {
      readonly mode: "append"
      readonly basis: Extract<StudioCompositionBasis, { readonly kind: "original" }>
      readonly tracks: ReadonlyArray<StudioMidiCompositionTrack>
    }
  | {
      readonly mode: "replace_session"
      readonly basis: StudioReferencePracticeBedBasis
      readonly tracks: ReadonlyArray<StudioMidiCompositionTrack>
    }

export interface StudioMidiCompositionTrackResult {
  readonly trackId: string
  readonly clipId: string
  readonly trackName: string
  readonly clipName: string
  readonly program: number
  readonly channel: number
  readonly notesWritten: number
}

export interface StudioMidiCompositionResult extends StudioMutationResult {
  readonly mode: "append" | "replace_session"
  readonly basis: StudioCompositionBasis
  readonly tracksCreated: number
  readonly notesWritten: number
  readonly tracks: ReadonlyArray<StudioMidiCompositionTrackResult>
}

export interface StudioMidiTransposition {
  readonly semitones: number
  readonly startBeat: number
  readonly endBeat: number
  readonly trackIds?: ReadonlyArray<string>
}

export interface StudioMidiTranspositionResult extends StudioMutationResult {
  readonly previewId: string
  readonly semitones: number
  readonly startBeat: number
  readonly endBeat: number
  readonly trackIds: ReadonlyArray<string>
  readonly notesAffected: number
}

export interface StudioKaraokeGuideInput {
  readonly lyrics: string
  readonly melodyTrackId: string
  readonly startBeat: number
  readonly endBeat: number
  readonly title?: string
}

export interface StudioKaraokeGuideResult extends StudioMutationResult {
  readonly previewId: string
  readonly guideId: string
  readonly tokenCount: number
  readonly melodyTrackId: string
}

export interface StudioDocument {
  readonly songSlug: string
  readonly title: string
  readonly attribution: StudioSourceAttribution | null
  readonly bpm: number
  readonly timeSignature: readonly [number, number]
  readonly selection: StudioSelection
  readonly tracks: ReadonlyArray<StudioTrack>
  readonly karaokeGuide: StudioKaraokeGuide | null
  readonly karaokeCountInBeats: StudioKaraokeCountInBeats
  readonly practiceBed: StudioReferencePracticeBedBasis | null
}

export interface StudioSeenMutation {
  readonly fingerprint: string
  readonly result: StudioMutationResult
}

export interface StudioInternalState {
  readonly present: StudioState
  readonly past: ReadonlyArray<StudioDocument>
  readonly future: ReadonlyArray<StudioDocument>
  readonly seen: ReadonlyMap<string, StudioSeenMutation>
  readonly nextId: number
  readonly mutations: ReadonlyArray<StudioMutationEvent>
  readonly nextMutationSequence: number
}

interface StudioMutationIntent<A extends StudioMutationResult> {
  readonly action: StudioMutationAction
  readonly defaultActor: StudioActor
  readonly input: Readonly<Record<string, StudioMutationValue>>
  readonly targets?: StudioMutationTargets
  readonly resolveTargets?: (result: A) => StudioMutationTargets
}

export class StudioRuleError extends Schema.TaggedError<StudioRuleError>()("StudioRuleError", {
  code: Schema.Literals([
    "invalid_selection",
    "invalid_midi",
    "invalid_karaoke",
    "missing_preview",
    "missing_clip",
    "missing_track",
    "request_id_conflict",
    "revision_conflict",
    "nothing_to_undo",
    "nothing_to_redo",
    "invalid_shared_session"
  ]),
  message: Schema.String,
  currentRevision: Schema.Int
}) {}

const generatedMidiClip = (
  id: string,
  name: string,
  sound: StudioSound,
  seed: number,
  start: number,
  duration: number,
  color: string,
  bpm = 120
): StudioClip => {
  const startBeat = cleanBeat(beatsOfSeconds(start, bpm))
  const durationBeats = cleanBeat(beatsOfSeconds(duration, bpm))
  const relativeNotes = notesForSound(sound, duration, seed, id)
  const compiled = compileMidiClip(
    relativeNotes.map((note) => ({
      id: note.id,
      midi: note.midi,
      startBeat: cleanBeat(startBeat + beatsOfSeconds(note.time, bpm)),
      durationBeats: cleanBeat(beatsOfSeconds(note.duration, bpm)),
      velocity: Math.max(1, Math.min(127, Math.round(note.velocity * 127)))
    })),
    bpm,
    {
      id,
      name,
      program: midiProgramForSound[sound],
      channel: sound === "drums" ? 9 : 0,
      seed,
      color
    }
  )
  return {
    ...compiled,
    start,
    duration,
    startBeat,
    durationBeats
  }
}

const freshStudioState = (): StudioState => initialStudioSongState()

const freshInternalState = (): StudioInternalState => ({
  present: freshStudioState(),
  past: [],
  future: [],
  seen: new Map(),
  nextId: 1,
  mutations: [],
  nextMutationSequence: 1
})

export const initialStudioState = (): StudioState => restoreStudioSessionState(freshStudioState())

const initialInternalState = (): StudioInternalState => restoreStudioSession(freshInternalState())

const documentOf = (state: StudioState): StudioDocument => ({
  songSlug: state.songSlug,
  title: state.title,
  attribution: state.attribution,
  bpm: state.bpm,
  timeSignature: state.timeSignature,
  selection: state.selection,
  tracks: state.tracks,
  karaokeGuide: state.karaokeGuide,
  karaokeCountInBeats: state.karaokeCountInBeats,
  practiceBed: state.practiceBed
})

const boundedLogs = (logs: ReadonlyArray<StudioLog>): ReadonlyArray<StudioLog> =>
  logs.length <= 32 ? logs : logs.slice(logs.length - 32)

const withLog = (
  state: StudioState,
  actor: StudioActor,
  message: string,
  changes: Partial<StudioState> = {}
): StudioState => ({
  ...state,
  ...changes,
  logs: boundedLogs([
    ...state.logs,
    { id: state.logs.at(-1)?.id === undefined ? 1 : state.logs.at(-1)!.id + 1, actor, message }
  ])
})

const withRevision = (
  state: StudioState,
  historyDepth: number,
  redoDepth: number,
  actor: StudioActor,
  message: string,
  changes: Partial<StudioState>
): StudioState =>
  withLog(state, actor, message, {
    ...changes,
    revision: state.revision + 1,
    historyDepth,
    redoDepth
  })

const restoreDocument = (
  state: StudioState,
  document: StudioDocument,
  revision: number,
  historyDepth: number,
  redoDepth: number,
  message: string
): StudioState =>
  withLog(state, "AGENT", message, {
    ...document,
    preview: null,
    revision,
    historyDepth,
    redoDepth
  })

const hashPrompt = (prompt: string): number => {
  let value = 2166136261
  for (const character of prompt) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

const inferSound = (prompt: string): StudioSound => {
  const normalized = prompt.toLowerCase()
  if (/drum|beat|rhythm|percussion|kick|snare/.test(normalized)) return "drums"
  if (/bass|sub|low end|808/.test(normalized)) return "bass"
  if (/pad|ambient|atmosphere|wash|chord/.test(normalized)) return "pad"
  if (/lead|melody|pluck|arp|hook|solo/.test(normalized)) return "lead"
  return "texture"
}

export const midiName = (midi: number): string => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

const notesForSound = (
  sound: StudioSound,
  duration: number,
  seed: number,
  clipId: string
): ReadonlyArray<StudioNote> => {
  const roots: Readonly<Record<StudioSound, ReadonlyArray<number>>> = {
    drums: [36, 42, 38, 42],
    bass: [36, 36, 39, 34, 43, 39, 34, 31],
    pad: [48, 51, 55, 60],
    lead: [60, 63, 67, 70, 67, 63, 72, 70],
    texture: [55, 58, 63, 67]
  }
  const pitches = roots[sound]
  const step = sound === "pad" || sound === "texture" ? 2 : 0.5
  const noteDuration = sound === "pad" || sound === "texture" ? 3.6 : 0.38
  const noteCount = Math.max(1, Math.floor(duration / step))
  return Array.from({ length: noteCount }, (_, index) => {
    const pitch = pitches[(index + seed) % pitches.length] ?? pitches[0] ?? 60
    return {
      id: `${clipId}-note-${index + 1}`,
      midi: pitch,
      name: midiName(pitch),
      time: index * step,
      duration: Math.min(noteDuration, duration - index * step),
      velocity: sound === "drums" ? 0.86 : 0.62 + ((seed + index * 7) % 22) / 100
    }
  })
}

interface NormalizedMidiNote {
  readonly id: string
  readonly midi: number
  readonly startBeat: number
  readonly durationBeats: number
  readonly velocity: number
}

const pitchPattern = /^([A-Ga-g])([#b]?)(-1|[0-9])$/
const naturalPitchClasses: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
}

export const midiNumberOf = (pitch: number | string): number | undefined => {
  if (typeof pitch === "number") {
    return Number.isInteger(pitch) && pitch >= 0 && pitch <= 127 ? pitch : undefined
  }
  const match = pitchPattern.exec(pitch.trim())
  if (match === null) return undefined
  const pitchClass = naturalPitchClasses[match[1]!.toUpperCase()]
  if (pitchClass === undefined) return undefined
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0
  const octave = Number(match[3])
  const midi = (octave + 1) * 12 + pitchClass + accidental
  return midi >= 0 && midi <= 127 ? midi : undefined
}

const secondsPerBeat = (bpm: number): number => 60 / bpm
const beatsOfSeconds = (seconds: number, bpm: number): number => seconds / secondsPerBeat(bpm)
export const studioBeatResolution = 0.000001
const cleanBeat = (beat: number): number => Math.round(beat * 1_000_000) / 1_000_000

const invalidMidi = (state: StudioState, message: string): StudioRuleError =>
  new StudioRuleError({
    code: "invalid_midi",
    message,
    currentRevision: state.revision
  })

const normalizeMidiNotes = (
  state: StudioState,
  notes: ReadonlyArray<StudioMidiWriteNote>,
  batchId: number
): { readonly notes: ReadonlyArray<NormalizedMidiNote> } | { readonly error: StudioRuleError } => {
  if (notes.length < 1 || notes.length > 512) {
    return { error: invalidMidi(state, "Write between 1 and 512 complete MIDI notes per call.") }
  }
  const normalized: Array<NormalizedMidiNote> = []
  for (const [index, note] of notes.entries()) {
    const midi = midiNumberOf(note.pitch)
    const velocity = note.velocity ?? 96
    const startBeat = cleanBeat(note.startBeat)
    const durationBeats = cleanBeat(note.durationBeats)
    if (midi === undefined) {
      return {
        error: invalidMidi(
          state,
          `Note ${index + 1} has an invalid pitch. Use a MIDI number from 0 to 127 or a name such as C4, F#3, or Bb2.`
        )
      }
    }
    if (!Number.isFinite(note.startBeat) || note.startBeat < 0 || note.startBeat > 4096) {
      return { error: invalidMidi(state, `Note ${index + 1} startBeat must be from 0 to 4096.`) }
    }
    if (
      !Number.isFinite(note.durationBeats) ||
      note.durationBeats < studioBeatResolution ||
      durationBeats < studioBeatResolution ||
      note.durationBeats > 256
    ) {
      return {
        error: invalidMidi(
          state,
          `Note ${index + 1} durationBeats must be at least ${studioBeatResolution} and at most 256.`
        )
      }
    }
    if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) {
      return { error: invalidMidi(state, `Note ${index + 1} velocity must be an integer from 1 to 127.`) }
    }
    normalized.push({
      id: `note-midi-${batchId}-${index + 1}`,
      midi,
      startBeat,
      durationBeats,
      velocity
    })
  }
  return { notes: normalized }
}

const logicalNotesOfClip = (clip: StudioClip, bpm: number): ReadonlyArray<NormalizedMidiNote> =>
  clip.notes.map((note) => ({
    id: note.id,
    midi: note.midi,
    startBeat: cleanBeat(note.startBeat ?? beatsOfSeconds(clip.start + note.time, bpm)),
    durationBeats: cleanBeat(note.durationBeats ?? beatsOfSeconds(note.duration, bpm)),
    velocity: note.midiVelocity ?? Math.max(1, Math.min(127, Math.round(note.velocity * 127)))
  }))

const midiProgramForSound: Readonly<Record<StudioSound, number>> = {
  drums: 0,
  bass: 38,
  pad: 88,
  lead: 80,
  texture: 94
}

const soundForMidi = (program: number, channel: number): StudioSound =>
  channel === 9
    ? "drums"
    : program >= 32 && program <= 39
      ? "bass"
      : program >= 88 && program <= 95
        ? "pad"
        : "lead"

const compileMidiClip = (
  logicalNotes: ReadonlyArray<NormalizedMidiNote>,
  bpm: number,
  values: {
    readonly id: string
    readonly name: string
    readonly program: number
    readonly channel: number
    readonly seed: number
    readonly color?: string
    readonly existing?: StudioClip
  }
): StudioClip => {
  const ordered = [...logicalNotes].sort(
    (left, right) =>
      left.startBeat - right.startBeat || left.midi - right.midi || left.id.localeCompare(right.id)
  )
  const startBeat = Math.min(...ordered.map((note) => note.startBeat))
  const endBeat = Math.max(...ordered.map((note) => note.startBeat + note.durationBeats))
  const durationBeats = cleanBeat(endBeat - startBeat)
  const beatSeconds = secondsPerBeat(bpm)
  const sound = soundForMidi(values.program, values.channel)
  return {
    id: values.id,
    kind: "midi",
    name: values.name,
    start: startBeat * beatSeconds,
    duration: durationBeats * beatSeconds,
    gain: values.existing?.gain ?? 0.8,
    color: values.existing?.color ?? values.color ?? paletteForSound[sound],
    source: values.existing?.source ?? { kind: "generated", sound, seed: values.seed },
    notes: ordered.map((note) => ({
      id: note.id,
      midi: note.midi,
      name: midiName(note.midi),
      time: (note.startBeat - startBeat) * beatSeconds,
      duration: note.durationBeats * beatSeconds,
      velocity: note.velocity / 127,
      startBeat: note.startBeat,
      durationBeats: note.durationBeats,
      midiVelocity: note.velocity
    })),
    takeGroupId: values.existing?.takeGroupId ?? null,
    startBeat,
    durationBeats,
    midiProgram: values.program,
    midiChannel: values.channel
  }
}

const midiClipAtTempo = (clip: StudioClip, bpm: number): StudioClip => {
  if (clip.kind !== "midi" || clip.startBeat === undefined || clip.durationBeats === undefined) {
    return clip
  }
  const beatSeconds = secondsPerBeat(bpm)
  return {
    ...clip,
    start: clip.startBeat * beatSeconds,
    duration: clip.durationBeats * beatSeconds,
    notes: clip.notes.map((note) =>
      note.startBeat === undefined || note.durationBeats === undefined
        ? note
        : {
            ...note,
            time: (note.startBeat - clip.startBeat!) * beatSeconds,
            duration: note.durationBeats * beatSeconds
          }
    )
  }
}

const midiClipSourceView = (source: StudioClipSource) => {
  switch (source.kind) {
    case "generated":
      return { kind: "generated" as const, sound: source.sound, seed: source.seed }
    case "midi_asset":
      return {
        kind: "bundled_midi_asset" as const,
        asset_id: source.assetId,
        source_track_name: source.sourceTrackName
      }
    case "upload":
      return { kind: "uploaded_audio" as const, asset_id: source.assetId }
  }
}

const midiClipView = (clip: StudioClip, bpm: number) => {
  const sound = clip.source.kind === "upload" ? undefined : clip.source.sound
  return {
    clip_id: clip.id,
    name: clip.name,
    start_beat: cleanBeat(clip.startBeat ?? beatsOfSeconds(clip.start, bpm)),
    duration_beats: cleanBeat(clip.durationBeats ?? beatsOfSeconds(clip.duration, bpm)),
    gain: clip.gain,
    program: clip.midiProgram ?? (sound === undefined ? 80 : midiProgramForSound[sound]),
    channel: clip.midiChannel ?? (sound === "drums" ? 9 : 0),
    source: midiClipSourceView(clip.source),
    ...(clip.takeGroupId === null ? {} : { take_group_id: clip.takeGroupId }),
    notes: logicalNotesOfClip(clip, bpm).map((note) => ({
      note_id: note.id,
      pitch: note.midi,
      pitch_name: midiName(note.midi),
      start_beat: note.startBeat,
      duration_beats: note.durationBeats,
      velocity: note.velocity
    }))
  }
}

const audioAssetView = (track: StudioTrack, clip: StudioClip, bpm: number) => ({
  track_id: track.id,
  track_name: track.name,
  clip_id: clip.id,
  clip_name: clip.name,
  start_beat: cleanBeat(beatsOfSeconds(clip.start, bpm)),
  duration_beats: cleanBeat(beatsOfSeconds(clip.duration, bpm)),
  gain: clip.gain,
  source:
    clip.source.kind === "upload"
      ? { kind: "uploaded_audio" as const, asset_id: clip.source.assetId }
      : clip.source.kind === "midi_asset"
        ? {
            kind: "bundled_midi_asset" as const,
            asset_id: clip.source.assetId,
            source_track_name: clip.source.sourceTrackName
          }
        : {
            kind: "legacy_generated_audio" as const,
            sound: clip.source.sound,
            seed: clip.source.seed
          }
})

export const studioMidiView = (state: StudioState) => {
  const midiTracks = state.tracks.filter((track) => track.kind === "midi")
  const audioAssets = state.tracks.flatMap((track) =>
    track.kind === "audio"
      ? track.clips.map((clip) => ({
          ...audioAssetView(track, clip, state.bpm),
          mix: {
            volume: track.volume,
            pan: track.pan,
            muted: track.muted,
            soloed: track.soloed
          }
        }))
      : []
  )
  const clipCount = midiTracks.reduce((count, track) => count + track.clips.length, 0)
  const noteCount = midiTracks.reduce(
    (count, track) => count + track.clips.reduce((trackCount, clip) => trackCount + clip.notes.length, 0),
    0
  )
  const sessionEndBeat = cleanBeat(
    Math.max(
      0,
      ...state.tracks.flatMap((track) =>
        track.clips.map(
          (clip) =>
            (clip.startBeat ?? beatsOfSeconds(clip.start, state.bpm)) +
            (clip.durationBeats ?? beatsOfSeconds(clip.duration, state.bpm))
        )
      )
    )
  )
  const pendingPreview =
    state.preview === null
      ? null
      : {
          preview_id: state.preview.id,
          kind: state.preview.kind,
          prompt: state.preview.prompt,
          target_track_id: state.preview.targetTrackId,
          target_track_name: state.preview.targetTrackName,
          clip: state.preview.clip.kind === "midi" ? midiClipView(state.preview.clip, state.bpm) : null,
          ...(state.preview.kind === "midi_transposition"
            ? {
                transposition: {
                  semitones: state.preview.semitones,
                  start_beat: state.preview.startBeat,
                  end_beat: state.preview.endBeat,
                  notes_affected: state.preview.notesAffected,
                  track_ids: state.preview.replacements.map((replacement) => replacement.trackId)
                }
              }
            : {}),
          ...(state.preview.kind === "karaoke_guide"
            ? {
                karaoke_guide: {
                  guide_id: state.preview.guide.id,
                  title: state.preview.guide.title,
                  melody_track_id: state.preview.guide.melodyTrackId,
                  start_beat: state.preview.guide.startBeat,
                  end_beat: state.preview.guide.endBeat,
                  tokens: state.preview.guide.tokens.map((token) => ({
                    token_id: token.id,
                    text: token.text,
                    start_beat: token.startBeat,
                    end_beat: token.endBeat,
                    expected_midi: token.expectedMidi,
                    expected_pitch_name: midiName(token.expectedMidi)
                  }))
                }
              }
            : {})
        }

  return {
    schema_version: 6,
    representation: "canonical_midi_event_session" as const,
    complete_session: true,
    project_id: state.projectId,
    title: state.title,
    song: {
      slug: state.songSlug,
      attribution:
        state.attribution === null
          ? null
          : {
              title: state.attribution.title,
              creator: state.attribution.creator,
              source_url: state.attribution.sourceUrl,
              license_name: state.attribution.licenseName,
              license_url: state.attribution.licenseUrl,
              source_midi_url: state.attribution.sourceMidiUrl,
              source_midi_sha256: state.attribution.sourceMidiSha256,
              changes: state.attribution.changes
            }
    },
    practice_bed: state.practiceBed,
    revision: state.revision,
    timebase: "absolute_zero_based_quarter_note_beats" as const,
    ppq: 960,
    tempo_map: [{ beat: 0, bpm: state.bpm }],
    meter_map: [
      {
        beat: 0,
        numerator: state.timeSignature[0],
        denominator: state.timeSignature[1]
      }
    ],
    selection: {
      start_beat: cleanBeat(beatsOfSeconds(state.selection.start, state.bpm)),
      end_beat: cleanBeat(beatsOfSeconds(state.selection.end, state.bpm))
    },
    session_end_beat: sessionEndBeat,
    summary: {
      midi_track_count: midiTracks.length,
      midi_clip_count: clipCount,
      note_count: noteCount,
      referenced_audio_asset_count: audioAssets.length
    },
    tracks: midiTracks.map((track, index) => ({
      track_id: track.id,
      order: index,
      name: track.name,
      mix: {
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        soloed: track.soloed
      },
      clips: track.clips.filter((clip) => clip.kind === "midi").map((clip) => midiClipView(clip, state.bpm))
    })),
    referenced_audio_assets: audioAssets,
    pending_preview: pendingPreview,
    karaoke_guide:
      state.karaokeGuide === null
        ? null
        : {
            guide_id: state.karaokeGuide.id,
            title: state.karaokeGuide.title,
            melody_track_id: state.karaokeGuide.melodyTrackId,
            melody_track_name: state.karaokeGuide.melodyTrackName,
            start_beat: state.karaokeGuide.startBeat,
            end_beat: state.karaokeGuide.endBeat,
            tokens: state.karaokeGuide.tokens.map((token) => ({
              token_id: token.id,
              text: token.text,
              start_beat: token.startBeat,
              end_beat: token.endBeat,
              expected_midi: token.expectedMidi,
              expected_pitch_name: midiName(token.expectedMidi)
            }))
          },
    karaoke_count_in_beats: state.karaokeCountInBeats,
    can_undo: state.historyDepth > 0,
    can_redo: state.redoDepth > 0,
    mutation_count: state.mutationCount
  }
}

export const studioOperationStateView = (state: StudioState) => ({
  project_id: state.projectId,
  song_slug: state.songSlug,
  revision: state.revision,
  canonical_music_tool: "get_studio_midi" as const,
  bpm: state.bpm,
  selection: {
    start_beat: cleanBeat(beatsOfSeconds(state.selection.start, state.bpm)),
    end_beat: cleanBeat(beatsOfSeconds(state.selection.end, state.bpm))
  },
  pending_preview_id: state.preview?.id ?? null,
  karaoke_guide_id: state.karaokeGuide?.id ?? null,
  karaoke_count_in_beats: state.karaokeCountInBeats,
  practice_bed: state.practiceBed,
  can_undo: state.historyDepth > 0,
  can_redo: state.redoDepth > 0,
  mutation_count: state.mutationCount
})

const paletteForSound: Readonly<Record<StudioSound, string>> = {
  drums: "#f5a44b",
  bass: "#4cc7a5",
  pad: "#b884ff",
  lead: "#58a6ff",
  texture: "#f3c84b"
}

const labelForSound: Readonly<Record<StudioSound, string>> = {
  drums: "Rhythm alternate",
  bass: "Bass alternate",
  pad: "Atmosphere alternate",
  lead: "Lead alternate",
  texture: "Texture alternate"
}

const replayed = <A extends StudioMutationResult>(result: A): A => ({ ...result, replayed: true })

const mutationResult = (
  options: StudioMutationOptions,
  revision: number,
  change: string
): StudioMutationResult => ({
  requestId: options.requestId,
  revision,
  replayed: false,
  change
})

const withSeen = (
  internal: StudioInternalState,
  result: StudioMutationResult,
  fingerprint: string
): ReadonlyMap<string, StudioSeenMutation> => {
  const next = new Map(internal.seen)
  next.set(result.requestId, { fingerprint, result })
  if (next.size > 128) {
    const oldest = next.keys().next().value as string | undefined
    if (oldest !== undefined) next.delete(oldest)
  }
  return next
}

const mutationFingerprint = <A extends StudioMutationResult>(
  options: StudioMutationOptions,
  intent: StudioMutationIntent<A>
): string =>
  JSON.stringify({
    action: intent.action,
    actor: options.actor ?? intent.defaultActor,
    expectedRevision: options.expectedRevision ?? null,
    input: intent.input
  })

const boundedMutationEvents = (
  mutations: ReadonlyArray<StudioMutationEvent>
): ReadonlyArray<StudioMutationEvent> =>
  mutations.length <= studioMutationRetentionLimit
    ? mutations
    : mutations.slice(mutations.length - studioMutationRetentionLimit)

const mutationPageOf = (internal: StudioInternalState, query: StudioMutationQuery): StudioMutationPage => {
  const limit = query.limit ?? 50
  const selectedActions = query.actions === undefined ? undefined : new Set(query.actions)
  const matching = internal.mutations.filter(
    (mutation) => selectedActions === undefined || selectedActions.has(mutation.action)
  )
  const candidates =
    query.afterSequence === undefined
      ? matching
      : matching.filter((mutation) => mutation.sequence > query.afterSequence!)
  const mutations = query.afterSequence === undefined ? candidates.slice(-limit) : candidates.slice(0, limit)
  const firstSequence = mutations.at(0)?.sequence
  return {
    schemaVersion: studioMutationSchemaVersion,
    projectId: internal.present.projectId,
    currentRevision: internal.present.revision,
    totalMutationCount: internal.present.mutationCount,
    retentionLimit: studioMutationRetentionLimit,
    retainedFromSequence: internal.mutations.at(0)?.sequence ?? null,
    nextCursor: mutations.at(-1)?.sequence ?? query.afterSequence ?? internal.nextMutationSequence - 1,
    hasMore: query.afterSequence !== undefined && candidates.length > mutations.length,
    hasOlder: firstSequence !== undefined && matching.some((mutation) => mutation.sequence < firstSequence),
    context: {
      bpm: internal.present.bpm,
      selectionStartBeat: cleanBeat(beatsOfSeconds(internal.present.selection.start, internal.present.bpm)),
      selectionEndBeat: cleanBeat(beatsOfSeconds(internal.present.selection.end, internal.present.bpm)),
      previewId: internal.present.preview?.id ?? null,
      canUndo: internal.present.historyDepth > 0,
      canRedo: internal.present.redoDepth > 0,
      trackCount: internal.present.tracks.length
    },
    mutations
  }
}

export const studioMutationView = (page: StudioMutationPage) => ({
  schema_version: page.schemaVersion,
  project_id: page.projectId,
  current_revision: page.currentRevision,
  total_mutation_count: page.totalMutationCount,
  retention_limit: page.retentionLimit,
  retained_from_sequence: page.retainedFromSequence,
  next_cursor: page.nextCursor,
  has_more: page.hasMore,
  has_older: page.hasOlder,
  context: {
    bpm: page.context.bpm,
    selection_start_beat: page.context.selectionStartBeat,
    selection_end_beat: page.context.selectionEndBeat,
    preview_id: page.context.previewId,
    can_undo: page.context.canUndo,
    can_redo: page.context.canRedo,
    track_count: page.context.trackCount
  },
  mutations: page.mutations.map((mutation) => ({
    sequence: mutation.sequence,
    recorded_at: mutation.recordedAt,
    actor: mutation.actor,
    action: mutation.action,
    request_id: mutation.requestId,
    ...(mutation.expectedRevision === undefined ? {} : { expected_revision: mutation.expectedRevision }),
    revision_before: mutation.revisionBefore,
    revision_after: mutation.revisionAfter,
    result: mutation.result,
    targets: {
      ...(mutation.targets.trackId === undefined ? {} : { track_id: mutation.targets.trackId }),
      ...(mutation.targets.clipId === undefined ? {} : { clip_id: mutation.targets.clipId }),
      ...(mutation.targets.previewId === undefined ? {} : { preview_id: mutation.targets.previewId })
    },
    input: mutation.input
  }))
})

const revisionConflict = (state: StudioState, expectedRevision: number): StudioRuleError =>
  new StudioRuleError({
    code: "revision_conflict",
    message: `Expected project revision ${expectedRevision}, but the current revision is ${state.revision}.`,
    currentRevision: state.revision
  })

export class Studio extends Context.Service<
  Studio,
  {
    readonly changes: Stream.Stream<StudioState>
    readonly mutationChanges: Stream.Stream<StudioMutationEvent>
    readonly snapshot: Effect.Effect<StudioState>
    readonly mutationHistory: (query: StudioMutationQuery) => Effect.Effect<StudioMutationPage>
    readonly reset: Effect.Effect<void>
    readonly selectTimeRange: (
      start: number,
      end: number,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly selectBeatRange: (
      startBeat: number,
      endBeat: number,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly stagePart: (
      prompt: string,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly stageMidiTransposition: (
      transposition: StudioMidiTransposition,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMidiTranspositionResult, StudioRuleError>
    readonly stageKaraokeGuide: (
      guide: StudioKaraokeGuideInput,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioKaraokeGuideResult, StudioRuleError>
    readonly applyPreview: (
      previewId: string,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly discardPreview: (
      previewId: string,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly setKaraokeCountIn: (
      beats: StudioKaraokeCountInBeats,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly setTempo: (
      bpm: number,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly setTrackMix: (
      trackId: string,
      changes: {
        readonly volume?: number
        readonly pan?: number
        readonly muted?: boolean
        readonly soloed?: boolean
      },
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly writeMidi: (
      write: StudioMidiWrite,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMidiMutationResult, StudioRuleError>
    readonly composeMidi: (
      composition: StudioMidiComposition,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMidiCompositionResult, StudioRuleError>
    readonly addUploadedTrack: (
      assetId: string,
      name: string,
      duration: number,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly importSharedSession: (
      payload: StudioSharePayload,
      shareId: string,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly moveClip: (
      trackId: string,
      clipId: string,
      start: number,
      duration: number,
      options: StudioMutationOptions
    ) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly undo: (options: StudioMutationOptions) => Effect.Effect<StudioMutationResult, StudioRuleError>
    readonly redo: (options: StudioMutationOptions) => Effect.Effect<StudioMutationResult, StudioRuleError>
  }
>()("signal-studio/Studio") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const internalRef = yield* SubscriptionRef.make(initialInternalState())
      const mutationPubSub = yield* PubSub.unbounded<StudioMutationEvent>({ replay: 1 })

      const modify = <A extends StudioMutationResult>(
        options: StudioMutationOptions,
        intent: StudioMutationIntent<A>,
        operation: (
          internal: StudioInternalState
        ) => Effect.Effect<readonly [A, StudioInternalState], StudioRuleError>
      ): Effect.Effect<A, StudioRuleError> =>
        SubscriptionRef.modifyEffect(internalRef, (internal) => {
          type PublishedMutation = readonly [A, StudioMutationEvent | null]
          const fingerprint = mutationFingerprint(options, intent)
          const previous = internal.seen.get(options.requestId)
          if (previous !== undefined) {
            if (previous.fingerprint !== fingerprint) {
              return Effect.fail(
                new StudioRuleError({
                  code: "request_id_conflict",
                  message: `Request ID ${options.requestId} was already used for a different Studio mutation.`,
                  currentRevision: internal.present.revision
                })
              )
            }
            return Effect.succeed([
              [replayed(previous.result) as A, null] as PublishedMutation,
              internal
            ] as const)
          }
          if (
            options.expectedRevision !== undefined &&
            options.expectedRevision !== internal.present.revision
          ) {
            return Effect.fail(revisionConflict(internal.present, options.expectedRevision))
          }
          return operation(internal).pipe(
            Effect.flatMap(([result, nextInternal]) =>
              DateTime.now.pipe(
                Effect.map((now) => {
                  const mutation: StudioMutationEvent = {
                    sequence: internal.nextMutationSequence,
                    recordedAt: DateTime.formatIso(now),
                    actor: options.actor ?? intent.defaultActor,
                    action: intent.action,
                    requestId: options.requestId,
                    ...(options.expectedRevision === undefined
                      ? {}
                      : { expectedRevision: options.expectedRevision }),
                    revisionBefore: internal.present.revision,
                    revisionAfter: nextInternal.present.revision,
                    result: result.change,
                    targets: intent.resolveTargets?.(result) ?? intent.targets ?? {},
                    input: intent.input
                  }
                  return [
                    [result, mutation] as PublishedMutation,
                    {
                      ...nextInternal,
                      seen: withSeen(nextInternal, result, fingerprint),
                      present: {
                        ...nextInternal.present,
                        mutationCount: internal.present.mutationCount + 1
                      },
                      mutations: boundedMutationEvents([...internal.mutations, mutation]),
                      nextMutationSequence: internal.nextMutationSequence + 1
                    }
                  ] as const
                })
              )
            )
          )
        }).pipe(
          Effect.tap(([, mutation]) =>
            mutation === null
              ? Effect.void
              : SubscriptionRef.get(internalRef).pipe(
                  Effect.tap((internal) => Effect.sync(() => persistStudioSession(internal)))
                )
          ),
          Effect.flatMap(([result, mutation]) =>
            mutation === null
              ? Effect.succeed(result)
              : PubSub.publish(mutationPubSub, mutation).pipe(Effect.as(result))
          )
        )

      const mutationHistory = Effect.fn("Studio.mutationHistory")(function* (query: StudioMutationQuery) {
        const internal = yield* SubscriptionRef.get(internalRef)
        return mutationPageOf(internal, query)
      })

      const selectTimeRange = Effect.fn("Studio.selectTimeRange")(function* (
        start: number,
        end: number,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "select_time_range",
            defaultActor: "HUMAN",
            input: { start_seconds: start, end_seconds: end }
          },
          (internal) => {
            if (
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              start < 0 ||
              end <= start ||
              end - start > 32
            ) {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_selection",
                  message: "Select a positive time range no longer than 32 seconds.",
                  currentRevision: internal.present.revision
                })
              )
            }
            const selection = { start, end }
            const next = withRevision(
              internal.present,
              internal.past.length,
              internal.future.length,
              "HUMAN",
              `Selected ${start.toFixed(1)}s–${end.toFixed(1)}s for the next operation.`,
              { selection }
            )
            const result = mutationResult(options, next.revision, "selection_updated")
            return Effect.succeed([result, { ...internal, present: next }] as const)
          }
        )
      })

      const selectBeatRange = Effect.fn("Studio.selectBeatRange")(function* (
        startBeat: number,
        endBeat: number,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "select_beat_range",
            defaultActor: "AGENT",
            input: { start_beat: startBeat, end_beat: endBeat }
          },
          (internal) => {
            const normalizedStartBeat = cleanBeat(startBeat)
            const normalizedEndBeat = cleanBeat(endBeat)
            const start = normalizedStartBeat * secondsPerBeat(internal.present.bpm)
            const end = normalizedEndBeat * secondsPerBeat(internal.present.bpm)
            if (
              !Number.isFinite(startBeat) ||
              !Number.isFinite(endBeat) ||
              startBeat < 0 ||
              endBeat - startBeat < studioBeatResolution ||
              normalizedEndBeat <= normalizedStartBeat ||
              endBeat > 4096 ||
              end - start > 32
            ) {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_selection",
                  message: `Select a beat range of at least ${studioBeatResolution} within beat 4096 and no longer than 32 seconds at the current tempo.`,
                  currentRevision: internal.present.revision
                })
              )
            }
            const selection = { start, end }
            const next = withRevision(
              internal.present,
              internal.past.length,
              internal.future.length,
              "AGENT",
              `Selected beats ${normalizedStartBeat}–${normalizedEndBeat} for the next operation.`,
              { selection }
            )
            const result = mutationResult(options, next.revision, "selection_updated")
            return Effect.succeed([result, { ...internal, present: next }] as const)
          }
        )
      })

      const stagePart = Effect.fn("Studio.stagePart")(function* (
        prompt: string,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "stage_part",
            defaultActor: "AGENT",
            input: { prompt, representation: "midi" }
          },
          (internal) => {
            const sound = inferSound(prompt)
            const id = `generated-${internal.nextId}`
            const trackId = "track-generated-midi"
            const targetTrackName = "Generated MIDI"
            const duration = internal.present.selection.end - internal.present.selection.start
            const seed = hashPrompt(`${prompt}:${internal.present.revision}:${internal.nextId}`)
            const takeGroupId = `take-${internal.nextId}`
            const clip: StudioClip = {
              ...generatedMidiClip(
                id,
                labelForSound[sound],
                sound,
                seed,
                internal.present.selection.start,
                duration,
                paletteForSound[sound],
                internal.present.bpm
              ),
              takeGroupId
            }
            const preview: StudioPreview = {
              kind: "generated_part",
              id: `preview-${internal.nextId}`,
              prompt,
              clip,
              targetTrackId: trackId,
              targetTrackName,
              operations: [
                `Create a symbolic MIDI ${sound} part with exact note events`,
                `Place it at beat ${cleanBeat(clip.startBeat ?? 0)} as ${takeGroupId}`,
                `Keep the current arrangement untouched until Apply`
              ]
            }
            const next = withRevision(
              internal.present,
              internal.past.length,
              internal.future.length,
              "AGENT",
              `Staged “${clip.name}” as an alternate take. The arrangement is unchanged.`,
              { preview }
            )
            const result = mutationResult(options, next.revision, "part_staged")
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                nextId: internal.nextId + 1
              }
            ] as const)
          }
        )
      })

      const stageMidiTransposition = Effect.fn("Studio.stageMidiTransposition")(function* (
        transposition: StudioMidiTransposition,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "stage_midi_transposition",
            defaultActor: "AGENT",
            input: {
              semitones: transposition.semitones,
              start_beat: transposition.startBeat,
              end_beat: transposition.endBeat,
              ...(transposition.trackIds === undefined ? {} : { track_ids: transposition.trackIds })
            }
          },
          (internal) => {
            const { semitones, startBeat, endBeat } = transposition
            if (!Number.isInteger(semitones) || semitones === 0 || semitones < -24 || semitones > 24) {
              return Effect.fail(
                invalidMidi(
                  internal.present,
                  "Transpose by a non-zero whole number from -24 to 24 semitones."
                )
              )
            }
            if (
              !Number.isFinite(startBeat) ||
              !Number.isFinite(endBeat) ||
              startBeat < 0 ||
              endBeat <= startBeat ||
              endBeat > 4096
            ) {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_selection",
                  message: "Transpose a positive absolute beat range within beat 4096.",
                  currentRevision: internal.present.revision
                })
              )
            }

            const requestedTrackIds = transposition.trackIds
            if (
              requestedTrackIds !== undefined &&
              (requestedTrackIds.length < 1 || requestedTrackIds.length > 32)
            ) {
              return Effect.fail(invalidMidi(internal.present, "Transpose between 1 and 32 MIDI tracks."))
            }
            const missingTrackId = requestedTrackIds?.find(
              (trackId) => !internal.present.tracks.some((track) => track.id === trackId)
            )
            if (missingTrackId !== undefined) {
              return Effect.fail(
                new StudioRuleError({
                  code: "missing_track",
                  message: `Track ${missingTrackId} does not exist.`,
                  currentRevision: internal.present.revision
                })
              )
            }

            const requested = requestedTrackIds === undefined ? undefined : new Set(requestedTrackIds)
            const targetTracks = internal.present.tracks.filter(
              (track) =>
                track.kind === "midi" &&
                (requested === undefined ? true : requested.has(track.id)) &&
                track.clips.some((clip) => clip.kind === "midi" && clip.midiChannel !== 9)
            )
            const excludedTrackId = requestedTrackIds?.find(
              (trackId) => !targetTracks.some((track) => track.id === trackId)
            )
            if (excludedTrackId !== undefined) {
              return Effect.fail(
                invalidMidi(
                  internal.present,
                  `Track ${excludedTrackId} is not a melodic MIDI track. Drum-channel notes are excluded from key changes.`
                )
              )
            }

            const replacements: Array<StudioMidiTranspositionReplacement> = []
            let notesAffected = 0
            for (const track of targetTracks) {
              for (const clip of track.clips) {
                if (clip.kind !== "midi" || clip.midiChannel === 9) continue
                const notes = logicalNotesOfClip(clip, internal.present.bpm)
                let clipNotesAffected = 0
                const transposed = notes.map((note) => {
                  const intersects =
                    note.startBeat < endBeat && note.startBeat + note.durationBeats > startBeat
                  if (!intersects) return note
                  const midi = note.midi + semitones
                  if (midi < 0 || midi > 127) return { ...note, midi: Number.NaN }
                  clipNotesAffected += 1
                  return { ...note, midi }
                })
                if (transposed.some((note) => !Number.isInteger(note.midi))) {
                  return Effect.fail(
                    invalidMidi(
                      internal.present,
                      `Transposition would move a note outside the MIDI range on track ${track.id}.`
                    )
                  )
                }
                if (clipNotesAffected === 0) continue
                notesAffected += clipNotesAffected
                replacements.push({
                  trackId: track.id,
                  clipId: clip.id,
                  clip: compileMidiClip(transposed, internal.present.bpm, {
                    id: clip.id,
                    name: clip.name,
                    program: clip.midiProgram ?? 80,
                    channel: clip.midiChannel ?? 0,
                    seed: hashPrompt(`${options.requestId}:${clip.id}`),
                    existing: clip
                  })
                })
              }
            }
            const firstReplacement = replacements[0]
            if (firstReplacement === undefined || notesAffected === 0) {
              return Effect.fail(
                invalidMidi(
                  internal.present,
                  "The requested beat range contains no melodic MIDI notes to transpose."
                )
              )
            }
            const firstTrack = internal.present.tracks.find((track) => track.id === firstReplacement.trackId)!
            const direction = semitones < 0 ? "down" : "up"
            const preview: StudioMidiTranspositionPreview = {
              kind: "midi_transposition",
              id: `preview-${internal.nextId}`,
              prompt: `Transpose beats ${cleanBeat(startBeat)}–${cleanBeat(endBeat)} ${direction} ${Math.abs(semitones)} semitones`,
              clip: firstReplacement.clip,
              targetTrackId: firstTrack.id,
              targetTrackName:
                replacements.length === 1
                  ? firstTrack.name
                  : `${firstTrack.name} + ${targetTracks.length - 1} tracks`,
              operations: [
                `Move ${notesAffected} exact MIDI notes ${direction} ${Math.abs(semitones)} semitones`,
                `Preserve absolute beats, durations, velocities, clip IDs, and drum-channel notes`,
                "Keep the current arrangement untouched until Apply"
              ],
              semitones,
              startBeat: cleanBeat(startBeat),
              endBeat: cleanBeat(endBeat),
              notesAffected,
              replacements
            }
            const next = withRevision(
              internal.present,
              internal.past.length,
              internal.future.length,
              options.actor ?? "AGENT",
              `Staged a ${Math.abs(semitones)}-semitone key change for ${notesAffected} MIDI notes. The arrangement is unchanged.`,
              { preview }
            )
            const result: StudioMidiTranspositionResult = {
              ...mutationResult(options, next.revision, "midi_transposition_staged"),
              previewId: preview.id,
              semitones,
              startBeat: preview.startBeat,
              endBeat: preview.endBeat,
              trackIds: targetTracks.map((track) => track.id),
              notesAffected
            }
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                nextId: internal.nextId + 1
              }
            ] as const)
          }
        )
      })

      const stageKaraokeGuide = Effect.fn("Studio.stageKaraokeGuide")(function* (
        input: StudioKaraokeGuideInput,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "stage_karaoke_guide",
            defaultActor: "AGENT",
            input: {
              lyrics: input.lyrics,
              melody_track_id: input.melodyTrackId,
              start_beat: input.startBeat,
              end_beat: input.endBeat,
              ...(input.title === undefined ? {} : { title: input.title })
            },
            targets: { trackId: input.melodyTrackId }
          },
          (internal) => {
            const track = internal.present.tracks.find((candidate) => candidate.id === input.melodyTrackId)
            if (track === undefined) {
              return Effect.fail(
                new StudioRuleError({
                  code: "missing_track",
                  message: `Melody track ${input.melodyTrackId} does not exist.`,
                  currentRevision: internal.present.revision
                })
              )
            }
            if (track.kind !== "midi") {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_karaoke",
                  message: "A karaoke guide requires one canonical MIDI melody track.",
                  currentRevision: internal.present.revision
                })
              )
            }
            if (
              !Number.isFinite(input.startBeat) ||
              !Number.isFinite(input.endBeat) ||
              input.startBeat < 0 ||
              input.endBeat <= input.startBeat ||
              input.endBeat > 4096
            ) {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_selection",
                  message: "A karaoke guide requires a positive absolute beat range within beat 4096.",
                  currentRevision: internal.present.revision
                })
              )
            }
            if (input.lyrics.trim().length < 1 || input.lyrics.length > 500) {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_karaoke",
                  message: "Provide 1–500 characters of authorized or user-authored lyrics.",
                  currentRevision: internal.present.revision
                })
              )
            }

            const selectedNotes = track.clips
              .flatMap((clip) => (clip.kind === "midi" ? logicalNotesOfClip(clip, internal.present.bpm) : []))
              .filter(
                (note) =>
                  note.startBeat < input.endBeat && note.startBeat + note.durationBeats > input.startBeat
              )
            let tokens: ReadonlyArray<KaraokeToken>
            try {
              tokens = createKaraokeTokens(
                input.lyrics,
                selectedNotes,
                input.startBeat,
                input.endBeat,
                `karaoke-${internal.nextId}`
              )
            } catch (cause) {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_karaoke",
                  message: cause instanceof Error ? cause.message : "The karaoke guide could not be created.",
                  currentRevision: internal.present.revision
                })
              )
            }
            const firstMidiClip = track.clips.find((clip) => clip.kind === "midi")
            if (firstMidiClip === undefined || selectedNotes.length === 0) {
              return Effect.fail(
                new StudioRuleError({
                  code: "invalid_karaoke",
                  message: "The requested melody passage contains no MIDI notes.",
                  currentRevision: internal.present.revision
                })
              )
            }
            const guide: StudioKaraokeGuide = {
              id: `karaoke-guide-${internal.nextId}`,
              title: input.title?.trim() || "Karaoke Guide",
              melodyTrackId: track.id,
              melodyTrackName: track.name,
              startBeat: cleanBeat(input.startBeat),
              endBeat: cleanBeat(input.endBeat),
              tokens
            }
            const previewClip = compileMidiClip(
              selectedNotes.map((note, index) => ({ ...note, id: `${guide.id}-note-${index + 1}` })),
              internal.present.bpm,
              {
                id: `clip-${guide.id}`,
                name: guide.title,
                program: firstMidiClip.midiProgram ?? 80,
                channel: firstMidiClip.midiChannel ?? 0,
                seed: hashPrompt(`${options.requestId}:${guide.id}`),
                color: "#f4f4f5"
              }
            )
            const preview: StudioKaraokeGuidePreview = {
              kind: "karaoke_guide",
              id: `preview-${internal.nextId}`,
              prompt: `Create a timed karaoke guide for ${track.name}`,
              clip: previewClip,
              targetTrackId: track.id,
              targetTrackName: track.name,
              operations: [
                `Map ${tokens.length} authorized lyric tokens to exact beats`,
                `Use ${track.name} as the canonical expected melody`,
                "Keep microphone capture off until the human starts singing"
              ],
              guide
            }
            const next = withRevision(
              internal.present,
              internal.past.length,
              internal.future.length,
              options.actor ?? "AGENT",
              `Staged “${guide.title}” with ${tokens.length} timed lyric tokens. The active guide is unchanged.`,
              { preview }
            )
            const result: StudioKaraokeGuideResult = {
              ...mutationResult(options, next.revision, "karaoke_guide_staged"),
              previewId: preview.id,
              guideId: guide.id,
              tokenCount: tokens.length,
              melodyTrackId: track.id
            }
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                nextId: internal.nextId + 1
              }
            ] as const)
          }
        )
      })

      const applyPreview = Effect.fn("Studio.applyPreview")(function* (
        previewId: string,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "apply_preview",
            defaultActor: "AGENT",
            input: { preview_id: previewId },
            targets: { previewId }
          },
          (internal) => {
            const preview = internal.present.preview
            if (preview === null || preview.id !== previewId) {
              return Effect.fail(
                new StudioRuleError({
                  code: "missing_preview",
                  message: `Preview ${previewId} is not available to apply.`,
                  currentRevision: internal.present.revision
                })
              )
            }
            let tracks = internal.present.tracks
            let karaokeGuide = internal.present.karaokeGuide
            let message: string
            if (preview.kind === "midi_transposition") {
              const replacements = new Map(
                preview.replacements.map((replacement) => [
                  `${replacement.trackId}:${replacement.clipId}`,
                  replacement.clip
                ])
              )
              tracks = tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => replacements.get(`${track.id}:${clip.id}`) ?? clip)
              }))
              message = `Applied a ${Math.abs(preview.semitones)}-semitone key change to ${preview.notesAffected} MIDI notes as one undoable transaction.`
            } else if (preview.kind === "karaoke_guide") {
              karaokeGuide = preview.guide
              message = `Applied “${preview.guide.title}” with ${preview.guide.tokens.length} timed lyric tokens.`
            } else {
              const existing = tracks.find((track) => track.id === preview.targetTrackId)
              tracks =
                existing === undefined
                  ? [
                      ...tracks,
                      {
                        id: preview.targetTrackId,
                        kind: preview.clip.kind,
                        name: preview.targetTrackName,
                        color: preview.clip.color,
                        volume: 0.72,
                        pan: 0,
                        muted: false,
                        soloed: false,
                        clips: [preview.clip]
                      }
                    ]
                  : tracks.map((track) =>
                      track.id === preview.targetTrackId
                        ? { ...track, clips: [...track.clips, preview.clip] }
                        : track
                    )
              message = `Applied “${preview.clip.name}” as one undoable project transaction.`
            }
            const past = [...internal.past, documentOf(internal.present)]
            const next = withRevision(internal.present, past.length, 0, "AGENT", message, {
              tracks,
              karaokeGuide,
              preview: null
            })
            const result = mutationResult(options, next.revision, "preview_applied")
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                past,
                future: []
              }
            ] as const)
          }
        )
      })

      const discardPreview = Effect.fn("Studio.discardPreview")(function* (
        previewId: string,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "discard_preview",
            defaultActor: "HUMAN",
            input: { preview_id: previewId },
            targets: { previewId }
          },
          (internal) => {
            const preview = internal.present.preview
            if (preview === null || preview.id !== previewId) {
              return Effect.fail(
                new StudioRuleError({
                  code: "missing_preview",
                  message: `Preview ${previewId} is not available to discard.`,
                  currentRevision: internal.present.revision
                })
              )
            }
            const next = withRevision(
              internal.present,
              internal.past.length,
              internal.future.length,
              "HUMAN",
              `Discarded staged take “${preview.clip.name}”.`,
              { preview: null }
            )
            const result = mutationResult(options, next.revision, "preview_discarded")
            return Effect.succeed([result, { ...internal, present: next }] as const)
          }
        )
      })

      const setKaraokeCountIn = Effect.fn("Studio.setKaraokeCountIn")(function* (
        beats: StudioKaraokeCountInBeats,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "set_karaoke_count_in",
            defaultActor: "AGENT",
            input: { beats }
          },
          (internal) => {
            const past = [...internal.past, documentOf(internal.present)]
            const next = withRevision(
              internal.present,
              past.length,
              0,
              options.actor ?? "AGENT",
              `Karaoke count-in set to ${beats} beats.`,
              { karaokeCountInBeats: beats, preview: null }
            )
            const result = mutationResult(options, next.revision, "karaoke_count_in_updated")
            return Effect.succeed([result, { ...internal, present: next, past, future: [] }] as const)
          }
        )
      })

      const setTempo = Effect.fn("Studio.setTempo")(function* (bpm: number, options: StudioMutationOptions) {
        return yield* modify(
          options,
          {
            action: "set_tempo",
            defaultActor: "AGENT",
            input: { bpm }
          },
          (internal) => {
            const past = [...internal.past, documentOf(internal.present)]
            const selection = {
              start:
                beatsOfSeconds(internal.present.selection.start, internal.present.bpm) * secondsPerBeat(bpm),
              end: beatsOfSeconds(internal.present.selection.end, internal.present.bpm) * secondsPerBeat(bpm)
            }
            const tracks = internal.present.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => midiClipAtTempo(clip, bpm))
            }))
            const next = withRevision(
              internal.present,
              past.length,
              0,
              "AGENT",
              `Tempo changed to ${bpm} BPM.`,
              { bpm, selection, tracks, preview: null }
            )
            const result = mutationResult(options, next.revision, "tempo_updated")
            return Effect.succeed([result, { ...internal, present: next, past, future: [] }] as const)
          }
        )
      })

      const setTrackMix = Effect.fn("Studio.setTrackMix")(function* (
        trackId: string,
        changes: {
          readonly volume?: number
          readonly pan?: number
          readonly muted?: boolean
          readonly soloed?: boolean
        },
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "set_track_mix",
            defaultActor: "AGENT",
            input: {
              track_id: trackId,
              ...(changes.volume === undefined ? {} : { volume: changes.volume }),
              ...(changes.pan === undefined ? {} : { pan: changes.pan }),
              ...(changes.muted === undefined ? {} : { muted: changes.muted }),
              ...(changes.soloed === undefined ? {} : { soloed: changes.soloed })
            },
            targets: { trackId }
          },
          (internal) => {
            const track = internal.present.tracks.find((candidate) => candidate.id === trackId)
            if (track === undefined) {
              return Effect.fail(
                new StudioRuleError({
                  code: "missing_track",
                  message: `Track ${trackId} does not exist.`,
                  currentRevision: internal.present.revision
                })
              )
            }
            const past = [...internal.past, documentOf(internal.present)]
            const tracks = internal.present.tracks.map((candidate) =>
              candidate.id === trackId ? { ...candidate, ...changes } : candidate
            )
            const next = withRevision(
              internal.present,
              past.length,
              0,
              "AGENT",
              `Updated the ${track.name} mix controls.`,
              { tracks, preview: null }
            )
            const result = mutationResult(options, next.revision, "track_mix_updated")
            return Effect.succeed([result, { ...internal, present: next, past, future: [] }] as const)
          }
        )
      })

      const composeMidi = Effect.fn("Studio.composeMidi")(function* (
        composition: StudioMidiComposition,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "compose_midi",
            defaultActor: "AGENT",
            input: {
              mode: composition.mode,
              basis:
                composition.basis.kind === "original"
                  ? { kind: composition.basis.kind }
                  : {
                      kind: composition.basis.kind,
                      reference_title: composition.basis.reference_title,
                      ...(composition.basis.reference_artist === undefined
                        ? {}
                        : { reference_artist: composition.basis.reference_artist }),
                      approximate_bpm: composition.basis.approximate_bpm,
                      key: composition.basis.key,
                      meter: composition.basis.meter,
                      harmonic_vocabulary: composition.basis.harmonic_vocabulary,
                      ...(composition.basis.factual_sources === undefined
                        ? {}
                        : { factual_sources: composition.basis.factual_sources }),
                      arrangement: composition.basis.arrangement,
                      excludes: composition.basis.excludes
                    },
              track_count: composition.tracks.length,
              note_count: composition.tracks.reduce((count, track) => count + track.notes.length, 0),
              tracks: composition.tracks.map((track) => ({
                track_name: track.trackName,
                clip_name: track.clipName,
                program: track.program,
                channel: track.channel,
                note_count: track.notes.length,
                ...(track.volume === undefined ? {} : { volume: track.volume }),
                ...(track.pan === undefined ? {} : { pan: track.pan })
              }))
            }
          },
          (internal) => {
            if (composition.tracks.length < 1 || composition.tracks.length > 8) {
              return Effect.fail(
                invalidMidi(internal.present, "Compose between 1 and 8 MIDI tracks per transaction.")
              )
            }

            const compositionBpm =
              composition.mode === "replace_session"
                ? composition.basis.approximate_bpm
                : internal.present.bpm
            const compositionTimeSignature: readonly [number, number] =
              composition.mode === "replace_session"
                ? [composition.basis.meter.numerator, composition.basis.meter.denominator]
                : internal.present.timeSignature

            const prepared: Array<{
              readonly source: StudioMidiCompositionTrack
              readonly suffix: number
              readonly notes: ReadonlyArray<NormalizedMidiNote>
            }> = []

            for (const [index, track] of composition.tracks.entries()) {
              if (
                track.trackName.trim().length < 1 ||
                track.trackName.trim().length > 80 ||
                track.clipName.trim().length < 1 ||
                track.clipName.trim().length > 80
              ) {
                return Effect.fail(
                  invalidMidi(
                    internal.present,
                    `Composition track ${index + 1} names must be 1–80 characters.`
                  )
                )
              }
              if (
                !Number.isInteger(track.program) ||
                track.program < 0 ||
                track.program > 127 ||
                !Number.isInteger(track.channel) ||
                track.channel < 0 ||
                track.channel > 15
              ) {
                return Effect.fail(
                  invalidMidi(
                    internal.present,
                    `Composition track ${index + 1} must use a MIDI program from 0–127 and channel from 0–15.`
                  )
                )
              }
              if (
                (track.volume !== undefined &&
                  (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 1)) ||
                (track.pan !== undefined && (!Number.isFinite(track.pan) || track.pan < -1 || track.pan > 1))
              ) {
                return Effect.fail(
                  invalidMidi(
                    internal.present,
                    `Composition track ${index + 1} volume must be 0–1 and pan must be -1–1.`
                  )
                )
              }

              const suffix = internal.nextId + index
              const normalized = normalizeMidiNotes(internal.present, track.notes, suffix)
              if ("error" in normalized) return Effect.fail(normalized.error)
              prepared.push({ source: track, suffix, notes: normalized.notes })
            }

            const created = prepared.map(({ source, suffix, notes }) => {
              const trackId = `track-midi-${suffix}`
              const clipId = `clip-midi-${suffix}`
              const clip = compileMidiClip(notes, compositionBpm, {
                id: clipId,
                name: source.clipName,
                program: source.program,
                channel: source.channel,
                seed: hashPrompt(`${options.requestId}:${internal.present.revision}:${suffix}`)
              })
              const track: StudioTrack = {
                id: trackId,
                kind: "midi",
                name: source.trackName,
                color: clip.color,
                volume: source.volume ?? 0.72,
                pan: source.pan ?? 0,
                muted: false,
                soloed: false,
                clips: [clip]
              }
              const result: StudioMidiCompositionTrackResult = {
                trackId,
                clipId,
                trackName: source.trackName,
                clipName: source.clipName,
                program: source.program,
                channel: source.channel,
                notesWritten: notes.length
              }
              return { track, result }
            })
            const past = [...internal.past, documentOf(internal.present)]
            const notesWritten = created.reduce((count, item) => count + item.result.notesWritten, 0)
            const replacingSession = composition.mode === "replace_session"
            const sessionEndBeat = Math.max(
              ...created.flatMap((item) =>
                item.track.clips.map((clip) => (clip.startBeat ?? 0) + (clip.durationBeats ?? 0))
              )
            )
            const nextTracks = replacingSession
              ? created.map((item) => item.track)
              : [...internal.present.tracks, ...created.map((item) => item.track)]
            const message = replacingSession
              ? `Created a facts-only original practice bed referencing ${composition.basis.reference_title}: ${created.length} MIDI ${created.length === 1 ? "track" : "tracks"} and ${notesWritten} exact notes.`
              : `Composed ${created.length} MIDI ${created.length === 1 ? "track" : "tracks"} with ${notesWritten} exact notes.`
            const next = withRevision(internal.present, past.length, 0, "AGENT", message, {
              tracks: nextTracks,
              preview: null,
              ...(replacingSession
                ? {
                    songSlug: "practice-bed",
                    title: `${composition.basis.reference_title} · ORIGINAL PRACTICE BED`,
                    attribution: null,
                    bpm: compositionBpm,
                    timeSignature: compositionTimeSignature,
                    selection: {
                      start: 0,
                      end: Math.min(16, sessionEndBeat) * secondsPerBeat(compositionBpm)
                    },
                    karaokeGuide: null,
                    practiceBed: composition.basis
                  }
                : {})
            })
            const result: StudioMidiCompositionResult = {
              ...mutationResult(options, next.revision, "midi_composition_created"),
              mode: composition.mode,
              basis: composition.basis,
              tracksCreated: created.length,
              notesWritten,
              tracks: created.map((item) => item.result)
            }
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                past,
                future: [],
                nextId: internal.nextId + created.length
              }
            ] as const)
          }
        )
      })

      const writeMidi = Effect.fn("Studio.writeMidi")(function* (
        write: StudioMidiWrite,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "write_midi",
            defaultActor: "AGENT",
            input: {
              mode: write.mode,
              notes: write.notes.map((note) => ({
                pitch: note.pitch,
                start_beat: note.startBeat,
                duration_beats: note.durationBeats,
                ...(note.velocity === undefined ? {} : { velocity: note.velocity })
              })),
              ...(write.trackId === undefined ? {} : { track_id: write.trackId }),
              ...(write.clipId === undefined ? {} : { clip_id: write.clipId }),
              ...(write.trackName === undefined ? {} : { track_name: write.trackName }),
              ...(write.clipName === undefined ? {} : { clip_name: write.clipName }),
              ...(write.program === undefined ? {} : { program: write.program }),
              ...(write.channel === undefined ? {} : { channel: write.channel })
            },
            resolveTargets: (result: StudioMidiMutationResult) => ({
              trackId: result.trackId,
              clipId: result.clipId
            })
          },
          (internal) => {
            const normalized = normalizeMidiNotes(internal.present, write.notes, internal.nextId)
            if ("error" in normalized) return Effect.fail(normalized.error)
            if (
              (write.program !== undefined &&
                (!Number.isInteger(write.program) || write.program < 0 || write.program > 127)) ||
              (write.channel !== undefined &&
                (!Number.isInteger(write.channel) || write.channel < 0 || write.channel > 15))
            ) {
              return Effect.fail(
                invalidMidi(internal.present, "MIDI program must be 0–127 and channel must be 0–15.")
              )
            }

            const suffix = internal.nextId
            let track: StudioTrack | undefined
            let existingClip: StudioClip | undefined

            if (write.mode === "create") {
              if (write.clipId !== undefined) {
                return Effect.fail(
                  invalidMidi(internal.present, "Create mode makes a new clip, so clipId must be omitted.")
                )
              }
              if (write.trackId !== undefined) {
                track = internal.present.tracks.find((candidate) => candidate.id === write.trackId)
                if (track === undefined) {
                  return Effect.fail(
                    new StudioRuleError({
                      code: "missing_track",
                      message: `Track ${write.trackId} does not exist. Omit trackId to create a MIDI track.`,
                      currentRevision: internal.present.revision
                    })
                  )
                }
                if (track.kind !== "midi") {
                  return Effect.fail(
                    invalidMidi(internal.present, `Track ${write.trackId} is not a MIDI track.`)
                  )
                }
              }
            } else {
              if (write.clipId === undefined) {
                return Effect.fail(
                  invalidMidi(
                    internal.present,
                    `${write.mode} mode requires a stable clipId from get_studio_midi.`
                  )
                )
              }
              track =
                write.trackId === undefined
                  ? internal.present.tracks.find((candidate) =>
                      candidate.clips.some((clip) => clip.id === write.clipId)
                    )
                  : internal.present.tracks.find((candidate) => candidate.id === write.trackId)
              existingClip = track?.clips.find((clip) => clip.id === write.clipId)
              if (track === undefined || existingClip === undefined) {
                return Effect.fail(
                  new StudioRuleError({
                    code: "missing_clip",
                    message: `MIDI clip ${write.clipId} was not found${
                      write.trackId === undefined ? "" : ` on track ${write.trackId}`
                    }. Read get_studio_midi again before editing.`,
                    currentRevision: internal.present.revision
                  })
                )
              }
              if (track.kind !== "midi" || existingClip.kind !== "midi") {
                return Effect.fail(invalidMidi(internal.present, `Clip ${write.clipId} is not MIDI.`))
              }
            }

            const trackId = track?.id ?? `track-midi-${suffix}`
            const clipId = existingClip?.id ?? `clip-midi-${suffix}`
            const program = write.program ?? existingClip?.midiProgram ?? 81
            const channel = write.channel ?? existingClip?.midiChannel ?? 0
            const logicalNotes =
              write.mode === "append" && existingClip !== undefined
                ? [...logicalNotesOfClip(existingClip, internal.present.bpm), ...normalized.notes]
                : normalized.notes
            const clip = compileMidiClip(logicalNotes, internal.present.bpm, {
              id: clipId,
              name: write.clipName ?? existingClip?.name ?? `Agent MIDI ${suffix}`,
              program,
              channel,
              seed: hashPrompt(`${options.requestId}:${internal.present.revision}:${suffix}`),
              ...(existingClip === undefined ? {} : { existing: existingClip })
            })
            const color = clip.color
            const tracks =
              track === undefined
                ? [
                    ...internal.present.tracks,
                    {
                      id: trackId,
                      kind: "midi" as const,
                      name: write.trackName ?? "Agent MIDI",
                      color,
                      volume: 0.72,
                      pan: 0,
                      muted: false,
                      soloed: false,
                      clips: [clip]
                    }
                  ]
                : internal.present.tracks.map((candidate) =>
                    candidate.id !== track.id
                      ? candidate
                      : {
                          ...candidate,
                          clips:
                            existingClip === undefined
                              ? [...candidate.clips, clip]
                              : candidate.clips.map((candidateClip) =>
                                  candidateClip.id === existingClip!.id ? clip : candidateClip
                                )
                        }
                  )
            const past = [...internal.past, documentOf(internal.present)]
            const next = withRevision(
              internal.present,
              past.length,
              0,
              "AGENT",
              `${write.mode === "create" ? "Created" : write.mode === "append" ? "Appended to" : "Replaced"} “${clip.name}” with ${normalized.notes.length} exact MIDI ${normalized.notes.length === 1 ? "note" : "notes"}.`,
              { tracks, preview: null }
            )
            const result: StudioMidiMutationResult = {
              ...mutationResult(
                options,
                next.revision,
                write.mode === "create"
                  ? "midi_created"
                  : write.mode === "append"
                    ? "midi_appended"
                    : "midi_replaced"
              ),
              mode: write.mode,
              trackId,
              clipId,
              notesWritten: normalized.notes.length,
              totalNotes: clip.notes.length
            }
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                past,
                future: [],
                nextId: suffix + 1
              }
            ] as const)
          }
        )
      })

      const addUploadedTrack = Effect.fn("Studio.addUploadedTrack")(function* (
        assetId: string,
        name: string,
        duration: number,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "add_uploaded_track",
            defaultActor: "HUMAN",
            input: { asset_id: assetId, name, duration_seconds: duration }
          },
          (internal) => {
            const suffix = internal.nextId
            const track: StudioTrack = {
              id: `track-upload-${suffix}`,
              kind: "audio",
              name,
              color: "#ed6f9d",
              volume: 0.72,
              pan: 0,
              muted: false,
              soloed: false,
              clips: [
                {
                  id: `clip-upload-${suffix}`,
                  kind: "audio",
                  name,
                  start: internal.present.selection.start,
                  duration,
                  gain: 0.85,
                  color: "#ed6f9d",
                  source: { kind: "upload", assetId },
                  notes: [],
                  takeGroupId: null
                }
              ]
            }
            const past = [...internal.past, documentOf(internal.present)]
            const next = withRevision(
              internal.present,
              past.length,
              0,
              "HUMAN",
              `Imported ${name} at ${internal.present.selection.start.toFixed(1)} seconds.`,
              { tracks: [...internal.present.tracks, track], preview: null }
            )
            const result = mutationResult(options, next.revision, "audio_imported")
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                past,
                future: [],
                nextId: suffix + 1
              }
            ] as const)
          }
        )
      })

      const importSharedSession = Effect.fn("Studio.importSharedSession")(function* (
        payload: StudioSharePayload,
        shareId: string,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "import_shared_session",
            defaultActor: "HUMAN",
            input: {
              share_id: shareId,
              source_project_id: payload.source_project_id,
              source_revision: payload.source_revision,
              midi_track_count: payload.tracks.length,
              omitted_audio_asset_count: payload.omitted_audio_asset_count
            }
          },
          (internal) => {
            const invalid = (message: string) =>
              Effect.fail(
                new StudioRuleError({
                  code: "invalid_shared_session",
                  message,
                  currentRevision: internal.present.revision
                })
              )
            const trackIds = payload.tracks.map((track) => track.track_id)
            const trackOrders = payload.tracks.map((track) => track.order)
            const clipIds = payload.tracks.flatMap((track) => track.clips.map((clip) => clip.clip_id))
            const noteIds = payload.tracks.flatMap((track) =>
              track.clips.flatMap((clip) => clip.notes.map((note) => note.note_id))
            )
            const totalNotes = noteIds.length
            if (new Set(trackIds).size !== trackIds.length) {
              return invalid("The shared project contains duplicate track IDs.")
            }
            if (new Set(trackOrders).size !== trackOrders.length) {
              return invalid("The shared project contains duplicate track ordering.")
            }
            if (new Set(clipIds).size !== clipIds.length || new Set(noteIds).size !== noteIds.length) {
              return invalid("The shared project contains duplicate clip or note IDs.")
            }
            if (totalNotes > 20_000) {
              return invalid("The shared project exceeds the 20,000-note safety limit.")
            }
            if (
              payload.selection.end_beat <= payload.selection.start_beat ||
              (payload.selection.end_beat - payload.selection.start_beat) * (60 / payload.bpm) > 32
            ) {
              return invalid("The shared project selection is not a valid bounded Studio range.")
            }
            if (
              payload.tracks.some((track) =>
                track.clips.some((clip) =>
                  clip.notes.some((note) => note.start_beat + note.duration_beats > 4096)
                )
              )
            ) {
              return invalid("The shared project contains a note extending beyond beat 4096.")
            }
            const lesson = payload.lesson_configuration
            const lessonTrack =
              lesson === null ? undefined : payload.tracks.find((track) => track.track_id === lesson.track_id)
            if (
              lesson !== null &&
              (lessonTrack === undefined ||
                lesson.end_beat <= lesson.start_beat ||
                lesson.end_beat - lesson.start_beat > 64 ||
                lesson.hand_position > lesson.max_fret ||
                !lessonTrack.clips.some((clip) => clip.channel !== 9 && clip.notes.length > 0))
            ) {
              return invalid(
                "The shared guitar lesson must target a melodic MIDI track and a valid range of at most 64 beats."
              )
            }

            const tracks: ReadonlyArray<StudioTrack> = [...payload.tracks]
              .sort((left, right) => left.order - right.order)
              .map((track) => {
                const clips = track.clips.map((clip) => {
                  const compiled = compileMidiClip(
                    clip.notes.map((note) => ({
                      id: note.note_id,
                      midi: note.pitch,
                      startBeat: note.start_beat,
                      durationBeats: note.duration_beats,
                      velocity: note.velocity
                    })),
                    payload.bpm,
                    {
                      id: clip.clip_id,
                      name: clip.name,
                      program: clip.program,
                      channel: clip.channel,
                      seed: hashPrompt(`${shareId}:${clip.clip_id}`)
                    }
                  )
                  return { ...compiled, gain: clip.gain }
                })
                return {
                  id: track.track_id,
                  kind: "midi" as const,
                  name: track.name,
                  color: clips[0]?.color ?? paletteForSound.lead,
                  volume: track.mix.volume,
                  pan: track.mix.pan,
                  muted: track.mix.muted,
                  soloed: track.mix.soloed,
                  clips
                }
              })

            const karaokeGuide =
              payload.karaoke_guide === null
                ? null
                : {
                    id: payload.karaoke_guide.guide_id,
                    title: payload.karaoke_guide.title,
                    melodyTrackId: payload.karaoke_guide.melody_track_id,
                    melodyTrackName: payload.karaoke_guide.melody_track_name,
                    startBeat: payload.karaoke_guide.start_beat,
                    endBeat: payload.karaoke_guide.end_beat,
                    tokens: payload.karaoke_guide.tokens.map((token) => ({
                      id: token.token_id,
                      text: token.text,
                      startBeat: token.start_beat,
                      endBeat: token.end_beat,
                      expectedMidi: token.expected_midi
                    }))
                  }
            if (
              karaokeGuide !== null &&
              (!trackIds.includes(karaokeGuide.melodyTrackId) ||
                karaokeGuide.endBeat <= karaokeGuide.startBeat ||
                karaokeGuide.tokens.some(
                  (token) =>
                    token.endBeat <= token.startBeat ||
                    token.startBeat < karaokeGuide.startBeat ||
                    token.endBeat > karaokeGuide.endBeat
                ))
            ) {
              return invalid("The shared karaoke guide does not match its MIDI melody passage.")
            }

            const document: StudioDocument = {
              songSlug: payload.song_slug,
              title: payload.title,
              attribution:
                payload.attribution === null
                  ? null
                  : {
                      title: payload.attribution.title,
                      creator: payload.attribution.creator,
                      sourceUrl: payload.attribution.source_url,
                      licenseName: payload.attribution.license_name,
                      licenseUrl: payload.attribution.license_url,
                      sourceMidiUrl: payload.attribution.source_midi_url,
                      sourceMidiSha256: payload.attribution.source_midi_sha256,
                      changes: payload.attribution.changes
                    },
              bpm: payload.bpm,
              timeSignature: [payload.meter.numerator, payload.meter.denominator],
              selection: {
                start: payload.selection.start_beat * (60 / payload.bpm),
                end: payload.selection.end_beat * (60 / payload.bpm)
              },
              tracks,
              karaokeGuide,
              karaokeCountInBeats: payload.karaoke_count_in_beats,
              practiceBed: payload.practice_bed
            }
            const past = [...internal.past, documentOf(internal.present)]
            const next = withRevision(
              internal.present,
              past.length,
              0,
              options.actor ?? "HUMAN",
              `Loaded shared copy ${shareId} with ${tracks.length} MIDI ${tracks.length === 1 ? "track" : "tracks"}.${
                payload.omitted_audio_asset_count === 0
                  ? ""
                  : ` ${payload.omitted_audio_asset_count} page-local audio ${payload.omitted_audio_asset_count === 1 ? "asset was" : "assets were"} intentionally omitted.`
              }`,
              { ...document, preview: null }
            )
            const numericSuffixes = [...trackIds, ...clipIds, ...noteIds].flatMap((id) => {
              const match = /-(\d+)$/.exec(id)
              return match?.[1] === undefined ? [] : [Number(match[1])]
            })
            const result = mutationResult(options, next.revision, "shared_session_imported")
            return Effect.succeed([
              result,
              {
                ...internal,
                present: next,
                past,
                future: [],
                nextId: Math.max(internal.nextId, 1 + Math.max(0, ...numericSuffixes))
              }
            ] as const)
          }
        )
      })

      const moveClip = Effect.fn("Studio.moveClip")(function* (
        trackId: string,
        clipId: string,
        start: number,
        duration: number,
        options: StudioMutationOptions
      ) {
        return yield* modify(
          options,
          {
            action: "move_clip",
            defaultActor: "HUMAN",
            input: {
              track_id: trackId,
              clip_id: clipId,
              start_seconds: start,
              duration_seconds: duration
            },
            targets: { trackId, clipId }
          },
          (internal) => {
            const track = internal.present.tracks.find((candidate) => candidate.id === trackId)
            if (track === undefined || !track.clips.some((clip) => clip.id === clipId)) {
              return Effect.fail(
                new StudioRuleError({
                  code: "missing_track",
                  message: `Clip ${clipId} was not found on track ${trackId}.`,
                  currentRevision: internal.present.revision
                })
              )
            }
            const past = [...internal.past, documentOf(internal.present)]
            const tracks = internal.present.tracks.map((candidate) =>
              candidate.id === trackId
                ? {
                    ...candidate,
                    clips: candidate.clips.map((clip) =>
                      clip.id !== clipId
                        ? clip
                        : clip.kind === "midi" && clip.startBeat !== undefined
                          ? {
                              ...clip,
                              start,
                              duration,
                              startBeat: beatsOfSeconds(start, internal.present.bpm),
                              durationBeats: beatsOfSeconds(duration, internal.present.bpm),
                              notes: clip.notes.map((note) =>
                                note.startBeat === undefined
                                  ? note
                                  : {
                                      ...note,
                                      startBeat:
                                        note.startBeat +
                                        beatsOfSeconds(start - clip.start, internal.present.bpm)
                                    }
                              )
                            }
                          : { ...clip, start, duration }
                    )
                  }
                : candidate
            )
            const next = withRevision(
              internal.present,
              past.length,
              0,
              "HUMAN",
              `Moved ${track.name} clip to ${start.toFixed(1)} seconds.`,
              { tracks, preview: null }
            )
            const result = mutationResult(options, next.revision, "clip_moved")
            return Effect.succeed([result, { ...internal, present: next, past, future: [] }] as const)
          }
        )
      })

      const undo = Effect.fn("Studio.undo")(function* (options: StudioMutationOptions) {
        return yield* modify(options, { action: "undo", defaultActor: "AGENT", input: {} }, (internal) => {
          const previous = internal.past.at(-1)
          if (previous === undefined) {
            return Effect.fail(
              new StudioRuleError({
                code: "nothing_to_undo",
                message: "There is no committed project edit to undo.",
                currentRevision: internal.present.revision
              })
            )
          }
          const past = internal.past.slice(0, -1)
          const future = [...internal.future, documentOf(internal.present)]
          const next = restoreDocument(
            internal.present,
            previous,
            internal.present.revision + 1,
            past.length,
            future.length,
            "Undid the last committed project transaction."
          )
          const result = mutationResult(options, next.revision, "project_undone")
          return Effect.succeed([result, { ...internal, present: next, past, future }] as const)
        })
      })

      const redo = Effect.fn("Studio.redo")(function* (options: StudioMutationOptions) {
        return yield* modify(options, { action: "redo", defaultActor: "AGENT", input: {} }, (internal) => {
          const nextDocument = internal.future.at(-1)
          if (nextDocument === undefined) {
            return Effect.fail(
              new StudioRuleError({
                code: "nothing_to_redo",
                message: "There is no committed project edit to redo.",
                currentRevision: internal.present.revision
              })
            )
          }
          const past = [...internal.past, documentOf(internal.present)]
          const future = internal.future.slice(0, -1)
          const next = restoreDocument(
            internal.present,
            nextDocument,
            internal.present.revision + 1,
            past.length,
            future.length,
            "Redid the last committed project transaction."
          )
          const result = mutationResult(options, next.revision, "project_redone")
          return Effect.succeed([result, { ...internal, present: next, past, future }] as const)
        })
      })

      return Studio.of({
        changes: SubscriptionRef.changes(internalRef).pipe(Stream.map((internal) => internal.present)),
        mutationChanges: Stream.fromPubSub(mutationPubSub),
        snapshot: SubscriptionRef.get(internalRef).pipe(Effect.map((internal) => internal.present)),
        mutationHistory,
        reset: SubscriptionRef.set(internalRef, freshInternalState()).pipe(
          Effect.tap(() =>
            SubscriptionRef.get(internalRef).pipe(
              Effect.tap((internal) => Effect.sync(() => persistStudioSession(internal)))
            )
          )
        ),
        selectTimeRange,
        selectBeatRange,
        stagePart,
        stageMidiTransposition,
        stageKaraokeGuide,
        applyPreview,
        discardPreview,
        setKaraokeCountIn,
        setTempo,
        setTrackMix,
        composeMidi,
        writeMidi,
        addUploadedTrack,
        importSharedSession,
        moveClip,
        undo,
        redo
      })
    })
  )
}
