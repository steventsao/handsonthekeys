import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { TaskOutput, type Participant } from "../src/relay/domain.ts"
import { canMoveRoom, canMoveTask } from "../src/relay/machine.ts"
import { planPosterTasks } from "../src/relay/planner.ts"

const participant = (
  id: string,
  name: string,
  capability: Participant["capability"],
  joinedAt: number
): Participant => ({
  id,
  name,
  capability,
  joinedAt,
  kind: "agent",
  role: "member",
  inputInterface: "goal",
  outputInterface: "typed output",
  runtimeState: "idle",
  lastSeenAt: joinedAt
})

describe("Hex Relay state graphs", () => {
  it("allows only the declared room transitions", () => {
    expect(canMoveRoom("forming", "running")).toBe(true)
    expect(canMoveRoom("running", "completed")).toBe(true)
    expect(canMoveRoom("forming", "completed")).toBe(false)
    expect(canMoveRoom("completed", "running")).toBe(false)
  })

  it("reopens only submitted work", () => {
    expect(canMoveTask("submitted", "offered")).toBe(true)
    expect(canMoveTask("working", "offered")).toBe(false)
    expect(canMoveTask("accepted", "offered")).toBe(false)
  })
})

describe("Hex Relay deterministic planner", () => {
  it("matches every known poster piece to an offered interface", () => {
    const tasks = planPosterTasks([
      participant("copy", "Copy Cell", "copy", 1),
      participant("palette", "Palette Cell", "palette", 2),
      participant("icons", "Icon Cell", "iconography", 3)
    ])
    expect(tasks.map((task) => task.suggestedParticipantId)).toEqual(["copy", "palette", "icons"])
    expect(tasks.map((task) => task.capability)).toEqual(["copy", "palette", "iconography"])
  })

  it("leaves a missing capability visibly unassigned", () => {
    const tasks = planPosterTasks([participant("copy", "Copy Cell", "copy", 1)])
    expect(tasks[0]?.suggestedParticipantId).toBe("copy")
    expect(tasks[1]?.suggestedParticipantId).toBeNull()
    expect(tasks[2]?.suggestionReason).toContain("UNASSIGNED")
  })

  it("uses stable joined order when equally capable cells compete", () => {
    const tasks = planPosterTasks([
      participant("later", "Later Cell", "copy", 20),
      participant("earlier", "Earlier Cell", "copy", 10)
    ])
    expect(tasks[0]?.suggestedParticipantId).toBe("earlier")
  })
})

describe("Hex Relay typed output boundary", () => {
  it("accepts exactly three six-digit colors", () => {
    const decode = Schema.decodeUnknownSync(TaskOutput)
    expect(decode({ kind: "palette", colors: ["#ffcc00", "#123456", "#abcdef"] })).toEqual({
      kind: "palette",
      colors: ["#ffcc00", "#123456", "#abcdef"]
    })
    expect(() => decode({ kind: "palette", colors: ["red"] })).toThrow()
  })

  it("rejects motif vocabulary drift", () => {
    const decode = Schema.decodeUnknownSync(TaskOutput)
    expect(() =>
      decode({
        kind: "iconography",
        motifs: ["moon", "spark", "wave", "leaf", "arch", "not-safe"]
      })
    ).toThrow()
  })
})
