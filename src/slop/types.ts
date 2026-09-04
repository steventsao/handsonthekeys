import { runStatuses } from "./schemas.ts"
import type {
  BatchQueueResultSchema,
  ChannelSnapshotSchema,
  PublicRunSchema,
  QueueResultSchema,
  StatusResultSchema,
  SteeringEventSchema,
  SteerResultSchema,
  VisualOutputSchema
} from "./schemas.ts"

export { runStatuses }
export type RunStatus = (typeof runStatuses)[number]

export type VisualOutput = typeof VisualOutputSchema.Type
export type SteeringEvent = typeof SteeringEventSchema.Type
export type PublicRun = typeof PublicRunSchema.Type
export type ChannelSnapshot = typeof ChannelSnapshotSchema.Type
export type QueueResult = typeof QueueResultSchema.Type
export type BatchQueueResult = typeof BatchQueueResultSchema.Type
export type StatusResult = typeof StatusResultSchema.Type
export type SteerResult = typeof SteerResultSchema.Type

export interface ToolActivity {
  readonly id: string
  readonly tool: "queue_prompt" | "get_status" | "batch_queue" | "steer_prompt"
  readonly title: string
  readonly detail: string
  readonly status: RunStatus | "complete" | "error"
  readonly runIds: ReadonlyArray<string>
  readonly at: string
}
