import { describe, expect, it } from "vitest"
import { renderStudioMidiSamples, resolveClipAudioUrl } from "../src/studio/audioAssets.ts"
import { initialStudioStateForSlug } from "../src/studio/songs/catalog.ts"

describe("Studio audio assets", () => {
  it("renders deterministic and distinct General MIDI drum voices with natural tails", () => {
    const sampleRate = 22_050
    const sampleCount = Math.ceil(sampleRate * 0.5)
    const render = (midi: number) =>
      renderStudioMidiSamples(
        [{ midi, time: 0, duration: 0.08, velocity: 1 }],
        "drums",
        sampleCount,
        sampleRate,
        17,
        0
      )

    const kick = render(36)
    const snare = render(38)
    const closedHat = render(42)

    expect(kick).toEqual(render(36))
    expect(kick).not.toEqual(snare)
    expect(snare).not.toEqual(closedHat)
    expect(Math.max(...kick.map(Math.abs))).toBeLessThanOrEqual(1)
    expect(Math.abs(kick[Math.floor(sampleRate * 0.25)] ?? 0)).toBeGreaterThan(0.0001)

    const zeroCrossings = (samples: Float32Array): number => {
      let crossings = 0
      for (let sample = 1; sample < samples.length; sample += 1) {
        if ((samples[sample - 1] ?? 0) * (samples[sample] ?? 0) < 0) crossings += 1
      }
      return crossings
    }
    expect(zeroCrossings(closedHat)).toBeGreaterThan(zeroCrossings(kick) * 5)
  })

  it("renders General MIDI acoustic piano with a decaying sustained body", () => {
    const sampleRate = 22_050
    const samples = renderStudioMidiSamples(
      [{ midi: 60, time: 0, duration: 0.8, velocity: 0.9 }],
      "lead",
      sampleRate,
      sampleRate,
      31,
      0
    )
    const energyBetween = (start: number, end: number): number => {
      let energy = 0
      const firstSample = Math.floor(start * sampleRate)
      const lastSample = Math.ceil(end * sampleRate)
      for (let sample = firstSample; sample < lastSample; sample += 1) {
        energy += Math.abs(samples[sample] ?? 0)
      }
      return energy / (lastSample - firstSample)
    }

    const earlyEnergy = energyBetween(0.03, 0.13)
    const lateEnergy = energyBetween(0.55, 0.65)
    expect(earlyEnergy).toBeGreaterThan(lateEnergy)
    expect(lateEnergy).toBeGreaterThan(0.01)
  })

  it("renders the complete generated clip instead of truncating long clips at 32 seconds", async () => {
    const state = initialStudioStateForSlug("korobeiniki")
    const clip = state.tracks[0]?.clips[0]
    expect(clip).toBeDefined()
    expect(clip!.duration).toBeGreaterThan(32)

    const response = await fetch(resolveClipAudioUrl(clip!, state.bpm))
    const wav = new DataView(await response.arrayBuffer())
    const sampleRate = wav.getUint32(24, true)
    const dataBytes = wav.getUint32(40, true)
    const renderedDuration = dataBytes / 2 / sampleRate
    const peakBetween = (start: number, end: number): number => {
      const firstSample = Math.floor(start * sampleRate)
      const lastSample = Math.min(dataBytes / 2, Math.ceil(end * sampleRate))
      let peak = 0
      for (let sample = firstSample; sample < lastSample; sample += 1) {
        peak = Math.max(peak, Math.abs(wav.getInt16(44 + sample * 2, true)))
      }
      return peak
    }

    expect(sampleRate).toBe(44_100)
    expect(renderedDuration).toBeCloseTo(clip!.duration, 3)
    expect(peakBetween(3, 4)).toBeGreaterThan(100)
    expect(peakBetween(30, 31)).toBeGreaterThan(100)
  })
})
