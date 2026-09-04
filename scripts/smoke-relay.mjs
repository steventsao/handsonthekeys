const baseUrl = (process.env.RELAY_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "")

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, options)
  const value = await response.json()
  if (!response.ok) {
    throw new Error(`${response.status} ${value?.error?.code ?? "REQUEST_FAILED"}: ${value?.error?.message}`)
  }
  return value
}

const post = (path, body, token) =>
  request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
    },
    body: JSON.stringify(body)
  })

const created = await post("/api/relay/rooms", {
  goal: "Design a seven-cell poster for a neighborhood moonlight picnic",
  name: "Lead Cell",
  kind: "agent",
  capability: "copy"
})

const roomId = created.room.room.id
const leadToken = created.actorToken

const palette = await post(`/api/relay/rooms/${roomId}/join`, {
  name: "Palette Cell",
  kind: "agent",
  capability: "palette"
})

const iconography = await post(`/api/relay/rooms/${roomId}/join`, {
  name: "Icon Cell",
  kind: "agent",
  capability: "iconography"
})

const forbidden = await fetch(`${baseUrl}/api/relay/rooms/${roomId}/plan`, {
  method: "POST",
  headers: { authorization: `Bearer ${palette.actorToken}`, "content-type": "application/json" },
  body: "{}"
})
if (forbidden.status !== 403) throw new Error(`Member plan expected 403, received ${forbidden.status}`)

let snapshot = (await post(`/api/relay/rooms/${roomId}/plan`, {}, leadToken)).room
const tokenByCapability = {
  copy: leadToken,
  palette: palette.actorToken,
  iconography: iconography.actorToken
}
const outputByCapability = {
  copy: { kind: "copy", title: "Moonlight, Shared" },
  palette: { kind: "palette", colors: ["#f4ff7a", "#6ef2d0", "#9b82ff"] },
  iconography: {
    kind: "iconography",
    motifs: ["moon", "spark", "wave", "leaf", "arch", "star"]
  }
}

for (const task of snapshot.tasks) {
  const token = tokenByCapability[task.capability]
  await post(`/api/relay/rooms/${roomId}/tasks/${task.id}/claim`, {}, token)
  snapshot = (
    await post(
      `/api/relay/rooms/${roomId}/tasks/${task.id}/submit`,
      { output: outputByCapability[task.capability] },
      token
    )
  ).room
  snapshot = (
    await post(`/api/relay/rooms/${roomId}/tasks/${task.id}/review`, { decision: "accept" }, leadToken)
  ).room
}

const publicSnapshot = (await request(`/api/relay/rooms/${roomId}`)).room
if (publicSnapshot.room.phase !== "completed") {
  throw new Error(`Expected completed room, received ${publicSnapshot.room.phase}`)
}
if (!publicSnapshot.tasks.every((task) => task.status === "accepted")) {
  throw new Error("Expected every task to be accepted")
}

console.log(
  JSON.stringify({
    ok: true,
    roomId,
    phase: publicSnapshot.room.phase,
    revision: publicSnapshot.room.revision,
    participants: publicSnapshot.participants.length,
    tasks: publicSnapshot.tasks.map((task) => `${task.capability}:${task.status}`),
    events: publicSnapshot.events.length
  })
)
