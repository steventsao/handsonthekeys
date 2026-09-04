import {
  IframeSandboxExecutor,
  createBrowserCodeTool,
  type JsonSchemaExecutableToolDescriptors
} from "@cloudflare/codemode/browser"
import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { BrowserRecording } from "./BrowserRecording.ts"
import { InstrumentLearning } from "./InstrumentLearning.ts"
import { sessionInstrumentOutputSchema } from "./sessionInstrumentSchema.ts"
import type { SessionInstrumentView } from "./sessionInstrumentView.ts"
import { Studio, studioMidiView } from "./Studio.ts"
import { StudioShareApi } from "./StudioShareApi.ts"
import { practiceTools, practiceToolSchemas } from "./practiceTools.ts"
import { getStudioPresentationView } from "./studioPresentation.ts"

const maximumCodeCharacters = 8_000
const maximumResultCharacters = 1_000
const maximumErrorCharacters = 500

const CodeModeInput = Schema.Struct({
  code: Schema.String.check(Schema.isLengthBetween(1, maximumCodeCharacters))
})

type PracticeToolName =
  "set_metronome" | "add_drum_beat" | "control_transport" | "record_take" | "share_session"

type JsonSchema = JsonSchemaExecutableToolDescriptors[string]["inputSchema"]

interface PracticeSessionView {
  readonly project_revision: number
  readonly lesson_revision: number
  readonly recording_revision: number
  readonly mode: "session" | "tab" | "daw"
  readonly bpm: number
  readonly meter: { readonly numerator: number; readonly denominator: number }
  readonly metronome: {
    readonly enabled: boolean
    readonly ramp: null | { readonly bpm_step_per_bar: number; readonly bar_count: number }
  }
  readonly transport: {
    readonly loop_enabled: boolean
    readonly loop_start_beat: number
    readonly loop_end_beat: number
  }
  readonly recording: {
    readonly status: string
    readonly count_in_remaining: number
    readonly take_count: number
  }
  readonly summary: {
    readonly midi_track_count: number
    readonly note_count: number
    readonly local_audio_asset_count: number
  }
  readonly raw_audio_shared: false
}

const emptyInputSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
}

const sessionOutputSchema: NonNullable<JsonSchemaExecutableToolDescriptors[string]["outputSchema"]> = {
  type: "object",
  properties: {
    project_revision: { type: "integer" },
    lesson_revision: { type: "integer" },
    recording_revision: { type: "integer" },
    mode: { type: "string", enum: ["session", "tab", "daw"] },
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
    metronome: { type: "object", additionalProperties: true },
    transport: {
      type: "object",
      properties: {
        loop_enabled: { type: "boolean" },
        loop_start_beat: { type: "number" },
        loop_end_beat: { type: "number" }
      },
      required: ["loop_enabled", "loop_start_beat", "loop_end_beat"],
      additionalProperties: false
    },
    recording: { type: "object", additionalProperties: true },
    summary: { type: "object", additionalProperties: true },
    raw_audio_shared: { type: "boolean", const: false }
  },
  required: [
    "project_revision",
    "lesson_revision",
    "recording_revision",
    "mode",
    "bpm",
    "meter",
    "metronome",
    "transport",
    "recording",
    "summary",
    "raw_audio_shared"
  ],
  additionalProperties: false
}

const conciseDescription = `Sandboxed JS. Return an async arrow and await writes. Complete example—start a 120 BPM metronome, add four bars of original drums, then play:
async () => {
  const session = await codemode.getSession({})
  const metronome = await codemode.setMetronome({
    request_id: "practice-metronome-120",
    enabled: true,
    bpm: 120,
    expected_revision: session.project_revision,
    expected_lesson_revision: session.lesson_revision
  })
  const drums = await codemode.addDrumBeat({
    request_id: "practice-drums-4",
    bars: 4,
    expected_revision: metronome.project_revision
  })
  const playback = await codemode.controlTransport({
    request_id: "practice-play",
    action: "play",
    expected_lesson_revision: drums.lesson_revision
  })
  return {
    bpm: metronome.base_bpm,
    drum_track_id: drums.track_id,
    transport_status: playback.status
  }
}
Use a fresh request_id for each new mutation. Other calls: codemode.getInstruments({}), codemode.recordTake(...), and codemode.shareSession(...). Transport actions: play|pause|stop|seek|play_range|set_loop. Browser audio or recording may require the visible Start/Play control. Raw audio is never returned or shared.`

const makePracticeCodeMode = (options: {
  readonly getSession: () => Promise<PracticeSessionView>
  readonly getInstruments: () => Promise<SessionInstrumentView | null>
  readonly execute: (name: PracticeToolName, input: Record<string, unknown>) => Promise<unknown>
}) => {
  const tools = {
    getSession: {
      description:
        "Read bounded tempo, mode, metronome, loop, recording, and track-count state. No audio bytes are returned.",
      inputSchema: emptyInputSchema,
      outputSchema: sessionOutputSchema,
      execute: async () => options.getSession()
    },
    getInstruments: {
      description:
        "Read the fixed Piano, Drums, and Metronome rack derived from canonical MIDI and the shared transport.",
      inputSchema: emptyInputSchema,
      outputSchema: sessionInstrumentOutputSchema,
      execute: async () => options.getInstruments()
    },
    setMetronome: {
      description:
        "Set 40–240 BPM, start or stop the page metronome, and optionally apply a signed per-bar BPM step.",
      inputSchema: practiceToolSchemas.setMetronome as unknown as JsonSchema,
      execute: async (input: Record<string, unknown>) => options.execute("set_metronome", input)
    },
    addDrumBeat: {
      description: "Add 1–16 bars of an original straight-eighth MIDI drum beat and show it in Studio.",
      inputSchema: practiceToolSchemas.addDrumBeat as unknown as JsonSchema,
      execute: async (input: Record<string, unknown>) => options.execute("add_drum_beat", input)
    },
    controlTransport: {
      description:
        "Play, pause, stop, seek, play a range, or set a beat loop on the shared browser Studio engine.",
      inputSchema: practiceToolSchemas.controlTransport as unknown as JsonSchema,
      execute: async (input: Record<string, unknown>) => options.execute("control_transport", input)
    },
    recordTake: {
      description:
        "Prepare a visible human-started recording with a metronome count-in, or stop and add the active local take.",
      inputSchema: practiceToolSchemas.recordTake as unknown as JsonSchema,
      execute: async (input: Record<string, unknown>) => options.execute("record_take", input)
    },
    shareSession: {
      description: "Create a 30-day MIDI session link. Local microphone and uploaded audio are omitted.",
      inputSchema: practiceToolSchemas.shareSession as unknown as JsonSchema,
      execute: async (input: Record<string, unknown>) => options.execute("share_session", input)
    }
  } satisfies JsonSchemaExecutableToolDescriptors

  return createBrowserCodeTool({
    tools,
    executor: new IframeSandboxExecutor({ timeout: 10_000 }),
    description: conciseDescription
  })
}

const registrationDescriptor = makePracticeCodeMode({
  getSession: async () => {
    throw new Error("Registration metadata cannot read the lesson.")
  },
  getInstruments: async () => {
    throw new Error("Registration metadata cannot read the instrument rack.")
  },
  execute: async () => {
    throw new Error("Registration metadata cannot change the lesson.")
  }
})

const messageOf = (cause: unknown): string => {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return (raw.split("\n\nConsole output:", 1)[0] ?? raw).slice(0, maximumErrorCharacters)
}

const boundedResult = (value: unknown, ignoredLogCount: number) => {
  if (value === undefined) {
    return {
      status: "invalid_result",
      error: "codemode_returned_undefined",
      guidance: "Return a small JSON value from the async arrow function."
    }
  }

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return {
      status: "invalid_result",
      error: "codemode_result_not_json",
      guidance: "Return only JSON-compatible data."
    }
  }

  if (serialized === undefined || serialized.length > maximumResultCharacters) {
    return {
      status: "result_too_large",
      error: "codemode_result_over_budget",
      maximum_characters: maximumResultCharacters,
      guidance: "Return one action receipt or a small summary instead of full session data."
    }
  }

  return {
    status: "completed",
    result: value,
    serialized_characters: serialized.length,
    ...(ignoredLogCount === 0 ? {} : { ignored_console_message_count: ignoredLogCount })
  }
}

export const studioPracticeCodeModeTool: EffectTool<
  ToolInput,
  unknown,
  unknown,
  Studio | InstrumentLearning | BrowserRecording | StudioShareApi
> = {
  name: "codemode",
  title: "Use Studio with Code Mode",
  description: registrationDescriptor.description,
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        minLength: 1,
        maxLength: maximumCodeCharacters,
        description:
          "A JavaScript async arrow function that calls the listed codemode methods and returns a small JSON result."
      }
    },
    required: ["code"],
    additionalProperties: false
  },
  execute: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CodeModeInput)(input)
      const studio = yield* Studio
      const learning = yield* InstrumentLearning
      const recording = yield* BrowserRecording
      const shares = yield* StudioShareApi

      const provideServices = <A, E>(
        effect: Effect.Effect<A, E, Studio | InstrumentLearning | BrowserRecording | StudioShareApi>
      ) =>
        effect.pipe(
          Effect.provideService(Studio, studio),
          Effect.provideService(InstrumentLearning, learning),
          Effect.provideService(BrowserRecording, recording),
          Effect.provideService(StudioShareApi, shares)
        )

      const codeMode = makePracticeCodeMode({
        getSession: async () => {
          const [project, lesson, recordingState] = await Effect.runPromise(
            Effect.all([studio.snapshot, learning.snapshot, recording.snapshot])
          )
          const midi = studioMidiView(project)
          return {
            project_revision: project.revision,
            lesson_revision: lesson.lessonRevision,
            recording_revision: recordingState.recordingRevision,
            mode: lesson.mode,
            bpm: project.bpm,
            meter: {
              numerator: project.timeSignature[0],
              denominator: project.timeSignature[1]
            },
            metronome: {
              enabled: lesson.metronomeEnabled,
              ramp:
                lesson.metronomeRamp === null
                  ? null
                  : {
                      bpm_step_per_bar: lesson.metronomeRamp.bpmPerBar,
                      bar_count: lesson.metronomeRamp.barCount
                    }
            },
            transport: {
              loop_enabled: lesson.transportLoop.enabled,
              loop_start_beat: lesson.transportLoop.startBeat,
              loop_end_beat: lesson.transportLoop.endBeat
            },
            recording: {
              status: recordingState.status,
              count_in_remaining: recordingState.countInRemaining,
              take_count: recordingState.takes.length
            },
            summary: {
              midi_track_count: midi.summary.midi_track_count,
              note_count: midi.summary.note_count,
              local_audio_asset_count: midi.summary.referenced_audio_asset_count
            },
            raw_audio_shared: false
          }
        },
        getInstruments: async () => getStudioPresentationView().session_instruments,
        execute: async (name, toolInput) => {
          const tool = practiceTools.find((candidate) => candidate.name === name)
          if (tool === undefined) throw new Error(`Unknown lesson action ${name}.`)
          return Effect.runPromise(provideServices(tool.execute(toolInput)))
        }
      })

      const attempted = yield* Effect.tryPromise({
        try: () => codeMode.execute({ code: decoded.code }),
        catch: messageOf
      }).pipe(Effect.result)

      if (Result.isFailure(attempted)) {
        return {
          status: "execution_error",
          error: "codemode_execution_failed",
          message: attempted.failure,
          guidance:
            "Use one JavaScript async arrow function, await the listed codemode methods, and return a small result."
        }
      }

      return boundedResult(attempted.success.result, attempted.success.logs?.length ?? 0)
    })
}
