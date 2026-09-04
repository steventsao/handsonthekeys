import * as Schema from "effect/Schema"
import type {
  StudioDocument,
  StudioInternalState,
  StudioMutationResult,
  StudioMutationValue,
  StudioState
} from "./Studio.ts"
import { ReferencePracticeBedBasisInput } from "./studioComposition.ts"

const sessionSchemaVersion = 1 as const
const sessionStoragePrefix = "signal-studio:session:"
const persistedHistoryLimit = 8
const persistedMutationLimit = 256
const persistedRequestLimit = 256

// Only the structured Studio document crosses a page navigation. Uploaded files, rendered audio,
// microphone frames, object URLs, and blob URLs stay in their page-local audio owners.

interface StudioSessionStorage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
}

const optionalFinite = Schema.optional(Schema.Finite)
const optionalInt = Schema.optional(Schema.Int)

const StudioNoteSchema = Schema.Struct({
  id: Schema.String,
  midi: Schema.Int,
  name: Schema.String,
  time: Schema.Finite,
  duration: Schema.Finite,
  velocity: Schema.Finite,
  startBeat: optionalFinite,
  durationBeats: optionalFinite,
  midiVelocity: optionalInt
})

const StudioClipSourceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("generated"),
    sound: Schema.Literals(["drums", "bass", "pad", "lead", "texture"]),
    seed: Schema.Int
  }),
  Schema.Struct({
    kind: Schema.Literal("upload"),
    assetId: Schema.String
  }),
  Schema.Struct({
    kind: Schema.Literal("midi_asset"),
    assetId: Schema.String,
    sourceTrackName: Schema.String,
    sound: Schema.Literals(["drums", "bass", "pad", "lead", "texture"]),
    seed: Schema.Int
  })
])

const StudioClipSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["audio", "midi"]),
  name: Schema.String,
  start: Schema.Finite,
  duration: Schema.Finite,
  gain: Schema.Finite,
  color: Schema.String,
  source: StudioClipSourceSchema,
  notes: Schema.Array(StudioNoteSchema),
  takeGroupId: Schema.NullOr(Schema.String),
  startBeat: optionalFinite,
  durationBeats: optionalFinite,
  midiProgram: optionalInt,
  midiChannel: optionalInt
})

const StudioTrackSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["audio", "midi"]),
  name: Schema.String,
  color: Schema.String,
  volume: Schema.Finite,
  pan: Schema.Finite,
  muted: Schema.Boolean,
  soloed: Schema.Boolean,
  clips: Schema.Array(StudioClipSchema)
})

const StudioSelectionSchema = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite
})

const KaraokeTokenSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  startBeat: Schema.Finite,
  endBeat: Schema.Finite,
  expectedMidi: Schema.Int
})

const StudioKaraokeGuideSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  melodyTrackId: Schema.String,
  melodyTrackName: Schema.String,
  startBeat: Schema.Finite,
  endBeat: Schema.Finite,
  tokens: Schema.Array(KaraokeTokenSchema)
})

const previewBaseFields = {
  id: Schema.String,
  prompt: Schema.String,
  clip: StudioClipSchema,
  targetTrackId: Schema.String,
  targetTrackName: Schema.String,
  operations: Schema.Array(Schema.String)
} as const

const StudioPreviewSchema = Schema.Union([
  Schema.Struct({
    ...previewBaseFields,
    kind: Schema.Literal("generated_part")
  }),
  Schema.Struct({
    ...previewBaseFields,
    kind: Schema.Literal("midi_transposition"),
    semitones: Schema.Int,
    startBeat: Schema.Finite,
    endBeat: Schema.Finite,
    notesAffected: Schema.Int,
    replacements: Schema.Array(
      Schema.Struct({
        trackId: Schema.String,
        clipId: Schema.String,
        clip: StudioClipSchema
      })
    )
  }),
  Schema.Struct({
    ...previewBaseFields,
    kind: Schema.Literal("karaoke_guide"),
    guide: StudioKaraokeGuideSchema
  })
])

const StudioAttributionSchema = Schema.Struct({
  title: Schema.String,
  creator: Schema.String,
  sourceUrl: Schema.String,
  licenseName: Schema.String,
  licenseUrl: Schema.String,
  sourceMidiUrl: Schema.String,
  sourceMidiSha256: Schema.String,
  changes: Schema.String
})

const studioDocumentFields = {
  songSlug: Schema.String,
  title: Schema.String,
  attribution: Schema.NullOr(StudioAttributionSchema),
  bpm: Schema.Finite,
  timeSignature: Schema.Tuple([Schema.Int, Schema.Int]),
  selection: StudioSelectionSchema,
  tracks: Schema.Array(StudioTrackSchema),
  karaokeGuide: Schema.NullOr(StudioKaraokeGuideSchema),
  karaokeCountInBeats: Schema.Literals([4, 8, 12]),
  practiceBed: Schema.NullOr(ReferencePracticeBedBasisInput)
} as const

const StudioDocumentSchema = Schema.Struct(studioDocumentFields)

const StudioStateSchema = Schema.Struct({
  projectId: Schema.String,
  ...studioDocumentFields,
  revision: Schema.Int,
  preview: Schema.NullOr(StudioPreviewSchema),
  historyDepth: Schema.Int,
  redoDepth: Schema.Int,
  mutationCount: Schema.Int,
  logs: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      actor: Schema.Literals(["AGENT", "HUMAN", "ENGINE"]),
      message: Schema.String
    })
  )
})

const StudioMutationValueSchema: Schema.Codec<StudioMutationValue> = Schema.suspend(
  (): Schema.Codec<StudioMutationValue> =>
    Schema.Union([
      Schema.Null,
      Schema.String,
      Schema.Finite,
      Schema.Boolean,
      Schema.Array(StudioMutationValueSchema),
      Schema.Record(Schema.String, StudioMutationValueSchema)
    ])
)

const StudioMutationResultSchema = Schema.StructWithRest(
  Schema.Struct({
    requestId: Schema.String,
    revision: Schema.Int,
    replayed: Schema.Boolean,
    change: Schema.String
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

const StudioMutationSchema = Schema.Struct({
  sequence: Schema.Int,
  recordedAt: Schema.String,
  actor: Schema.Literals(["AGENT", "HUMAN", "ENGINE"]),
  action: Schema.Literals([
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
  ]),
  requestId: Schema.String,
  expectedRevision: Schema.optional(Schema.Int),
  revisionBefore: Schema.Int,
  revisionAfter: Schema.Int,
  result: Schema.String,
  targets: Schema.Struct({
    trackId: Schema.optional(Schema.String),
    clipId: Schema.optional(Schema.String),
    previewId: Schema.optional(Schema.String)
  }),
  input: Schema.Record(Schema.String, StudioMutationValueSchema)
})

const StudioSessionSchema = Schema.Struct({
  schemaVersion: Schema.Literal(sessionSchemaVersion),
  projectId: Schema.String,
  present: StudioStateSchema,
  past: Schema.Array(StudioDocumentSchema),
  future: Schema.Array(StudioDocumentSchema),
  seen: Schema.Array(
    Schema.Struct({
      requestId: Schema.String,
      fingerprint: Schema.String,
      result: StudioMutationResultSchema
    })
  ),
  nextId: Schema.Int,
  mutations: Schema.Array(StudioMutationSchema),
  nextMutationSequence: Schema.Int
})

const StudioSessionJson = Schema.fromJsonString(StudioSessionSchema)

const browserSessionStorage = (): StudioSessionStorage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

const storageKey = (projectId: string): string => `${sessionStoragePrefix}${projectId}`

export const restoreStudioSession = (
  fallback: StudioInternalState,
  storage: StudioSessionStorage | undefined = browserSessionStorage()
): StudioInternalState => {
  if (storage === undefined) return fallback
  try {
    const encoded = storage.getItem(storageKey(fallback.present.projectId))
    if (encoded === null) return fallback
    const decoded = Schema.decodeUnknownSync(StudioSessionJson)(encoded)
    if (decoded.projectId !== fallback.present.projectId || decoded.present.projectId !== decoded.projectId) {
      return fallback
    }
    const past = decoded.past as ReadonlyArray<StudioDocument>
    const future = decoded.future as ReadonlyArray<StudioDocument>
    return {
      present: {
        ...(decoded.present as StudioState),
        historyDepth: past.length,
        redoDepth: future.length
      },
      past,
      future,
      seen: new Map(
        decoded.seen.map(({ requestId, fingerprint, result }) => [
          requestId,
          { fingerprint, result: result as StudioMutationResult }
        ])
      ),
      nextId: decoded.nextId,
      mutations: decoded.mutations.map((mutation) => {
        const { expectedRevision, targets, ...required } = mutation
        return {
          ...required,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          targets: {
            ...(targets.trackId === undefined ? {} : { trackId: targets.trackId }),
            ...(targets.clipId === undefined ? {} : { clipId: targets.clipId }),
            ...(targets.previewId === undefined ? {} : { previewId: targets.previewId })
          }
        }
      }),
      nextMutationSequence: decoded.nextMutationSequence
    }
  } catch {
    return fallback
  }
}

export const restoreStudioSessionState = (
  fallback: StudioState,
  storage: StudioSessionStorage | undefined = browserSessionStorage()
): StudioState =>
  restoreStudioSession(
    {
      present: fallback,
      past: [],
      future: [],
      seen: new Map(),
      nextId: 1,
      mutations: [],
      nextMutationSequence: 1
    },
    storage
  ).present

export const persistStudioSession = (
  internal: StudioInternalState,
  storage: StudioSessionStorage | undefined = browserSessionStorage()
): void => {
  if (storage === undefined) return
  try {
    const past = internal.past.slice(-persistedHistoryLimit)
    const future = internal.future.slice(-persistedHistoryLimit)
    const present: StudioState = {
      ...internal.present,
      historyDepth: past.length,
      redoDepth: future.length
    }
    const seen = [...internal.seen.entries()].slice(-persistedRequestLimit).map(([requestId, value]) => ({
      requestId,
      fingerprint: value.fingerprint,
      result: { ...value.result } as typeof StudioMutationResultSchema.Type
    }))
    const encoded = Schema.encodeSync(StudioSessionJson)({
      schemaVersion: sessionSchemaVersion,
      projectId: present.projectId,
      present,
      past,
      future,
      seen,
      nextId: internal.nextId,
      mutations: internal.mutations.slice(-persistedMutationLimit),
      nextMutationSequence: internal.nextMutationSequence
    })
    storage.setItem(storageKey(present.projectId), encoded)
  } catch {
    // The Studio remains fully functional in memory when browser storage is unavailable or full.
  }
}
