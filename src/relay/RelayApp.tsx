import { useEffect, useMemo, useState } from "react"
import type { Capability, Motif, Participant, RelayTask, RoomSnapshot, TaskOutput } from "./domain.ts"
import { motifValues } from "./domain.ts"
import { roomStateOrder, taskStateOrder } from "./machine.ts"
import {
  claimTask,
  createRoom,
  getIdentity,
  heartbeat,
  joinRoom,
  loadRoom,
  modelContextMode,
  planRoom,
  reviewTask,
  submitTask,
  subscribeToolResults,
  toolsReady
} from "./relayRuntime.ts"
import { currentRelayRoomId } from "./RelayApi.ts"

const capabilityCopy: Readonly<Record<Capability, string>> = {
  copy: "COPY",
  palette: "PALETTE",
  iconography: "ICONOGRAPHY"
}

const defaultGoal = "Design a seven-cell poster for a neighborhood moonlight picnic"

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "The relay could not complete that action."

const participantName = (room: RoomSnapshot, id: string | null): string => {
  if (id === null) return "UNASSIGNED"
  return room.participants.find((participant) => participant.id === id)?.name ?? "UNKNOWN CELL"
}

const outputSummary = (output: TaskOutput | null): string => {
  if (output === null) return "No output"
  if (output.kind === "copy") return `“${output.title}”`
  if (output.kind === "palette") return output.colors.join(" · ")
  return output.motifs.join(" · ")
}

interface IdentityFormProps {
  readonly mode: "create" | "join"
  readonly busy: boolean
  readonly onSubmit: (input: {
    readonly name: string
    readonly kind: "human" | "agent"
    readonly capability: Capability
    readonly goal?: string
  }) => void
}

const IdentityForm = ({ mode, busy, onSubmit }: IdentityFormProps) => {
  const [name, setName] = useState(mode === "create" ? "Lead Cell" : "Guest Cell")
  const [kind, setKind] = useState<"human" | "agent">("agent")
  const [capability, setCapability] = useState<Capability>(mode === "create" ? "copy" : "palette")
  const [goal, setGoal] = useState(defaultGoal)

  return (
    <form
      className="identity-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ name, kind, capability, ...(mode === "create" ? { goal } : {}) })
      }}
    >
      {mode === "create" ? (
        <label className="field field-wide">
          <span>COMMON GOAL</span>
          <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} />
        </label>
      ) : null}
      <label className="field">
        <span>CELL NAME</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} />
      </label>
      <div className="field">
        <span>OPERATOR</span>
        <div className="segmented">
          {(["agent", "human"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={kind === value ? "selected" : ""}
              onClick={() => setKind(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="field field-wide">
        <span>OFFERED INTERFACE</span>
        <div className="capability-grid">
          {(["copy", "palette", "iconography"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={capability === value ? "selected" : ""}
              onClick={() => setCapability(value)}
            >
              <strong>{capabilityCopy[value]}</strong>
              <small>
                {value === "copy"
                  ? "title → text"
                  : value === "palette"
                    ? "mood → 3 colors"
                    : "goal → 6 motifs"}
              </small>
            </button>
          ))}
        </div>
      </div>
      <button className="relay-primary field-wide" disabled={busy}>
        {busy ? "NEGOTIATING…" : mode === "create" ? "OPEN RELAY ROOM" : "OFFER THIS TAB AS A CELL"}
        <span>↗</span>
      </button>
    </form>
  )
}

const Landing = ({
  busy,
  onCreate
}: {
  readonly busy: boolean
  readonly onCreate: IdentityFormProps["onSubmit"]
}) => (
  <main className="landing">
    <div className="landing-copy">
      <div className="eyebrow">TAB-NATIVE COOPERATIVE RUNTIME · WEBMCP</div>
      <h1>
        FRIENDS BRING AGENTS.
        <br />
        <em>THE ROOM FINDS THE WORK.</em>
      </h1>
      <p>
        Open a protected room, invite other browser tabs, and pool their declared interfaces into one
        deterministic seven-cell poster. The creator is lead. Joining is always opt-in.
      </p>
      <div className="landing-principles">
        <span>01 · SERVER-OWNED STATE</span>
        <span>02 · TAB-SCOPED IDENTITY</span>
        <span>03 · TYPED OUTPUTS</span>
      </div>
    </div>
    <section className="create-card">
      <header>
        <span>NEW ROOM</span>
        <strong>LEAD CLAIM</strong>
      </header>
      <IdentityForm mode="create" busy={busy} onSubmit={onCreate} />
    </section>
  </main>
)

const HexPoster = ({ room }: { readonly room: RoomSnapshot }) => {
  const accepted = room.tasks.filter((task) => task.status === "accepted")
  const copy = accepted.find((task) => task.output?.kind === "copy")?.output
  const palette = accepted.find((task) => task.output?.kind === "palette")?.output
  const iconography = accepted.find((task) => task.output?.kind === "iconography")?.output
  const title = copy?.kind === "copy" ? copy.title : "AWAITING SIGNAL"
  const colors = palette?.kind === "palette" ? palette.colors : (["#d8ff52", "#7df9df", "#9d7bff"] as const)
  const motifs =
    iconography?.kind === "iconography"
      ? iconography.motifs
      : (["spark", "moon", "wave", "leaf", "arch", "star"] as const)
  const centers = [
    [360, 85],
    [520, 180],
    [520, 370],
    [360, 465],
    [200, 370],
    [200, 180]
  ] as const
  const glyphs: Readonly<Record<Motif, string>> = {
    arch: "⌒",
    bolt: "ϟ",
    eye: "◉",
    flower: "✣",
    heart: "♥",
    leaf: "⌁",
    moon: "◒",
    mountain: "△",
    spark: "✦",
    star: "★",
    sun: "☼",
    wave: "≈"
  }
  const hex = (cx: number, cy: number, radius: number) =>
    Array.from({ length: 6 }, (_, index) => {
      const angle = (Math.PI / 180) * (60 * index - 30)
      return `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`
    }).join(" ")
  const titleWords = title.split(" ")
  const breakAt = Math.ceil(titleWords.length / 2)
  const titleLines = [titleWords.slice(0, breakAt).join(" "), titleWords.slice(breakAt).join(" ")].filter(
    Boolean
  )

  return (
    <section className="poster-panel">
      <header className="panel-title">
        <span>LIVE ASSEMBLY</span>
        <strong>{accepted.length}/3 INTERFACES RESOLVED</strong>
      </header>
      <svg
        className="poster-svg"
        data-testid="hex-poster"
        viewBox="80 0 560 550"
        role="img"
        aria-label={`Seven-cell poster titled ${title}`}
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {centers.map(([cx, cy], index) => {
          const motif = motifs[index] ?? "spark"
          const color = colors[index % colors.length] ?? "#d8ff52"
          return (
            <g key={`${cx}-${cy}`} className="poster-cell">
              <polygon points={hex(cx, cy, 92)} fill={`${color}22`} stroke={color} />
              <text x={cx} y={cy + 7} textAnchor="middle" fill={color} filter="url(#glow)">
                {glyphs[motif]}
              </text>
              <text x={cx} y={cy + 40} textAnchor="middle" className="motif-label">
                {motif.toUpperCase()}
              </text>
            </g>
          )
        })}
        <g className="poster-center">
          <polygon points={hex(360, 275, 106)} fill="#090a0e" stroke="#f5f7ef" />
          {titleLines.map((line, index) => (
            <text key={line} x="360" y={268 + index * 30 - (titleLines.length - 1) * 15} textAnchor="middle">
              {line.toUpperCase()}
            </text>
          ))}
          <text x="360" y="330" textAnchor="middle" className="center-meta">
            ROOM {room.room.id.slice(-6).toUpperCase()}
          </text>
        </g>
      </svg>
      <footer className="poster-footer">
        <span>{room.room.goal}</span>
        <strong>{room.room.phase.toUpperCase()}</strong>
      </footer>
    </section>
  )
}

const SubmissionForm = ({
  task,
  busy,
  onSubmit
}: {
  readonly task: RelayTask
  readonly busy: boolean
  readonly onSubmit: (output: TaskOutput) => void
}) => {
  const [title, setTitle] = useState("Moonlight, Shared")
  const [colors, setColors] = useState<[string, string, string]>(["#f4ff7a", "#6ef2d0", "#9b82ff"])
  const [motifs, setMotifs] = useState<ReadonlyArray<Motif>>([
    "moon",
    "spark",
    "wave",
    "leaf",
    "arch",
    "star"
  ])

  const toggleMotif = (motif: Motif) => {
    setMotifs((current) =>
      current.includes(motif) ? current.filter((value) => value !== motif) : [...current, motif].slice(0, 6)
    )
  }

  return (
    <div className="submission-form">
      {task.capability === "copy" ? (
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={42} />
      ) : task.capability === "palette" ? (
        <div className="color-inputs">
          {colors.map((color, index) => (
            <label key={index}>
              <input
                type="color"
                value={color}
                onChange={(event) => {
                  const next = [...colors] as [string, string, string]
                  next[index] = event.target.value
                  setColors(next)
                }}
              />
              <span>{color}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="motif-picker">
          {motifValues.map((motif) => (
            <button
              type="button"
              key={motif}
              className={motifs.includes(motif) ? "selected" : ""}
              onClick={() => toggleMotif(motif)}
            >
              {motif}
            </button>
          ))}
          <small>{motifs.length}/6 selected</small>
        </div>
      )}
      <button
        className="task-action"
        disabled={busy || (task.capability === "iconography" && motifs.length !== 6)}
        onClick={() =>
          onSubmit(
            task.capability === "copy"
              ? { kind: "copy", title }
              : task.capability === "palette"
                ? { kind: "palette", colors }
                : { kind: "iconography", motifs: motifs as [Motif, Motif, Motif, Motif, Motif, Motif] }
          )
        }
      >
        SUBMIT TO LEAD
      </button>
    </div>
  )
}

const TaskCard = ({
  room,
  task,
  actor,
  busy,
  onClaim,
  onSubmit,
  onReview
}: {
  readonly room: RoomSnapshot
  readonly task: RelayTask
  readonly actor: Participant | null
  readonly busy: boolean
  readonly onClaim: () => void
  readonly onSubmit: (output: TaskOutput) => void
  readonly onReview: (decision: "accept" | "reopen") => void
}) => (
  <article className={`task-card task-${task.status}`} data-testid={`task-${task.capability}`}>
    <header>
      <span>0{task.position + 1}</span>
      <strong>{capabilityCopy[task.capability]}</strong>
      <em>{task.status.toUpperCase()}</em>
    </header>
    <h3>{task.title}</h3>
    <p>{task.brief}</p>
    <div className="task-path" aria-label={`Task state ${task.status}`}>
      {taskStateOrder.map((state) => (
        <span key={state} className={state === task.status ? "active" : ""}>
          {state.slice(0, 3)}
        </span>
      ))}
    </div>
    <div className="assignment">
      <span>SUGGESTED</span>
      <strong>{participantName(room, task.suggestedParticipantId)}</strong>
      <small>{task.suggestionReason}</small>
    </div>
    {task.claimedByParticipantId !== null ? (
      <div className="claimed-by">OWNER · {participantName(room, task.claimedByParticipantId)}</div>
    ) : null}
    {task.status === "offered" && actor !== null ? (
      <button className="task-action" disabled={busy} onClick={onClaim}>
        CLAIM TASK
      </button>
    ) : null}
    {task.status === "working" && task.claimedByParticipantId === actor?.id ? (
      <SubmissionForm task={task} busy={busy} onSubmit={onSubmit} />
    ) : null}
    {task.status === "submitted" ? (
      <div className="submitted-output">
        <span>SUBMISSION</span>
        <strong>{outputSummary(task.output)}</strong>
      </div>
    ) : null}
    {task.status === "submitted" && actor?.role === "lead" ? (
      <div className="review-actions">
        <button disabled={busy} onClick={() => onReview("reopen")}>
          REOPEN
        </button>
        <button disabled={busy} onClick={() => onReview("accept")}>
          ACCEPT
        </button>
      </div>
    ) : null}
    {task.status === "accepted" ? (
      <div className="accepted-output">✓ {outputSummary(task.output)}</div>
    ) : null}
  </article>
)

export const RelayApp = () => {
  const [roomId, setRoomId] = useState<string | null>(() => currentRelayRoomId())
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [toolsAreReady, setToolsAreReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const identity = roomId === null ? null : getIdentity(roomId)
  const actor =
    room === null || identity === null
      ? null
      : (room.participants.find((participant) => participant.id === identity.actorId) ?? null)

  const commit = async (operation: Promise<RoomSnapshot>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await operation
      setRoom(next)
      setRoomId(next.room.id)
      return next
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void toolsReady.then(() => setToolsAreReady(true))
    return subscribeToolResults(({ room: next }) => {
      setRoom(next)
      setRoomId(next.room.id)
      setError(null)
    })
  }, [])

  useEffect(() => {
    if (roomId === null) return
    let cancelled = false
    const refresh = async () => {
      try {
        const next = await loadRoom(roomId)
        if (!cancelled) {
          setRoom(next)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      }
    }
    void refresh()
    const interval = window.setInterval(refresh, 1_800)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [roomId])

  useEffect(() => {
    if (roomId === null || identity === null) return
    const beat = () => {
      void heartbeat(roomId)
        .then(setRoom)
        .catch(() => undefined)
    }
    beat()
    const interval = window.setInterval(beat, 9_000)
    return () => window.clearInterval(interval)
  }, [roomId, identity?.actorId])

  const shareUrl = useMemo(() => {
    if (roomId === null) return null
    const url = new URL("/cell.html", window.location.origin)
    url.searchParams.set("room", roomId)
    return url.toString()
  }, [roomId])

  if (roomId === null) {
    return (
      <div className="relay-shell">
        <header className="relay-topbar">
          <a className="relay-brand" href="/cell.html">
            <span>HX</span> HEX RELAY
          </a>
          <div className="protocol-status">
            <i className={toolsAreReady ? "online" : ""} /> {modelContextMode}
          </div>
          <a href="/" className="legacy-link">
            VISUAL QUEUE ↗
          </a>
        </header>
        <Landing
          busy={busy}
          onCreate={(input) => {
            if (input.goal === undefined) return
            void commit(
              createRoom({
                name: input.name,
                kind: input.kind,
                capability: input.capability,
                goal: input.goal
              })
            ).catch(() => undefined)
          }}
        />
        {error === null ? null : <div className="error-toast">{error}</div>}
      </div>
    )
  }

  if (room === null) {
    return (
      <div className="relay-shell loading-room">
        <div className="loading-hex">HX</div>
        <p>{error ?? "Attaching this tab to the relay…"}</p>
      </div>
    )
  }

  return (
    <div className="relay-shell" data-testid="relay-room">
      <header className="relay-topbar">
        <a className="relay-brand" href="/cell.html">
          <span>HX</span> HEX RELAY
        </a>
        <div className="room-meta">
          <span>ROOM {room.room.id.slice(-8).toUpperCase()}</span>
          <strong>{actor === null ? "OBSERVER" : actor.role.toUpperCase()}</strong>
          <em>{room.room.phase.toUpperCase()}</em>
        </div>
        <button
          className="share-button"
          data-testid="copy-join-link"
          onClick={() => {
            if (shareUrl === null) return
            void navigator.clipboard.writeText(shareUrl).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1_500)
            })
          }}
        >
          {copied ? "LINK COPIED" : "COPY JOIN LINK"} ↗
        </button>
      </header>

      <div className="room-statebar">
        <span>ROOM GRAPH</span>
        <div>
          {roomStateOrder.map((phase, index) => (
            <span key={phase} className={room.room.phase === phase ? "active" : ""}>
              {phase.toUpperCase()}
              {index < roomStateOrder.length - 1 ? <b>→</b> : null}
            </span>
          ))}
        </div>
        <small>REV {room.room.revision.toString().padStart(3, "0")}</small>
      </div>

      <main className="room-grid">
        <section className="task-panel" data-testid="task-panel">
          <header className="panel-title">
            <span>TASK GRAPH</span>
            <strong>{room.tasks.filter((task) => task.status === "accepted").length}/3 ACCEPTED</strong>
          </header>
          <div className="goal-card">
            <span>LEAD DEFINITION</span>
            <h2>{room.room.goal}</h2>
            {actor?.role === "lead" && room.room.phase === "forming" ? (
              <button
                className="relay-primary"
                data-testid="plan-room"
                disabled={busy}
                onClick={() => void commit(planRoom(room.room.id)).catch(() => undefined)}
              >
                PLAN WITH {room.participants.length} AVAILABLE CELL
                {room.participants.length === 1 ? "" : "S"} <span>→</span>
              </button>
            ) : null}
            {room.room.phase === "forming" && actor?.role !== "lead" ? (
              <p className="waiting-note">Waiting for the lead to freeze the task graph.</p>
            ) : null}
          </div>
          <div className="task-list">
            {room.tasks.length === 0 ? (
              <div className="empty-tasks">
                <span>NO TASKS YET</span>
                <p>Invite capable cells, then let the lead create the deterministic poster plan.</p>
              </div>
            ) : (
              room.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  room={room}
                  task={task}
                  actor={actor}
                  busy={busy}
                  onClaim={() => void commit(claimTask(room.room.id, task.id)).catch(() => undefined)}
                  onSubmit={(output) =>
                    void commit(submitTask(room.room.id, task.id, output)).catch(() => undefined)
                  }
                  onReview={(decision) =>
                    void commit(reviewTask(room.room.id, task.id, decision)).catch(() => undefined)
                  }
                />
              ))
            )}
          </div>
        </section>

        <HexPoster room={room} />

        <aside className="presence-panel" data-testid="presence-panel">
          {actor === null ? (
            <section className="offer-card">
              <header>
                <span>OBSERVER MODE</span>
                <strong>OPT-IN REQUIRED</strong>
              </header>
              <p>This tab can watch without receiving work. Offer an interface only when you choose.</p>
              <IdentityForm
                mode="join"
                busy={busy}
                onSubmit={(input) =>
                  void commit(
                    joinRoom(room.room.id, {
                      name: input.name,
                      kind: input.kind,
                      capability: input.capability
                    })
                  ).catch(() => undefined)
                }
              />
            </section>
          ) : (
            <section className="current-cell" data-testid="current-cell">
              <span>THIS TAB</span>
              <strong>{actor.name}</strong>
              <em>
                {actor.role.toUpperCase()} · {capabilityCopy[actor.capability]}
              </em>
            </section>
          )}
          <section className="roster">
            <header className="panel-title">
              <span>AVAILABLE CELLS</span>
              <strong>
                {room.participants.filter((participant) => participant.runtimeState !== "offline").length}{" "}
                LIVE
              </strong>
            </header>
            {room.participants.map((participant) => (
              <article className="cell-row" key={participant.id}>
                <div className="cell-avatar">{participant.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <strong>
                    {participant.name} {participant.role === "lead" ? <i>LEAD</i> : null}
                  </strong>
                  <span>{capabilityCopy[participant.capability]}</span>
                  <small>{participant.outputInterface}</small>
                </div>
                <em className={`state-${participant.runtimeState}`}>{participant.runtimeState}</em>
              </article>
            ))}
          </section>
          <section className="event-log" data-testid="event-log">
            <header className="panel-title">
              <span>ORDERED EVENTS</span>
              <strong>SERVER TRUTH</strong>
            </header>
            <div>
              {[...room.events].reverse().map((event) => (
                <article key={event.id}>
                  <span>{event.revision.toString().padStart(3, "0")}</span>
                  <p>{event.message}</p>
                  <time>
                    {new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
                      event.createdAt
                    )}
                  </time>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>

      <footer className="runtime-footer" data-testid="relay-runtime">
        <span>
          <i className={toolsAreReady ? "online" : ""} />{" "}
          {toolsAreReady ? "7 WEBMCP TOOLS SCOPED TO THIS PAGE" : "REGISTERING TOOLS"}
        </span>
        <strong>EFFECT SCHEMA · D1 EVENT LOG · TAB LEASE</strong>
      </footer>
      {error === null ? null : <div className="error-toast">{error}</div>}
    </div>
  )
}
