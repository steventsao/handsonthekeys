import type { AudioClip, ClipTrack } from "@waveform-playlist/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createStudioPlayoutAdapter,
  studioTransportBeatAtSeconds,
  studioTransportSecondsAtBeat
} from "../src/studio/studioPlayout.ts"

class FakeAudioParam {
  value = 1
  setValueAtTime(value: number): void {
    this.value = value
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value
  }
  exponentialRampToValueAtTime(value: number): void {
    this.value = value
  }
}

class FakeAudioNode {
  connect<T>(destination: T): T {
    return destination
  }
  disconnect(): void {}
}

class FakeAudioBuffer {
  readonly channels: Float32Array[]
  label = ""

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }

  get duration(): number {
    return this.length / this.sampleRate
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel]
    if (data === undefined) throw new Error(`Missing channel ${channel}`)
    return data
  }
}

interface StartedSource {
  readonly buffer: FakeAudioBuffer | null
  readonly at: number
  readonly offset: number
  readonly duration: number | undefined
}

class FakeBufferSource extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null
  private readonly ended = new Set<() => void>()

  constructor(private readonly starts: StartedSource[]) {
    super()
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "ended") this.ended.add(listener)
  }

  start(at = 0, offset = 0, duration?: number): void {
    this.starts.push({ buffer: this.buffer, at, offset, duration })
  }

  stop(): void {
    for (const listener of this.ended) listener()
    this.ended.clear()
  }
}

class FakeAudioContext {
  currentTime = 10
  state: AudioContextState = "running"
  readonly sampleRate = 48_000
  readonly outputLatency = 0
  readonly destination = new FakeAudioNode()
  readonly audioWorklet = { addModule: async (_url: string) => undefined }
  readonly starts: StartedSource[] = []
  private nextBuffer = 0

  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const buffer = new FakeAudioBuffer(channels, length, sampleRate)
    buffer.label = `native-${this.nextBuffer++}`
    return buffer
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this.starts)
  }

  createGain(): FakeAudioNode & { readonly gain: FakeAudioParam } {
    return Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam() })
  }

  createStereoPanner(): FakeAudioNode & { readonly pan: FakeAudioParam } {
    return Object.assign(new FakeAudioNode(), { pan: new FakeAudioParam() })
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return new FakeAudioNode() as unknown as MediaStreamAudioSourceNode
  }

  async resume(): Promise<void> {
    this.state = "running"
  }

  async close(): Promise<void> {
    this.state = "closed"
  }
}

const drumTrack = (context: FakeAudioContext) => {
  const buffer = context.createBuffer(1, 96_000, context.sampleRate)
  buffer.label = "drum"
  const clip: AudioClip = {
    id: "clip-drums",
    startSample: 0,
    durationSamples: buffer.length,
    offsetSamples: 0,
    sampleRate: context.sampleRate,
    sourceDurationSamples: buffer.length,
    gain: 1,
    audioBuffer: buffer as unknown as AudioBuffer
  }
  const track: ClipTrack = {
    id: "track-drums",
    name: "Drum kit",
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    clips: [clip]
  }
  return { buffer, track }
}

let animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrame = 1
let originalRequestAnimationFrame: typeof globalThis.requestAnimationFrame | undefined
let originalCancelAnimationFrame: typeof globalThis.cancelAnimationFrame | undefined

const runAnimationFrame = (timestamp = 0): void => {
  const pending = [...animationFrames.values()]
  animationFrames = new Map()
  for (const callback of pending) callback(timestamp)
}

beforeEach(() => {
  animationFrames = new Map()
  nextAnimationFrame = 1
  originalRequestAnimationFrame = globalThis.requestAnimationFrame
  originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (callback) => {
    const handle = nextAnimationFrame++
    animationFrames.set(handle, callback)
    return handle
  }
  globalThis.cancelAnimationFrame = (handle) => {
    animationFrames.delete(handle)
  }
})

afterEach(() => {
  if (originalRequestAnimationFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame")
  else globalThis.requestAnimationFrame = originalRequestAnimationFrame
  if (originalCancelAnimationFrame === undefined) Reflect.deleteProperty(globalThis, "cancelAnimationFrame")
  else globalThis.cancelAnimationFrame = originalCancelAnimationFrame
})

describe("shared Studio playout transport", () => {
  it("rephases a metronome-first track launch onto the exact same AudioContext timestamp", async () => {
    const context = new FakeAudioContext()
    const adapter = createStudioPlayoutAdapter({
      audioContext: context as unknown as AudioContext,
      initial: { bpm: 120, meter: [4, 4] }
    })
    const drums = drumTrack(context)
    adapter.setTracks([drums.track])

    await adapter.syncMetronome({ enabled: true, bpm: 120, meter: [4, 4] })
    runAnimationFrame()
    context.starts.length = 0

    context.currentTime = 10.125
    adapter.play(0, 2)
    runAnimationFrame()

    const drumStart = context.starts.find((source) => source.buffer === drums.buffer)
    const clickStart = context.starts.find((source) => source.buffer !== drums.buffer)
    expect(drumStart).toBeDefined()
    expect(clickStart).toBeDefined()
    expect(Math.abs(drumStart!.at - clickStart!.at)).toBeLessThanOrEqual(0.000_001)
    expect(drumStart!.at).toBe(10.125)
    expect(adapter.musicIsPlaying()).toBe(true)
    adapter.dispose()
  })

  it("phases a DAW-first metronome enable to the running transport grid", async () => {
    const context = new FakeAudioContext()
    context.currentTime = 20
    const adapter = createStudioPlayoutAdapter({
      audioContext: context as unknown as AudioContext,
      initial: { bpm: 120, meter: [4, 4] }
    })
    const drums = drumTrack(context)
    adapter.setTracks([drums.track])
    adapter.play(0, 2)
    runAnimationFrame()
    context.starts.length = 0

    context.currentTime = 20.25
    await adapter.syncMetronome({ enabled: true, bpm: 120, meter: [4, 4] })
    runAnimationFrame()
    context.currentTime = 20.31
    runAnimationFrame()

    const clickStart = context.starts.find((source) => source.buffer !== drums.buffer)
    expect(clickStart?.at).toBe(20.5)
    expect(adapter.metronomePosition()).toMatchObject({ clockRunning: true })
    expect(adapter.musicIsPlaying()).toBe(true)
    adapter.dispose()
  })

  it("preserves musical beat position while re-establishing phase after tempo and meter changes", async () => {
    const context = new FakeAudioContext()
    context.currentTime = 30
    const adapter = createStudioPlayoutAdapter({
      audioContext: context as unknown as AudioContext,
      initial: { bpm: 120, meter: [4, 4] }
    })
    const drums = drumTrack(context)
    adapter.setTracks([drums.track])
    await adapter.syncMetronome({ enabled: true, bpm: 120, meter: [4, 4] })
    adapter.play(0, 2)
    runAnimationFrame()

    context.currentTime = 30.25
    await adapter.syncMetronome({ enabled: true, bpm: 60, meter: [3, 4] })

    expect(adapter.getCurrentTime()).toBeCloseTo(0.5, 6)
    context.starts.length = 0
    runAnimationFrame()
    context.currentTime = 30.76
    runAnimationFrame()
    const clickStart = context.starts.find((source) => source.buffer !== drums.buffer)
    expect(clickStart?.at).toBeCloseTo(30.75, 6)
    adapter.dispose()
  })

  it("installs bounded metronome ramps on the shared native tempo map", async () => {
    const context = new FakeAudioContext()
    const adapter = createStudioPlayoutAdapter({
      audioContext: context as unknown as AudioContext,
      initial: { bpm: 120, meter: [4, 4] }
    })

    await adapter.syncMetronome({
      enabled: true,
      bpm: 120,
      meter: [4, 4],
      ramp: { bpmPerBar: 10, barCount: 2 }
    })

    expect(adapter.ticksToSeconds!(4 * adapter.ppqn)).toBeCloseTo(2, 6)
    expect(adapter.ticksToSeconds!(8 * adapter.ppqn)).toBeCloseTo(2 + (4 * 60) / 130, 6)
    expect(adapter.ticksToSeconds!(12 * adapter.ppqn)).toBeCloseTo(2 + (4 * 60) / 130 + (4 * 60) / 140, 6)
    const beatEightSeconds = studioTransportSecondsAtBeat(adapter, 8, 120)
    expect(beatEightSeconds).toBeCloseTo(2 + (4 * 60) / 130, 6)
    expect(studioTransportBeatAtSeconds(adapter, beatEightSeconds, 120)).toBeCloseTo(8, 6)

    await adapter.syncMetronome({
      enabled: false,
      bpm: 120,
      meter: [4, 4],
      ramp: { bpmPerBar: 10, barCount: 2 }
    })
    expect(adapter.ticksToSeconds!(12 * adapter.ppqn)).toBeCloseTo(6, 6)
    adapter.dispose()
  })

  it("rephases click-only seek and restart without creating another clock", async () => {
    const context = new FakeAudioContext()
    context.currentTime = 40
    const adapter = createStudioPlayoutAdapter({
      audioContext: context as unknown as AudioContext,
      initial: { bpm: 120, meter: [4, 4] }
    })
    const drums = drumTrack(context)
    adapter.setTracks([drums.track])
    await adapter.syncMetronome({ enabled: true, bpm: 120, meter: [4, 4] })
    adapter.seek(1)
    runAnimationFrame()
    context.starts.length = 0

    context.currentTime = 40.2
    adapter.play(1, 2)
    runAnimationFrame()

    const drumStart = context.starts.find((source) => source.buffer === drums.buffer)
    const clickStart = context.starts.find((source) => source.buffer !== drums.buffer)
    expect(drumStart).toBeDefined()
    expect(clickStart).toBeDefined()
    expect(Math.abs(drumStart!.at - clickStart!.at)).toBeLessThanOrEqual(0.000_001)
    expect(adapter.metronomePosition().phaseRevision).toBeGreaterThanOrEqual(3)
    adapter.dispose()
  })

  it("continues on the shared clock in click-only mode after a bounded musical range ends", async () => {
    const context = new FakeAudioContext()
    context.currentTime = 50
    const adapter = createStudioPlayoutAdapter({
      audioContext: context as unknown as AudioContext,
      initial: { bpm: 120, meter: [4, 4] }
    })
    const drums = drumTrack(context)
    adapter.setTracks([drums.track])
    await adapter.syncMetronome({ enabled: true, bpm: 120, meter: [4, 4] })
    adapter.play(0, 1)
    runAnimationFrame()

    context.currentTime = 51.01
    runAnimationFrame()

    expect(adapter.metronomePosition()).toMatchObject({
      clockRunning: true,
      transportSeconds: 1
    })
    expect(adapter.isPlaying()).toBe(false)
    expect(adapter.getCurrentTime()).toBeCloseTo(1, 6)
    adapter.dispose()
  })
})
