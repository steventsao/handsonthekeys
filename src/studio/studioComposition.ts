import * as Schema from "effect/Schema"

export const studioInstrumentAliases = [
  "acoustic_grand_piano",
  "electric_piano",
  "drawbar_organ",
  "nylon_guitar",
  "clean_electric_guitar",
  "acoustic_bass",
  "finger_bass",
  "synth_bass",
  "strings",
  "choir",
  "brass",
  "tenor_sax",
  "flute",
  "square_lead",
  "saw_lead",
  "warm_pad",
  "polysynth_pad",
  "halo_pad",
  "standard_drums"
] as const

export type StudioInstrumentAlias = (typeof studioInstrumentAliases)[number]

export const studioInstrumentFamilies = [
  "keys",
  "guitar",
  "bass",
  "ensemble",
  "wind",
  "lead",
  "pad",
  "drums"
] as const

export type StudioInstrumentFamily = (typeof studioInstrumentFamilies)[number]

export interface StudioInstrument {
  readonly alias: StudioInstrumentAlias
  readonly label: string
  readonly family: StudioInstrumentFamily
  readonly program: number
  readonly channel: number
  readonly description: string
}

const instrumentDetails: Readonly<Record<StudioInstrumentAlias, Omit<StudioInstrument, "alias">>> = {
  acoustic_grand_piano: {
    label: "Acoustic Grand Piano",
    family: "keys",
    program: 0,
    channel: 0,
    description: "Natural piano for chords, melodies, and accompaniment."
  },
  electric_piano: {
    label: "Electric Piano",
    family: "keys",
    program: 4,
    channel: 0,
    description: "Rounded electric keys with a softer attack."
  },
  drawbar_organ: {
    label: "Drawbar Organ",
    family: "keys",
    program: 16,
    channel: 0,
    description: "Sustained organ for held harmony and rhythmic stabs."
  },
  nylon_guitar: {
    label: "Nylon Guitar",
    family: "guitar",
    program: 24,
    channel: 0,
    description: "Soft plucked guitar for broken chords and melodies."
  },
  clean_electric_guitar: {
    label: "Clean Electric Guitar",
    family: "guitar",
    program: 27,
    channel: 0,
    description: "Clean guitar suitable for arpeggios and rhythmic voicings."
  },
  acoustic_bass: {
    label: "Acoustic Bass",
    family: "bass",
    program: 32,
    channel: 0,
    description: "Upright-style acoustic bass."
  },
  finger_bass: {
    label: "Finger Bass",
    family: "bass",
    program: 33,
    channel: 0,
    description: "Electric finger bass with a direct attack."
  },
  synth_bass: {
    label: "Synth Bass",
    family: "bass",
    program: 38,
    channel: 0,
    description: "Electronic bass for pulses, ostinatos, and low arpeggios."
  },
  strings: {
    label: "String Ensemble",
    family: "ensemble",
    program: 48,
    channel: 0,
    description: "Sustained orchestral strings for chord beds."
  },
  choir: {
    label: "Choir Aahs",
    family: "ensemble",
    program: 52,
    channel: 0,
    description: "Vocal ensemble texture for slow harmony."
  },
  brass: {
    label: "Brass Section",
    family: "ensemble",
    program: 61,
    channel: 0,
    description: "Bright brass section for accents and sustained chords."
  },
  tenor_sax: {
    label: "Tenor Sax",
    family: "wind",
    program: 66,
    channel: 0,
    description: "Tenor saxophone for monophonic lines."
  },
  flute: {
    label: "Flute",
    family: "wind",
    program: 73,
    channel: 0,
    description: "Flute for light melodies and upper-register arpeggios."
  },
  square_lead: {
    label: "Square Lead",
    family: "lead",
    program: 80,
    channel: 0,
    description: "Focused chiptune-style square lead."
  },
  saw_lead: {
    label: "Saw Lead",
    family: "lead",
    program: 81,
    channel: 0,
    description: "Bright saw lead for hooks and fast arpeggios."
  },
  warm_pad: {
    label: "Warm Pad",
    family: "pad",
    program: 89,
    channel: 0,
    description: "Warm sustained pad for long chord progressions."
  },
  polysynth_pad: {
    label: "Polysynth Pad",
    family: "pad",
    program: 90,
    channel: 0,
    description: "Defined polyphonic synth pad for rhythmic harmony."
  },
  halo_pad: {
    label: "Halo Pad",
    family: "pad",
    program: 94,
    channel: 0,
    description: "Airy pad for high, spacious chord voicings."
  },
  standard_drums: {
    label: "Standard Drum Kit",
    family: "drums",
    program: 0,
    channel: 9,
    description: "General MIDI percussion on channel 10; pitches select drum sounds."
  }
}

export const studioInstruments: ReadonlyArray<StudioInstrument> = studioInstrumentAliases.map((alias) => ({
  alias,
  ...instrumentDetails[alias]
}))

export const instrumentByAlias = (alias: StudioInstrumentAlias): StudioInstrument => ({
  alias,
  ...instrumentDetails[alias]
})

const Beat = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 4096 }))
const BeatDuration = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(32))
const Velocity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 127 }))
const Octave = Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 8 }))
const Transpose = Schema.Int.check(Schema.isBetween({ minimum: -24, maximum: 24 }))
const Gate = Schema.Finite.check(Schema.isBetween({ minimum: 0.05, maximum: 1.5 }))
const Unit = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Pan = Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 }))
const MidiPitch = Schema.Union([
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 127 })),
  Schema.Trim.check(Schema.isPattern(/^[A-Ga-g][#b]?(-1|[0-9])$/))
])
const MidiName = Schema.Trim.check(Schema.isLengthBetween(1, 80))
const RequestId = Schema.Trim.check(Schema.isLengthBetween(1, 128))
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const FactualSourceUrl = Schema.Trim.check(
  Schema.isLengthBetween(8, 300),
  Schema.isPattern(/^https:\/\/[^\s]+$/)
)
const PracticeBedKey = Schema.Trim.check(
  Schema.isLengthBetween(7, 9),
  Schema.isPattern(/^[A-G](?:#|b)? (?:major|minor)$/)
)

const chordSymbolPattern =
  /^([A-Ga-g])([#b]?)(maj7|mMaj7|m7b5|m7|m6|m|dim7|dim|aug|sus2|sus4|add9|6|7|5)?(?:\/([A-Ga-g])([#b]?))?$/
const ChordSymbol = Schema.Trim.check(Schema.isLengthBetween(1, 12), Schema.isPattern(chordSymbolPattern))
const ChordSymbols = Schema.Array(ChordSymbol).check(Schema.isLengthBetween(1, 64))
const ChordVoicing = Schema.Literals(["close", "open", "drop_2"])

export const practiceBedArrangementStatement = "new_original_accompaniment" as const
export const practiceBedExcludedExpression =
  "lyrics_melody_signature_riffs_exact_arrangement_source_notation_or_recordings" as const

const OriginalCompositionBasisInput = Schema.Struct({
  kind: Schema.Literal("original")
})

export const ReferencePracticeBedBasisInput = Schema.Struct({
  kind: Schema.Literal("reference_practice_bed"),
  reference_title: MidiName,
  reference_artist: Schema.optional(MidiName),
  approximate_bpm: Schema.Finite.check(Schema.isBetween({ minimum: 40, maximum: 240 })),
  key: PracticeBedKey,
  meter: Schema.Struct({
    numerator: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
    denominator: Schema.Literals([2, 4, 8, 16])
  }),
  harmonic_vocabulary: Schema.Array(ChordSymbol).check(Schema.isLengthBetween(1, 12)),
  factual_sources: Schema.optional(Schema.Array(FactualSourceUrl).check(Schema.isLengthBetween(1, 4))),
  arrangement: Schema.Literal(practiceBedArrangementStatement),
  excludes: Schema.Literal(practiceBedExcludedExpression)
})

export const StudioCompositionBasisInput = Schema.Union([
  OriginalCompositionBasisInput,
  ReferencePracticeBedBasisInput
])

export type StudioCompositionBasis = typeof StudioCompositionBasisInput.Type
export type StudioReferencePracticeBedBasis = typeof ReferencePracticeBedBasisInput.Type

export const ChordProgressionInput = Schema.Struct({
  symbols: ChordSymbols,
  start_beat: Beat,
  beats_per_chord: BeatDuration,
  octave: Schema.optional(Octave),
  inversion: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
  voicing: Schema.optional(ChordVoicing),
  velocity: Schema.optional(Velocity),
  gate: Schema.optional(Gate),
  transpose: Schema.optional(Transpose)
})

export type ChordProgressionInput = typeof ChordProgressionInput.Type

export const ArpeggioInput = Schema.Struct({
  symbols: ChordSymbols,
  start_beat: Beat,
  beats_per_chord: BeatDuration,
  step_beats: Schema.Finite.check(Schema.isBetween({ minimum: 0.0625, maximum: 4 })),
  octave: Schema.optional(Octave),
  octaves: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))),
  inversion: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
  voicing: Schema.optional(ChordVoicing),
  direction: Schema.optional(Schema.Literals(["up", "down", "up_down"])),
  pattern: Schema.optional(
    Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 31 }))).check(
      Schema.isLengthBetween(1, 32)
    )
  ),
  velocity: Schema.optional(Velocity),
  gate: Schema.optional(Gate),
  transpose: Schema.optional(Transpose)
})

export type ArpeggioInput = typeof ArpeggioInput.Type

export const ListInstrumentsInput = Schema.Struct({
  family: Schema.optional(Schema.Literals(studioInstrumentFamilies))
})

export const StudioContextInput = Schema.Struct({})

const MidiWriteNoteInput = Schema.Struct({
  pitch: MidiPitch,
  start_beat: Beat,
  duration_beats: Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(256)),
  velocity: Schema.optional(Velocity)
})

const CompositionTrackInput = Schema.Struct({
  name: MidiName,
  clip_name: Schema.optional(MidiName),
  instrument: Schema.Literals(studioInstrumentAliases),
  volume: Schema.optional(Unit),
  pan: Schema.optional(Pan),
  notes: Schema.Array(MidiWriteNoteInput).check(Schema.isLengthBetween(1, 512))
})

const CompositionTracksInput = Schema.Array(CompositionTrackInput).check(Schema.isLengthBetween(1, 8))

export const WriteTracksInput = Schema.Union([
  Schema.Struct({
    request_id: RequestId,
    expected_revision: Schema.optional(Revision),
    mode: Schema.Literal("append"),
    basis: OriginalCompositionBasisInput,
    tracks: CompositionTracksInput
  }),
  Schema.Struct({
    request_id: RequestId,
    expected_revision: Schema.optional(Revision),
    mode: Schema.Literal("replace_session"),
    basis: ReferencePracticeBedBasisInput,
    tracks: CompositionTracksInput
  })
])

export type WriteTracksInput = typeof WriteTracksInput.Type

export interface StudioShorthandNote {
  readonly pitch: number
  readonly start_beat: number
  readonly duration_beats: number
  readonly velocity: number
}

export interface StudioGeneratedNotes {
  readonly symbols: ReadonlyArray<string>
  readonly start_beat: number
  readonly end_beat: number
  readonly note_count: number
  readonly notes: ReadonlyArray<StudioShorthandNote>
}

const naturalPitchClasses: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
}

const chordIntervals: Readonly<Record<string, ReadonlyArray<number>>> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "5": [0, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mMaj7: [0, 3, 7, 11],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14]
}

const cleanBeat = (beat: number): number => Math.round(beat * 1_000_000) / 1_000_000
const pitchClassOf = (letter: string, accidental: string): number => {
  const natural = naturalPitchClasses[letter.toUpperCase()] ?? 0
  return (natural + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + 12) % 12
}

const chordPitches = (
  symbol: string,
  octave: number,
  inversion: number,
  voicing: "close" | "open" | "drop_2",
  transpose: number
): ReadonlyArray<number> => {
  const match = chordSymbolPattern.exec(symbol)
  if (match === null) throw new Error(`Unsupported chord symbol ${symbol}.`)
  const rootClass = pitchClassOf(match[1]!, match[2] ?? "")
  const quality = match[3] ?? ""
  const intervals = chordIntervals[quality]
  if (intervals === undefined) throw new Error(`Unsupported chord quality in ${symbol}.`)
  const root = (octave + 1) * 12 + rootClass
  const closed = intervals.map((interval) => root + interval + transpose)
  const inverted = closed.map((pitch, index) => (index < inversion % closed.length ? pitch + 12 : pitch))
  let voiced = [...inverted].sort((left, right) => left - right)
  if (voicing === "open") {
    voiced = voiced
      .map((pitch, index) => (index % 2 === 1 ? pitch + 12 : pitch))
      .sort((left, right) => left - right)
  } else if (voicing === "drop_2" && voiced.length >= 3) {
    voiced[voiced.length - 2] = voiced[voiced.length - 2]! - 12
    voiced.sort((left, right) => left - right)
  }

  const slashLetter = match[4]
  if (slashLetter !== undefined) {
    const slashClass = pitchClassOf(slashLetter, match[5] ?? "")
    let bass = voiced[0]! - 1
    while (((bass % 12) + 12) % 12 !== slashClass) bass -= 1
    voiced = [bass, ...voiced]
  }

  if (voiced.some((pitch) => pitch < 0 || pitch > 127)) {
    throw new Error(`Chord ${symbol} exceeds the MIDI pitch range at octave ${octave}.`)
  }
  return [...new Set(voiced)]
}

const ensureNoteLimit = (notes: ReadonlyArray<StudioShorthandNote>): void => {
  if (notes.length > 512) {
    throw new Error(`Shorthand generated ${notes.length} notes; reduce it to at most 512 per track.`)
  }
}

export const expandChordProgression = (input: ChordProgressionInput): StudioGeneratedNotes => {
  const notes = input.symbols.flatMap((symbol, chordIndex) => {
    const start = input.start_beat + chordIndex * input.beats_per_chord
    return chordPitches(
      symbol,
      input.octave ?? 4,
      input.inversion ?? 0,
      input.voicing ?? "close",
      input.transpose ?? 0
    ).map((pitch) => ({
      pitch,
      start_beat: cleanBeat(start),
      duration_beats: cleanBeat(input.beats_per_chord * (input.gate ?? 0.9)),
      velocity: input.velocity ?? 92
    }))
  })
  ensureNoteLimit(notes)
  return {
    symbols: input.symbols,
    start_beat: input.start_beat,
    end_beat: cleanBeat(input.start_beat + input.symbols.length * input.beats_per_chord),
    note_count: notes.length,
    notes
  }
}

const directionPattern = (length: number, direction: "up" | "down" | "up_down") => {
  const up = Array.from({ length }, (_, index) => index)
  if (direction === "down") return [...up].reverse()
  if (direction === "up_down" && up.length > 2) return [...up, ...up.slice(1, -1).reverse()]
  return up
}

export const expandArpeggio = (input: ArpeggioInput): StudioGeneratedNotes => {
  const notes: Array<StudioShorthandNote> = []
  for (const [chordIndex, symbol] of input.symbols.entries()) {
    const chordStart = input.start_beat + chordIndex * input.beats_per_chord
    const chordEnd = chordStart + input.beats_per_chord
    const base = chordPitches(
      symbol,
      input.octave ?? 4,
      input.inversion ?? 0,
      input.voicing ?? "close",
      input.transpose ?? 0
    )
    const pool = [
      ...new Set(
        Array.from({ length: input.octaves ?? 1 }, (_, octaveIndex) =>
          base.map((pitch) => pitch + octaveIndex * 12)
        )
          .flat()
          .filter((pitch) => pitch <= 127)
      )
    ].sort((left, right) => left - right)
    const pattern = input.pattern ?? directionPattern(pool.length, input.direction ?? "up")
    const invalidIndex = pattern.find((index) => index >= pool.length)
    if (invalidIndex !== undefined) {
      throw new Error(
        `Arpeggio pattern index ${invalidIndex} is unavailable for ${symbol}; use 0–${pool.length - 1}.`
      )
    }
    let stepIndex = 0
    for (let start = chordStart; start < chordEnd - 0.000001; start += input.step_beats) {
      const pitch = pool[pattern[stepIndex % pattern.length]!]!
      notes.push({
        pitch,
        start_beat: cleanBeat(start),
        duration_beats: cleanBeat(Math.min(input.step_beats * (input.gate ?? 0.85), chordEnd - start)),
        velocity: input.velocity ?? 96
      })
      stepIndex += 1
    }
  }
  ensureNoteLimit(notes)
  return {
    symbols: input.symbols,
    start_beat: input.start_beat,
    end_beat: cleanBeat(input.start_beat + input.symbols.length * input.beats_per_chord),
    note_count: notes.length,
    notes
  }
}
