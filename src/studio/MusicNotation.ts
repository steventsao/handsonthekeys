import * as Schema from "effect/Schema"

export const notationDurationTypes = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"] as const

export type NotationDurationType = (typeof notationDurationTypes)[number]

export interface NotationSourceEvent {
  readonly note_id: string
  readonly pitch: number
  readonly start_beat: number
  readonly duration_beats: number
  readonly string_number: number | null
  readonly fret: number | null
  readonly playable: boolean
}

export interface NotationDuration {
  readonly type: NotationDurationType
  readonly dots: 0 | 1
  readonly beats: number
  readonly vexflow: string
}

export interface NotationRestSlot {
  readonly kind: "rest"
  readonly slot_id: string
  readonly start_beat: number
  readonly duration: NotationDuration
}

export interface NotationChordSlot {
  readonly kind: "chord"
  readonly slot_id: string
  readonly start_beat: number
  readonly event_ids: ReadonlyArray<string>
  readonly duration: NotationDuration
  readonly duration_source: "inter_onset_rhythm" | "performed_gate"
  readonly quantization_error_beats: number
  readonly articulation: "none" | "staccato"
  readonly tie_from_previous: boolean
  readonly tie_to_next: boolean
}

export type NotationSlot = NotationRestSlot | NotationChordSlot

export interface NotationMeasure {
  readonly number: number
  readonly start_beat: number
  readonly end_beat: number
  readonly partial: boolean
  readonly slots: ReadonlyArray<NotationSlot>
}

export interface InstrumentNotationProjection {
  readonly schema_version: 1
  readonly semantics: "musicxml_4_0_guitar_subset"
  readonly renderer: "vexflow_5_svg"
  readonly timing_authority: "canonical_midi_events"
  readonly divisions_per_quarter: 960
  readonly meter: {
    readonly beats: number
    readonly beat_type: number
    readonly measure_duration_beats: number
  }
  readonly clef: {
    readonly sign: "G"
    readonly line: 2
    readonly octave_change: -1
  }
  readonly transposition: {
    readonly chromatic: 0
    readonly octave_change: -1
    readonly sounding_to_written_semitones: 12
  }
  readonly staves: readonly [
    {
      readonly number: 1
      readonly kind: "standard_notation"
      readonly lines: 5
    },
    {
      readonly number: 2
      readonly kind: "tablature"
      readonly lines: 6
      readonly show_rhythm: true
    }
  ]
  readonly measures: ReadonlyArray<NotationMeasure>
  readonly summary: {
    readonly measure_count: number
    readonly chord_slot_count: number
    readonly rest_slot_count: number
    readonly event_reference_count: number
    readonly quantized_slot_count: number
    readonly partial_measure_count: number
  }
}

const DurationSchema = Schema.Struct({
  type: Schema.Literals(notationDurationTypes),
  dots: Schema.Literals([0, 1]),
  beats: Schema.Finite.check(Schema.isGreaterThan(0)),
  vexflow: Schema.NonEmptyString
})

const RestSlotSchema = Schema.Struct({
  kind: Schema.Literal("rest"),
  slot_id: Schema.NonEmptyString,
  start_beat: Schema.Finite,
  duration: DurationSchema
})

const ChordSlotSchema = Schema.Struct({
  kind: Schema.Literal("chord"),
  slot_id: Schema.NonEmptyString,
  start_beat: Schema.Finite,
  event_ids: Schema.Array(Schema.NonEmptyString),
  duration: DurationSchema,
  duration_source: Schema.Literals(["inter_onset_rhythm", "performed_gate"]),
  quantization_error_beats: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  articulation: Schema.Literals(["none", "staccato"]),
  tie_from_previous: Schema.Boolean,
  tie_to_next: Schema.Boolean
})

export const InstrumentNotationProjectionSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  semantics: Schema.Literal("musicxml_4_0_guitar_subset"),
  renderer: Schema.Literal("vexflow_5_svg"),
  timing_authority: Schema.Literal("canonical_midi_events"),
  divisions_per_quarter: Schema.Literal(960),
  meter: Schema.Struct({
    beats: Schema.Int.check(Schema.isGreaterThan(0)),
    beat_type: Schema.Int.check(Schema.isGreaterThan(0)),
    measure_duration_beats: Schema.Finite.check(Schema.isGreaterThan(0))
  }),
  clef: Schema.Struct({
    sign: Schema.Literal("G"),
    line: Schema.Literal(2),
    octave_change: Schema.Literal(-1)
  }),
  transposition: Schema.Struct({
    chromatic: Schema.Literal(0),
    octave_change: Schema.Literal(-1),
    sounding_to_written_semitones: Schema.Literal(12)
  }),
  staves: Schema.Tuple([
    Schema.Struct({
      number: Schema.Literal(1),
      kind: Schema.Literal("standard_notation"),
      lines: Schema.Literal(5)
    }),
    Schema.Struct({
      number: Schema.Literal(2),
      kind: Schema.Literal("tablature"),
      lines: Schema.Literal(6),
      show_rhythm: Schema.Literal(true)
    })
  ]),
  measures: Schema.Array(
    Schema.Struct({
      number: Schema.Int.check(Schema.isGreaterThan(0)),
      start_beat: Schema.Finite,
      end_beat: Schema.Finite,
      partial: Schema.Boolean,
      slots: Schema.Array(Schema.Union([RestSlotSchema, ChordSlotSchema]))
    })
  ),
  summary: Schema.Struct({
    measure_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    chord_slot_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    rest_slot_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    event_reference_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    quantized_slot_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    partial_measure_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  })
})

interface DurationDefinition extends NotationDuration {
  readonly beats: number
}

const durationDefinitions: ReadonlyArray<DurationDefinition> = [
  { type: "whole", dots: 0, beats: 4, vexflow: "w" },
  { type: "half", dots: 1, beats: 3, vexflow: "hd" },
  { type: "half", dots: 0, beats: 2, vexflow: "h" },
  { type: "quarter", dots: 1, beats: 1.5, vexflow: "qd" },
  { type: "quarter", dots: 0, beats: 1, vexflow: "q" },
  { type: "eighth", dots: 1, beats: 0.75, vexflow: "8d" },
  { type: "eighth", dots: 0, beats: 0.5, vexflow: "8" },
  { type: "16th", dots: 1, beats: 0.375, vexflow: "16d" },
  { type: "16th", dots: 0, beats: 0.25, vexflow: "16" },
  { type: "32nd", dots: 1, beats: 0.1875, vexflow: "32d" },
  { type: "32nd", dots: 0, beats: 0.125, vexflow: "32" },
  { type: "64th", dots: 0, beats: 0.0625, vexflow: "64" }
]

const cleanBeat = (beat: number): number => Math.round(beat * 1_000_000) / 1_000_000

const nearestDuration = (beats: number, maximum = Number.POSITIVE_INFINITY): DurationDefinition => {
  const candidates = durationDefinitions.filter((duration) => duration.beats <= maximum + 0.000001)
  const pool = candidates.length > 0 ? candidates : durationDefinitions
  return [...pool].sort(
    (left, right) => Math.abs(left.beats - beats) - Math.abs(right.beats - beats) || right.beats - left.beats
  )[0]!
}

const restSlots = (
  startBeat: number,
  durationBeats: number,
  idPrefix: string
): ReadonlyArray<NotationRestSlot> => {
  const slots: Array<NotationRestSlot> = []
  let cursor = cleanBeat(startBeat)
  let remaining = cleanBeat(durationBeats)
  let index = 0

  while (remaining >= 0.03125 && index < 128) {
    const duration = durationDefinitions.find((candidate) => candidate.beats <= remaining + 0.000001)
    if (duration === undefined) break
    slots.push({
      kind: "rest",
      slot_id: `${idPrefix}-rest-${index + 1}`,
      start_beat: cursor,
      duration
    })
    cursor = cleanBeat(cursor + duration.beats)
    remaining = cleanBeat(remaining - duration.beats)
    index += 1
  }

  return slots
}

const measureRanges = (
  startBeat: number,
  endBeat: number,
  measureDurationBeats: number
): ReadonlyArray<{
  readonly number: number
  readonly start: number
  readonly end: number
  readonly partial: boolean
}> => {
  if (endBeat <= startBeat) return []
  const firstMeasureIndex = Math.floor(startBeat / measureDurationBeats)
  const ranges = []
  let start = startBeat
  let measureIndex = firstMeasureIndex

  while (start < endBeat - 0.000001) {
    const naturalStart = measureIndex * measureDurationBeats
    const naturalEnd = naturalStart + measureDurationBeats
    const end = Math.min(endBeat, naturalEnd)
    ranges.push({
      number: measureIndex + 1,
      start: cleanBeat(start),
      end: cleanBeat(end),
      partial: Math.abs(start - naturalStart) > 0.000001 || Math.abs(end - naturalEnd) > 0.000001
    })
    start = end
    measureIndex += 1
  }

  return ranges
}

export const notationProjectionOf = (options: {
  readonly events: ReadonlyArray<NotationSourceEvent>
  readonly startBeat: number
  readonly endBeat: number
  readonly timeSignature: readonly [number, number]
}): InstrumentNotationProjection => {
  const [beats, beatType] = options.timeSignature
  const measureDurationBeats = cleanBeat((beats * 4) / beatType)
  const groups = new Map<number, Array<NotationSourceEvent>>()
  for (const event of options.events) {
    const group = groups.get(event.start_beat) ?? []
    group.push(event)
    groups.set(event.start_beat, group)
  }

  const onsets = [...groups.entries()]
    .map(([startBeat, events]) => ({
      startBeat,
      events: [...events].sort(
        (left, right) => right.pitch - left.pitch || left.note_id.localeCompare(right.note_id)
      )
    }))
    .sort((left, right) => left.startBeat - right.startBeat)

  const measures: Array<NotationMeasure> = measureRanges(
    options.startBeat,
    options.endBeat,
    measureDurationBeats
  ).map((range) => {
    const measureOnsets = onsets.filter(
      (onset) => onset.startBeat >= range.start - 0.000001 && onset.startBeat < range.end - 0.000001
    )
    const slots: Array<NotationSlot> = []
    let cursor = range.start

    for (let index = 0; index < measureOnsets.length; index += 1) {
      const onset = measureOnsets[index]!
      if (onset.startBeat > cursor + 0.000001) {
        slots.push(
          ...restSlots(cursor, onset.startBeat - cursor, `measure-${range.number}-before-${index + 1}`)
        )
      }

      const nextOnset = measureOnsets[index + 1]?.startBeat ?? range.end
      const availableBeats = Math.max(0.0625, cleanBeat(nextOnset - onset.startBeat))
      const performedGate = Math.max(...onset.events.map((event) => event.duration_beats))
      const useInterOnsetRhythm = performedGate >= availableBeats * 0.55
      const rhythmTarget = useInterOnsetRhythm ? availableBeats : Math.min(performedGate, availableBeats)
      const duration = nearestDuration(rhythmTarget, availableBeats)
      const noteEnd = cleanBeat(onset.startBeat + performedGate)
      const quantizationError = cleanBeat(Math.abs(duration.beats - rhythmTarget))

      slots.push({
        kind: "chord",
        slot_id: `measure-${range.number}-beat-${onset.startBeat}`,
        start_beat: onset.startBeat,
        event_ids: onset.events.map((event) => event.note_id),
        duration,
        duration_source: useInterOnsetRhythm ? "inter_onset_rhythm" : "performed_gate",
        quantization_error_beats: quantizationError,
        articulation: useInterOnsetRhythm && performedGate < duration.beats * 0.85 ? "staccato" : "none",
        tie_from_previous: false,
        tie_to_next: noteEnd > range.end + 0.000001
      })
      cursor = cleanBeat(onset.startBeat + duration.beats)
    }

    if (cursor < range.end - 0.000001) {
      slots.push(...restSlots(cursor, range.end - cursor, `measure-${range.number}-after`))
    }

    return {
      number: range.number,
      start_beat: range.start,
      end_beat: range.end,
      partial: range.partial,
      slots
    }
  })

  const allSlots = measures.flatMap((measure) => measure.slots)
  const projection: InstrumentNotationProjection = {
    schema_version: 1,
    semantics: "musicxml_4_0_guitar_subset",
    renderer: "vexflow_5_svg",
    timing_authority: "canonical_midi_events",
    divisions_per_quarter: 960,
    meter: {
      beats,
      beat_type: beatType,
      measure_duration_beats: measureDurationBeats
    },
    clef: { sign: "G", line: 2, octave_change: -1 },
    transposition: { chromatic: 0, octave_change: -1, sounding_to_written_semitones: 12 },
    staves: [
      { number: 1, kind: "standard_notation", lines: 5 },
      { number: 2, kind: "tablature", lines: 6, show_rhythm: true }
    ],
    measures,
    summary: {
      measure_count: measures.length,
      chord_slot_count: allSlots.filter((slot) => slot.kind === "chord").length,
      rest_slot_count: allSlots.filter((slot) => slot.kind === "rest").length,
      event_reference_count: allSlots.reduce(
        (count, slot) => count + (slot.kind === "chord" ? slot.event_ids.length : 0),
        0
      ),
      quantized_slot_count: allSlots.filter(
        (slot) => slot.kind === "chord" && slot.quantization_error_beats > 0.000001
      ).length,
      partial_measure_count: measures.filter((measure) => measure.partial).length
    }
  }

  return Schema.decodeUnknownSync(InstrumentNotationProjectionSchema)(
    projection
  ) as InstrumentNotationProjection
}
