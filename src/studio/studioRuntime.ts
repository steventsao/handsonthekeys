import * as WebMcp from "@effect/platform-browser/WebMcp"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import { LocalModelContext } from "../LocalModelContext.ts"
import {
  InstrumentLearning,
  type InstrumentLearningMode,
  type InstrumentLearningOptions,
  type InstrumentLearningState,
  type InstrumentLessonConfiguration,
  type LearningMetronomeRamp,
  type InstrumentTabView,
  type LearningMetronomeController,
  type LearningTransportCommand,
  type LearningTransportController,
  type LearningTransportReceipt
} from "./InstrumentLearning.ts"
import {
  Studio,
  type StudioKaraokeCountInBeats,
  type StudioMutationOptions,
  type StudioState
} from "./Studio.ts"
import { practiceTools } from "./practiceTools.ts"
import { studioPracticeCodeModeTool } from "./studioPracticeCodeMode.ts"
import { studioTools as advancedStudioTools } from "./studioTools.ts"
import { presentStudioMutation } from "./studioPresentation.ts"
import {
  BrowserRecording,
  stopAndCommitBrowserRecording,
  type BrowserRecordingState
} from "./BrowserRecording.ts"
import {
  StudioShareApi,
  currentStudioShareId,
  type StudioShareLoadReceipt,
  type StudioShareReceipt
} from "./StudioShareApi.ts"

const documentWithModelContext = document as unknown as WebMcp.ModelContextDocument
const nativeModelContext = documentWithModelContext.modelContext
const localModelContext = new LocalModelContext()

export const studioModelContextMode =
  nativeModelContext?.executeTool === undefined ? "LOCAL EFFECT ADAPTER" : "NATIVE WEBMCP"
export const studioModelContext =
  nativeModelContext?.executeTool === undefined ? localModelContext : nativeModelContext
const publicStudioTools = [studioPracticeCodeModeTool] as const

export const studioToolCount = publicStudioTools.length

if (nativeModelContext === undefined) {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: studioModelContext
  })
}

const StudioLearningLayer = InstrumentLearning.layer.pipe(Layer.provideMerge(Studio.layer))
const StudioSharingLayer = StudioShareApi.layer.pipe(Layer.provideMerge(StudioLearningLayer))
const StudioServicesLayer = Layer.merge(StudioSharingLayer, BrowserRecording.layer)
const StudioLayer = Layer.merge(StudioServicesLayer, WebMcp.layerModelContext(studioModelContext))
const runtime = ManagedRuntime.make(StudioLayer)
const registrationReady = Effect.runSync(Deferred.make<void, WebMcp.WebMcpRegistrationError>())

const presentationProgram = Effect.flatMap(Studio, (studio) =>
  studio.mutationChanges.pipe(
    Stream.runForEach((mutation) => Effect.sync(() => presentStudioMutation(mutation)))
  )
)

runtime.runFork(presentationProgram)

const registrationProgram = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.all(
      publicStudioTools.map((tool) => WebMcp.registerTool(tool)),
      { discard: true }
    )
    yield* Deferred.succeed(registrationReady, undefined)
    yield* Effect.never
  })
).pipe(Effect.catch((error) => Deferred.fail(registrationReady, error).pipe(Effect.map(() => undefined))))

runtime.runFork(registrationProgram)

export const studioToolsReady = runtime.runPromise(Deferred.await(registrationReady))

export const subscribeStudio = (listener: (state: StudioState) => void): (() => void) => {
  const fiber = runtime.runFork(
    Effect.flatMap(Studio, (studio) =>
      studio.changes.pipe(Stream.runForEach((state) => Effect.sync(() => listener(state))))
    )
  )
  return () => {
    void Effect.runPromise(Fiber.interrupt(fiber))
  }
}

export const subscribeInstrumentLearning = (
  listener: (state: InstrumentLearningState) => void
): (() => void) => {
  const fiber = runtime.runFork(
    Effect.flatMap(InstrumentLearning, (learning) =>
      learning.changes.pipe(Stream.runForEach((state) => Effect.sync(() => listener(state))))
    )
  )
  return () => {
    void Effect.runPromise(Fiber.interrupt(fiber))
  }
}

export const subscribeBrowserRecording = (listener: (state: BrowserRecordingState) => void): (() => void) => {
  const fiber = runtime.runFork(
    Effect.flatMap(BrowserRecording, (recording) =>
      recording.changes.pipe(Stream.runForEach((state) => Effect.sync(() => listener(state))))
    )
  )
  return () => {
    void Effect.runPromise(Fiber.interrupt(fiber))
  }
}

export const subscribeStudioShare = (listener: (receipt: StudioShareReceipt) => void): (() => void) => {
  const fiber = runtime.runFork(
    Effect.flatMap(StudioShareApi, (shares) =>
      shares.changes.pipe(Stream.runForEach((receipt) => Effect.sync(() => listener(receipt))))
    )
  )
  return () => {
    void Effect.runPromise(Fiber.interrupt(fiber))
  }
}

const request = (prefix: string, expectedRevision?: number): StudioMutationOptions => ({
  requestId: `${prefix}-${crypto.randomUUID()}`,
  ...(expectedRevision === undefined ? {} : { expectedRevision }),
  actor: "HUMAN"
})

const learningRequest = (prefix: string, expectedLessonRevision?: number): InstrumentLearningOptions => ({
  requestId: `${prefix}-${crypto.randomUUID()}`,
  ...(expectedLessonRevision === undefined ? {} : { expectedLessonRevision })
})

export const getInstrumentLearningState = (): Promise<InstrumentLearningState> =>
  runtime.runPromise(Effect.flatMap(InstrumentLearning, (learning) => learning.snapshot))

export const getInstrumentTab = (): Promise<InstrumentTabView> =>
  runtime.runPromise(Effect.flatMap(InstrumentLearning, (learning) => learning.tab))

export const setInstrumentLearningMode = (
  mode: InstrumentLearningMode,
  expectedLessonRevision?: number
): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(InstrumentLearning, (learning) =>
      learning.setMode(mode, learningRequest("learning-mode", expectedLessonRevision))
    )
  )

export const configureInstrumentLesson = (
  configuration: InstrumentLessonConfiguration,
  expectedLessonRevision?: number
): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(InstrumentLearning, (learning) =>
      learning.configureLesson(configuration, learningRequest("configure-lesson", expectedLessonRevision))
    )
  )

export const setInstrumentLearningMetronome = (
  enabled: boolean,
  expectedLessonRevision?: number,
  ramp?: LearningMetronomeRamp | null
): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(InstrumentLearning, (learning) =>
      learning.setMetronome(enabled, learningRequest("learning-metronome", expectedLessonRevision), ramp)
    )
  )

export const attachLearningMetronome = async (
  controller: LearningMetronomeController
): Promise<() => void> => {
  await runtime.runPromise(
    Effect.flatMap(InstrumentLearning, (learning) => learning.attachMetronome(controller))
  )
  return () => {
    void runtime.runPromise(
      Effect.flatMap(InstrumentLearning, (learning) => learning.detachMetronome(controller))
    )
  }
}

export const attachLearningTransport = async (
  controller: LearningTransportController
): Promise<() => void> => {
  await runtime.runPromise(
    Effect.flatMap(InstrumentLearning, (learning) => learning.attachTransport(controller))
  )
  return () => {
    void runtime.runPromise(
      Effect.flatMap(InstrumentLearning, (learning) => learning.detachTransport(controller))
    )
  }
}

export const controlInstrumentLearningTransport = (
  command: LearningTransportCommand,
  expectedLessonRevision?: number
): Promise<LearningTransportReceipt> =>
  runtime.runPromise(
    Effect.flatMap(InstrumentLearning, (learning) =>
      learning.controlTransport(command, `learning-transport-${crypto.randomUUID()}`, expectedLessonRevision)
    )
  )

export const selectStudioTimeRange = (start: number, end: number): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.selectTimeRange(start, end, request("select")))
  )

export const stageStudioPart = (prompt: string, expectedRevision: number): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.stagePart(prompt, request("stage", expectedRevision)))
  )

export const stageStudioTransposition = (
  semitones: number,
  startBeat: number,
  endBeat: number,
  expectedRevision: number,
  trackIds?: ReadonlyArray<string>
): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) =>
      studio.stageMidiTransposition(
        {
          semitones,
          startBeat,
          endBeat,
          ...(trackIds === undefined ? {} : { trackIds })
        },
        request("transpose", expectedRevision)
      )
    )
  )

export const stageStudioKaraokeGuide = (
  lyrics: string,
  melodyTrackId: string,
  startBeat: number,
  endBeat: number,
  expectedRevision: number,
  title = "Browser Karaoke"
): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) =>
      studio.stageKaraokeGuide(
        { lyrics, melodyTrackId, startBeat, endBeat, title },
        request("karaoke", expectedRevision)
      )
    )
  )

export const applyStudioPreview = (previewId: string, expectedRevision: number): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.applyPreview(previewId, request("apply", expectedRevision)))
  )

export const discardStudioPreview = (previewId: string, expectedRevision: number): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.discardPreview(previewId, request("discard", expectedRevision)))
  )

export const setStudioKaraokeCountIn = (
  beats: StudioKaraokeCountInBeats,
  expectedRevision: number
): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.setKaraokeCountIn(beats, request("count-in", expectedRevision)))
  )

export const setStudioTempo = (bpm: number, expectedRevision: number): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.setTempo(bpm, request("tempo", expectedRevision)))
  )

export const setStudioTrackMix = (
  trackId: string,
  changes: {
    readonly volume?: number
    readonly pan?: number
    readonly muted?: boolean
    readonly soloed?: boolean
  }
): Promise<unknown> =>
  runtime.runPromise(Effect.flatMap(Studio, (studio) => studio.setTrackMix(trackId, changes, request("mix"))))

export const addStudioUpload = (assetId: string, name: string, duration: number): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.addUploadedTrack(assetId, name, duration, request("upload")))
  )

export const armBrowserRecording = (name: string, expectedRecordingRevision?: number): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(BrowserRecording, (recording) =>
      recording.arm(name, 4, {
        requestId: `recording-arm-${crypto.randomUUID()}`,
        ...(expectedRecordingRevision === undefined ? {} : { expectedRecordingRevision })
      })
    )
  )

export const startBrowserRecordingFromHumanGesture = (bpm: number): Promise<unknown> =>
  runtime.runPromise(Effect.flatMap(BrowserRecording, (recording) => recording.startFromHumanGesture(bpm)))

export const stopBrowserRecordingAndCommit = (expectedRecordingRevision: number): Promise<unknown> => {
  const requestId = `recording-stop-${crypto.randomUUID()}`
  return runtime.runPromise(
    stopAndCommitBrowserRecording(
      { requestId, expectedRecordingRevision },
      {
        requestId: `${requestId}:project`,
        actor: "HUMAN"
      }
    )
  )
}

export const getBrowserRecordingBlob = (recordingId: string): Promise<Blob | null> =>
  runtime.runPromise(Effect.flatMap(BrowserRecording, (recording) => recording.localTakeBlob(recordingId)))

export const createStudioShareLink = (expectedRevision: number): Promise<StudioShareReceipt> =>
  runtime.runPromise(
    Effect.flatMap(StudioShareApi, (shares) =>
      shares.create(`share-${crypto.randomUUID()}`, expectedRevision)
    )
  )

export const loadStudioShareFromLocation = async (): Promise<StudioShareLoadReceipt | null> => {
  const shareId = currentStudioShareId()
  if (shareId === null) return null
  return runtime.runPromise(
    Effect.flatMap(StudioShareApi, (shares) =>
      shares.load(shareId, {
        requestId: `load-${shareId}`,
        actor: "HUMAN"
      })
    )
  )
}

export const moveStudioClip = (
  trackId: string,
  clipId: string,
  start: number,
  duration: number
): Promise<unknown> =>
  runtime.runPromise(
    Effect.flatMap(Studio, (studio) => studio.moveClip(trackId, clipId, start, duration, request("clip")))
  )

export const undoStudioEdit = (expectedRevision: number): Promise<unknown> =>
  runtime.runPromise(Effect.flatMap(Studio, (studio) => studio.undo(request("undo", expectedRevision))))

export const redoStudioEdit = (expectedRevision: number): Promise<unknown> =>
  runtime.runPromise(Effect.flatMap(Studio, (studio) => studio.redo(request("redo", expectedRevision))))

export const resetStudio = (): Promise<void> =>
  runtime.runPromise(Effect.flatMap(Studio, (studio) => studio.reset))

export const executeStudioTool = async (name: string, input: WebMcp.ToolInput = {}): Promise<string> => {
  await studioToolsReady
  const tools = await runtime.runPromise(WebMcp.getTools())
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`WebMCP tool ${name} is not registered`)
  return runtime.runPromise(WebMcp.executeTool(tool, input))
}

const executeStudioInternalTool = async (name: string, input: WebMcp.ToolInput = {}): Promise<string> => {
  await studioToolsReady
  const tool = [studioPracticeCodeModeTool, ...practiceTools, ...advancedStudioTools].find(
    (candidate) => candidate.name === name
  )
  if (tool === undefined) throw new Error(`Studio tool ${name} does not exist`)
  const result = await runtime.runPromise(tool.execute(input))
  return typeof result === "string" ? result : JSON.stringify(result ?? null)
}

if (import.meta.env.DEV) {
  Object.defineProperty(window, "__signalStudioTest", {
    configurable: true,
    value: { executeTool: executeStudioInternalTool }
  })
}
