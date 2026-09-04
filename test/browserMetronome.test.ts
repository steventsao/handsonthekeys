import { describe, expect, it } from "vitest"
import {
  createBrowserMetronome,
  type BrowserMetronomeConfig,
  type BrowserMetronomeTransport,
  type MetronomeTimerAdapter
} from "../src/studio/browserMetronome.ts"

const testTransport = () => {
  let audioState = "suspended"
  let clockRunning = false
  let transportSeconds = 0
  let phaseRevision = 0
  let rejectUnlock = false
  let nextHandle = 1
  const intervals = new Map<number, () => void>()
  const syncs: BrowserMetronomeConfig[] = []

  const transport: BrowserMetronomeTransport = {
    audioState: () => audioState,
    unlock: async () => {
      if (rejectUnlock) throw new Error("visible gesture required")
      audioState = "running"
    },
    syncMetronome: async (config) => {
      syncs.push(config)
      if (config.enabled && rejectUnlock) throw new Error("visible gesture required")
      if (config.enabled) audioState = "running"
      clockRunning = config.enabled
      phaseRevision += 1
    },
    metronomePosition: () => ({ clockRunning, transportSeconds, phaseRevision })
  }
  const timers: MetronomeTimerAdapter = {
    setInterval: (callback) => {
      const handle = nextHandle++
      intervals.set(handle, callback)
      return handle
    },
    clearInterval: (handle) => {
      intervals.delete(handle)
    }
  }

  return {
    transport,
    timers,
    syncs,
    setSeconds: (seconds: number) => {
      transportSeconds = seconds
    },
    runIntervals: () => {
      for (const callback of intervals.values()) callback()
    },
    intervalCount: () => intervals.size,
    rejectFutureUnlocks: () => {
      rejectUnlock = true
    }
  }
}

describe("shared browser metronome facade", () => {
  it("projects accented pulses from the shared DAW clock without owning an audio scheduler", async () => {
    const test = testTransport()
    const metronome = createBrowserMetronome({ transport: test.transport, timers: test.timers })
    const snapshots: Array<ReturnType<typeof metronome.snapshot>> = []
    metronome.subscribe((snapshot) => snapshots.push(snapshot))

    await metronome.sync({ enabled: true, bpm: 120, meter: [4, 4] })

    expect(test.syncs).toEqual([{ enabled: true, bpm: 120, meter: [4, 4], ramp: null }])
    expect(test.intervalCount()).toBe(1)
    expect(metronome.snapshot()).toMatchObject({
      status: "running",
      enabled: true,
      bpm: 120,
      meter: [4, 4],
      beat: 1,
      accented: true,
      sequence: 1
    })

    test.setSeconds(0.5)
    test.runIntervals()
    expect(snapshots.at(-1)).toMatchObject({ beat: 2, accented: false, sequence: 2 })
  })

  it("stops only the shared click projection and retains a monotonic visual sequence", async () => {
    const test = testTransport()
    const metronome = createBrowserMetronome({ transport: test.transport, timers: test.timers })

    await metronome.sync({ enabled: true, bpm: 100, meter: [3, 4] })
    const sequence = metronome.snapshot().sequence
    await metronome.sync({ enabled: false, bpm: 100, meter: [3, 4] })

    expect(test.intervalCount()).toBe(0)
    expect(test.syncs.at(-1)).toEqual({ enabled: false, bpm: 100, meter: [3, 4], ramp: null })
    expect(metronome.snapshot()).toMatchObject({
      status: "stopped",
      enabled: false,
      beat: 0,
      sequence
    })
  })

  it("reprojects tempo and meter changes from a new shared-transport phase", async () => {
    const test = testTransport()
    const metronome = createBrowserMetronome({ transport: test.transport, timers: test.timers })

    await metronome.sync({ enabled: true, bpm: 90, meter: [4, 4] })
    const firstSequence = metronome.snapshot().sequence
    test.setSeconds(60 / 140)
    await metronome.sync({ enabled: true, bpm: 140, meter: [6, 8] })

    expect(test.intervalCount()).toBe(1)
    expect(metronome.snapshot()).toMatchObject({ status: "running", bpm: 140, meter: [6, 8] })
    expect(metronome.snapshot().sequence).toBeGreaterThan(firstSequence)
  })

  it("reports the browser audio boundary instead of fabricating a running clock", async () => {
    const test = testTransport()
    test.rejectFutureUnlocks()
    const metronome = createBrowserMetronome({ transport: test.transport, timers: test.timers })

    await expect(metronome.sync({ enabled: true, bpm: 120, meter: [4, 4] })).rejects.toThrow(
      "visible gesture required"
    )
    expect(metronome.snapshot()).toMatchObject({
      status: "audio_locked",
      enabled: true,
      beat: 0,
      accented: false
    })
    expect(test.intervalCount()).toBe(0)
  })

  it("applies a bounded signed tempo step on each new bar", async () => {
    const test = testTransport()
    const metronome = createBrowserMetronome({ transport: test.transport, timers: test.timers })

    await metronome.sync({
      enabled: true,
      bpm: 120,
      meter: [4, 4],
      ramp: { bpmPerBar: 10, barCount: 2 }
    })

    test.setSeconds(2)
    test.runIntervals()
    expect(metronome.snapshot()).toMatchObject({
      baseBpm: 120,
      bpm: 130,
      bar: 2,
      beat: 1,
      ramp: { bpmPerBar: 10, barCount: 2 }
    })

    test.setSeconds(2 + (4 * 60) / 130)
    test.runIntervals()
    expect(metronome.snapshot()).toMatchObject({ baseBpm: 120, bpm: 140, bar: 3, beat: 1 })

    test.setSeconds(0)
    await metronome.sync({
      enabled: true,
      bpm: 120,
      meter: [4, 4],
      ramp: { bpmPerBar: -5, barCount: 3 }
    })
    test.setSeconds(2)
    test.runIntervals()
    expect(metronome.snapshot()).toMatchObject({ baseBpm: 120, bpm: 115, bar: 2, beat: 1 })
  })

  it("rejects zero, excessive, and unbounded ramp settings", async () => {
    const test = testTransport()
    const metronome = createBrowserMetronome({ transport: test.transport, timers: test.timers })

    await expect(
      metronome.sync({
        enabled: true,
        bpm: 120,
        meter: [4, 4],
        ramp: { bpmPerBar: 0, barCount: 4 }
      })
    ).rejects.toThrow("non-zero -20 to 20 BPM step")
    await expect(
      metronome.sync({
        enabled: true,
        bpm: 120,
        meter: [4, 4],
        ramp: { bpmPerBar: 21, barCount: 33 }
      })
    ).rejects.toThrow("1–32 bars")
  })
})
