import type { JsonSchemaExecutableToolDescriptors } from "@cloudflare/codemode/browser"

type OutputSchema = NonNullable<JsonSchemaExecutableToolDescriptors[string]["outputSchema"]>

const sessionSegmentOutputSchema: OutputSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        track_id: { type: "string", description: "Stable canonical track identifier." },
        track_name: { type: "string" },
        clip_id: { type: "string", description: "Stable canonical clip identifier." },
        clip_name: { type: "string" },
        start_beat: { type: "number" },
        end_beat: { type: "number" },
        muted: { type: "boolean" },
        audible_when_transport_runs: { type: "boolean" }
      },
      required: [
        "track_id",
        "track_name",
        "clip_id",
        "clip_name",
        "start_beat",
        "end_beat",
        "muted",
        "audible_when_transport_runs"
      ],
      additionalProperties: false
    },
    { type: "null" }
  ]
}

export const sessionInstrumentOutputSchema: OutputSchema = {
  anyOf: [
    {
      type: "object",
      description:
        "A three-tile Session projection derived from canonical MIDI segments, track mix, and the shared Studio transport.",
      properties: {
        representation: { type: "string", enum: ["derived_session_instrument_projection"] },
        project_id: { type: "string" },
        project_revision: { type: "integer" },
        playhead_beat: { type: "number" },
        transport: {
          type: "object",
          properties: {
            musical_playback_running: { type: "boolean" },
            shared_click_enabled: { type: "boolean" },
            shared_click_running: { type: "boolean" }
          },
          required: ["musical_playback_running", "shared_click_enabled", "shared_click_running"],
          additionalProperties: false
        },
        instruments: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              instrument_id: { type: "string", enum: ["piano", "drums", "metronome"] },
              label: { type: "string", enum: ["Piano", "Drums", "Metronome"] },
              authority: { type: "string", enum: ["canonical_midi", "shared_daw_transport"] },
              activity: {
                type: "string",
                enum: ["playing_now", "muted", "ready", "idle", "silent"]
              },
              available: { type: "boolean" },
              enabled: { type: "boolean" },
              playing_now: { type: "boolean" },
              muted: { type: "boolean" },
              idle_no_current_segment: { type: "boolean" },
              mapped_track_count: { type: "integer" },
              current_segment: sessionSegmentOutputSchema,
              next_segment: sessionSegmentOutputSchema
            },
            required: [
              "instrument_id",
              "label",
              "authority",
              "activity",
              "available",
              "enabled",
              "playing_now",
              "muted",
              "idle_no_current_segment",
              "mapped_track_count",
              "current_segment",
              "next_segment"
            ],
            additionalProperties: false
          }
        }
      },
      required: [
        "representation",
        "project_id",
        "project_revision",
        "playhead_beat",
        "transport",
        "instruments"
      ],
      additionalProperties: false
    },
    { type: "null" }
  ]
}
