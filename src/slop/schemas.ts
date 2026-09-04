import * as Schema from "effect/Schema"

export const runStatuses = ["queued", "generating", "succeeded", "failed"] as const

export const VisualOutputSchema = Schema.Struct({
  kind: Schema.Literals(["video", "procedural"]),
  url: Schema.NullOr(Schema.String),
  posterUrl: Schema.NullOr(Schema.String),
  palette: Schema.Array(Schema.String),
  seed: Schema.Number,
  title: Schema.String
})

export const SteeringEventSchema = Schema.Struct({
  id: Schema.String,
  instruction: Schema.String,
  revision: Schema.Number,
  created_at: Schema.String
})

export const PublicRunSchema = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  status: Schema.Literals(runStatuses),
  revision: Schema.Number,
  position: Schema.NullOr(Schema.Number),
  progress: Schema.Number,
  output: Schema.NullOr(VisualOutputSchema),
  error: Schema.NullOr(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String
    })
  ),
  steering: Schema.Array(SteeringEventSchema),
  created_at: Schema.String,
  updated_at: Schema.String
})

export const ChannelSnapshotSchema = Schema.Struct({
  generated_at: Schema.String,
  now_playing: Schema.NullOr(PublicRunSchema),
  generating: Schema.NullOr(PublicRunSchema),
  playing_next: Schema.NullOr(PublicRunSchema),
  queue: Schema.Array(PublicRunSchema),
  recent: Schema.Array(PublicRunSchema),
  all_runs: Schema.Array(PublicRunSchema)
})

export const QueueResultSchema = Schema.Struct({
  run: PublicRunSchema,
  idempotent: Schema.Boolean,
  visual_result: Schema.Struct({
    mode: Schema.Literal("on_page_card"),
    message: Schema.String
  })
})

export const BatchQueueResultSchema = Schema.Struct({
  runs: Schema.Array(PublicRunSchema),
  idempotent: Schema.Array(Schema.Boolean),
  visual_result: Schema.Struct({
    mode: Schema.Literal("on_page_cards"),
    message: Schema.String
  })
})

export const StatusResultSchema = Schema.Struct({
  run: PublicRunSchema,
  visual_result: Schema.Struct({
    mode: Schema.Literal("on_page_card"),
    message: Schema.String
  })
})

export const SteerResultSchema = Schema.Struct({
  run: PublicRunSchema,
  steering: SteeringEventSchema,
  idempotent: Schema.Boolean,
  visual_result: Schema.Struct({
    mode: Schema.Literal("on_page_card"),
    message: Schema.String
  })
})

export const QueuePromptInputSchema = Schema.Struct({
  prompt: Schema.String,
  client_request_id: Schema.String
})

export const GetStatusInputSchema = Schema.Struct({
  run_id: Schema.String
})

export const BatchQueueInputSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      prompt: Schema.String,
      client_request_id: Schema.String
    })
  )
})

export const SteerPromptInputSchema = Schema.Struct({
  run_id: Schema.String,
  instruction: Schema.String,
  expected_revision: Schema.Number,
  client_request_id: Schema.String
})

export const jsonSchema = (schema: Schema.Top) => Schema.toJsonSchemaDocument(schema) as object
