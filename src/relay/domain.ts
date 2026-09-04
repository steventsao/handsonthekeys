import * as Schema from "effect/Schema"

export const Capability = Schema.Literals(["copy", "palette", "iconography"])
export type Capability = typeof Capability.Type

export const ParticipantRole = Schema.Literals(["lead", "member"])
export type ParticipantRole = typeof ParticipantRole.Type

export const ParticipantKind = Schema.Literals(["human", "agent"])
export type ParticipantKind = typeof ParticipantKind.Type

export const ParticipantRuntimeState = Schema.Literals(["offline", "idle", "working", "blocked", "done"])
export type ParticipantRuntimeState = typeof ParticipantRuntimeState.Type

export const RoomPhase = Schema.Literals(["forming", "running", "completed"])
export type RoomPhase = typeof RoomPhase.Type

export const TaskStatus = Schema.Literals(["offered", "working", "submitted", "accepted"])
export type TaskStatus = typeof TaskStatus.Type

export const EventKind = Schema.Literals([
  "room_created",
  "cell_joined",
  "plan_created",
  "task_claimed",
  "task_submitted",
  "task_accepted",
  "task_reopened",
  "room_completed"
])
export type EventKind = typeof EventKind.Type

export const Motif = Schema.Literals([
  "arch",
  "bolt",
  "eye",
  "flower",
  "heart",
  "leaf",
  "moon",
  "mountain",
  "spark",
  "star",
  "sun",
  "wave"
])
export type Motif = typeof Motif.Type

export const DisplayName = Schema.Trim.check(Schema.isLengthBetween(2, 32))
export const Goal = Schema.Trim.check(Schema.isLengthBetween(8, 180))
export const CopyTitle = Schema.Trim.check(Schema.isLengthBetween(3, 42))
export const HexColor = Schema.String.check(
  Schema.isPattern(/^#[0-9a-fA-F]{6}$/),
  Schema.isLengthBetween(7, 7)
)

export const CopyOutput = Schema.Struct({
  kind: Schema.Literal("copy"),
  title: CopyTitle
})

export const PaletteOutput = Schema.Struct({
  kind: Schema.Literal("palette"),
  colors: Schema.Array(HexColor).check(Schema.isLengthBetween(3, 3))
})

export const IconographyOutput = Schema.Struct({
  kind: Schema.Literal("iconography"),
  motifs: Schema.Array(Motif).check(Schema.isLengthBetween(6, 6))
})

export const TaskOutput = Schema.Union([CopyOutput, PaletteOutput, IconographyOutput])
export type TaskOutput = typeof TaskOutput.Type

export const Participant = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: ParticipantKind,
  role: ParticipantRole,
  capability: Capability,
  inputInterface: Schema.String,
  outputInterface: Schema.String,
  runtimeState: ParticipantRuntimeState,
  joinedAt: Schema.Int,
  lastSeenAt: Schema.Int
})
export type Participant = typeof Participant.Type

export const RelayTask = Schema.Struct({
  id: Schema.String,
  position: Schema.Int,
  title: Schema.String,
  brief: Schema.String,
  capability: Capability,
  status: TaskStatus,
  suggestedParticipantId: Schema.NullOr(Schema.String),
  suggestionReason: Schema.String,
  claimedByParticipantId: Schema.NullOr(Schema.String),
  output: Schema.NullOr(TaskOutput),
  createdAt: Schema.Int,
  updatedAt: Schema.Int
})
export type RelayTask = typeof RelayTask.Type

export const RoomEvent = Schema.Struct({
  id: Schema.String,
  revision: Schema.Int,
  kind: EventKind,
  actorId: Schema.NullOr(Schema.String),
  message: Schema.String,
  createdAt: Schema.Int
})
export type RoomEvent = typeof RoomEvent.Type

export const RelayRoom = Schema.Struct({
  id: Schema.String,
  goal: Schema.String,
  phase: RoomPhase,
  revision: Schema.Int,
  createdAt: Schema.Int,
  updatedAt: Schema.Int
})
export type RelayRoom = typeof RelayRoom.Type

export const RoomSnapshot = Schema.Struct({
  room: RelayRoom,
  participants: Schema.Array(Participant),
  tasks: Schema.Array(RelayTask),
  events: Schema.Array(RoomEvent)
})
export type RoomSnapshot = typeof RoomSnapshot.Type

export const CreateRoomInput = Schema.Struct({
  goal: Goal,
  name: DisplayName,
  kind: ParticipantKind,
  capability: Capability
})
export type CreateRoomInput = typeof CreateRoomInput.Type

export const JoinRoomInput = Schema.Struct({
  name: DisplayName,
  kind: ParticipantKind,
  capability: Capability
})
export type JoinRoomInput = typeof JoinRoomInput.Type

export const SubmitTaskInput = Schema.Struct({
  output: TaskOutput
})
export type SubmitTaskInput = typeof SubmitTaskInput.Type

export const ReviewTaskInput = Schema.Struct({
  decision: Schema.Literals(["accept", "reopen"])
})
export type ReviewTaskInput = typeof ReviewTaskInput.Type

export const CreateRoomResponse = Schema.Struct({
  ok: Schema.Literal(true),
  room: RoomSnapshot,
  actorToken: Schema.String,
  actorId: Schema.String
})

export const JoinRoomResponse = Schema.Struct({
  ok: Schema.Literal(true),
  room: RoomSnapshot,
  actorToken: Schema.String,
  actorId: Schema.String
})

export const RoomResponse = Schema.Struct({
  ok: Schema.Literal(true),
  room: RoomSnapshot
})

export const capabilityInterfaces: Readonly<
  Record<Capability, { readonly input: string; readonly output: string }>
> = {
  copy: {
    input: "Room goal and accepted creative direction",
    output: "One poster title, 3–42 characters"
  },
  palette: {
    input: "Room goal and desired mood",
    output: "Exactly three six-digit hex colors"
  },
  iconography: {
    input: "Room goal and the shared motif vocabulary",
    output: "Exactly six safe motif identifiers"
  }
}

export const motifValues: ReadonlyArray<Motif> = [
  "arch",
  "bolt",
  "eye",
  "flower",
  "heart",
  "leaf",
  "moon",
  "mountain",
  "spark",
  "star",
  "sun",
  "wave"
]
