import { assert, describe, it } from "@effect/vitest"
import {
  createKaraokeTokens,
  detectMonophonicPitch,
  frequencyToMidi,
  midiToFrequency,
  scoreKaraokePerformance
} from "../src/studio/karaoke.ts"
import { describeKaraokeMicrophoneFailure } from "../src/studio/karaokeSession.ts"

const sine = (frequencyHz: number, sampleRate = 48_000, length = 4_096, amplitude = 0.7) =>
  Float32Array.from(
    { length },
    (_, index) => amplitude * Math.sin((Math.PI * 2 * frequencyHz * index) / sampleRate)
  )

describe("browser-local karaoke analysis", () => {
  it("turns browser microphone failures into useful, bounded issue codes", () => {
    const noDevice = new Error("Requested device not found")
    noDevice.name = "NotFoundError"
    const denied = new Error("Permission denied")
    denied.name = "NotAllowedError"
    const busy = new Error("Could not start audio source")
    busy.name = "NotReadableError"

    assert.deepStrictEqual(describeKaraokeMicrophoneFailure(noDevice), {
      issue: "no_input_device",
      message:
        "No microphone was found. Connect or enable an input device, then try again. If this is an embedded preview, open Signal Karaoke in Chrome or Edge."
    })
    assert.strictEqual(describeKaraokeMicrophoneFailure(denied).issue, "permission_denied")
    assert.strictEqual(describeKaraokeMicrophoneFailure(busy).issue, "device_busy")
    assert.strictEqual(describeKaraokeMicrophoneFailure(new Error("unknown")).issue, "capture_failed")
  })

  it("converts frequency and MIDI pitch in both directions", () => {
    assert.closeTo(frequencyToMidi(440), 69, 0.000_001)
    assert.closeTo(frequencyToMidi(220), 57, 0.000_001)
    assert.closeTo(midiToFrequency(60), 261.625_565, 0.000_01)
  })

  it("detects a monophonic sine wave with cents and confidence", () => {
    const detected = detectMonophonicPitch(sine(220), 48_000)
    assert.isNotNull(detected)
    assert.closeTo(detected!.frequencyHz, 220, 0.5)
    assert.strictEqual(detected!.nearestMidi, 57)
    assert.closeTo(detected!.cents, 0, 4)
    assert.isAtLeast(detected!.confidence, 0.82)
  })

  it("returns no pitch for silence or insufficient confidence", () => {
    assert.strictEqual(detectMonophonicPitch(new Float32Array(4_096), 48_000), null)
    assert.strictEqual(detectMonophonicPitch(sine(220, 48_000, 4_096, 0.001), 48_000), null)
  })

  it("maps authorized lyric words onto an exact selected MIDI passage", () => {
    const tokens = createKaraokeTokens(
      "SING TOGETHER NOW",
      [
        { midi: 60, startBeat: 16, durationBeats: 1 },
        { midi: 62, startBeat: 18, durationBeats: 1 },
        { midi: 64, startBeat: 20, durationBeats: 2 }
      ],
      16,
      24,
      "guide"
    )

    assert.deepStrictEqual(
      tokens.map((token) => [token.id, token.text, token.expectedMidi]),
      [
        ["guide-1", "SING", 60],
        ["guide-2", "TOGETHER", 62],
        ["guide-3", "NOW", 64]
      ]
    )
    assert.strictEqual(tokens[0]?.startBeat, 16)
    assert.strictEqual(tokens.at(-1)?.endBeat, 24)
  })

  it("scores confident frames and refuses to overstate insufficient evidence", () => {
    const tokens = createKaraokeTokens(
      "SING NOW",
      [
        { midi: 60, startBeat: 0, durationBeats: 2 },
        { midi: 64, startBeat: 2, durationBeats: 2 }
      ],
      0,
      4
    )
    const accurate = Array.from({ length: 12 }, (_, index) => ({
      beat: index / 3,
      midiFloat: index < 6 ? 60.08 : 63.92,
      confidence: 0.95
    }))
    const score = scoreKaraokePerformance(accurate, tokens)

    assert.strictEqual(score.sufficientEvidence, true)
    assert.strictEqual(score.matchedFrames, 12)
    assert.isAtLeast(score.score ?? 0, 90)
    assert.strictEqual(score.inTunePercent, 100)
    assert.isNotNull(score.detectedRange)
    assert.deepStrictEqual(
      score.phrases.map((phrase) => phrase.matchedFrames),
      [6, 6]
    )

    const insufficient = scoreKaraokePerformance(accurate.slice(0, 2), tokens)
    assert.strictEqual(insufficient.sufficientEvidence, false)
    assert.strictEqual(insufficient.score, null)
    assert.strictEqual(insufficient.inTunePercent, null)
    assert.strictEqual(insufficient.detectedRange, null)
  })
})
