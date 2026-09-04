import * as Predicate from "effect/Predicate"
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react"
import {
  executeSlopTool,
  loadChannel,
  makeRequestId,
  modelContextMode,
  subscribeToolResults,
  toolsReady
} from "./slopRuntime.ts"
import type { ChannelSnapshot, PublicRun, RunStatus, ToolActivity, VisualOutput } from "./types.ts"

const initialChannel: ChannelSnapshot = {
  generated_at: new Date(0).toISOString(),
  now_playing: null,
  generating: null,
  playing_next: null,
  queue: [],
  recent: [],
  all_runs: []
}

const toolNames = ["queue_prompt", "get_status", "batch_queue", "steer_prompt"] as const

const samples = [
  "A coral city learning to dream in the reflection of a black ocean",
  "A chrome moth cathedral unfolding above a violet desert",
  "A tiny weather system living inside a glass cassette tape"
] as const

const statusCopy: Readonly<Record<RunStatus, string>> = {
  queued: "IN QUEUE",
  generating: "RENDERING",
  succeeded: "READY",
  failed: "FAILED"
}

export const SlopApp = () => {
  const [channel, setChannel] = useState<ChannelSnapshot>(initialChannel)
  const [ready, setReady] = useState(false)
  const [prompt, setPrompt] = useState<string>(samples[0])
  const [steering, setSteering] = useState("")
  const [activities, setActivities] = useState<ReadonlyArray<ToolActivity>>([])
  const [ownedRunIds, setOwnedRunIds] = useState<ReadonlyArray<string>>(() => readOwnedRuns())
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [busyTool, setBusyTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tuned, setTuned] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await loadChannel()
      setChannel(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = subscribeToolResults(({ tool, result }) => {
      if (!active) return
      const activity = activityFromToolResult(tool, result)
      setActivities((current) => [activity, ...current].slice(0, 12))
      const runIds = getRunIds(result)
      if (tool === "queue_prompt" || tool === "batch_queue") {
        setOwnedRunIds((current) => persistOwnedRuns([...current, ...runIds]))
      }
      void refresh()
    })
    const broadcast = new BroadcastChannel("infinite-slop-channel")
    broadcast.addEventListener("message", () => void refresh())
    void toolsReady.then(() => {
      if (active) setReady(true)
    })
    void refresh()
    const interval = window.setInterval(() => void refresh(), 2_200)
    return () => {
      active = false
      unsubscribe()
      broadcast.close()
      window.clearInterval(interval)
    }
  }, [refresh])

  const selectedRun = useMemo(
    () => channel.all_runs.find((run) => run.id === selectedRunId) ?? null,
    [channel.all_runs, selectedRunId]
  )
  const reelRun = selectedRun?.status === "succeeded" ? selectedRun : channel.now_playing
  const steerableRun =
    selectedRun !== null && ownedRunIds.includes(selectedRun.id)
      ? selectedRun
      : (channel.all_runs.find((run) => ownedRunIds.includes(run.id)) ?? null)

  const callTool = async (name: string, input: Record<string, unknown>) => {
    setBusyTool(name)
    setError(null)
    try {
      await executeSlopTool(name, input)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      setActivities((current) => [errorActivity(name, message), ...current].slice(0, 12))
    } finally {
      setBusyTool(null)
    }
  }

  const queuePrompt = async () => {
    const value = prompt.trim()
    if (value.length < 3) return
    await callTool("queue_prompt", {
      prompt: value,
      client_request_id: makeRequestId("queue")
    })
    setPrompt("")
  }

  const batchQueue = async () => {
    await callTool("batch_queue", {
      items: samples.map((sample, index) => ({
        prompt: sample,
        client_request_id: makeRequestId(`batch-${index + 1}`)
      }))
    })
  }

  const steerPrompt = async () => {
    if (steerableRun === null || steering.trim().length < 2) return
    await callTool("steer_prompt", {
      run_id: steerableRun.id,
      instruction: steering.trim(),
      expected_revision: steerableRun.revision,
      client_request_id: makeRequestId("steer")
    })
    setSteering("")
  }

  return (
    <main className="slop-shell">
      <header className="slop-header">
        <a className="slop-brand" href="#channel" aria-label="Infinite Slop channel home">
          <span className="slop-logo" aria-hidden="true">
            ∞
          </span>
          <span>
            INFINITE SLOP
            <small>WEBMCP CHANNEL / 01</small>
          </span>
        </a>
        <div className="tool-marquee" aria-label="Available WebMCP tools">
          {toolNames.map((name, index) => (
            <span key={name}>
              <b>0{index + 1}</b> {name}
            </span>
          ))}
        </div>
        <div className={`mcp-state ${ready ? "ready" : ""}`} data-testid="mcp-state">
          <i /> {ready ? modelContextMode : "REGISTERING TOOLS"}
        </div>
      </header>

      <section className="channel-grid" id="channel">
        <aside className="pipeline-panel" aria-label="Visual generation pipeline">
          <div className="section-label">
            <span>LIVE PIPELINE</span>
            <b>{String(channel.queue.length).padStart(2, "0")} WAITING</b>
          </div>

          <PipelineSlot label="PLAYING NEXT" index="A" run={channel.playing_next} />
          <PipelineSlot label="NOW GENERATING" index="B" run={channel.generating} featured />

          <div className="queue-heading">
            <span>UP NEXT</span>
            <button type="button" onClick={() => void batchQueue()} disabled={busyTool !== null}>
              + QUEUE TRIPTYCH
            </button>
          </div>
          <ol className="queue-list" data-testid="queue-list">
            {channel.queue.length === 0 ? (
              <li className="queue-empty">THE QUEUE IS LISTENING.</li>
            ) : (
              channel.queue.slice(0, 8).map((run) => (
                <li key={run.id} className={selectedRunId === run.id ? "selected" : ""}>
                  <button type="button" onClick={() => setSelectedRunId(run.id)}>
                    <span>{String(run.position ?? 0).padStart(2, "0")}</span>
                    <p>{run.prompt}</p>
                    <b>R{run.revision}</b>
                  </button>
                </li>
              ))
            )}
          </ol>

          <div className="channel-stats">
            <div>
              <small>OUTPUTS</small>
              <b>{channel.recent.filter((run) => run.status === "succeeded").length}</b>
            </div>
            <div>
              <small>TABS</small>
              <b>SYNC</b>
            </div>
            <div>
              <small>STATE</small>
              <b>D1</b>
            </div>
          </div>
        </aside>

        <section className="reel-stage" aria-label="Now playing visual output">
          <div className="reel-meta">
            <span>NOW PLAYING</span>
            <span>{reelRun?.output?.kind === "video" ? "H3 MAX / 768×1344" : "PROCEDURAL / LIVE"}</span>
          </div>
          <div className="reel-frame" data-testid="visual-reel">
            <Visual run={reelRun} />
            {!tuned && (
              <button className="tune-overlay" type="button" onClick={() => setTuned(true)}>
                <span>CLICK TO TUNE IN</span>
                <i>LIVE SHARED SIGNAL</i>
              </button>
            )}
            <div className="reel-scanline" />
            <div className="reel-caption">
              <span>{reelRun?.output?.title ?? "WAITING FOR SIGNAL"}</span>
              <b>{reelRun?.id ?? "NO ACTIVE OUTPUT"}</b>
            </div>
          </div>
          <div className="reel-controls">
            <span>CH 01 / AUTOLOOP</span>
            <div>
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <button type="button" onClick={() => void refresh()}>
              REFRESH SIGNAL ↻
            </button>
          </div>
        </section>

        <aside className="activity-panel" aria-label="Prompt and tool activity stream">
          <div className="section-label activity-heading">
            <span>PROMPT STREAM</span>
            <b>TOOL RESULTS ARE VISUAL</b>
          </div>
          <div className="activity-stream" data-testid="activity-stream">
            {activities.length > 0
              ? activities.map((activity) => (
                  <ToolResultCard activity={activity} key={activity.id} onSelect={setSelectedRunId} />
                ))
              : channel.recent
                  .slice(0, 5)
                  .map((run) => <SharedRunCard run={run} key={run.id} onSelect={setSelectedRunId} />)}
          </div>

          <form
            className="prompt-composer"
            onSubmit={(event) => {
              event.preventDefault()
              void queuePrompt()
            }}
          >
            <label htmlFor="prompt">FEED THE CHANNEL</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the next impossible clip…"
              maxLength={1_200}
            />
            <div>
              <span>{prompt.length}/1200</span>
              <button type="submit" disabled={!ready || busyTool !== null || prompt.trim().length < 3}>
                {busyTool === "queue_prompt" ? "QUEUING…" : "QUEUE PROMPT"} <b>↗</b>
              </button>
            </div>
          </form>
        </aside>
      </section>

      <section className="steer-dock" aria-label="Steer an owned prompt">
        <div>
          <small>STEER_PROMPT / REVISION LOCK</small>
          <b>{steerableRun === null ? "QUEUE A PROMPT TO UNLOCK" : steerableRun.id}</b>
        </div>
        <input
          value={steering}
          onChange={(event) => setSteering(event.target.value)}
          placeholder="Make it stranger, warmer, faster…"
          maxLength={600}
          disabled={steerableRun === null}
        />
        <button
          type="button"
          onClick={() => void steerPrompt()}
          disabled={steerableRun === null || steering.trim().length < 2 || busyTool !== null}
        >
          APPLY R{steerableRun?.revision ?? "—"} →
        </button>
      </section>

      {error !== null && (
        <div className="slop-error" role="alert">
          <span>CHANNEL ERROR</span> {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <footer className="slop-footer">
        <span>ONE SHARED QUEUE / EVERY TAB REGISTERS ITS OWN TOOL SURFACE</span>
        <nav aria-label="Other WebMCP demos">
          <a href="/driftline.html">DRIFTLINE</a>
          <a href="/cook.html">WOK THIS WAY</a>
        </nav>
      </footer>
    </main>
  )
}

const PipelineSlot = ({
  label,
  index,
  run,
  featured = false
}: {
  readonly label: string
  readonly index: string
  readonly run: PublicRun | null
  readonly featured?: boolean
}) => (
  <article className={`pipeline-slot ${featured ? "featured" : ""}`}>
    <div>
      <span>{index}</span>
      <small>{label}</small>
      <b>{run === null ? "AWAITING SIGNAL" : statusCopy[run.status]}</b>
    </div>
    <p>{run?.prompt ?? "The next prompt will appear here."}</p>
    {featured && run !== null && (
      <div className="progress-track">
        <i style={{ width: `${run.progress}%` }} />
        <span>{run.progress}%</span>
      </div>
    )}
  </article>
)

const Visual = ({ run }: { readonly run: PublicRun | null }) => {
  const output = run?.output
  if (output?.kind === "video" && output.url !== null) {
    return <video src={output.url} autoPlay muted loop playsInline poster={output.posterUrl ?? undefined} />
  }
  const visual = output ?? fallbackVisual(run)
  const style = {
    "--visual-a": visual.palette[0] ?? "#080808",
    "--visual-b": visual.palette[1] ?? "#f43f5e",
    "--visual-c": visual.palette[2] ?? "#fbbf24",
    "--visual-d": visual.palette[3] ?? "#38bdf8",
    "--visual-turn": `${visual.seed % 360}deg`
  } as CSSProperties
  return (
    <div className={`procedural-visual ${run?.status === "generating" ? "generating" : ""}`} style={style}>
      <i className="visual-orb orb-a" />
      <i className="visual-orb orb-b" />
      <i className="visual-orb orb-c" />
      <div className="visual-prism" />
      <div className="visual-grain" />
    </div>
  )
}

const ToolResultCard = ({
  activity,
  onSelect
}: {
  readonly activity: ToolActivity
  readonly onSelect: (runId: string) => void
}) => (
  <article className={`tool-result-card status-${activity.status}`}>
    <header>
      <span>WEBMCP / {activity.tool}</span>
      <b>{activity.status.toUpperCase()}</b>
    </header>
    <h2>{activity.title}</h2>
    <p>{activity.detail}</p>
    <footer>
      <time>{formatClock(activity.at)}</time>
      <div>
        {activity.runIds.map((id) => (
          <button type="button" key={id} onClick={() => onSelect(id)}>
            {compactId(id)} ↗
          </button>
        ))}
      </div>
    </footer>
  </article>
)

const SharedRunCard = ({
  run,
  onSelect
}: {
  readonly run: PublicRun
  readonly onSelect: (runId: string) => void
}) => (
  <article className="shared-run-card">
    <header>
      <span>SHARED CHANNEL</span>
      <b>{statusCopy[run.status]}</b>
    </header>
    <p>{run.prompt}</p>
    <button type="button" onClick={() => onSelect(run.id)}>
      {compactId(run.id)} / R{run.revision} ↗
    </button>
  </article>
)

function activityFromToolResult(tool: string, result: unknown): ToolActivity {
  const runIds = getRunIds(result)
  const run = getRun(result)
  const count = runIds.length
  return {
    id: `activity-${crypto.randomUUID()}`,
    tool: isToolName(tool) ? tool : "get_status",
    title:
      tool === "batch_queue"
        ? `${count} PROMPTS ENTERED THE PIPELINE`
        : tool === "steer_prompt"
          ? "CREATIVE DIRECTION APPLIED"
          : tool === "get_status"
            ? `${run?.status?.toUpperCase() ?? "STATUS"} / REVISION ${run?.revision ?? "—"}`
            : "PROMPT ACCEPTED BY CHANNEL",
    detail:
      run?.prompt ??
      (tool === "batch_queue"
        ? "The batch is visible in the shared queue in input order."
        : "Tool call complete."),
    status: run?.status ?? "complete",
    runIds,
    at: new Date().toISOString()
  }
}

function errorActivity(tool: string, message: string): ToolActivity {
  return {
    id: `activity-${crypto.randomUUID()}`,
    tool: isToolName(tool) ? tool : "get_status",
    title: "TOOL CALL REJECTED",
    detail: message,
    status: "error",
    runIds: [],
    at: new Date().toISOString()
  }
}

function getRun(result: unknown): PublicRun | null {
  if (!Predicate.isObject(result) || !Predicate.isObject(result.run)) return null
  const run = result.run
  if (!Predicate.isString(run.id) || !Predicate.isString(run.prompt) || !Predicate.isString(run.status)) {
    return null
  }
  return run as unknown as PublicRun
}

function getRunIds(result: unknown): ReadonlyArray<string> {
  const run = getRun(result)
  if (run !== null) return [run.id]
  if (!Predicate.isObject(result) || !Array.isArray(result.runs)) return []
  return result.runs.flatMap((candidate) =>
    Predicate.isObject(candidate) && Predicate.isString(candidate.id) ? [candidate.id] : []
  )
}

function isToolName(value: string): value is ToolActivity["tool"] {
  return toolNames.some((name) => name === value)
}

function fallbackVisual(run: PublicRun | null): VisualOutput {
  return {
    kind: "procedural",
    url: null,
    posterUrl: null,
    palette:
      run?.status === "generating"
        ? ["#09090b", "#fb7185", "#c084fc", "#38bdf8"]
        : ["#080808", "#202020", "#ff4d00", "#f7f7f2"],
    seed: run?.revision ?? 17,
    title: "LIVE SIGNAL"
  }
}

function readOwnedRuns(): ReadonlyArray<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem("infinite-slop-owned-runs") ?? "[]")
    return Array.isArray(parsed) ? parsed.filter(Predicate.isString).slice(-24) : []
  } catch {
    return []
  }
}

function persistOwnedRuns(ids: ReadonlyArray<string>): ReadonlyArray<string> {
  const unique = Array.from(new Set(ids)).slice(-24)
  window.localStorage.setItem("infinite-slop-owned-runs", JSON.stringify(unique))
  return unique
}

function compactId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value))
}
