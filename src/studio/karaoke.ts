export interface DetectedPitch {
  readonly frequencyHz: number
  readonly midiFloat: number
  readonly nearestMidi: number
  readonly cents: number
  readonly confidence: number
}

export interface PitchDetectorOptions {
  readonly minimumFrequencyHz?: number
  readonly maximumFrequencyHz?: number
  readonly minimumRms?: number
  readonly minimumConfidence?: number
}

export interface KaraokeMidiNote {
  readonly midi: number
  readonly startBeat: number
  readonly durationBeats: number
}

export interface KaraokeToken {
  readonly id: string
  readonly text: string
  readonly startBeat: number
  readonly endBeat: number
  readonly expectedMidi: number
}

export interface KaraokePitchFrame {
  readonly beat: number
  readonly midiFloat: number
  readonly confidence: number
}

export interface KaraokePhraseScore {
  readonly tokenId: string
  readonly text: string
  readonly matchedFrames: number
  readonly score: number | null
  readonly medianErrorCents: number | null
}

export interface KaraokeScore {
  readonly sufficientEvidence: boolean
  readonly matchedFrames: number
  readonly confidentFrames: number
  readonly coverage: number
  readonly score: number | null
  readonly inTunePercent: number | null
  readonly medianErrorCents: number | null
  readonly detectedRange: { readonly lowestMidi: number; readonly highestMidi: number } | null
  readonly phrases: ReadonlyArray<KaraokePhraseScore>
}

const clean = (value: number, places = 3): number => Number(value.toFixed(places))

export const frequencyToMidi = (frequencyHz: number): number => 69 + 12 * Math.log2(frequencyHz / 440)

export const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

const normalizedCorrelation = (samples: Float32Array, lag: number, usableLength: number): number => {
  let cross = 0
  let leftEnergy = 0
  let rightEnergy = 0
  for (let index = 0; index < usableLength; index += 1) {
    const left = samples[index] ?? 0
    const right = samples[index + lag] ?? 0
    cross += left * right
    leftEnergy += left * left
    rightEnergy += right * right
  }
  const scale = Math.sqrt(leftEnergy * rightEnergy)
  return scale === 0 ? 0 : cross / scale
}

export const detectMonophonicPitch = (
  input: Float32Array,
  sampleRate: number,
  options: PitchDetectorOptions = {}
): DetectedPitch | null => {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || input.length < 128) return null

  const minimumFrequencyHz = options.minimumFrequencyHz ?? 70
  const maximumFrequencyHz = options.maximumFrequencyHz ?? 1_000
  const minimumRms = options.minimumRms ?? 0.012
  const minimumConfidence = options.minimumConfidence ?? 0.82
  if (
    minimumFrequencyHz <= 0 ||
    maximumFrequencyHz <= minimumFrequencyHz ||
    maximumFrequencyHz >= sampleRate / 2
  ) {
    return null
  }

  let mean = 0
  for (const sample of input) mean += sample
  mean /= input.length

  const samples = new Float32Array(input.length)
  let squareSum = 0
  for (let index = 0; index < input.length; index += 1) {
    const centered = (input[index] ?? 0) - mean
    samples[index] = centered
    squareSum += centered * centered
  }
  const rms = Math.sqrt(squareSum / samples.length)
  if (rms < minimumRms) return null

  const minimumLag = Math.max(2, Math.floor(sampleRate / maximumFrequencyHz))
  const maximumLag = Math.min(Math.ceil(sampleRate / minimumFrequencyHz), Math.floor(samples.length / 2))
  if (maximumLag <= minimumLag) return null

  const usableLength = samples.length - maximumLag
  const correlations = new Float64Array(maximumLag + 1)
  let strongestLag = minimumLag
  let strongestCorrelation = -1
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    const correlation = normalizedCorrelation(samples, lag, usableLength)
    correlations[lag] = correlation
    if (correlation > strongestCorrelation) {
      strongestCorrelation = correlation
      strongestLag = lag
    }
  }

  const qualifyingPeak = Math.max(minimumConfidence, strongestCorrelation * 0.97)
  let selectedLag = strongestLag
  for (let lag = minimumLag + 1; lag < maximumLag; lag += 1) {
    const previous = correlations[lag - 1] ?? -1
    const current = correlations[lag] ?? -1
    const next = correlations[lag + 1] ?? -1
    if (current >= qualifyingPeak && current >= previous && current > next) {
      selectedLag = lag
      break
    }
  }

  const confidence = correlations[selectedLag] ?? 0
  if (confidence < minimumConfidence) return null

  const previous = correlations[selectedLag - 1] ?? confidence
  const next = correlations[selectedLag + 1] ?? confidence
  const denominator = previous - 2 * confidence + next
  const offset = denominator === 0 ? 0 : (0.5 * (previous - next)) / denominator
  const refinedLag = selectedLag + Math.max(-0.5, Math.min(0.5, offset))
  const frequencyHz = sampleRate / refinedLag
  const midiFloat = frequencyToMidi(frequencyHz)
  const nearestMidi = Math.round(midiFloat)

  return {
    frequencyHz: clean(frequencyHz),
    midiFloat: clean(midiFloat),
    nearestMidi,
    cents: Math.round((midiFloat - nearestMidi) * 100),
    confidence: clean(Math.max(0, Math.min(1, confidence)))
  }
}

const lyricWords = (lyrics: string): ReadonlyArray<string> =>
  lyrics
    .trim()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)

export const createKaraokeTokens = (
  lyrics: string,
  notes: ReadonlyArray<KaraokeMidiNote>,
  startBeat: number,
  endBeat: number,
  idPrefix = "karaoke-token"
): ReadonlyArray<KaraokeToken> => {
  const words = lyricWords(lyrics)
  if (words.length < 1 || words.length > 64) {
    throw new Error("Karaoke lyrics must contain between 1 and 64 whitespace-separated words.")
  }
  if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || startBeat < 0 || endBeat <= startBeat) {
    throw new Error("Karaoke guide requires a positive beat range.")
  }

  const selected = notes
    .filter((note) => note.startBeat < endBeat && note.startBeat + note.durationBeats > startBeat)
    .sort((left, right) => left.startBeat - right.startBeat || left.midi - right.midi)
  if (selected.length < 1) throw new Error("The selected melody contains no MIDI notes.")

  return words.map((text, index) => {
    const noteIndex = Math.min(selected.length - 1, Math.floor((index * selected.length) / words.length))
    const nextIndex = Math.min(selected.length, Math.floor(((index + 1) * selected.length) / words.length))
    const note = selected[noteIndex]!
    const proportionalStart = startBeat + ((endBeat - startBeat) * index) / words.length
    const proportionalEnd = startBeat + ((endBeat - startBeat) * (index + 1)) / words.length
    const nextNote = selected[nextIndex]
    const tokenStart = Math.max(startBeat, Math.min(endBeat, note.startBeat))
    const tokenEnd = Math.max(tokenStart + 0.001, Math.min(endBeat, nextNote?.startBeat ?? proportionalEnd))
    return {
      id: `${idPrefix}-${index + 1}`,
      text,
      startBeat: clean(Math.max(proportionalStart, tokenStart), 6),
      endBeat: clean(Math.max(proportionalEnd, tokenEnd), 6),
      expectedMidi: note.midi
    }
  })
}

const median = (values: ReadonlyArray<number>): number | null => {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : (ordered[middle] ?? null)
}

const scoreErrors = (errors: ReadonlyArray<number>): number | null => {
  if (errors.length === 0) return null
  return Math.round(
    errors.reduce((total, error) => total + Math.max(0, 100 - Math.abs(error)), 0) / errors.length
  )
}

export const scoreKaraokePerformance = (
  frames: ReadonlyArray<KaraokePitchFrame>,
  tokens: ReadonlyArray<KaraokeToken>,
  options: {
    readonly minimumConfidence?: number
    readonly inTuneCents?: number
    readonly minimumMatchedFrames?: number
  } = {}
): KaraokeScore => {
  const minimumConfidence = options.minimumConfidence ?? 0.82
  const inTuneCents = options.inTuneCents ?? 50
  const minimumMatchedFrames = options.minimumMatchedFrames ?? 8
  const confidentFrames = frames.filter((frame) => frame.confidence >= minimumConfidence)
  const matched = confidentFrames.flatMap((frame) => {
    const token = tokens.find(
      (candidate) => frame.beat >= candidate.startBeat && frame.beat < candidate.endBeat
    )
    return token === undefined
      ? []
      : [{ frame, token, errorCents: (frame.midiFloat - token.expectedMidi) * 100 }]
  })
  const errors = matched.map((item) => item.errorCents)
  const sufficientEvidence = matched.length >= minimumMatchedFrames
  const detectedMidi = matched.map((item) => item.frame.midiFloat)
  const phraseScores = tokens.map((token) => {
    const phraseErrors = matched.filter((item) => item.token.id === token.id).map((item) => item.errorCents)
    const enoughPhraseEvidence = phraseErrors.length >= 2
    return {
      tokenId: token.id,
      text: token.text,
      matchedFrames: phraseErrors.length,
      score: enoughPhraseEvidence ? scoreErrors(phraseErrors) : null,
      medianErrorCents: enoughPhraseEvidence ? clean(median(phraseErrors) ?? 0) : null
    }
  })

  return {
    sufficientEvidence,
    matchedFrames: matched.length,
    confidentFrames: confidentFrames.length,
    coverage: clean(confidentFrames.length === 0 ? 0 : matched.length / confidentFrames.length),
    score: sufficientEvidence ? scoreErrors(errors) : null,
    inTunePercent: sufficientEvidence
      ? clean((errors.filter((error) => Math.abs(error) <= inTuneCents).length / errors.length) * 100, 1)
      : null,
    medianErrorCents: sufficientEvidence ? clean(median(errors) ?? 0) : null,
    detectedRange:
      sufficientEvidence && detectedMidi.length > 0
        ? {
            lowestMidi: clean(Math.min(...detectedMidi)),
            highestMidi: clean(Math.max(...detectedMidi))
          }
        : null,
    phrases: phraseScores
  }
}
