import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import {
  InstrumentLearning,
  InstrumentLearningRuleError,
  preferredLessonTrack,
  type InstrumentLearningMode,
  type InstrumentLessonConfiguration
} from "./InstrumentLearning.ts"
import { Studio, StudioRuleError, studioMidiView, type StudioMutationOptions } from "./Studio.ts"
import {
  CreateStudioShareResponse,
  GetStudioShareResponse,
  isStudioShareId,
  StudioShareApiErrorEnvelope,
  StudioSharePayload,
  type StudioShareRecord
} from "./studioShareContract.ts"

export class StudioShareApiError extends Schema.TaggedError<StudioShareApiError>()("StudioShareApiError", {
  code: Schema.String,
  message: Schema.String,
  status: Schema.Int,
  cause: Schema.optional(Schema.Defect())
}) {}

export interface StudioShareReceipt {
  readonly shareId: string
  readonly url: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly idempotent: boolean
  readonly sourceRevision: number
  readonly midiTrackCount: number
  readonly noteCount: number
  readonly omittedAudioAssetCount: number
}

export interface StudioShareLoadReceipt {
  readonly shareId: string
  readonly change: string
  readonly projectRevision: number
  readonly lessonRevision: number
  readonly sourceProjectId: string
  readonly sourceRevision: number
  readonly omittedAudioAssetCount: number
}

const apiFailure = (code: string, message: string, status: number, cause?: unknown) =>
  new StudioShareApiError({
    code,
    message,
    status,
    ...(cause === undefined ? {} : { cause })
  })

const safeSharePath = (): string => {
  if (typeof window === "undefined") return "/"
  if (window.location.pathname.includes("karaoke")) return "/karaoke.html"
  return "/"
}

const shareUrl = (record: StudioShareRecord, mode: InstrumentLearningMode): string => {
  const base = typeof window === "undefined" ? "https://signal.invalid" : window.location.origin
  const url = new URL(safeSharePath(), base)
  if (url.pathname === "/") url.searchParams.set("mode", mode)
  url.searchParams.set("song", record.payload.song_slug)
  url.searchParams.set("share", record.id)
  return url.toString()
}

export const currentStudioShareId = (): string | null => {
  if (typeof window === "undefined") return null
  const candidate = new URL(window.location.href).searchParams.get("share")
  return candidate !== null && isStudioShareId(candidate) ? candidate : null
}

export class StudioShareApi extends Context.Service<
  StudioShareApi,
  {
    readonly changes: Stream.Stream<StudioShareReceipt>
    readonly snapshot: Effect.Effect<StudioShareReceipt | null>
    readonly create: (
      requestId: string,
      expectedRevision?: number
    ) => Effect.Effect<StudioShareReceipt, StudioShareApiError>
    readonly load: (
      shareId: string,
      projectOptions: StudioMutationOptions
    ) => Effect.Effect<
      StudioShareLoadReceipt,
      StudioShareApiError | StudioRuleError | InstrumentLearningRuleError
    >
  }
>()("signal-studio/StudioShareApi") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const studio = yield* Studio
      const learning = yield* InstrumentLearning
      const latestShareRef = yield* SubscriptionRef.make<StudioShareReceipt | null>(null)

      const requestJson = Effect.fn("StudioShareApi.requestJson")(function* (
        path: string,
        init?: RequestInit
      ) {
        const response = yield* Effect.tryPromise({
          try: (signal) => fetch(path, { ...init, signal }),
          catch: (cause) =>
            apiFailure(
              "NETWORK_ERROR",
              "The Signal share service is unreachable. Your browser-local project is unchanged.",
              0,
              cause
            )
        })
        const value = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: (cause) =>
            apiFailure("INVALID_RESPONSE", "The share service returned an unreadable response.", 500, cause)
        })
        if (!response.ok) {
          const envelope = yield* Schema.decodeUnknownEffect(StudioShareApiErrorEnvelope)(value).pipe(
            Effect.catch(() =>
              Effect.succeed({
                ok: false as const,
                error: {
                  code: "REQUEST_FAILED",
                  message: `Share request failed (${response.status}).`
                }
              })
            )
          )
          return yield* apiFailure(envelope.error.code, envelope.error.message, response.status)
        }
        return value
      })

      const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
        Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError((cause) =>
            apiFailure(
              "CONTRACT_ERROR",
              "The share service response did not match its Effect Schema contract.",
              500,
              cause
            )
          )
        )

      const payloadOf = Effect.fn("StudioShareApi.payloadOf")(function* (expectedRevision?: number) {
        const [state, learningState] = yield* Effect.all([studio.snapshot, learning.snapshot])
        if (expectedRevision !== undefined && expectedRevision !== state.revision) {
          return yield* apiFailure(
            "REVISION_CONFLICT",
            `Expected project revision ${expectedRevision}, but the current revision is ${state.revision}.`,
            409
          )
        }
        const midi = studioMidiView(state)
        const melodicTrackIds = new Set(midi.tracks.map((track) => track.track_id))
        const candidate = {
          schema_version: 1 as const,
          source_project_id: state.projectId,
          source_revision: state.revision,
          title: state.title,
          song_slug: state.songSlug,
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
                },
          practice_bed: state.practiceBed,
          bpm: state.bpm,
          meter: { numerator: state.timeSignature[0], denominator: state.timeSignature[1] },
          selection: midi.selection,
          tracks: midi.tracks.map((track, order) => ({
            track_id: track.track_id,
            order,
            name: track.name,
            mix: track.mix,
            clips: track.clips.map((clip) => ({
              clip_id: clip.clip_id,
              name: clip.name,
              gain: clip.gain,
              program: clip.program,
              channel: clip.channel,
              notes: clip.notes.map((note) => ({
                note_id: note.note_id,
                pitch: note.pitch,
                start_beat: note.start_beat,
                duration_beats: note.duration_beats,
                velocity: note.velocity
              }))
            }))
          })),
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
                    expected_midi: token.expectedMidi
                  }))
                },
          karaoke_count_in_beats: state.karaokeCountInBeats,
          lesson_configuration: melodicTrackIds.has(learningState.lesson.trackId)
            ? {
                instrument: learningState.lesson.instrument,
                tuning: learningState.lesson.tuning,
                track_id: learningState.lesson.trackId,
                start_beat: learningState.lesson.startBeat,
                end_beat: learningState.lesson.endBeat,
                hand_position: learningState.lesson.handPosition,
                max_fret: learningState.lesson.maxFret
              }
            : null,
          omitted_audio_asset_count: midi.summary.referenced_audio_asset_count
        }
        return yield* decode(StudioSharePayload, candidate)
      })

      const create = Effect.fn("StudioShareApi.create")(function* (
        requestId: string,
        expectedRevision?: number
      ) {
        const payload = yield* payloadOf(expectedRevision)
        const value = yield* requestJson("/api/studio-shares", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request_id: requestId, payload })
        })
        const response = yield* decode(CreateStudioShareResponse, value)
        const mode = (yield* learning.snapshot).mode
        const noteCount = response.share.payload.tracks.reduce(
          (count, track) => count + track.clips.reduce((clipCount, clip) => clipCount + clip.notes.length, 0),
          0
        )
        const receipt: StudioShareReceipt = {
          shareId: response.share.id,
          url: shareUrl(response.share, mode),
          createdAt: response.share.created_at,
          expiresAt: response.share.expires_at,
          idempotent: response.idempotent,
          sourceRevision: response.share.payload.source_revision,
          midiTrackCount: response.share.payload.tracks.length,
          noteCount,
          omittedAudioAssetCount: response.share.payload.omitted_audio_asset_count
        }
        yield* SubscriptionRef.set(latestShareRef, receipt)
        return receipt
      })

      const load = Effect.fn("StudioShareApi.load")(function* (
        shareId: string,
        projectOptions: StudioMutationOptions
      ) {
        if (!isStudioShareId(shareId)) {
          return yield* apiFailure("INVALID_SHARE_ID", "The Signal share link is malformed.", 400)
        }
        const value = yield* requestJson(`/api/studio-shares/${encodeURIComponent(shareId)}`)
        const response = yield* decode(GetStudioShareResponse, value)
        const result = yield* studio.importSharedSession(response.share.payload, shareId, projectOptions)
        const [project, learningBefore] = yield* Effect.all([studio.snapshot, learning.snapshot])
        const sharedLesson = response.share.payload.lesson_configuration
        const sharedTrack =
          sharedLesson === null
            ? undefined
            : project.tracks.find((track) => track.id === sharedLesson.track_id)
        const fallbackTrack = preferredLessonTrack(project)
        const track = sharedTrack ?? fallbackTrack
        let lessonRevision = learningBefore.lessonRevision
        if (track !== undefined) {
          const configuration: InstrumentLessonConfiguration =
            sharedLesson !== null && sharedTrack !== undefined
              ? {
                  instrument: sharedLesson.instrument,
                  tuning: sharedLesson.tuning,
                  trackId: sharedLesson.track_id,
                  startBeat: sharedLesson.start_beat,
                  endBeat: sharedLesson.end_beat,
                  handPosition: sharedLesson.hand_position,
                  maxFret: sharedLesson.max_fret
                }
              : {
                  ...learningBefore.lesson,
                  trackId: track.id,
                  startBeat: response.share.payload.selection.start_beat,
                  endBeat: Math.min(
                    response.share.payload.selection.end_beat,
                    response.share.payload.selection.start_beat + 64
                  )
                }
          const lessonResult = yield* learning.configureLesson(configuration, {
            requestId: `${projectOptions.requestId}-lesson`
          })
          lessonRevision = lessonResult.lessonRevision
        }
        return {
          shareId,
          change: result.change,
          projectRevision: result.revision,
          lessonRevision,
          sourceProjectId: response.share.payload.source_project_id,
          sourceRevision: response.share.payload.source_revision,
          omittedAudioAssetCount: response.share.payload.omitted_audio_asset_count
        }
      })

      return StudioShareApi.of({
        changes: SubscriptionRef.changes(latestShareRef).pipe(
          Stream.filter((receipt): receipt is StudioShareReceipt => receipt !== null)
        ),
        snapshot: SubscriptionRef.get(latestShareRef),
        create,
        load
      })
    })
  )
}
