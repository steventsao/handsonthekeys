import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { BrowserRecording, browserRecordingView, stopAndCommitBrowserRecording } from "./BrowserRecording.ts"
import { type InstrumentLearning } from "./InstrumentLearning.ts"
import { Studio } from "./Studio.ts"
import { StudioShareApi } from "./StudioShareApi.ts"

const RequestId = Schema.Trim.check(
  Schema.isLengthBetween(1, 128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
)
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const RecordingName = Schema.Trim.check(Schema.isLengthBetween(1, 80))

const EmptyInput = Schema.Struct({})
const ArmRecordingInput = Schema.Struct({
  request_id: RequestId,
  expected_recording_revision: Schema.optional(Revision),
  name: Schema.optional(RecordingName)
})
const StopRecordingInput = Schema.Struct({
  request_id: RequestId,
  expected_recording_revision: Schema.optional(Revision),
  expected_revision: Schema.optional(Revision)
})
const CreateShareInput = Schema.Struct({
  request_id: RequestId,
  expected_revision: Schema.optional(Revision)
})

const jsonSchema = (schema: Schema.Top): object => {
  const document = Schema.toJsonSchemaDocument(schema)
  return Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions }
}

export const studioCollaborationTools: ReadonlyArray<
  EffectTool<ToolInput, unknown, unknown, Studio | InstrumentLearning | BrowserRecording | StudioShareApi>
> = [
  {
    name: "get_browser_recording_status",
    title: "Read browser recording status",
    description:
      "Read bounded metadata for the page-local microphone recorder: its separate recording revision, armed or active take, completed take durations and sizes, permission issue, and explicit privacy boundary. This never returns raw audio, sample arrays, encoded audio, object URLs, blob URLs, or a local asset ID. It is read-only and does not request microphone permission.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const recording = yield* BrowserRecording
        return browserRecordingView(yield* recording.snapshot)
      })
  },
  {
    name: "arm_browser_recording",
    title: "Arm a browser microphone take",
    description:
      "Configure a named browser recording take using a retry-safe request_id and optional recording revision. Arming never calls getUserMedia and never opens a permission prompt. A person must press the visible Start Recording control on the page before capture begins. Use get_browser_recording_status afterward to confirm the human-action boundary.",
    inputSchema: jsonSchema(ArmRecordingInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ArmRecordingInput)(input)
        const recording = yield* BrowserRecording
        const result = yield* recording.arm(decoded.name ?? "Agent-armed Mic Take", 4, {
          requestId: decoded.request_id,
          ...(decoded.expected_recording_revision === undefined
            ? {}
            : { expectedRecordingRevision: decoded.expected_recording_revision })
        })
        return {
          change: result.change,
          recording_id: result.recordingId,
          recording_revision: result.recordingRevision,
          count_in_beats: result.countInBeats,
          idempotent: result.idempotent,
          human_action_required: result.humanActionRequired,
          microphone_requested: false,
          raw_audio_shared: false,
          next_action: "Ask the person to press Start Recording in the visible Signal Studio page."
        }
      })
  },
  {
    name: "stop_browser_recording",
    title: "Stop and commit an active browser take",
    description:
      "Stop a microphone take that a person already started from the visible page, then add it to the same browser Studio as an opaque local audio track. This mutation is retry-safe and accepts separate recording and project revisions. It never starts the microphone and never returns audio bytes, samples, encoded audio, object URLs, blob URLs, or the private local asset ID. Share links omit this local recording.",
    inputSchema: jsonSchema(StopRecordingInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(StopRecordingInput)(input)
        const committed = yield* stopAndCommitBrowserRecording(
          {
            requestId: decoded.request_id,
            ...(decoded.expected_recording_revision === undefined
              ? {}
              : { expectedRecordingRevision: decoded.expected_recording_revision })
          },
          {
            requestId: `${decoded.request_id}:project`,
            ...(decoded.expected_revision === undefined
              ? {}
              : { expectedRevision: decoded.expected_revision }),
            actor: "AGENT"
          }
        )
        const recording = yield* BrowserRecording
        return {
          change: committed.change,
          project_change: committed.projectChange,
          project_revision: committed.projectRevision,
          recording_revision: committed.recording.recordingRevision,
          idempotent: committed.recording.idempotent,
          take: {
            recording_id: committed.recording.take.recordingId,
            name: committed.recording.take.name,
            duration_seconds: committed.recording.take.durationSeconds,
            byte_length: committed.recording.take.byteLength,
            mime_type: committed.recording.take.mimeType,
            recorded_at: committed.recording.take.recordedAt
          },
          raw_audio_shared: false,
          share_links_omit_audio: true,
          recording: browserRecordingView(yield* recording.snapshot)
        }
      })
  },
  {
    name: "create_studio_share_link",
    title: "Create an expiring Studio share link",
    description:
      "Create an immutable, unlisted, 30-day link containing the current canonical MIDI project, lesson configuration, licensed attribution, and timed karaoke guide. The operation is retry-safe by request_id and may revision-check the project. Anyone with the URL can read that structured snapshot until it expires. Uploaded audio and browser recordings are always omitted; the response reports exactly how many local audio assets were left out.",
    inputSchema: jsonSchema(CreateShareInput),
    execute: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateShareInput)(input)
        const shares = yield* StudioShareApi
        const result = yield* shares.create(decoded.request_id, decoded.expected_revision)
        return {
          change: "studio_share_link_created",
          share_id: result.shareId,
          url: result.url,
          created_at: result.createdAt,
          expires_at: result.expiresAt,
          idempotent: result.idempotent,
          source_revision: result.sourceRevision,
          midi_track_count: result.midiTrackCount,
          note_count: result.noteCount,
          omitted_audio_asset_count: result.omittedAudioAssetCount,
          access: "Anyone with this unlisted URL can read the structured snapshot until it expires.",
          raw_audio_shared: false
        }
      })
  }
]
