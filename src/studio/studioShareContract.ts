import * as Schema from "effect/Schema"
import { ReferencePracticeBedBasisInput } from "./studioComposition.ts"

export const studioShareSchemaVersion = 1 as const
export const studioShareRetentionDays = 30 as const

const Identifier = Schema.Trim.check(
  Schema.isLengthBetween(1, 128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
)
const ShareId = Schema.Trim.check(Schema.isLengthBetween(26, 70), Schema.isPattern(/^share_[a-f0-9]{20,64}$/))
const ShortText = Schema.Trim.check(
  Schema.isLengthBetween(1, 160),
  // oxlint-disable-next-line no-control-regex -- Shared display text excludes non-printing controls.
  Schema.isPattern(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/)
)
const LongText = Schema.Trim.check(
  Schema.isLengthBetween(1, 500),
  // oxlint-disable-next-line no-control-regex -- Shared display text excludes non-printing controls.
  Schema.isPattern(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/)
)
const SafeSourceUrl = Schema.Trim.check(
  Schema.isLengthBetween(1, 500),
  Schema.isPattern(/^(?:https:\/\/[^\s]+|\/(?!\/)[^\s]*)$/)
)
const Beat = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 }))
const BeatDuration = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0.000001),
  Schema.isLessThanOrEqualTo(256)
)
const Unit = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Pan = Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 }))
const MidiNumber = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 }))
const MidiVelocity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 127 }))
const MidiProgram = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 }))
const MidiChannel = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 }))

export const StudioShareAttribution = Schema.Struct({
  title: ShortText,
  creator: ShortText,
  source_url: SafeSourceUrl,
  license_name: ShortText,
  license_url: SafeSourceUrl,
  source_midi_url: SafeSourceUrl,
  source_midi_sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  changes: LongText
})

export const StudioShareNote = Schema.Struct({
  note_id: Identifier,
  pitch: MidiNumber,
  start_beat: Beat,
  duration_beats: BeatDuration,
  velocity: MidiVelocity
})

export const StudioShareClip = Schema.Struct({
  clip_id: Identifier,
  name: ShortText,
  gain: Unit,
  program: MidiProgram,
  channel: MidiChannel,
  notes: Schema.Array(StudioShareNote).check(Schema.isLengthBetween(1, 4_096))
})

export const StudioShareTrack = Schema.Struct({
  track_id: Identifier,
  order: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 31 })),
  name: ShortText,
  mix: Schema.Struct({
    volume: Unit,
    pan: Pan,
    muted: Schema.Boolean,
    soloed: Schema.Boolean
  }),
  clips: Schema.Array(StudioShareClip).check(Schema.isLengthBetween(1, 64))
})

export const StudioShareKaraokeGuide = Schema.Struct({
  guide_id: Identifier,
  title: ShortText,
  melody_track_id: Identifier,
  melody_track_name: ShortText,
  start_beat: Beat,
  end_beat: Beat,
  tokens: Schema.Array(
    Schema.Struct({
      token_id: Identifier,
      text: ShortText,
      start_beat: Beat,
      end_beat: Beat,
      expected_midi: MidiNumber
    })
  ).check(Schema.isLengthBetween(1, 64))
})

export const StudioShareLessonConfiguration = Schema.Struct({
  instrument: Schema.Literal("guitar"),
  tuning: Schema.Literal("standard"),
  track_id: Identifier,
  start_beat: Beat,
  end_beat: Beat,
  hand_position: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
  max_fret: Schema.Int.check(Schema.isBetween({ minimum: 12, maximum: 24 }))
})

export const StudioSharePayload = Schema.Struct({
  schema_version: Schema.Literal(studioShareSchemaVersion),
  source_project_id: Identifier,
  source_revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  title: ShortText,
  song_slug: Identifier,
  attribution: Schema.NullOr(StudioShareAttribution),
  practice_bed: Schema.NullOr(ReferencePracticeBedBasisInput),
  bpm: Schema.Finite.check(Schema.isBetween({ minimum: 40, maximum: 240 })),
  meter: Schema.Struct({
    numerator: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
    denominator: Schema.Literals([2, 4, 8, 16])
  }),
  selection: Schema.Struct({
    start_beat: Beat,
    end_beat: Beat
  }),
  tracks: Schema.Array(StudioShareTrack).check(Schema.isLengthBetween(1, 32)),
  karaoke_guide: Schema.NullOr(StudioShareKaraokeGuide),
  karaoke_count_in_beats: Schema.Literals([4, 8, 12]),
  lesson_configuration: Schema.NullOr(StudioShareLessonConfiguration),
  omitted_audio_asset_count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000 }))
})
export type StudioSharePayload = typeof StudioSharePayload.Type

export const CreateStudioShareRequest = Schema.Struct({
  request_id: Identifier,
  payload: StudioSharePayload
})
export type CreateStudioShareRequest = typeof CreateStudioShareRequest.Type

export const StudioShareRecord = Schema.Struct({
  id: ShareId,
  created_at: Schema.String,
  expires_at: Schema.String,
  payload: StudioSharePayload
})
export type StudioShareRecord = typeof StudioShareRecord.Type

export const CreateStudioShareResponse = Schema.Struct({
  ok: Schema.Literal(true),
  share: StudioShareRecord,
  idempotent: Schema.Boolean
})

export const GetStudioShareResponse = Schema.Struct({
  ok: Schema.Literal(true),
  share: StudioShareRecord
})

export const StudioShareApiErrorEnvelope = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String
  })
})

export const isStudioShareId = Schema.is(ShareId)
