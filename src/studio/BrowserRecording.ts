import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { registerBrowserRecordingAudio } from "./audioAssets.ts"
import { describeKaraokeMicrophoneFailure, type KaraokeMicrophoneIssue } from "./karaokeSession.ts"
import { Studio, StudioRuleError, type StudioMutationOptions } from "./Studio.ts"

export type BrowserRecordingStatus =
  "idle" | "armed" | "requesting" | "counting_in" | "recording" | "stopping" | "complete" | "error"

export interface BrowserRecordingTake {
  readonly recordingId: string
  readonly name: string
  readonly durationSeconds: number
  readonly byteLength: number
  readonly mimeType: string
  readonly recordedAt: string
}

export interface BrowserRecordingState {
  readonly recordingRevision: number
  readonly status: BrowserRecordingStatus
  readonly armedRecordingId: string | null
  readonly activeRecordingId: string | null
  readonly name: string | null
  readonly countInBeats: number
  readonly countInRemaining: number
  readonly microphoneIssue: KaraokeMicrophoneIssue | null
  readonly humanActionRequired: true
  readonly rawAudioShared: false
  readonly takes: ReadonlyArray<BrowserRecordingTake>
  readonly message: string
}

export interface BrowserRecordingOptions {
  readonly requestId: string
  readonly expectedRecordingRevision?: number
}

export interface BrowserRecordingArmReceipt {
  readonly change: "recording_armed"
  readonly recordingId: string
  readonly recordingRevision: number
  readonly idempotent: boolean
  readonly countInBeats: number
  readonly humanActionRequired: true
  readonly message: string
}

export interface BrowserRecordingStartReceipt {
  readonly change: "recording_started"
  readonly recordingId: string
  readonly recordingRevision: number
  readonly humanActionRequired: true
}

export interface BrowserRecordingStopReceipt {
  readonly change: "recording_stopped"
  readonly recordingId: string
  readonly recordingRevision: number
  readonly idempotent: boolean
  readonly assetId: string
  readonly take: BrowserRecordingTake
}

export interface BrowserRecordingCommitReceipt {
  readonly change: "browser_recording_committed"
  readonly recording: BrowserRecordingStopReceipt
  readonly projectRevision: number
  readonly projectChange: string
}

export class BrowserRecordingError extends Schema.TaggedError<BrowserRecordingError>()(
  "BrowserRecordingError",
  {
    code: Schema.String,
    message: Schema.String,
    currentRecordingRevision: Schema.Int,
    cause: Schema.optional(Schema.Defect())
  }
) {}

interface SeenMutation {
  readonly fingerprint: string
  readonly receipt: BrowserRecordingArmReceipt | BrowserRecordingStopReceipt
}

interface BrowserRecordingInternalState {
  readonly view: BrowserRecordingState
  readonly seen: ReadonlyMap<string, SeenMutation>
}

interface ActiveCapture {
  readonly recordingId: string
  readonly name: string
  readonly recorder: MediaRecorder
  readonly stream: MediaStream
  readonly chunks: Array<Blob>
  readonly startedAt: number
}

interface StoredTake {
  readonly blob: Blob
}

const maximumRecordingSeconds = 600
const maximumRecordingBytes = 64 * 1_024 * 1_024
const seenMutationLimit = 128

export const initialBrowserRecordingState = (): BrowserRecordingState => ({
  recordingRevision: 1,
  status: "idle",
  armedRecordingId: null,
  activeRecordingId: null,
  name: null,
  countInBeats: 4,
  countInRemaining: 0,
  microphoneIssue: null,
  humanActionRequired: true,
  rawAudioShared: false,
  takes: [],
  message: "Ready. Arm through MCP or press Record; only a visible human action can open the microphone."
})

const failure = (state: BrowserRecordingState, code: string, message: string, cause?: unknown) =>
  new BrowserRecordingError({
    code,
    message,
    currentRecordingRevision: state.recordingRevision,
    ...(cause === undefined ? {} : { cause })
  })

const normalizedName = (name: string): string | null => {
  const value = name.trim()
  return value.length >= 1 && value.length <= 80 ? value : null
}

const supportedMimeType = (): string | undefined => {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

const rememberMutation = (
  seen: ReadonlyMap<string, SeenMutation>,
  requestId: string,
  mutation: SeenMutation
): ReadonlyMap<string, SeenMutation> => {
  const next = new Map(seen)
  next.set(requestId, mutation)
  if (next.size > seenMutationLimit) {
    const oldest = next.keys().next().value as string | undefined
    if (oldest !== undefined) next.delete(oldest)
  }
  return next
}

const stopCapture = (capture: ActiveCapture): Promise<Blob> =>
  new Promise((resolve, reject) => {
    let settled = false
    const release = () => {
      for (const track of capture.stream.getTracks()) track.stop()
    }
    const finish = () => {
      if (settled) return
      settled = true
      release()
      resolve(
        new Blob(capture.chunks, {
          type: capture.recorder.mimeType || capture.chunks[0]?.type || "audio/webm"
        })
      )
    }
    capture.recorder.addEventListener("stop", finish, { once: true })
    capture.recorder.addEventListener(
      "error",
      (event) => {
        if (settled) return
        settled = true
        release()
        reject(event.error ?? new Error("The browser recorder stopped with an unknown error."))
      },
      { once: true }
    )
    if (capture.recorder.state === "inactive") finish()
    else capture.recorder.stop()
  })

export const browserRecordingView = (state: BrowserRecordingState) => ({
  recording_revision: state.recordingRevision,
  status: state.status,
  armed_recording_id: state.armedRecordingId,
  active_recording_id: state.activeRecordingId,
  name: state.name,
  count_in_beats: state.countInBeats,
  count_in_remaining: state.countInRemaining,
  microphone_issue: state.microphoneIssue,
  human_action_required: state.humanActionRequired,
  raw_audio_shared: state.rawAudioShared,
  take_count: state.takes.length,
  takes: state.takes.map((take) => ({
    recording_id: take.recordingId,
    name: take.name,
    duration_seconds: take.durationSeconds,
    byte_length: take.byteLength,
    mime_type: take.mimeType,
    recorded_at: take.recordedAt
  })),
  message: state.message
})

export class BrowserRecording extends Context.Service<
  BrowserRecording,
  {
    readonly changes: Stream.Stream<BrowserRecordingState>
    readonly snapshot: Effect.Effect<BrowserRecordingState>
    readonly arm: (
      name: string,
      countInBeats: number,
      options: BrowserRecordingOptions
    ) => Effect.Effect<BrowserRecordingArmReceipt, BrowserRecordingError>
    readonly startFromHumanGesture: (
      bpm: number
    ) => Effect.Effect<BrowserRecordingStartReceipt, BrowserRecordingError>
    readonly stop: (
      options: BrowserRecordingOptions
    ) => Effect.Effect<BrowserRecordingStopReceipt, BrowserRecordingError>
    readonly localTakeBlob: (recordingId: string) => Effect.Effect<Blob | null>
  }
>()("signal-studio/BrowserRecording") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make<BrowserRecordingInternalState>({
        view: initialBrowserRecordingState(),
        seen: new Map()
      })
      const storedTakes = new Map<string, StoredTake>()
      let activeCapture: ActiveCapture | null = null
      let stopInFlight: {
        readonly requestId: string
        readonly promise: Promise<BrowserRecordingStopReceipt>
      } | null = null

      const snapshot = SubscriptionRef.get(stateRef).pipe(Effect.map((internal) => internal.view))

      const arm = Effect.fn("BrowserRecording.arm")(function* (
        name: string,
        countInBeats: number,
        options: BrowserRecordingOptions
      ) {
        const safeName = normalizedName(name)
        const fingerprint = JSON.stringify({
          action: "arm",
          name: safeName,
          countInBeats,
          expectedRecordingRevision: options.expectedRecordingRevision ?? null
        })
        if (safeName === null) {
          const state = yield* snapshot
          return yield* failure(state, "invalid_name", "Recording names must contain 1–80 characters.")
        }
        if (!Number.isInteger(countInBeats) || countInBeats < 1 || countInBeats > 32) {
          const state = yield* snapshot
          return yield* failure(state, "invalid_count_in", "Recording count-in must be 1–32 beats.")
        }
        return yield* SubscriptionRef.modifyEffect(stateRef, (internal) => {
          const prior = internal.seen.get(options.requestId)
          if (prior !== undefined) {
            if (prior.fingerprint !== fingerprint || prior.receipt.change !== "recording_armed") {
              return Effect.fail(
                failure(
                  internal.view,
                  "request_id_conflict",
                  `Request ID ${options.requestId} was already used for another recording mutation.`
                )
              )
            }
            return Effect.succeed([{ ...prior.receipt, idempotent: true }, internal] as const)
          }
          if (
            options.expectedRecordingRevision !== undefined &&
            options.expectedRecordingRevision !== internal.view.recordingRevision
          ) {
            return Effect.fail(
              failure(
                internal.view,
                "revision_conflict",
                `Expected recording revision ${options.expectedRecordingRevision}, but the current revision is ${internal.view.recordingRevision}.`
              )
            )
          }
          if (["requesting", "counting_in", "recording", "stopping"].includes(internal.view.status)) {
            return Effect.fail(
              failure(
                internal.view,
                "recording_active",
                "Stop the active browser recording before arming another take."
              )
            )
          }
          const recordingId = `take-${crypto.randomUUID()}`
          const nextView: BrowserRecordingState = {
            ...internal.view,
            recordingRevision: internal.view.recordingRevision + 1,
            status: "armed",
            armedRecordingId: recordingId,
            activeRecordingId: null,
            name: safeName,
            countInBeats,
            countInRemaining: 0,
            microphoneIssue: null,
            message: `Recording armed with a ${countInBeats}-beat count-in. A person must press Start Recording on the visible page before microphone permission is requested.`
          }
          const receipt: BrowserRecordingArmReceipt = {
            change: "recording_armed",
            recordingId,
            recordingRevision: nextView.recordingRevision,
            idempotent: false,
            countInBeats,
            humanActionRequired: true,
            message: nextView.message
          }
          return Effect.succeed([
            receipt,
            {
              view: nextView,
              seen: rememberMutation(internal.seen, options.requestId, { fingerprint, receipt })
            }
          ] as const)
        })
      })

      const startFromHumanGesture = Effect.fn("BrowserRecording.startFromHumanGesture")(function* (
        bpm: number
      ) {
        const internal = yield* SubscriptionRef.get(stateRef)
        if (["requesting", "counting_in", "recording", "stopping"].includes(internal.view.status)) {
          return yield* failure(internal.view, "recording_active", "A browser recording is already active.")
        }
        if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
          return yield* failure(internal.view, "invalid_tempo", "Recording tempo must be 40–240 BPM.")
        }
        if (
          typeof navigator === "undefined" ||
          navigator.mediaDevices?.getUserMedia === undefined ||
          typeof MediaRecorder === "undefined"
        ) {
          return yield* failure(
            internal.view,
            "unsupported_browser",
            "This browser does not support microphone recording. Open the secure Signal Studio link in Chrome, Edge, or Safari."
          )
        }
        if (!globalThis.isSecureContext) {
          return yield* failure(
            internal.view,
            "insecure_context",
            "Microphone recording requires HTTPS. Open the secure Signal Studio link and try again."
          )
        }

        const recordingId = internal.view.armedRecordingId ?? `take-${crypto.randomUUID()}`
        const name = internal.view.name ?? `Mic Take ${internal.view.takes.length + 1}`
        const requestingView: BrowserRecordingState = {
          ...internal.view,
          recordingRevision: internal.view.recordingRevision + 1,
          status: "requesting",
          armedRecordingId: recordingId,
          activeRecordingId: recordingId,
          name,
          countInRemaining: 0,
          microphoneIssue: null,
          message: "Waiting for the browser's microphone permission prompt."
        }
        yield* SubscriptionRef.set(stateRef, { ...internal, view: requestingView })

        const stream = yield* Effect.tryPromise({
          try: () => navigator.mediaDevices.getUserMedia({ audio: true }),
          catch: (cause) => cause
        }).pipe(
          Effect.catch((cause) => {
            const microphoneFailure = describeKaraokeMicrophoneFailure(cause)
            return SubscriptionRef.update(stateRef, (latest) => ({
              ...latest,
              view: {
                ...latest.view,
                recordingRevision: latest.view.recordingRevision + 1,
                status: "error" as const,
                activeRecordingId: null,
                countInRemaining: 0,
                microphoneIssue: microphoneFailure.issue,
                message: microphoneFailure.message
              }
            })).pipe(
              Effect.flatMap(() =>
                Effect.fail(
                  failure(requestingView, microphoneFailure.issue, microphoneFailure.message, cause)
                )
              )
            )
          })
        )

        const chunks: Array<Blob> = []
        const mimeType = supportedMimeType()
        const recorder = yield* Effect.try({
          try: () => new MediaRecorder(stream, mimeType === undefined ? undefined : { mimeType }),
          catch: (cause) => cause
        }).pipe(
          Effect.catch((cause) => {
            for (const track of stream.getTracks()) track.stop()
            const message = "The browser could not initialize its microphone recorder."
            return SubscriptionRef.update(stateRef, (latest) => ({
              ...latest,
              view: {
                ...latest.view,
                recordingRevision: latest.view.recordingRevision + 1,
                status: "error" as const,
                activeRecordingId: null,
                countInRemaining: 0,
                microphoneIssue: "capture_failed" as const,
                message
              }
            })).pipe(
              Effect.flatMap(() => Effect.fail(failure(requestingView, "capture_failed", message, cause)))
            )
          })
        )
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        })

        const beatMilliseconds = 60_000 / bpm
        for (let remaining = internal.view.countInBeats; remaining > 0; remaining -= 1) {
          const latest = yield* SubscriptionRef.get(stateRef)
          const countInView: BrowserRecordingState = {
            ...latest.view,
            recordingRevision: latest.view.recordingRevision + 1,
            status: "counting_in",
            armedRecordingId: recordingId,
            activeRecordingId: recordingId,
            name,
            countInRemaining: remaining,
            microphoneIssue: null,
            message: `Count-in ${internal.view.countInBeats - remaining + 1} of ${internal.view.countInBeats}. The metronome continues into the take.`
          }
          yield* SubscriptionRef.set(stateRef, { ...latest, view: countInView })
          yield* Effect.promise(
            () => new Promise<void>((resolve) => window.setTimeout(resolve, beatMilliseconds))
          )
        }

        yield* Effect.try({
          try: () => recorder.start(250),
          catch: (cause) => cause
        }).pipe(
          Effect.catch((cause) => {
            for (const track of stream.getTracks()) track.stop()
            const message = "The browser could not start its microphone recorder."
            return SubscriptionRef.update(stateRef, (latest) => ({
              ...latest,
              view: {
                ...latest.view,
                recordingRevision: latest.view.recordingRevision + 1,
                status: "error" as const,
                activeRecordingId: null,
                countInRemaining: 0,
                microphoneIssue: "capture_failed" as const,
                message
              }
            })).pipe(
              Effect.flatMap(() => Effect.fail(failure(requestingView, "capture_failed", message, cause)))
            )
          })
        )
        activeCapture = { recordingId, name, recorder, stream, chunks, startedAt: Date.now() }
        const latest = yield* SubscriptionRef.get(stateRef)
        const recordingView: BrowserRecordingState = {
          ...latest.view,
          recordingRevision: latest.view.recordingRevision + 1,
          status: "recording",
          armedRecordingId: null,
          activeRecordingId: recordingId,
          name,
          countInRemaining: 0,
          microphoneIssue: null,
          message:
            "Recording in this page while the metronome continues. Stop from the visible controls or MCP; raw microphone audio is never returned to MCP."
        }
        yield* SubscriptionRef.set(stateRef, { ...latest, view: recordingView })
        return {
          change: "recording_started" as const,
          recordingId,
          recordingRevision: recordingView.recordingRevision,
          humanActionRequired: true as const
        }
      })

      const stop = Effect.fn("BrowserRecording.stop")(function* (options: BrowserRecordingOptions) {
        const fingerprint = JSON.stringify({
          action: "stop",
          expectedRecordingRevision: options.expectedRecordingRevision ?? null
        })
        const internal = yield* SubscriptionRef.get(stateRef)
        const prior = internal.seen.get(options.requestId)
        if (prior !== undefined) {
          if (prior.fingerprint !== fingerprint || prior.receipt.change !== "recording_stopped") {
            return yield* failure(
              internal.view,
              "request_id_conflict",
              `Request ID ${options.requestId} was already used for another recording mutation.`
            )
          }
          return { ...prior.receipt, idempotent: true }
        }
        if (stopInFlight !== null) {
          if (stopInFlight.requestId !== options.requestId) {
            return yield* failure(
              internal.view,
              "recording_stopping",
              "The active browser recording is already being finalized."
            )
          }
          return yield* Effect.tryPromise({
            try: () => stopInFlight!.promise,
            catch: (cause) =>
              cause instanceof BrowserRecordingError
                ? cause
                : failure(
                    internal.view,
                    "capture_failed",
                    "The browser could not finalize this recording.",
                    cause
                  )
          })
        }
        if (
          options.expectedRecordingRevision !== undefined &&
          options.expectedRecordingRevision !== internal.view.recordingRevision
        ) {
          return yield* failure(
            internal.view,
            "revision_conflict",
            `Expected recording revision ${options.expectedRecordingRevision}, but the current revision is ${internal.view.recordingRevision}.`
          )
        }
        if (activeCapture === null || internal.view.status !== "recording") {
          return yield* failure(
            internal.view,
            "human_action_required",
            "Nothing is recording. MCP may arm a take, but a person must press Start Recording on the visible page first."
          )
        }
        const capture = activeCapture
        const stoppingView: BrowserRecordingState = {
          ...internal.view,
          recordingRevision: internal.view.recordingRevision + 1,
          status: "stopping",
          countInRemaining: 0,
          message: "Finalizing the browser-local recording."
        }
        yield* SubscriptionRef.set(stateRef, { ...internal, view: stoppingView })

        const promise = (async () => {
          try {
            const blob = await stopCapture(capture)
            const durationSeconds = Math.max(0.05, (Date.now() - capture.startedAt) / 1_000)
            if (durationSeconds > maximumRecordingSeconds) {
              throw new Error(`Recordings are limited to ${maximumRecordingSeconds / 60} minutes.`)
            }
            if (blob.size < 1) throw new Error("The browser recorder produced an empty take.")
            if (blob.size > maximumRecordingBytes) {
              throw new Error("The browser recording exceeds the 64 MB page-local safety limit.")
            }
            const metadata: BrowserRecordingTake = {
              recordingId: capture.recordingId,
              name: capture.name,
              durationSeconds,
              byteLength: blob.size,
              mimeType: blob.type || "audio/webm",
              recordedAt: new Date().toISOString()
            }
            const { assetId } = registerBrowserRecordingAudio(blob)
            storedTakes.set(capture.recordingId, { blob })
            activeCapture = null
            const latest = await Effect.runPromise(SubscriptionRef.get(stateRef))
            const completeView: BrowserRecordingState = {
              ...latest.view,
              recordingRevision: latest.view.recordingRevision + 1,
              status: "complete",
              armedRecordingId: null,
              activeRecordingId: null,
              name: null,
              countInRemaining: 0,
              microphoneIssue: null,
              takes: [...latest.view.takes, metadata].slice(-8),
              message:
                "Take complete and available in this page. Share links omit the recording bytes and local audio asset."
            }
            const receipt: BrowserRecordingStopReceipt = {
              change: "recording_stopped",
              recordingId: capture.recordingId,
              recordingRevision: completeView.recordingRevision,
              idempotent: false,
              assetId,
              take: metadata
            }
            await Effect.runPromise(
              SubscriptionRef.set(stateRef, {
                view: completeView,
                seen: rememberMutation(latest.seen, options.requestId, { fingerprint, receipt })
              })
            )
            return receipt
          } catch (cause) {
            activeCapture = null
            const latest = await Effect.runPromise(SubscriptionRef.get(stateRef))
            const message =
              cause instanceof Error ? cause.message : "The browser could not finalize this recording."
            const errorView: BrowserRecordingState = {
              ...latest.view,
              recordingRevision: latest.view.recordingRevision + 1,
              status: "error",
              activeRecordingId: null,
              countInRemaining: 0,
              microphoneIssue: "capture_failed",
              message
            }
            await Effect.runPromise(SubscriptionRef.set(stateRef, { ...latest, view: errorView }))
            throw failure(errorView, "capture_failed", message, cause)
          }
        })()
        stopInFlight = { requestId: options.requestId, promise }
        void promise.then(
          () => {
            stopInFlight = null
          },
          () => {
            stopInFlight = null
          }
        )

        return yield* Effect.tryPromise({
          try: () => promise,
          catch: (cause) =>
            cause instanceof BrowserRecordingError
              ? cause
              : failure(
                  stoppingView,
                  "capture_failed",
                  "The browser could not finalize this recording.",
                  cause
                )
        })
      })

      const localTakeBlob = (recordingId: string) =>
        Effect.sync(() => storedTakes.get(recordingId)?.blob ?? null)

      return BrowserRecording.of({
        changes: SubscriptionRef.changes(stateRef).pipe(Stream.map((internal) => internal.view)),
        snapshot,
        arm,
        startFromHumanGesture,
        stop,
        localTakeBlob
      })
    })
  )
}

export const stopAndCommitBrowserRecording = (
  recordingOptions: BrowserRecordingOptions,
  projectOptions: StudioMutationOptions
): Effect.Effect<
  BrowserRecordingCommitReceipt,
  BrowserRecordingError | StudioRuleError,
  BrowserRecording | Studio
> =>
  Effect.gen(function* () {
    const recording = yield* BrowserRecording
    const studio = yield* Studio
    const recordingBefore = yield* recording.snapshot
    if (projectOptions.expectedRevision !== undefined && recordingBefore.status === "recording") {
      const project = yield* studio.snapshot
      if (project.revision !== projectOptions.expectedRevision) {
        return yield* new StudioRuleError({
          code: "revision_conflict",
          message: `Expected project revision ${projectOptions.expectedRevision}, but the current revision is ${project.revision}. The microphone is still recording.`,
          currentRevision: project.revision
        })
      }
    }
    const stopped = yield* recording.stop(recordingOptions)
    const commitOptions: StudioMutationOptions = {
      requestId: projectOptions.requestId,
      ...(projectOptions.actor === undefined ? {} : { actor: projectOptions.actor })
    }
    const project = yield* studio.addUploadedTrack(
      stopped.assetId,
      stopped.take.name,
      stopped.take.durationSeconds,
      commitOptions
    )
    return {
      change: "browser_recording_committed" as const,
      recording: stopped,
      projectRevision: project.revision,
      projectChange: project.change
    }
  })
