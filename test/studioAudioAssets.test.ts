import { describe, expect, it } from "vitest"
import { resolveClipAudioUrl } from "../src/studio/audioAssets.ts"
import { initialStudioStateForSlug } from "../src/studio/songs/catalog.ts"

describe("Studio audio assets", () => {
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
