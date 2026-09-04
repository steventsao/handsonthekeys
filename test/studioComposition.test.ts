import { describe, expect, it } from "vitest"
import * as Schema from "effect/Schema"
import {
  WriteTracksInput,
  expandArpeggio,
  expandChordProgression,
  instrumentByAlias
} from "../src/studio/studioComposition.ts"

describe("Studio composition shorthands", () => {
  it("expands named chords, sevenths, and slash bass notes", () => {
    const progression = expandChordProgression({
      symbols: ["Am7", "Fmaj7", "C/E"],
      start_beat: 8,
      beats_per_chord: 4,
      octave: 3,
      voicing: "close",
      gate: 0.9,
      velocity: 88
    })

    expect(progression.note_count).toBe(12)
    expect(progression.end_beat).toBe(20)
    expect(progression.notes.filter((note) => note.start_beat === 8).map((note) => note.pitch)).toEqual([
      57, 60, 64, 67
    ])
    expect(progression.notes.filter((note) => note.start_beat === 12).map((note) => note.pitch)).toEqual([
      53, 57, 60, 64
    ])
    expect(progression.notes.filter((note) => note.start_beat === 16).map((note) => note.pitch)).toEqual([
      40, 48, 52, 55
    ])
    expect(progression.notes.every((note) => note.duration_beats === 3.6)).toBe(true)
  })

  it("expands multi-octave up-down arpeggios without exposing raw note construction", () => {
    const arpeggio = expandArpeggio({
      symbols: ["C"],
      start_beat: 0,
      beats_per_chord: 4,
      step_beats: 0.5,
      octave: 4,
      octaves: 2,
      direction: "up_down"
    })

    expect(arpeggio.note_count).toBe(8)
    expect(arpeggio.notes.map((note) => note.pitch)).toEqual([60, 64, 67, 72, 76, 79, 76, 72])
    expect(arpeggio.notes.map((note) => note.start_beat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  })

  it("maps friendly instrument aliases to exact General MIDI programs and channels", () => {
    expect(instrumentByAlias("warm_pad")).toMatchObject({ program: 89, channel: 0, family: "pad" })
    expect(instrumentByAlias("saw_lead")).toMatchObject({ program: 81, channel: 0, family: "lead" })
    expect(instrumentByAlias("standard_drums")).toMatchObject({
      program: 0,
      channel: 9,
      family: "drums"
    })
  })

  it("accepts only factual reference metadata for a replacement practice bed", () => {
    const decode = Schema.decodeUnknownSync(WriteTracksInput, { onExcessProperty: "error" })
    const practiceBed = {
      request_id: "practice-bed-schema",
      mode: "replace_session",
      basis: {
        kind: "reference_practice_bed",
        reference_title: "Requested Pop Song",
        reference_artist: "Reference Artist",
        approximate_bpm: 99,
        key: "E major",
        meter: { numerator: 4, denominator: 4 },
        harmonic_vocabulary: ["E", "B", "C#m", "A"],
        factual_sources: ["https://example.com/facts"],
        arrangement: "new_original_accompaniment",
        excludes: "lyrics_melody_signature_riffs_exact_arrangement_source_notation_or_recordings"
      },
      tracks: [
        {
          name: "Original Practice Chords",
          instrument: "electric_piano",
          notes: [{ pitch: "E3", start_beat: 0, duration_beats: 4 }]
        }
      ]
    }

    expect(decode(practiceBed)).toMatchObject({
      mode: "replace_session",
      basis: { kind: "reference_practice_bed", approximate_bpm: 99 }
    })
    expect(() =>
      decode({
        ...practiceBed,
        basis: { ...practiceBed.basis, lyrics: "not accepted" }
      })
    ).toThrow()
    expect(() =>
      decode({
        ...practiceBed,
        basis: { ...practiceBed.basis, source_midi_url: "https://example.com/source.mid" }
      })
    ).toThrow()
    expect(() => decode({ ...practiceBed, mode: "append" })).toThrow()
  })
})
