import type { StudioKaraokeGuide } from "./Studio.ts"
import {
  detectMonophonicPitch,
  scoreKaraokePerformance,
  type DetectedPitch,
  type KaraokePitchFrame,
  type KaraokeScore
} from "./karaoke.ts"

export type KaraokeSessionStatus = "idle" | "ready" | "listening" | "complete" | "error"
export type KaraokeMicrophoneIssue =
  | "no_input_device"
  | "permission_denied"
  | "device_busy"
  | "unsupported_browser"
  | "insecure_context"
  | "capture_failed"

export interface KaraokeMicrophoneFailure {
  readonly issue: KaraokeMicrophoneIssue
  readonly message: string
}

export class KaraokeMicrophoneError extends Error {
  readonly issue: KaraokeMicrophoneIssue

  constructor(failure: KaraokeMicrophoneFailure, options?: ErrorOptions) {
    super(failure.message, options)
    this.name = "KaraokeMicrophoneError"
    this.issue = failure.issue
  }
}

export interface KaraokeSessionView {
  readonly status: KaraokeSessionStatus
  readonly guideId: string | null
  readonly microphoneActive: boolean
  readonly microphoneIssue: KaraokeMicrophoneIssue | null
  readonly rawAudioShared: false
  readonly capturedPitchFrames: number
  readonly latestPitch: DetectedPitch | null
  readonly result: KaraokeScore | null
  readonly message: string
}

interface KaraokeCapture {
  readonly context: AudioContext
  readonly stream: MediaStream
  readonly timer: number
}

const idleView = (): KaraokeSessionView => ({
  status: "idle",
  guideId: null,
  microphoneActive: false,
  microphoneIssue: null,
  rawAudioShared: false,
  capturedPitchFrames: 0,
  latestPitch: null,
  result: null,
  message: "Apply a timed karaoke guide before starting the microphone."
})

let view = idleView()
let guide: StudioKaraokeGuide | null = null
let pitchFrames: Array<KaraokePitchFrame> = []
let capture: KaraokeCapture | null = null
const listeners = new Set<(next: KaraokeSessionView) => void>()

export const describeKaraokeMicrophoneFailure = (cause: unknown): KaraokeMicrophoneFailure => {
  const name = cause instanceof Error ? cause.name : ""
  const detail = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase()

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    detail.includes("requested device not found")
  ) {
    return {
      issue: "no_input_device",
      message:
        "No microphone was found. Connect or enable an input device, then try again. If this is an embedded preview, open Signal Karaoke in Chrome or Edge."
    }
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return {
      issue: "permission_denied",
      message:
        "Microphone access is blocked. Allow microphone permission for this site in the browser address bar, then try again."
    }
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return {
      issue: "device_busy",
      message:
        "The microphone exists but could not start. Close other apps using it, check the system input setting, then try again."
    }
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return {
      issue: "capture_failed",
      message:
        "The selected microphone cannot satisfy the browser's capture settings. Try another input device."
    }
  }
  return {
    issue: "capture_failed",
    message: "The microphone could not start. Check the browser and system input settings, then try again."
  }
}

const publish = (next: KaraokeSessionView) => {
  view = next
  for (const listener of listeners) listener(view)
}

const releaseCapture = async () => {
  if (capture === null) return
  window.clearInterval(capture.timer)
  for (const track of capture.stream.getTracks()) track.stop()
  await capture.context.close()
  capture = null
}

export const getKaraokeSessionView = (): KaraokeSessionView => view

export const subscribeKaraokeSession = (listener: (next: KaraokeSessionView) => void): (() => void) => {
  listeners.add(listener)
  listener(view)
  return () => listeners.delete(listener)
}

export const configureKaraokeSession = (nextGuide: StudioKaraokeGuide | null) => {
  if (capture !== null || guide?.id === nextGuide?.id) return
  guide = nextGuide
  pitchFrames = []
  publish(
    nextGuide === null
      ? idleView()
      : {
          status: "ready",
          guideId: nextGuide.id,
          microphoneActive: false,
          microphoneIssue: null,
          rawAudioShared: false,
          capturedPitchFrames: 0,
          latestPitch: null,
          result: null,
          message: "Ready. The microphone starts only when you press Start Singing."
        }
  )
}

export const startKaraokeMicrophone = async (
  activeGuide: StudioKaraokeGuide,
  currentBeat: () => number
): Promise<void> => {
  if (capture !== null) return
  if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia === undefined) {
    throw new KaraokeMicrophoneError({
      issue: "unsupported_browser",
      message: "This browser does not expose microphone capture. Open Signal Karaoke in Chrome or Edge."
    })
  }
  if (!globalThis.isSecureContext) {
    throw new KaraokeMicrophoneError({
      issue: "insecure_context",
      message: "Microphone capture requires HTTPS. Open the secure Signal Karaoke URL and try again."
    })
  }

  guide = activeGuide
  pitchFrames = []
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const [audioTrack] = stream.getAudioTracks()
    if (audioTrack === undefined) {
      throw new KaraokeMicrophoneError({
        issue: "no_input_device",
        message:
          "No microphone was found. Connect or enable an input device, then try again. If this is an embedded preview, open Signal Karaoke in Chrome or Edge."
      })
    }
    await audioTrack
      .applyConstraints({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      })
      .catch(() => undefined)

    context = new AudioContext({ latencyHint: "interactive" })
    await context.resume()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 4_096
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      const detected = detectMonophonicPitch(samples, context!.sampleRate)
      if (detected !== null) {
        pitchFrames.push({
          beat: currentBeat(),
          midiFloat: detected.midiFloat,
          confidence: detected.confidence
        })
        if (pitchFrames.length > 12_000) pitchFrames = pitchFrames.slice(-12_000)
      }
      publish({
        status: "listening",
        guideId: activeGuide.id,
        microphoneActive: true,
        microphoneIssue: null,
        rawAudioShared: false,
        capturedPitchFrames: pitchFrames.length,
        latestPitch: detected,
        result: null,
        message:
          detected === null
            ? "Listening locally. Sing a clear note to begin pitch tracking."
            : "Pitch detected locally. Raw microphone audio remains in this page."
      })
    }, 80)
    capture = { context, stream, timer }
    publish({
      status: "listening",
      guideId: activeGuide.id,
      microphoneActive: true,
      microphoneIssue: null,
      rawAudioShared: false,
      capturedPitchFrames: 0,
      latestPitch: null,
      result: null,
      message: "Listening locally. Raw microphone audio remains in this page."
    })
  } catch (cause) {
    for (const track of stream?.getTracks() ?? []) track.stop()
    if (context !== null) await context.close().catch(() => undefined)
    throw cause instanceof KaraokeMicrophoneError
      ? cause
      : new KaraokeMicrophoneError(describeKaraokeMicrophoneFailure(cause), { cause })
  }
}

export const stopKaraokeMicrophone = async (): Promise<void> => {
  await releaseCapture()
  const result = guide === null ? null : scoreKaraokePerformance(pitchFrames, guide.tokens)
  publish({
    status: "complete",
    guideId: guide?.id ?? null,
    microphoneActive: false,
    microphoneIssue: null,
    rawAudioShared: false,
    capturedPitchFrames: pitchFrames.length,
    latestPitch: view.latestPitch,
    result,
    message:
      result?.sufficientEvidence === true
        ? `Take complete with ${result.matchedFrames} matched pitch frames.`
        : "Take stopped. There was not enough confident, melody-aligned pitch evidence to score it."
  })
}

export const failKaraokeSession = async (cause: unknown): Promise<void> => {
  await releaseCapture()
  const failure =
    cause instanceof KaraokeMicrophoneError
      ? { issue: cause.issue, message: cause.message }
      : describeKaraokeMicrophoneFailure(cause)
  publish({
    status: "error",
    guideId: guide?.id ?? null,
    microphoneActive: false,
    microphoneIssue: failure.issue,
    rawAudioShared: false,
    capturedPitchFrames: pitchFrames.length,
    latestPitch: view.latestPitch,
    result: null,
    message: failure.message
  })
}
