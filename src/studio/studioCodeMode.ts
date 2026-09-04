import {
  IframeSandboxExecutor,
  createBrowserCodeTool,
  type JsonSchemaExecutableToolDescriptors
} from "@cloudflare/codemode/browser"
import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { Studio, studioMidiView } from "./Studio.ts"
import { sessionInstrumentOutputSchema } from "./sessionInstrumentSchema.ts"
import { getStudioPresentationView, type StudioPresentationView } from "./studioPresentation.ts"

const MAX_CODE_CHARACTERS = 10_000
const MAX_RESULT_CHARACTERS = 2_500
const MAX_ERROR_CHARACTERS = 700

const studioPresentationOutputSchema: NonNullable<
  JsonSchemaExecutableToolDescriptors[string]["outputSchema"]
> = {
  type: "object",
  description:
    "A bounded semantic snapshot of the XState-managed Studio presentation; it excludes animation frames and raw audio.",
  properties: {
    schema_version: { type: "integer", enum: [2] },
    manager: { type: "string", enum: ["xstate-v5"] },
    phase: { type: "string", enum: ["settled", "announcing", "animating"] },
    reduced_motion: { type: "boolean" },
    surface: { type: "string", enum: ["unknown", "session", "karaoke", "tab", "studio"] },
    active_panel: { anyOf: [{ type: "string" }, { type: "null" }] },
    tools_ready: { type: "boolean" },
    transition: {
      anyOf: [
        {
          type: "object",
          properties: {
            id: { type: "string" },
            actor: { type: "string", enum: ["AGENT", "HUMAN", "ENGINE"] },
            action: { type: "string" },
            request_id: { type: "string" },
            revision_before: { type: "integer" },
            revision_after: { type: "integer" },
            targets: {
              type: "object",
              properties: {
                track_id: { type: "string" },
                clip_id: { type: "string" },
                preview_id: { type: "string" }
              },
              additionalProperties: false
            },
            duration_ms: { type: "integer" }
          },
          required: [
            "id",
            "actor",
            "action",
            "request_id",
            "revision_before",
            "revision_after",
            "targets",
            "duration_ms"
          ],
          additionalProperties: false
        },
        { type: "null" }
      ]
    },
    transport: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["stopped", "click_only", "counting_in", "playing", "paused"] },
        playhead_beat: { type: "number" },
        loop_enabled: { type: "boolean" },
        loop_start_beat: { type: "number" },
        loop_end_beat: { type: "number" }
      },
      required: ["status", "playhead_beat", "loop_enabled", "loop_start_beat", "loop_end_beat"],
      additionalProperties: false
    },
    engine: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["loading", "ready", "error"] },
        message: { anyOf: [{ type: "string" }, { type: "null" }] }
      },
      required: ["status", "message"],
      additionalProperties: false
    },
    operation: {
      type: "object",
      properties: {
        busy: { anyOf: [{ type: "string" }, { type: "null" }] },
        error: { anyOf: [{ type: "string" }, { type: "null" }] }
      },
      required: ["busy", "error"],
      additionalProperties: false
    },
    microphone: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["idle", "ready", "requesting", "listening", "scoring", "complete", "error"]
        },
        issue: {
          anyOf: [
            {
              type: "string",
              enum: [
                "no_input_device",
                "permission_denied",
                "device_busy",
                "unsupported_browser",
                "insecure_context",
                "capture_failed"
              ]
            },
            { type: "null" }
          ]
        }
      },
      required: ["status", "issue"],
      additionalProperties: false
    },
    lyrics: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["standby", "counting_in", "active", "complete"] },
        active_token_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        count_in_remaining: { anyOf: [{ type: "integer" }, { type: "null" }] }
      },
      required: ["status", "active_token_id", "count_in_remaining"],
      additionalProperties: false
    },
    session_instruments: sessionInstrumentOutputSchema
  },
  required: [
    "schema_version",
    "manager",
    "phase",
    "reduced_motion",
    "surface",
    "active_panel",
    "tools_ready",
    "transition",
    "transport",
    "engine",
    "operation",
    "microphone",
    "lyrics",
    "session_instruments"
  ],
  additionalProperties: false
}

const QueryStudioInput = Schema.Struct({
  code: Schema.String.check(Schema.isLengthBetween(1, MAX_CODE_CHARACTERS))
})

const studioMidiOutputSchema: NonNullable<JsonSchemaExecutableToolDescriptors[string]["outputSchema"]> = {
  type: "object",
  description: "One immutable revision of the complete canonical Signal Studio MIDI session.",
  properties: {
    schema_version: { type: "integer" },
    representation: { type: "string" },
    complete_session: { type: "boolean" },
    project_id: { type: "string" },
    title: { type: "string" },
    revision: { type: "integer" },
    tempo_map: {
      type: "array",
      items: {
        type: "object",
        properties: { beat: { type: "number" }, bpm: { type: "number" } },
        required: ["beat", "bpm"],
        additionalProperties: false
      }
    },
    meter_map: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat: { type: "number" },
          numerator: { type: "integer" },
          denominator: { type: "integer" }
        },
        required: ["beat", "numerator", "denominator"],
        additionalProperties: false
      }
    },
    timebase: { type: "string" },
    ppq: { type: "integer" },
    selection: {
      type: "object",
      properties: {
        start_beat: { type: "number" },
        end_beat: { type: "number" }
      },
      required: ["start_beat", "end_beat"],
      additionalProperties: false
    },
    session_end_beat: { type: "number" },
    summary: {
      type: "object",
      properties: {
        midi_track_count: { type: "integer" },
        midi_clip_count: { type: "integer" },
        note_count: { type: "integer" },
        referenced_audio_asset_count: { type: "integer" }
      },
      required: ["midi_track_count", "midi_clip_count", "note_count", "referenced_audio_asset_count"],
      additionalProperties: false
    },
    tracks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          track_id: { type: "string", description: "Stable track identifier." },
          order: { type: "integer" },
          name: { type: "string" },
          mix: {
            type: "object",
            properties: {
              volume: { type: "number" },
              pan: { type: "number" },
              muted: { type: "boolean" },
              soloed: { type: "boolean" }
            },
            required: ["volume", "pan", "muted", "soloed"],
            additionalProperties: false
          },
          clips: {
            type: "array",
            items: {
              type: "object",
              properties: {
                clip_id: { type: "string", description: "Stable clip identifier." },
                name: { type: "string" },
                start_beat: { type: "number" },
                duration_beats: { type: "number" },
                gain: { type: "number" },
                program: { type: "integer" },
                channel: { type: "integer" },
                notes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      note_id: { type: "string", description: "Stable note identifier." },
                      pitch: { type: "integer" },
                      pitch_name: { type: "string" },
                      start_beat: { type: "number" },
                      duration_beats: { type: "number" },
                      velocity: { type: "integer" }
                    },
                    required: ["note_id", "pitch", "pitch_name", "start_beat", "duration_beats", "velocity"],
                    additionalProperties: true
                  }
                }
              },
              required: [
                "clip_id",
                "name",
                "start_beat",
                "duration_beats",
                "gain",
                "program",
                "channel",
                "notes"
              ],
              additionalProperties: true
            }
          }
        },
        required: ["track_id", "order", "name", "mix", "clips"],
        additionalProperties: true
      }
    },
    pending_preview: {
      description:
        "The complete staged human-review checkpoint, or null. It may contain a MIDI transposition or timed karaoke guide.",
      anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
    },
    karaoke_guide: {
      description: "The active beat-timed lyric and expected-pitch guide, or null.",
      anyOf: [
        {
          type: "object",
          properties: {
            guide_id: { type: "string" },
            title: { type: "string" },
            melody_track_id: { type: "string" },
            melody_track_name: { type: "string" },
            start_beat: { type: "number" },
            end_beat: { type: "number" },
            tokens: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  token_id: { type: "string" },
                  text: { type: "string" },
                  start_beat: { type: "number" },
                  end_beat: { type: "number" },
                  expected_midi: { type: "integer" },
                  expected_pitch_name: { type: "string" }
                },
                required: [
                  "token_id",
                  "text",
                  "start_beat",
                  "end_beat",
                  "expected_midi",
                  "expected_pitch_name"
                ],
                additionalProperties: false
              }
            }
          },
          required: [
            "guide_id",
            "title",
            "melody_track_id",
            "melody_track_name",
            "start_beat",
            "end_beat",
            "tokens"
          ],
          additionalProperties: false
        },
        { type: "null" }
      ]
    },
    karaoke_count_in_beats: {
      type: "integer",
      enum: [4, 8, 12],
      description: "Instrumental lead-in before the active karaoke passage begins."
    },
    can_undo: { type: "boolean" },
    can_redo: { type: "boolean" },
    mutation_count: { type: "integer" }
  },
  required: [
    "schema_version",
    "representation",
    "complete_session",
    "project_id",
    "title",
    "revision",
    "tempo_map",
    "meter_map",
    "timebase",
    "ppq",
    "selection",
    "session_end_beat",
    "summary",
    "tracks",
    "pending_preview",
    "karaoke_guide",
    "karaoke_count_in_beats",
    "can_undo",
    "can_redo",
    "mutation_count"
  ],
  additionalProperties: true
}

const studioCodeModeDescription = `Run read-only JavaScript against one complete immutable Effect Studio state snapshot and one bounded XState presentation snapshot. The musical snapshot includes tempo and meter, selection, every MIDI note and track mix, staged previews, the active beat-timed karaoke guide and its 4/8/12-beat count-in, undo/redo availability, and mutation count. The presentation snapshot exposes the active surface, transport, engine, microphone, lyrics, busy/error state, the fixed Piano/Drums/Metronome Session projection, and the semantic phase of the latest human or agent mutation without animation frames or raw audio. Session instrument activity is derived from canonical track/clip IDs, mute/solo state, the current shared playhead, and shared-click state; it is not audio detection or another music model. Do not call the public get_studio_midi tool first; this tool reads the required live state internally so it never has to enter model context.

Available:
{{types}}

Prefer one JavaScript async arrow function. Start with:
async () => { const midi = await codemode.getStudioMidi({}); const ui = await codemode.getStudioPresentation({}); return SMALL_RESULT; }

For a short query, a normal body is also accepted and its final expression is returned automatically. Call each needed snapshot tool once, then filter, map, group, sort, or aggregate inside the program. Return only the small JSON-serializable result needed to answer the user. Never return or console.log the complete session. Use track_id, clip_id, and note_id values found in the snapshot; never invent IDs. This environment is read-only and cannot mutate the project, access the host Studio DOM, use storage, or make network requests.`

type StudioMidiDocument = ReturnType<typeof studioMidiView>

const makeStudioCodeMode = (
  getStudioMidi: () => Promise<StudioMidiDocument>,
  getStudioPresentation: () => Promise<StudioPresentationView>
) => {
  const tools = {
    getStudioMidi: {
      description:
        "Read the complete canonical Effect Studio session once, including musical state, mix, staged changes, and karaoke guide. Filter or aggregate it in this program and return only a small result.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      outputSchema: studioMidiOutputSchema,
      execute: async () => getStudioMidi()
    },
    getStudioPresentation: {
      description:
        "Read the bounded semantic XState presentation snapshot: current UI surface, transport, engine, operation, microphone, lyrics, fixed Session instrument activity/up-next projection, and mutation-animation phase. It contains no raw audio or frame stream.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      outputSchema: studioPresentationOutputSchema,
      execute: async () => getStudioPresentation()
    }
  } satisfies JsonSchemaExecutableToolDescriptors

  return createBrowserCodeTool({
    tools,
    executor: new IframeSandboxExecutor({ timeout: 5_000 }),
    description: studioCodeModeDescription
  })
}

const registrationDescriptor = makeStudioCodeMode(
  async () => {
    throw new Error("Registration metadata cannot read the Studio session.")
  },
  async () => {
    throw new Error("Registration metadata cannot read the Studio presentation.")
  }
)

const errorMessage = (cause: unknown): string => {
  const raw = cause instanceof Error ? cause.message : String(cause)
  const withoutLogs = raw.split("\n\nConsole output:", 1)[0] ?? raw
  return withoutLogs.slice(0, MAX_ERROR_CHARACTERS)
}

const codeHint = (message: string): string => {
  if (/get_studio_midi|getStudioMidi is not defined/.test(message)) {
    return "Use `const midi = await codemode.getStudioMidi({});` inside one async arrow function."
  }
  if (/await is only valid|Unexpected reserved word/.test(message)) {
    return "Wrap the program as `async () => { ... }` and await Studio methods."
  }
  return "Use one JavaScript async arrow function, await codemode.getStudioMidi({}), and explicitly return a small JSON value."
}

const boundedResult = (result: unknown, ignoredLogCount: number) => {
  if (result === undefined) {
    return {
      status: "invalid_result",
      error: "studio_query_returned_undefined",
      guidance: "Explicitly return a small JSON-serializable value from the async arrow function."
    }
  }

  let serialized: string
  try {
    serialized = JSON.stringify(result)
  } catch {
    return {
      status: "invalid_result",
      error: "studio_query_result_not_json_serializable",
      guidance: "Return only JSON-compatible objects, arrays, strings, numbers, booleans, or null."
    }
  }

  if (serialized === undefined) {
    return {
      status: "invalid_result",
      error: "studio_query_result_not_json_serializable",
      guidance: "Return only JSON-compatible objects, arrays, strings, numbers, booleans, or null."
    }
  }

  if (serialized.length > MAX_RESULT_CHARACTERS) {
    return {
      status: "result_too_large",
      error: "studio_query_result_too_large",
      actual_characters: serialized.length,
      maximum_characters: MAX_RESULT_CHARACTERS,
      guidance:
        "Run query_studio again and filter by track, clip, or beat range, or return an aggregate instead of notes or the complete session."
    }
  }

  return {
    status: "completed",
    result,
    serialized_characters: serialized.length,
    ...(ignoredLogCount === 0 ? {} : { ignored_console_message_count: ignoredLogCount })
  }
}

export const queryStudioTool: EffectTool<ToolInput, unknown, unknown, Studio> = {
  name: "query_studio",
  title: "Query the open Studio with code",
  description: registrationDescriptor.description,
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        minLength: 1,
        maxLength: MAX_CODE_CHARACTERS,
        description:
          "JavaScript that reads Studio through codemode.getStudioMidi({}) and returns a small JSON value; prefer an explicit async arrow function."
      }
    },
    required: ["code"],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  execute: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(QueryStudioInput)(input)
      const studio = yield* Studio
      const state = yield* studio.snapshot
      const midi = studioMidiView(state)
      const presentation = getStudioPresentationView()
      const codeMode = makeStudioCodeMode(
        async () => midi,
        async () => presentation
      )
      const attempted = yield* Effect.tryPromise({
        try: () => codeMode.execute({ code: decoded.code }),
        catch: errorMessage
      }).pipe(Effect.result)

      if (Result.isFailure(attempted)) {
        return {
          status: "execution_error",
          error: "studio_query_execution_failed",
          message: attempted.failure,
          guidance: codeHint(attempted.failure)
        }
      }

      return boundedResult(attempted.success.result, attempted.success.logs?.length ?? 0)
    })
}
