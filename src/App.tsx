import { useEffect, useMemo, useState } from "react"
import {
  confirmRescue,
  modelContextMode,
  resetMission,
  runAgentSequence,
  scanSector,
  subscribeMission,
  toolsReady
} from "./appRuntime.ts"
import { initialMissionState, sectors, type Sector } from "./Mission.ts"

const toolNames = [
  "read_mission_telemetry",
  "scan_signal_sector",
  "reroute_ship_power",
  "decode_distress_signal",
  "propose_rescue_vector"
] as const

const stepCopy: Readonly<Record<(typeof toolNames)[number], string>> = {
  read_mission_telemetry: "Telemetry acquired. Signal search is clear to proceed.",
  scan_signal_sector: "Scanning the Kepler drift for a coherent distress carrier.",
  reroute_ship_power: "Signal isolated. Moving shield reserve into the decoder.",
  decode_distress_signal: "Packet restored. NYX–7 crew is alive and awaiting guidance.",
  propose_rescue_vector: "Intercept plotted. The final burn is locked for human approval."
}

const phaseLabel = {
  searching: "SEARCH ACTIVE",
  "signal-found": "SIGNAL FOUND",
  decoded: "CREW LOCATED",
  "vector-ready": "APPROVAL NEEDED",
  rescued: "MISSION COMPLETE"
} as const

const formatToolOutput = (output: string) => (output.length > 116 ? `${output.slice(0, 113)}…` : output)

export const App = () => {
  const [mission, setMission] = useState(initialMissionState)
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [completedTools, setCompletedTools] = useState<ReadonlyArray<string>>([])
  const [agentText, setAgentText] = useState(
    "I can scan the drift, rebalance power, decode the signal, and plot a rescue vector."
  )
  const [lastOutput, setLastOutput] = useState("Waiting for a WebMCP call…")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeMission(setMission)
    void toolsReady.then(() => setReady(true))
    return unsubscribe
  }, [])

  const foundSignal = mission.scans.F6 === 96
  const scannedCount = useMemo(
    () => Object.values(mission.scans).filter((value) => value !== null).length,
    [mission.scans]
  )

  const runMission = async () => {
    if (running) return
    setRunning(true)
    setError(null)
    setCompletedTools([])
    setActiveTool("read_mission_telemetry")
    try {
      await resetMission()
      await runAgentSequence((name, output) => {
        setActiveTool(name)
        setCompletedTools((current) => (current.includes(name) ? current : [...current, name]))
        if (name in stepCopy) setAgentText(stepCopy[name as keyof typeof stepCopy])
        setLastOutput(formatToolOutput(output))
      })
      setActiveTool(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setActiveTool(null)
    } finally {
      setRunning(false)
    }
  }

  const runSectorScan = async (sector: Sector) => {
    if (running) return
    setError(null)
    setActiveTool("scan_signal_sector")
    try {
      const output = await scanSector(sector)
      setCompletedTools((current) =>
        current.includes("scan_signal_sector") ? current : [...current, "scan_signal_sector"]
      )
      setAgentText(`Sector ${sector} scan committed through WebMCP.`)
      setLastOutput(formatToolOutput(output))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setActiveTool(null)
    }
  }

  const authorizeBurn = async () => {
    setError(null)
    try {
      await confirmRescue()
      setAgentText("Human authorization received. Intercept burn complete — NYX–7 is coming home.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const reset = async () => {
    await resetMission()
    setCompletedTools([])
    setActiveTool(null)
    setError(null)
    setAgentText("Mission reset. I’m ready to search the drift again.")
    setLastOutput("Waiting for a WebMCP call…")
  }

  return (
    <main className={`shell phase-${mission.phase}`}>
      <header className="topbar">
        <a className="brand" href="#mission" aria-label="DRIFTLINE home">
          <span className="brand-mark" aria-hidden="true">
            D/
          </span>
          <span>DRIFTLINE</span>
        </a>
        <div className="mission-status" data-testid="relay-status">
          <span /> {phaseLabel[mission.phase]}
        </div>
        <div style={{ justifySelf: "end" }}>
          <a
            className="reset-button"
            href="/cook.html"
            style={{ textDecoration: "none", marginRight: "18px" }}
          >
            WOK THIS WAY ↗
          </a>
          <button className="reset-button" type="button" onClick={() => void reset()}>
            RESET / R
          </button>
        </div>
      </header>

      <section className="hero" id="mission">
        <div className="eyebrow">RESCUE RELAY // MISSION 07</div>
        <h1>
          {mission.phase === "rescued" ? (
            <>
              SIGNAL FOUND.
              <br />
              <em>THEY’RE COMING HOME.</em>
            </>
          ) : (
            <>
              FIND THE SIGNAL.
              <br />
              <em>BRING THEM HOME.</em>
            </>
          )}
        </h1>
        <p>One stranded probe. One fading signal. One human + one agent.</p>
        <button
          className="primary"
          data-testid="run-agent-sequence"
          type="button"
          disabled={!ready || running}
          onClick={() => void runMission()}
        >
          {running
            ? "AGENT SEQUENCE RUNNING"
            : mission.phase === "rescued"
              ? "RUN MISSION AGAIN"
              : "RUN AGENT SEQUENCE"}
          <span>{running ? "•••" : "↗"}</span>
        </button>
        <div className="runtime-badge">
          <span>{ready ? "●" : "○"}</span> {modelContextMode} / EFFECT 4
        </div>
      </section>

      <section className="mission-grid" aria-label="Mission control">
        <article className="panel radar-panel">
          <div className="panel-heading">
            <span>01 / SIGNAL ARRAY</span>
            <strong>{foundSignal ? "SOURCE LOCKED" : `${scannedCount}/6 SCANNED`}</strong>
          </div>
          <div className="radar">
            <div className="radar-sweep" />
            <div className={`probe-ping ${foundSignal ? "found" : ""}`} aria-label="Unidentified signal" />
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="radar-label">
              KEPLER DRIFT
              <br />
              <b>{foundSignal ? "NYX–7 / LOCKED" : "UNKNOWN SOURCE"}</b>
            </div>
          </div>
          <div className="sector-row">
            {sectors.map((sector) => (
              <button
                className={mission.activeSector === sector ? "active" : ""}
                key={sector}
                type="button"
                disabled={running}
                onClick={() => void runSectorScan(sector)}
                aria-label={`Scan sector ${sector}`}
              >
                {sector}
                <small>{mission.scans[sector] === null ? "—" : `${mission.scans[sector]}%`}</small>
              </button>
            ))}
          </div>
        </article>

        <article className="panel telemetry-panel">
          <div className="panel-heading">
            <span>02 / SHIP SYSTEMS</span>
            <strong>{mission.decodedMessage === null ? "CARRIER NOISY" : "PACKET CLEAN"}</strong>
          </div>
          <div className="telemetry-intro">
            <div>
              <small>PROBE</small>
              <b>NYX–7</b>
            </div>
            <div>
              <small>DISTANCE</small>
              <b>12,481 KM</b>
            </div>
          </div>
          {(Object.entries(mission.powers) as ReadonlyArray<readonly [string, number]>).map(
            ([label, value]) => (
              <div className="power-row" key={label}>
                <span>{label.toUpperCase()}</span>
                <div>
                  <i style={{ width: `${value}%` }} />
                </div>
                <b>{value}%</b>
              </div>
            )
          )}
          <div className={`signal-card ${mission.decodedMessage === null ? "" : "decoded"}`}>
            <small>INCOMING TRANSMISSION</small>
            <p>{mission.decodedMessage ?? "••• ––– ••• / PACKET CORRUPTED"}</p>
          </div>
          {mission.rescueVector !== null && (
            <div className="vector-card" data-testid="rescue-vector">
              <div>
                <small>RESCUE VECTOR</small>
                <b>{mission.rescueVector.heading}</b>
              </div>
              <div>
                <small>BURN</small>
                <b>{mission.rescueVector.burnSeconds}s</b>
              </div>
              <div>
                <small>INTERCEPT</small>
                <b>{mission.rescueVector.interceptMinutes}m</b>
              </div>
            </div>
          )}
        </article>

        <article className="panel agent-panel">
          <div className="panel-heading">
            <span>03 / AGENT UPLINK</span>
            <strong>{ready ? "5 TOOLS READY" : "REGISTERING"}</strong>
          </div>
          <div className="agent-message">
            <span>AGENT</span>
            <p data-testid="agent-message">{agentText}</p>
          </div>
          <ol className="tool-list" data-testid="tool-list">
            {toolNames.map((name) => {
              const status =
                activeTool === name ? "CALLING" : completedTools.includes(name) ? "DONE" : "READY"
              return (
                <li className={status.toLowerCase()} key={name}>
                  <span>{name}</span>
                  <b>{status}</b>
                </li>
              )
            })}
          </ol>
          <div className="flight-recorder">
            <small>FLIGHT RECORDER / LAST EFFECT RESULT</small>
            <code data-testid="last-tool-output">{lastOutput}</code>
          </div>
          {error !== null && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <div className="human-lock">FINAL BURN REQUIRES HUMAN CONFIRMATION</div>
        </article>
      </section>

      <section className="mission-log" aria-label="Mission log">
        <div className="panel-heading">
          <span>04 / SHARED MISSION LOG</span>
          <strong>LIVE EFFECT STREAM</strong>
        </div>
        <div className="log-grid" data-testid="mission-log">
          {mission.logs.slice(-4).map((entry) => (
            <div className="log-entry" key={entry.id}>
              <span>{String(entry.id).padStart(2, "0")}</span>
              <b>{entry.actor}</b>
              <p>{entry.message}</p>
            </div>
          ))}
        </div>
      </section>

      {mission.phase === "vector-ready" && mission.rescueVector !== null && (
        <aside
          className="approval-drawer"
          data-testid="approval-drawer"
          aria-label="Human rescue authorization"
        >
          <div>
            <small>HUMAN CHECKPOINT</small>
            <h2>
              AUTHORIZE
              <br />
              INTERCEPT BURN?
            </h2>
            <p>
              Heading {mission.rescueVector.heading} · {mission.rescueVector.confidence}% confidence
            </p>
          </div>
          <button type="button" data-testid="authorize-burn" onClick={() => void authorizeBurn()}>
            HOLD TO AUTHORIZE <span>→</span>
          </button>
        </aside>
      )}

      {mission.phase === "rescued" && (
        <div className="completion-stamp" data-testid="mission-complete">
          NYX–7 // CREW RECOVERED
        </div>
      )}
    </main>
  )
}
