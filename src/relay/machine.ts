import type { RoomPhase, TaskStatus } from "./domain.ts"

export const roomStateGraph: Readonly<Record<RoomPhase, ReadonlyArray<RoomPhase>>> = {
  forming: ["running"],
  running: ["completed"],
  completed: []
}

export const taskStateGraph: Readonly<Record<TaskStatus, ReadonlyArray<TaskStatus>>> = {
  offered: ["working"],
  working: ["submitted"],
  submitted: ["accepted", "offered"],
  accepted: []
}

export const canMoveRoom = (from: RoomPhase, to: RoomPhase): boolean => roomStateGraph[from].includes(to)

export const canMoveTask = (from: TaskStatus, to: TaskStatus): boolean => taskStateGraph[from].includes(to)

export const roomStateOrder: ReadonlyArray<RoomPhase> = ["forming", "running", "completed"]
export const taskStateOrder: ReadonlyArray<TaskStatus> = ["offered", "working", "submitted", "accepted"]
