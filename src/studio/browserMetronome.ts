export type BrowserMetronomeStatus = "stopped" | "running" | "audio_locked"

export interface BrowserMetronomeRamp {
  readonly bpmPerBar: number
  readonly barCount: number
}

export interface BrowserMetronomeConfig {
  readonly enabled: boolean
  readonly bpm: number
  readonly meter: readonly [number, number]
  readonly ramp?: BrowserMetronomeRamp | null
}

export interface BrowserMetronomeSnapshot {
  readonly status: BrowserMetronomeStatus
  readonly enabled: boolean
  readonly baseBpm: number
  readonly bpm: number
  readonly meter: readonly [number, number]
  readonly beat: number
  readonly bar: number
  readonly accented: boolean
  readonly sequence: number
  readonly ramp: BrowserMetronomeRamp | null
}

export interface BrowserMetronomeTransportPosition {
  readonly clockRunning: boolean
  readonly transportSeconds: number
  readonly phaseRevision: number
}

/**
 * The narrow seam implemented by the persistent DAW playout adapter. Audible
 * clicks are scheduled by its native Transport, not by this UI facade.
 */
export interface BrowserMetronomeTransport {
  readonly audioState: () => string
  readonly unlock: () => Promise<void>
  readonly syncMetronome: (config: BrowserMetronomeConfig) => Promise<void>
  readonly metronomePosition: () => BrowserMetronomeTransportPosition
}

export interface BrowserMetronome {
  readonly unlock: () => Promise<void>
  readonly sync: (config: BrowserMetronomeConfig) => Promise<BrowserMetronomeSnapshot>
  readonly snapshot: () => BrowserMetronomeSnapshot
  readonly subscribe: (listener: (snapshot: BrowserMetronomeSnapshot) => void) => () => void
  readonly dispose: () => void
}

export interface MetronomeTimerAdapter {
  readonly setInterval: (callback: () => void, milliseconds: number) => number
  readonly clearInterval: (handle: number) => void
}

const visualIntervalMs = 16

const browserTimers = (): MetronomeTimerAdapter => ({
  setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: (handle) => window.clearInterval(handle)
})

type NormalizedBrowserMetronomeConfig = Omit<BrowserMetronomeConfig, "ramp"> & {
  readonly ramp: BrowserMetronomeRamp | null
}

const normalizeConfig = (config: BrowserMetronomeConfig): NormalizedBrowserMetronomeConfig => ({
  ...config,
  meter: [...config.meter] as [number, number],
  ramp: config.ramp ?? null
})

const assertConfig = ({
  bpm,
  meter: [numerator, denominator],
  ramp
}: NormalizedBrowserMetronomeConfig): void => {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    throw new Error("Metronome tempo must be between 40 and 240 BPM.")
  }
  if (
    !Number.isInteger(numerator) ||
    numerator < 1 ||
    numerator > 32 ||
    ![2, 4, 8, 16].includes(denominator)
  ) {
    throw new Error("Metronome meter must use 1–32 beats and a 2, 4, 8, or 16 denominator.")
  }
  if (
    ramp !== null &&
    (!Number.isFinite(ramp.bpmPerBar) ||
      ramp.bpmPerBar === 0 ||
      ramp.bpmPerBar < -20 ||
      ramp.bpmPerBar > 20 ||
      !Number.isInteger(ramp.barCount) ||
      ramp.barCount < 1 ||
      ramp.barCount > 32)
  ) {
    throw new Error("Metronome ramps need a non-zero -20 to 20 BPM step and 1–32 bars.")
  }
}

const sameConfig = (
  left: NormalizedBrowserMetronomeConfig,
  right: NormalizedBrowserMetronomeConfig
): boolean =>
  left.enabled === right.enabled &&
  left.bpm === right.bpm &&
  left.meter[0] === right.meter[0] &&
  left.meter[1] === right.meter[1] &&
  left.ramp?.bpmPerBar === right.ramp?.bpmPerBar &&
  left.ramp?.barCount === right.ramp?.barCount

const boundedBpm = (bpm: number): number => Math.max(40, Math.min(240, bpm))

const pulseAt = (
  transportSeconds: number,
  config: NormalizedBrowserMetronomeConfig
): { readonly pulseIndex: number; readonly beat: number; readonly bar: number; readonly bpm: number } => {
  const [beatsPerBar, denominator] = config.meter
  const ramp = config.ramp
  let remainingSeconds = Math.max(0, transportSeconds) + 1e-7
  let elapsedBars = 0

  while (ramp !== null && elapsedBars < ramp.barCount) {
    const barBpm = boundedBpm(config.bpm + ramp.bpmPerBar * elapsedBars)
    const barSeconds = beatsPerBar * (60 / barBpm) * (4 / denominator)
    if (remainingSeconds < barSeconds) break
    remainingSeconds -= barSeconds
    elapsedBars += 1
  }

  const bpm = boundedBpm(config.bpm + (ramp?.bpmPerBar ?? 0) * elapsedBars)
  const beatSeconds = (60 / bpm) * (4 / denominator)
  const pulseIndex = elapsedBars * beatsPerBar + Math.max(0, Math.floor(remainingSeconds / beatSeconds))
  return {
    pulseIndex,
    beat: (pulseIndex % beatsPerBar) + 1,
    bar: Math.floor(pulseIndex / beatsPerBar) + 1,
    bpm
  }
}

/**
 * Project the DAW transport clock into the compact Session pulse view.
 *
 * This object owns no AudioContext, click oscillator, beat origin, or audio
 * scheduler. Its interval only publishes bounded visual state derived from
 * the native DAW clock that schedules both metronome and musical sources.
 */
export const createBrowserMetronome = (options: {
  readonly transport: BrowserMetronomeTransport
  readonly initial?: Partial<BrowserMetronomeConfig>
  readonly timers?: MetronomeTimerAdapter
}): BrowserMetronome => {
  const transport = options.transport
  const timers = options.timers ?? browserTimers()
  let config: NormalizedBrowserMetronomeConfig = {
    enabled: options.initial?.enabled ?? false,
    bpm: options.initial?.bpm ?? 100,
    meter: options.initial?.meter ?? [4, 4],
    ramp: options.initial?.ramp ?? null
  }
  let current: BrowserMetronomeSnapshot = {
    status: "stopped",
    enabled: false,
    baseBpm: config.bpm,
    bpm: config.bpm,
    meter: config.meter,
    beat: 0,
    bar: 0,
    accented: false,
    sequence: 0,
    ramp: config.ramp
  }
  let visualTimer: number | null = null
  let lastPulseKey: string | null = null
  let disposed = false
  const listeners = new Set<(snapshot: BrowserMetronomeSnapshot) => void>()

  const publish = (patch: Partial<BrowserMetronomeSnapshot>): BrowserMetronomeSnapshot => {
    current = { ...current, ...patch }
    for (const listener of listeners) listener(current)
    return current
  }

  const stopVisuals = (): void => {
    if (visualTimer !== null) timers.clearInterval(visualTimer)
    visualTimer = null
    lastPulseKey = null
  }

  const refresh = (): void => {
    if (!config.enabled) return
    const position = transport.metronomePosition()
    if (!position.clockRunning) {
      publish({ status: "audio_locked", enabled: true, beat: 0, bar: 0, accented: false })
      return
    }

    const pulse = pulseAt(position.transportSeconds, config)
    const pulseKey = `${position.phaseRevision}:${pulse.pulseIndex}`
    const advanced = pulseKey !== lastPulseKey
    lastPulseKey = pulseKey
    publish({
      status: "running",
      enabled: true,
      baseBpm: config.bpm,
      bpm: pulse.bpm,
      meter: config.meter,
      beat: pulse.beat,
      bar: pulse.bar,
      accented: pulse.beat === 1,
      sequence: advanced ? current.sequence + 1 : current.sequence,
      ramp: config.ramp
    })
  }

  const unlock = async (): Promise<void> => {
    if (disposed) throw new Error("The shared metronome facade has been disposed.")
    try {
      await transport.unlock()
    } catch (cause) {
      publish({ status: "audio_locked", enabled: true, beat: 0, bar: 0, accented: false })
      throw cause
    }
  }

  const sync = async (next: BrowserMetronomeConfig): Promise<BrowserMetronomeSnapshot> => {
    if (disposed) throw new Error("The shared metronome facade has been disposed.")
    const normalized = normalizeConfig(next)
    assertConfig(normalized)
    const unchanged = sameConfig(config, normalized)
    config = normalized

    try {
      await transport.syncMetronome(config)
    } catch (cause) {
      if (config.enabled) {
        stopVisuals()
        publish({
          status: "audio_locked",
          enabled: true,
          baseBpm: config.bpm,
          bpm: config.bpm,
          meter: config.meter,
          beat: 0,
          bar: 0,
          accented: false,
          ramp: config.ramp
        })
      }
      throw cause
    }

    if (!config.enabled) {
      stopVisuals()
      return publish({
        status: "stopped",
        enabled: false,
        baseBpm: config.bpm,
        bpm: config.bpm,
        meter: config.meter,
        beat: 0,
        bar: 0,
        accented: false,
        ramp: config.ramp
      })
    }

    if (transport.audioState() !== "running" || !transport.metronomePosition().clockRunning) {
      stopVisuals()
      publish({ status: "audio_locked", enabled: true, beat: 0, bar: 0, accented: false })
      throw new Error("Audio is waiting for a visible Start metronome action in the browser.")
    }

    if (!unchanged || visualTimer === null) {
      stopVisuals()
      refresh()
      visualTimer = timers.setInterval(refresh, visualIntervalMs)
    }
    return current
  }

  return {
    unlock,
    sync,
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      stopVisuals()
      listeners.clear()
    }
  }
}
