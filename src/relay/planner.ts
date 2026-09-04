import type { Capability, Participant } from "./domain.ts"

export interface TaskBlueprint {
  readonly title: string
  readonly brief: string
  readonly capability: Capability
  readonly suggestedParticipantId: string | null
  readonly suggestionReason: string
}

const blueprints: ReadonlyArray<Omit<TaskBlueprint, "suggestedParticipantId" | "suggestionReason">> = [
  {
    title: "Name the signal",
    brief: "Write the short title that will anchor the center hexagon.",
    capability: "copy"
  },
  {
    title: "Tune the spectrum",
    brief: "Choose three accessible colors that express the room goal.",
    capability: "palette"
  },
  {
    title: "Cast the six symbols",
    brief: "Select six safe motifs for the outer cells of the poster.",
    capability: "iconography"
  }
]

export const planPosterTasks = (
  participants: ReadonlyArray<Pick<Participant, "id" | "name" | "capability" | "joinedAt">>
): ReadonlyArray<TaskBlueprint> => {
  const assigned = new Map<string, number>()

  return blueprints.map((blueprint) => {
    const candidates = [...participants]
      .filter((participant) => participant.capability === blueprint.capability)
      .sort((left, right) => {
        const loadDifference = (assigned.get(left.id) ?? 0) - (assigned.get(right.id) ?? 0)
        if (loadDifference !== 0) return loadDifference
        const timeDifference = left.joinedAt - right.joinedAt
        return timeDifference !== 0 ? timeDifference : left.id.localeCompare(right.id)
      })
    const selected = candidates[0]
    if (selected === undefined) {
      return {
        ...blueprint,
        suggestedParticipantId: null,
        suggestionReason: `UNASSIGNED · no ${blueprint.capability} cell is online`
      }
    }
    assigned.set(selected.id, (assigned.get(selected.id) ?? 0) + 1)
    return {
      ...blueprint,
      suggestedParticipantId: selected.id,
      suggestionReason: `MATCH: ${blueprint.capability.toUpperCase()} · ${selected.name}`
    }
  })
}
