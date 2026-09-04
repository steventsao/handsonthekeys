import {
  IframeSandboxExecutor,
  createBrowserCodeTool,
  type JsonSchemaExecutableToolDescriptors
} from "@cloudflare/codemode/browser"
import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { Studio, studioOperationStateView } from "./Studio.ts"
import {
  ArpeggioInput,
  ChordProgressionInput,
  ListInstrumentsInput,
  ReferencePracticeBedBasisInput,
  WriteTracksInput,
  expandArpeggio,
  expandChordProgression,
  instrumentByAlias,
  studioInstruments,
  type WriteTracksInput as WriteTracks
} from "./studioComposition.ts"

const MAX_CODE_CHARACTERS = 15_000
const MAX_ERROR_CHARACTERS = 700

const ComposeStudioInput = Schema.Struct({
  code: Schema.String.check(Schema.isLengthBetween(1, MAX_CODE_CHARACTERS))
})

type JsonSchema = JsonSchemaExecutableToolDescriptors[string]["inputSchema"]

const refinementKeywords = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
  "uniqueItems"
])

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeRefinementIntersections = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeRefinementIntersections)
  if (!isJsonObject(value)) return value

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeRefinementIntersections(child)])
  )
  const allOf = normalized.allOf
  if (
    Array.isArray(allOf) &&
    allOf.every(
      (clause) => isJsonObject(clause) && Object.keys(clause).every((key) => refinementKeywords.has(key))
    )
  ) {
    delete normalized.allOf
    for (const clause of allOf) Object.assign(normalized, clause)
  }
  return normalized
}

const jsonSchema = (schema: Schema.Top): JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  const root =
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions }
  return normalizeRefinementIntersections(root) as JsonSchema
}

const emptyInputSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
}

const generatedNotesOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    symbols: { type: "array", items: { type: "string" } },
    start_beat: { type: "number" },
    end_beat: { type: "number" },
    note_count: { type: "integer" },
    notes: {
      type: "array",
      description:
        "Expanded notes stay inside the Code Mode program; pass this array to writeTracks rather than returning it.",
      items: {
        type: "object",
        properties: {
          pitch: { type: "integer" },
          start_beat: { type: "number" },
          duration_beats: { type: "number" },
          velocity: { type: "integer" }
        },
        required: ["pitch", "start_beat", "duration_beats", "velocity"],
        additionalProperties: false
      }
    }
  },
  required: ["symbols", "start_beat", "end_beat", "note_count", "notes"],
  additionalProperties: false
}

const studioContextOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    project_id: { type: "string" },
    revision: { type: "integer" },
    bpm: { type: "number" },
    meter: {
      type: "object",
      properties: {
        numerator: { type: "integer" },
        denominator: { type: "integer" }
      },
      required: ["numerator", "denominator"],
      additionalProperties: false
    },
    practice_bed: {
      oneOf: [{ type: "null" }, jsonSchema(ReferencePracticeBedBasisInput)]
    },
    selection: {
      type: "object",
      properties: {
        start_beat: { type: "number" },
        end_beat: { type: "number" }
      },
      required: ["start_beat", "end_beat"],
      additionalProperties: false
    },
    tracks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          track_id: { type: "string" },
          name: { type: "string" },
          clip_count: { type: "integer" }
        },
        required: ["track_id", "name", "clip_count"],
        additionalProperties: false
      }
    }
  },
  required: ["project_id", "revision", "bpm", "meter", "practice_bed", "selection", "tracks"],
  additionalProperties: false
}

const instrumentsOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    instruments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          alias: { type: "string" },
          label: { type: "string" },
          family: { type: "string" },
          program: { type: "integer" },
          channel: { type: "integer" },
          description: { type: "string" }
        },
        required: ["alias", "label", "family", "program", "channel", "description"],
        additionalProperties: false
      }
    }
  },
  required: ["instruments"],
  additionalProperties: false
}

const writeTracksOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    status: { const: "composition_validated" },
    request_id: { type: "string" },
    mode: { enum: ["append", "replace_session"] },
    basis_kind: { enum: ["original", "reference_practice_bed"] },
    track_count: { type: "integer" },
    note_count: { type: "integer" },
    track_names: { type: "array", items: { type: "string" } }
  },
  required: ["status", "request_id", "mode", "basis_kind", "track_count", "note_count", "track_names"],
  additionalProperties: false
}

const studioComposeDescription = `Compose MIDI in the open Signal Studio with concise JavaScript music shorthands. Chord and arpeggio expansion stays inside the sandbox; only a small commit summary returns to model context.

For a requested commercial song, use only researched factual reference data: approximate tempo, key, meter, and common harmonic vocabulary. Then create a new accompaniment with your own rhythm, voicing, texture, form, and note choices. Never transcribe or reproduce source lyrics, vocal melody, signature riffs, exact arrangement, third-party notation/MIDI, or recordings. This facts-only workflow reduces copyright risk; it does not make the result licensed or guarantee non-infringement.

Available:
{{types}}

Use this shape:
async () => {
  const studio = await codemode.getStudioContext({});
  const progression = ["Am7", "Fmaj7", "Cmaj7", "G7"];
  const pad = await codemode.chords({ symbols: progression, start_beat: 0, beats_per_chord: 4, octave: 3, voicing: "open" });
  const arp = await codemode.arpeggio({ symbols: progression, start_beat: 0, beats_per_chord: 4, step_beats: 0.5, octave: 4, octaves: 2, direction: "up_down" });
  return await codemode.writeTracks({
    request_id: "unique-stable-request-id",
    expected_revision: studio.revision,
    mode: "append",
    basis: { kind: "original" },
    tracks: [
      { name: "Warm Chords", instrument: "warm_pad", notes: pad.notes },
      { name: "Rising Arp", instrument: "saw_lead", notes: arp.notes }
    ]
  });
}

To replace the open song with a facts-only practice bed, use mode: "replace_session" and basis: {
  kind: "reference_practice_bed",
  reference_title: "Requested song title",
  reference_artist: "Requested artist",
  approximate_bpm: 100,
  key: "E major",
  meter: { numerator: 4, denominator: 4 },
  harmonic_vocabulary: ["E", "B", "C#m", "A"],
  factual_sources: ["https://example.com/song-facts"],
  arrangement: "new_original_accompaniment",
  excludes: "lyrics_melody_signature_riffs_exact_arrangement_source_notation_or_recordings"
}. The host atomically replaces the current tracks, applies the declared tempo and meter, clears any old lyric guide, labels the room ORIGINAL PRACTICE BED, and stores the complete basis in canonical Effect state and the mutation journal. Do not use append mode for a commercial-song reference.

Supported chord suffixes: major (C), m, 5, 6, m6, 7, maj7, m7, mMaj7, dim, dim7, m7b5, aug, sus2, sus4, add9, plus slash bass notes such as C/E. Beat positions are absolute zero-based quarter-note beats. Call writeTracks exactly once and return it immediately. It validates 1–8 new tracks with at most 512 notes each, then the host commits all tracks atomically as one revision-checked, retry-safe, undoable transaction. If any helper or the program fails, nothing is written.`

interface StudioComposeCodeModeOptions {
  readonly projectId: string
  readonly revision: number
  readonly bpm: number
  readonly timeSignature: readonly [number, number]
  readonly practiceBed: WriteTracks["basis"] | null
  readonly selection: { readonly start_beat: number; readonly end_beat: number }
  readonly tracks: ReadonlyArray<{
    readonly track_id: string
    readonly name: string
    readonly clip_count: number
  }>
  readonly stageWrite: (write: WriteTracks) => void
}

const makeStudioComposeCodeMode = (options: StudioComposeCodeModeOptions) => {
  let writeStaged = false
  const tools = {
    getStudioContext: {
      description:
        "Read the current revision, tempo, beat selection, and existing track names before composing.",
      inputSchema: emptyInputSchema,
      outputSchema: studioContextOutputSchema,
      execute: async () => ({
        project_id: options.projectId,
        revision: options.revision,
        bpm: options.bpm,
        meter: {
          numerator: options.timeSignature[0],
          denominator: options.timeSignature[1]
        },
        practice_bed: options.practiceBed?.kind === "reference_practice_bed" ? options.practiceBed : null,
        selection: options.selection,
        tracks: options.tracks
      })
    },
    listInstruments: {
      description:
        "List curated General MIDI instrument aliases accepted by writeTracks. Filter by family when useful.",
      inputSchema: jsonSchema(ListInstrumentsInput),
      outputSchema: instrumentsOutputSchema,
      execute: async (input: Record<string, unknown>) => {
        const decoded = await Schema.decodeUnknownPromise(ListInstrumentsInput)(input)
        return {
          instruments:
            decoded.family === undefined
              ? studioInstruments
              : studioInstruments.filter((instrument) => instrument.family === decoded.family)
        }
      }
    },
    chords: {
      description:
        "Expand chord symbols into simultaneous exact MIDI notes. Keep the returned notes inside this program and pass them to writeTracks.",
      inputSchema: jsonSchema(ChordProgressionInput),
      outputSchema: generatedNotesOutputSchema,
      execute: async (input: Record<string, unknown>) =>
        expandChordProgression(await Schema.decodeUnknownPromise(ChordProgressionInput)(input))
    },
    arpeggio: {
      description:
        "Expand chord symbols into a timed arpeggio. Use direction or an explicit zero-based chord-tone pattern; pass result.notes to writeTracks.",
      inputSchema: jsonSchema(ArpeggioInput),
      outputSchema: generatedNotesOutputSchema,
      execute: async (input: Record<string, unknown>) =>
        expandArpeggio(await Schema.decodeUnknownPromise(ArpeggioInput)(input))
    },
    writeTracks: {
      description:
        "Stage exactly one atomic multi-track commit. Use append + original for your own music. For a commercial-song request, use replace_session + reference_practice_bed and provide only factual tempo, key, meter, harmony, and factual source URLs; excluded protected expression is not accepted by the schema. Call this once, last, and immediately return its small validation summary.",
      inputSchema: jsonSchema(WriteTracksInput),
      outputSchema: writeTracksOutputSchema,
      execute: async (input: Record<string, unknown>) => {
        if (writeStaged) throw new Error("writeTracks may be called only once per compose_studio program.")
        const decoded = await Schema.decodeUnknownPromise(WriteTracksInput, {
          onExcessProperty: "error"
        })(input)
        writeStaged = true
        options.stageWrite(decoded)
        return {
          status: "composition_validated",
          request_id: decoded.request_id,
          mode: decoded.mode,
          basis_kind: decoded.basis.kind,
          track_count: decoded.tracks.length,
          note_count: decoded.tracks.reduce((count, track) => count + track.notes.length, 0),
          track_names: decoded.tracks.map((track) => track.name)
        }
      }
    }
  } satisfies JsonSchemaExecutableToolDescriptors

  return createBrowserCodeTool({
    tools,
    executor: new IframeSandboxExecutor({ timeout: 5_000 }),
    description: studioComposeDescription
  })
}

const registrationDescriptor = makeStudioComposeCodeMode({
  projectId: "registration-only",
  revision: 1,
  bpm: 120,
  timeSignature: [4, 4],
  practiceBed: null,
  selection: { start_beat: 0, end_beat: 4 },
  tracks: [],
  stageWrite: () => undefined
})

const errorMessage = (cause: unknown): string => {
  const raw = cause instanceof Error ? cause.message : String(cause)
  const withoutLogs = raw.split("\n\nConsole output:", 1)[0] ?? raw
  return withoutLogs.slice(0, MAX_ERROR_CHARACTERS)
}

export const composeStudioTool: EffectTool<ToolInput, unknown, unknown, Studio> = {
  name: "compose_studio",
  title: "Compose Studio tracks with code",
  description: registrationDescriptor.description,
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        minLength: 1,
        maxLength: MAX_CODE_CHARACTERS,
        description:
          "One async JavaScript program using codemode.chords, codemode.arpeggio, instrument aliases, and exactly one codemode.writeTracks call with an explicit composition mode and rights basis."
      }
    },
    required: ["code"],
    additionalProperties: false
  },
  execute: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ComposeStudioInput)(input)
      const studio = yield* Studio
      const before = yield* studio.snapshot
      const operationState = studioOperationStateView(before)
      let stagedWrite: WriteTracks | undefined
      const codeMode = makeStudioComposeCodeMode({
        projectId: before.projectId,
        revision: before.revision,
        bpm: before.bpm,
        timeSignature: before.timeSignature,
        practiceBed: before.practiceBed,
        selection: operationState.selection,
        tracks: before.tracks.map((track) => ({
          track_id: track.id,
          name: track.name,
          clip_count: track.clips.length
        })),
        stageWrite: (write) => {
          stagedWrite = write
        }
      })
      const attempted = yield* Effect.tryPromise({
        try: () => codeMode.execute({ code: decoded.code }),
        catch: errorMessage
      }).pipe(Effect.result)

      if (Result.isFailure(attempted)) {
        return {
          status: "execution_error",
          error: "studio_composition_execution_failed",
          message: attempted.failure,
          guidance:
            "Use one async arrow function, build notes with codemode.chords or codemode.arpeggio, then return exactly one awaited codemode.writeTracks call with an explicit mode and basis. No tracks were written."
        }
      }

      if (stagedWrite === undefined) {
        return {
          status: "invalid_result",
          error: "studio_composition_not_staged",
          guidance:
            "Call codemode.writeTracks exactly once after creating the chord or arpeggio note arrays. No tracks were written."
        }
      }

      const write = stagedWrite
      const tracks = write.tracks.map((track) => {
        const instrument = instrumentByAlias(track.instrument)
        return {
          trackName: track.name,
          clipName: track.clip_name ?? track.name,
          program: instrument.program,
          channel: instrument.channel,
          ...(track.volume === undefined ? {} : { volume: track.volume }),
          ...(track.pan === undefined ? {} : { pan: track.pan }),
          notes: track.notes.map((note) => ({
            pitch: note.pitch,
            startBeat: note.start_beat,
            durationBeats: note.duration_beats,
            ...(note.velocity === undefined ? {} : { velocity: note.velocity })
          }))
        }
      })
      const request =
        write.mode === "append"
          ? { mode: write.mode, basis: write.basis, tracks }
          : { mode: write.mode, basis: write.basis, tracks }
      const composition = yield* studio.composeMidi(request, {
        requestId: write.request_id,
        expectedRevision: write.expected_revision ?? before.revision,
        actor: "AGENT"
      })
      const after = yield* studio.snapshot

      return {
        status: "committed",
        request_id: composition.requestId,
        revision: composition.revision,
        replayed: composition.replayed,
        change: composition.change,
        mode: composition.mode,
        basis: composition.basis,
        tracks_created: composition.tracksCreated,
        notes_written: composition.notesWritten,
        tracks: composition.tracks.map((track) => ({
          track_id: track.trackId,
          clip_id: track.clipId,
          track_name: track.trackName,
          clip_name: track.clipName,
          program: track.program,
          channel: track.channel,
          notes_written: track.notesWritten
        })),
        state: studioOperationStateView(after)
      }
    })
}
