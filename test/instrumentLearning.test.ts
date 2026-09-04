import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  canonicalInstrumentLearningUrl,
  guitarStandardTuning,
  guitarTabEvents,
  initialInstrumentLearningState,
  instrumentLearningModeOfLocation,
  instrumentTabViewOf,
  InstrumentLearning,
  type LearningTransportCommand
} from "../src/studio/InstrumentLearning.ts"
import { notationProjectionOf } from "../src/studio/MusicNotation.ts"
import { initialStudioState, Studio } from "../src/studio/Studio.ts"
import { initialStudioStateForSlug } from "../src/studio/songs/catalog.ts"

describe("InstrumentLearning", () => {
  it("keeps loop writes retry-safe, lesson-revision checked, and outside the MIDI project journal", async () => {
    const layer = InstrumentLearning.layer.pipe(Layer.provideMerge(Studio.layer))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const learning = yield* InstrumentLearning
        const studio = yield* Studio
        const projectBefore = yield* studio.snapshot
        const learningBefore = yield* learning.snapshot
        const commands: LearningTransportCommand[] = []
        const controller = {
          execute: async (command: LearningTransportCommand) => {
            commands.push(command)
            return { action: command.action, status: "stopped" as const, playheadBeat: 0 }
          }
        }
        yield* learning.attachTransport(controller)

        const command = { action: "set_loop", enabled: true, startBeat: 2, endBeat: 6 } as const
        const first = yield* learning.controlTransport(
          command,
          "unit-enable-loop",
          learningBefore.lessonRevision
        )
        const replay = yield* learning.controlTransport(
          command,
          "unit-enable-loop",
          learningBefore.lessonRevision
        )
        const conflict = yield* Effect.flip(
          learning.controlTransport(
            { ...command, enabled: false },
            "unit-stale-disable-loop",
            learningBefore.lessonRevision
          )
        )
        const projectAfter = yield* studio.snapshot
        const learningAfter = yield* learning.snapshot
        return { commands, conflict, first, learningAfter, projectAfter, projectBefore, replay }
      }).pipe(Effect.provide(layer))
    )

    expect(result.commands).toEqual([{ action: "set_loop", enabled: true, startBeat: 2, endBeat: 6 }])
    expect(result.first).toMatchObject({
      action: "set_loop",
      lessonRevision: result.learningAfter.lessonRevision,
      loop: { enabled: true, startBeat: 2, endBeat: 6 }
    })
    expect(result.replay).toEqual(result.first)
    expect(result.conflict.code).toBe("lesson_revision_conflict")
    expect(result.learningAfter.lessonRevision).toBe(result.first.lessonRevision)
    expect(result.projectAfter.revision).toBe(result.projectBefore.revision)
    expect(result.projectAfter.tracks).toEqual(result.projectBefore.tracks)
  })

  it("addresses every learning surface through one canonical root route", () => {
    expect(instrumentLearningModeOfLocation("/", "?mode=session")).toBe("session")
    expect(instrumentLearningModeOfLocation("/", "?mode=tab")).toBe("tab")
    expect(instrumentLearningModeOfLocation("/", "?mode=daw")).toBe("daw")
    expect(instrumentLearningModeOfLocation("/studio.html", "?mode=tab")).toBe("tab")
    expect(instrumentLearningModeOfLocation("/studio/korobeiniki")).toBe("daw")
    expect(instrumentLearningModeOfLocation("/tab.html")).toBe("tab")
    expect(instrumentLearningModeOfLocation("/", "?mode=unknown")).toBe("session")

    expect(
      canonicalInstrumentLearningUrl("daw", "?song=afterglow&mode=tab&share=share_1234", "#transport")
    ).toBe("/?mode=daw&song=afterglow&share=share_1234#transport")
    expect(canonicalInstrumentLearningUrl("daw", "", "", "korobeiniki")).toBe("/?mode=daw&song=korobeiniki")
    expect(canonicalInstrumentLearningUrl("session", "", "", "untitled")).toBe("/?mode=session")
  })

  it("maps canonical MIDI pitches to deterministic standard-tuning strings and frets", () => {
    const events = guitarTabEvents(
      [
        { noteId: "open-low-e", midi: 40, startBeat: 0, durationBeats: 1 },
        { noteId: "open-high-e", midi: 64, startBeat: 1, durationBeats: 1 },
        { noteId: "below-guitar", midi: 35, startBeat: 2, durationBeats: 1 }
      ],
      0,
      24
    )

    expect(guitarStandardTuning.map((string) => string.name)).toEqual(["E4", "B3", "G3", "D3", "A2", "E2"])
    expect(events[0]).toMatchObject({
      noteId: "open-low-e",
      stringNumber: 6,
      fret: 0,
      playable: true
    })
    expect(events[1]).toMatchObject({
      noteId: "open-high-e",
      stringNumber: 1,
      fret: 0,
      playable: true
    })
    expect(events[2]).toMatchObject({
      noteId: "below-guitar",
      stringNumber: null,
      fret: null,
      playable: false
    })
  })

  it("uses distinct strings for simultaneous notes instead of inventing an impossible tab chord", () => {
    const chord = guitarTabEvents(
      [
        { noteId: "e", midi: 64, startBeat: 4, durationBeats: 2 },
        { noteId: "g-sharp", midi: 68, startBeat: 4, durationBeats: 2 },
        { noteId: "b", midi: 71, startBeat: 4, durationBeats: 2 }
      ],
      5,
      24
    )

    expect(chord).toHaveLength(3)
    expect(new Set(chord.map((event) => event.stringNumber)).size).toBe(3)
    expect(chord.every((event) => event.playable)).toBe(true)
  })

  it("projects a bounded rights-aware tab view from the same Studio revision", () => {
    const studio = initialStudioState()
    const learning = initialInstrumentLearningState(studio)
    const view = instrumentTabViewOf(studio, learning)

    expect(view.representation).toBe("derived_from_canonical_midi")
    expect(view.project_id).toBe(studio.projectId)
    expect(view.project_revision).toBe(studio.revision)
    expect(view.source_track.track_id).toBe(learning.lesson.trackId)
    expect(view.metronome).toEqual({
      enabled: false,
      follows_project_tempo: true,
      accented_downbeat: true,
      included_in_export: false,
      independently_enabled: true,
      clock_source: "shared_daw_transport",
      rephases_with_track_start: true
    })
    expect(view.transport).toEqual({
      shared_engine: "canonical_daw",
      loop_enabled: false,
      loop_start_beat: learning.transportLoop.startBeat,
      loop_end_beat: learning.transportLoop.endBeat
    })
    expect(view.summary.returned_event_count).toBeLessThanOrEqual(192)
    expect(view.rights.policy).toBe("original_or_cleared_material_only")
    expect(view.rights.source_kind).toBe("licensed_or_public_domain")
    expect(view.events.every((event) => event.note_id.length > 0)).toBe(true)

    const originalView = instrumentTabViewOf(
      {
        ...studio,
        attribution:
          studio.attribution === null
            ? null
            : { ...studio.attribution, licenseName: "Project-authored original" }
      },
      learning
    )
    expect(originalView.rights.source_kind).toBe("original")
  })

  it("backs paired standard notation and TAB with the exact same bounded event IDs", () => {
    const studio = initialStudioStateForSlug("afterglow")
    const view = instrumentTabViewOf(studio, initialInstrumentLearningState(studio))
    const notationEventIds = view.notation.measures.flatMap((measure) =>
      measure.slots.flatMap((slot) => (slot.kind === "chord" ? slot.event_ids : []))
    )

    expect(view.notation).toMatchObject({
      semantics: "musicxml_4_0_guitar_subset",
      renderer: "vexflow_5_svg",
      timing_authority: "canonical_midi_events",
      divisions_per_quarter: 960,
      clef: { sign: "G", line: 2, octave_change: -1 },
      staves: [
        { number: 1, kind: "standard_notation", lines: 5 },
        { number: 2, kind: "tablature", lines: 6, show_rhythm: true }
      ]
    })
    expect(new Set(notationEventIds)).toEqual(new Set(view.events.map((event) => event.note_id)))
    expect(view.notation.summary.event_reference_count).toBe(view.events.length)
    expect(view.notation.summary.quantized_slot_count).toBe(0)
  })

  it("separates written rhythm from performed MIDI gates without changing either timing source", () => {
    const notation = notationProjectionOf({
      startBeat: 0,
      endBeat: 1,
      timeSignature: [4, 4],
      events: [
        {
          note_id: "first",
          pitch: 64,
          start_beat: 0,
          duration_beats: 0.39,
          string_number: 1,
          fret: 0,
          playable: true
        },
        {
          note_id: "second",
          pitch: 66,
          start_beat: 0.5,
          duration_beats: 0.39,
          string_number: 1,
          fret: 2,
          playable: true
        }
      ]
    })
    const chordSlots = notation.measures.flatMap((measure) =>
      measure.slots.filter((slot) => slot.kind === "chord")
    )

    expect(chordSlots).toHaveLength(2)
    expect(chordSlots[0]).toMatchObject({
      start_beat: 0,
      event_ids: ["first"],
      duration: { type: "eighth", beats: 0.5, vexflow: "8" },
      duration_source: "inter_onset_rhythm",
      articulation: "staccato",
      quantization_error_beats: 0
    })
  })

  it("groups a collision-free guitar chord into one synchronized notation slot", () => {
    const notation = notationProjectionOf({
      startBeat: 4,
      endBeat: 8,
      timeSignature: [4, 4],
      events: [
        {
          note_id: "e",
          pitch: 64,
          start_beat: 4,
          duration_beats: 2,
          string_number: 2,
          fret: 5,
          playable: true
        },
        {
          note_id: "g-sharp",
          pitch: 68,
          start_beat: 4,
          duration_beats: 2,
          string_number: 1,
          fret: 4,
          playable: true
        }
      ]
    })
    const chord = notation.measures[0]?.slots.find((slot) => slot.kind === "chord")

    expect(chord).toMatchObject({
      event_ids: ["g-sharp", "e"],
      duration: { type: "half", beats: 2, vexflow: "h" }
    })
    expect(notation.summary).toMatchObject({
      chord_slot_count: 1,
      event_reference_count: 2,
      rest_slot_count: 1
    })
  })
})
