import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { Studio, studioMidiView, studioOperationStateView } from "../src/studio/Studio.ts"
import type { StudioSharePayload } from "../src/studio/studioShareContract.ts"

describe("Studio service", () => {
  it.effect("emits each accepted mutation once for presentation subscribers", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const eventsFiber = yield* studio.mutationChanges.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Effect.yieldNow

      const first = yield* studio.setTempo(126, {
        requestId: "presentation-event-tempo",
        expectedRevision: 1,
        actor: "AGENT"
      })
      const replay = yield* studio.setTempo(126, {
        requestId: "presentation-event-tempo",
        expectedRevision: 1,
        actor: "AGENT"
      })
      yield* studio.setTrackMix(
        "track-drums",
        { volume: 0.61 },
        {
          requestId: "presentation-event-mix",
          expectedRevision: first.revision,
          actor: "AGENT"
        }
      )

      const events = Array.from(yield* Fiber.join(eventsFiber))
      assert.strictEqual(replay.replayed, true)
      assert.deepStrictEqual(
        events.map((event) => [event.requestId, event.action, event.revisionAfter]),
        [
          ["presentation-event-tempo", "set_tempo", 2],
          ["presentation-event-mix", "set_track_mix", 3]
        ]
      )
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("exposes the seeded composition as one complete canonical MIDI document", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const state = yield* studio.snapshot
      const document = studioMidiView(state)

      assert.isTrue(state.tracks.every((track) => track.kind === "midi"))
      assert.strictEqual(document.schema_version, 6)
      assert.strictEqual(document.representation, "canonical_midi_event_session")
      assert.strictEqual(document.complete_session, true)
      assert.strictEqual(document.timebase, "absolute_zero_based_quarter_note_beats")
      assert.strictEqual(document.ppq, 960)
      assert.deepStrictEqual(document.tempo_map, [{ beat: 0, bpm: 138 }])
      assert.deepStrictEqual(document.meter_map, [{ beat: 0, numerator: 4, denominator: 4 }])
      assert.deepStrictEqual(document.selection, { start_beat: 16, end_beat: 32 })
      assert.strictEqual(document.karaoke_count_in_beats, 4)
      assert.isNull(document.practice_bed)
      assert.strictEqual(document.summary.midi_track_count, 9)
      assert.strictEqual(document.summary.midi_clip_count, 9)
      assert.strictEqual(document.summary.note_count, 605)
      assert.strictEqual(document.summary.referenced_audio_asset_count, 0)
      assert.strictEqual(document.referenced_audio_assets.length, 0)
      assert.deepStrictEqual(document.song, {
        slug: "korobeiniki",
        attribution: {
          title: "Tetris forever",
          creator: "rocavaco",
          source_url: "https://ccmixter.org/files/rocavaco/44418",
          license_name: "CC BY 3.0",
          license_url: "https://creativecommons.org/licenses/by/3.0/",
          source_midi_url: "/studio-songs/korobeiniki.mid",
          source_midi_sha256: "84c71f223e62419ecbbb58b4a9a114ded11ab5c7d4ec394b4f97c20815c0b67e",
          changes:
            "Track labels and General MIDI programs normalized, tempo set to 138 BPM, and an original pop drum part added for Signal Studio."
        }
      })
      assert.isTrue(
        document.tracks.every((track) =>
          track.clips.every(
            (clip) => clip.notes.length > 0 && clip.notes.every((note) => note.note_id !== "")
          )
        )
      )
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("stages symbolic MIDI non-destructively and applies as one undoable transaction", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const initial = yield* studio.snapshot
      const initialClipCount = initial.tracks.reduce((count, track) => count + track.clips.length, 0)

      const staged = yield* studio.stagePart("Add a glassy analog lead", {
        requestId: "stage-lead",
        expectedRevision: initial.revision
      })
      const afterStage = yield* studio.snapshot

      assert.strictEqual(staged.change, "part_staged")
      assert.strictEqual(afterStage.tracks.length, initial.tracks.length)
      assert.strictEqual(
        afterStage.tracks.reduce((count, track) => count + track.clips.length, 0),
        initialClipCount
      )
      assert.strictEqual(afterStage.historyDepth, 0)
      assert.isNotNull(afterStage.preview)
      assert.strictEqual(afterStage.preview?.clip.kind, "midi")
      assert.isAbove(afterStage.preview?.clip.notes.length ?? 0, 0)

      yield* studio.applyPreview(afterStage.preview!.id, {
        requestId: "apply-lead",
        expectedRevision: afterStage.revision
      })
      const afterApply = yield* studio.snapshot

      assert.strictEqual(afterApply.preview, null)
      assert.strictEqual(afterApply.historyDepth, 1)
      assert.strictEqual(
        afterApply.tracks.reduce((count, track) => count + track.clips.length, 0),
        initialClipCount + 1
      )

      yield* studio.undo({ requestId: "undo-lead", expectedRevision: afterApply.revision })
      const afterUndo = yield* studio.snapshot
      assert.strictEqual(afterUndo.tracks.length, initial.tracks.length)
      assert.strictEqual(afterUndo.historyDepth, 0)
      assert.strictEqual(afterUndo.redoDepth, 1)

      yield* studio.redo({ requestId: "redo-lead", expectedRevision: afterUndo.revision })
      const afterRedo = yield* studio.snapshot
      assert.strictEqual(afterRedo.historyDepth, 1)
      assert.strictEqual(afterRedo.redoDepth, 0)
      assert.strictEqual(
        afterRedo.tracks.reduce((count, track) => count + track.clips.length, 0),
        initialClipCount + 1
      )
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("stages an exact semitone key change and applies it without timing drift", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const before = yield* studio.snapshot
      const beforeClip = studioMidiView(before).tracks.find((track) => track.track_id === "track-piano-lead")
        ?.clips[0]
      const beforeSelected = beforeClip?.notes.filter(
        (note) => note.start_beat < 32 && note.start_beat + note.duration_beats > 16
      )

      const transposition = {
        semitones: -3,
        startBeat: 16,
        endBeat: 32,
        trackIds: ["track-piano-lead"]
      } as const
      const stagingOptions = { requestId: "stage-key-down-three", expectedRevision: before.revision }
      const staged = yield* studio.stageMidiTransposition(transposition, stagingOptions)
      const afterStage = yield* studio.snapshot

      assert.strictEqual(staged.change, "midi_transposition_staged")
      assert.strictEqual(staged.semitones, -3)
      assert.isAbove(staged.notesAffected, 0)
      assert.strictEqual(afterStage.historyDepth, 0)
      assert.strictEqual(afterStage.preview?.kind, "midi_transposition")
      assert.deepStrictEqual(
        studioMidiView(afterStage).tracks.find((track) => track.track_id === "track-piano-lead")?.clips[0]
          ?.notes,
        beforeClip?.notes
      )

      const replay = yield* studio.stageMidiTransposition(transposition, stagingOptions)
      const conflictingReplay = yield* Effect.flip(
        studio.stageMidiTransposition({ ...transposition, semitones: -2 }, stagingOptions)
      )
      const afterReplay = yield* studio.snapshot
      assert.strictEqual(replay.replayed, true)
      assert.strictEqual(replay.revision, staged.revision)
      assert.strictEqual(conflictingReplay.code, "request_id_conflict")
      assert.strictEqual(afterReplay.revision, afterStage.revision)
      assert.strictEqual(afterReplay.mutationCount, afterStage.mutationCount)

      yield* studio.applyPreview(staged.previewId, {
        requestId: "apply-key-down-three",
        expectedRevision: afterStage.revision
      })
      const applied = yield* studio.snapshot
      const appliedSelected = studioMidiView(applied)
        .tracks.find((track) => track.track_id === "track-piano-lead")
        ?.clips[0]?.notes.filter((note) => note.start_beat < 32 && note.start_beat + note.duration_beats > 16)

      assert.strictEqual(applied.preview, null)
      assert.strictEqual(applied.historyDepth, 1)
      assert.deepStrictEqual(
        appliedSelected?.map((note) => [note.note_id, note.pitch, note.start_beat, note.duration_beats]),
        beforeSelected?.map((note) => [note.note_id, note.pitch - 3, note.start_beat, note.duration_beats])
      )

      yield* studio.undo({ requestId: "undo-key-down-three", expectedRevision: applied.revision })
      const undone = yield* studio.snapshot
      assert.deepStrictEqual(
        studioMidiView(undone).tracks.find((track) => track.track_id === "track-piano-lead")?.clips[0]?.notes,
        beforeClip?.notes
      )

      yield* studio.redo({ requestId: "redo-key-down-three", expectedRevision: undone.revision })
      const redone = yield* studio.snapshot
      assert.deepStrictEqual(
        studioMidiView(redone)
          .tracks.find((track) => track.track_id === "track-piano-lead")
          ?.clips[0]?.notes.filter(
            (note) => note.start_beat < 32 && note.start_beat + note.duration_beats > 16
          )
          .map((note) => note.pitch),
        beforeSelected?.map((note) => note.pitch - 3)
      )
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("stages authorized lyric tokens against canonical MIDI and applies an undoable guide", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const before = yield* studio.snapshot
      const guide = {
        lyrics: "SING TOGETHER NOW",
        melodyTrackId: "track-piano-lead",
        startBeat: 16,
        endBeat: 32,
        title: "Demo chorus"
      } as const
      const stagingOptions = { requestId: "stage-demo-karaoke", expectedRevision: before.revision }
      const staged = yield* studio.stageKaraokeGuide(guide, stagingOptions)
      const afterStage = yield* studio.snapshot

      assert.strictEqual(staged.change, "karaoke_guide_staged")
      assert.strictEqual(staged.tokenCount, 3)
      assert.strictEqual(afterStage.karaokeGuide, null)
      assert.strictEqual(afterStage.preview?.kind, "karaoke_guide")
      assert.strictEqual(afterStage.historyDepth, 0)

      const replay = yield* studio.stageKaraokeGuide(guide, stagingOptions)
      const conflictingReplay = yield* Effect.flip(
        studio.stageKaraokeGuide({ ...guide, lyrics: "DIFFERENT WORDS" }, stagingOptions)
      )
      const afterReplay = yield* studio.snapshot
      assert.strictEqual(replay.replayed, true)
      assert.strictEqual(replay.revision, staged.revision)
      assert.strictEqual(conflictingReplay.code, "request_id_conflict")
      assert.strictEqual(afterReplay.revision, afterStage.revision)
      assert.strictEqual(afterReplay.mutationCount, afterStage.mutationCount)

      yield* studio.applyPreview(staged.previewId, {
        requestId: "apply-demo-karaoke",
        expectedRevision: afterStage.revision
      })
      const applied = yield* studio.snapshot
      const document = studioMidiView(applied)
      assert.deepStrictEqual(
        applied.karaokeGuide?.tokens.map((token) => token.text),
        ["SING", "TOGETHER", "NOW"]
      )
      assert.strictEqual(document.karaoke_guide?.melody_track_id, "track-piano-lead")
      assert.deepStrictEqual(
        document.karaoke_guide?.tokens.map((token) => token.expected_pitch_name),
        applied.karaokeGuide?.tokens
          .map((token) => token.expectedMidi)
          .map((midi) => {
            const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
            return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
          })
      )
      assert.strictEqual(applied.historyDepth, 1)

      yield* studio.undo({ requestId: "undo-demo-karaoke", expectedRevision: applied.revision })
      assert.strictEqual((yield* studio.snapshot).karaokeGuide, null)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("configures an undoable karaoke count-in as shared agent-visible state", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const before = yield* studio.snapshot
      const options = { requestId: "count-in-eight", expectedRevision: before.revision } as const

      const updated = yield* studio.setKaraokeCountIn(8, options)
      const after = yield* studio.snapshot

      assert.strictEqual(updated.change, "karaoke_count_in_updated")
      assert.strictEqual(updated.replayed, false)
      assert.strictEqual(after.karaokeCountInBeats, 8)
      assert.strictEqual(after.historyDepth, before.historyDepth + 1)
      assert.strictEqual(studioMidiView(after).karaoke_count_in_beats, 8)
      assert.strictEqual(studioOperationStateView(after).karaoke_count_in_beats, 8)

      const replay = yield* studio.setKaraokeCountIn(8, options)
      assert.strictEqual(replay.replayed, true)
      assert.strictEqual((yield* studio.snapshot).mutationCount, after.mutationCount)

      yield* studio.undo({ requestId: "undo-count-in", expectedRevision: after.revision })
      const undone = yield* studio.snapshot
      assert.strictEqual(undone.karaokeCountInBeats, 4)

      yield* studio.redo({ requestId: "redo-count-in", expectedRevision: undone.revision })
      assert.strictEqual((yield* studio.snapshot).karaokeCountInBeats, 8)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("commits a multi-track MIDI composition atomically as one undoable transaction", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const before = yield* studio.snapshot
      const composition = {
        mode: "append",
        basis: { kind: "original" },
        tracks: [
          {
            trackName: "Code Chords",
            clipName: "Am to F",
            program: 89,
            channel: 0,
            volume: 0.6,
            notes: [
              { pitch: "A3", startBeat: 0, durationBeats: 4 },
              { pitch: "C4", startBeat: 0, durationBeats: 4 },
              { pitch: "F3", startBeat: 4, durationBeats: 4 }
            ]
          },
          {
            trackName: "Code Arp",
            clipName: "Eighth-note arp",
            program: 81,
            channel: 0,
            pan: 0.2,
            notes: [
              { pitch: "A4", startBeat: 0, durationBeats: 0.4 },
              { pitch: "C5", startBeat: 0.5, durationBeats: 0.4 }
            ]
          }
        ]
      } as const
      const options = { requestId: "atomic-code-composition", expectedRevision: before.revision }
      const composed = yield* studio.composeMidi(composition, options)
      const after = yield* studio.snapshot

      assert.strictEqual(composed.change, "midi_composition_created")
      assert.strictEqual(composed.tracksCreated, 2)
      assert.strictEqual(composed.notesWritten, 5)
      assert.strictEqual(after.revision, before.revision + 1)
      assert.strictEqual(after.historyDepth, before.historyDepth + 1)
      assert.strictEqual(after.tracks.length, before.tracks.length + 2)
      assert.strictEqual(after.mutationCount, before.mutationCount + 1)
      assert.deepStrictEqual(
        composed.tracks.map((track) => [track.trackName, track.program]),
        [
          ["Code Chords", 89],
          ["Code Arp", 81]
        ]
      )

      const replay = yield* studio.composeMidi(composition, options)
      const conflictingReplay = yield* Effect.flip(
        studio.composeMidi(
          {
            ...composition,
            tracks: [{ ...composition.tracks[0], trackName: "Different composition" }]
          },
          options
        )
      )
      const afterReplay = yield* studio.snapshot
      assert.strictEqual(replay.replayed, true)
      assert.strictEqual(replay.revision, composed.revision)
      assert.strictEqual(conflictingReplay.code, "request_id_conflict")
      assert.strictEqual(afterReplay.revision, after.revision)
      assert.strictEqual(afterReplay.mutationCount, after.mutationCount)

      yield* studio.undo({ requestId: "undo-atomic-code-composition", expectedRevision: after.revision })
      const undone = yield* studio.snapshot
      assert.strictEqual(undone.tracks.length, before.tracks.length)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("replaces the session with an auditable facts-only original practice bed", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const before = yield* studio.snapshot
      const basis = {
        kind: "reference_practice_bed",
        reference_title: "Requested Pop Song",
        reference_artist: "Reference Artist",
        approximate_bpm: 99,
        key: "E major",
        meter: { numerator: 4, denominator: 4 },
        harmonic_vocabulary: ["E", "B", "C#m", "A"],
        factual_sources: ["https://example.com/song-facts"],
        arrangement: "new_original_accompaniment",
        excludes: "lyrics_melody_signature_riffs_exact_arrangement_source_notation_or_recordings"
      } as const

      const composed = yield* studio.composeMidi(
        {
          mode: "replace_session",
          basis,
          tracks: [
            {
              trackName: "Original Practice Chords",
              clipName: "New Voicing",
              program: 4,
              channel: 0,
              notes: [
                { pitch: "E3", startBeat: 0, durationBeats: 4 },
                { pitch: "G#3", startBeat: 0, durationBeats: 4 }
              ]
            }
          ]
        },
        { requestId: "reference-practice-bed", expectedRevision: before.revision }
      )
      const after = yield* studio.snapshot
      const document = studioMidiView(after)
      const mutations = yield* studio.mutationHistory({ actions: ["compose_midi"] })

      assert.strictEqual(composed.mode, "replace_session")
      assert.deepStrictEqual(composed.basis, basis)
      assert.strictEqual(after.title, "Requested Pop Song · ORIGINAL PRACTICE BED")
      assert.strictEqual(after.songSlug, "practice-bed")
      assert.isNull(after.attribution)
      assert.strictEqual(after.bpm, 99)
      assert.deepStrictEqual(after.timeSignature, [4, 4])
      assert.strictEqual(after.tracks.length, 1)
      assert.deepStrictEqual(after.practiceBed, basis)
      assert.isNull(after.karaokeGuide)
      assert.deepStrictEqual(document.practice_bed, basis)
      assert.deepStrictEqual(document.song, { slug: "practice-bed", attribution: null })
      assert.deepStrictEqual(mutations.mutations.at(-1)?.input.basis, basis)

      yield* studio.undo({ requestId: "undo-reference-practice-bed", expectedRevision: after.revision })
      const undone = yield* studio.snapshot
      assert.strictEqual(undone.title, before.title)
      assert.strictEqual(undone.songSlug, before.songSlug)
      assert.strictEqual(undone.bpm, before.bpm)
      assert.strictEqual(undone.tracks.length, before.tracks.length)
      assert.isNull(undone.practiceBed)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("replays duplicate request IDs without applying the mutation twice", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const first = yield* studio.stagePart("Add syncopated drums", {
        requestId: "idempotent-stage",
        expectedRevision: 1
      })
      const firstState = yield* studio.snapshot
      const second = yield* studio.stagePart("Add syncopated drums", {
        requestId: "idempotent-stage",
        expectedRevision: 1
      })
      const changedPayload = yield* Effect.flip(
        studio.stagePart("This different prompt must not run", {
          requestId: "idempotent-stage",
          expectedRevision: 1
        })
      )
      const conflict = yield* Effect.flip(
        studio.setTempo(120, {
          requestId: "idempotent-stage",
          expectedRevision: 1
        })
      )
      const secondState = yield* studio.snapshot

      assert.strictEqual(first.replayed, false)
      assert.strictEqual(second.replayed, true)
      assert.strictEqual(second.revision, first.revision)
      assert.strictEqual(changedPayload.code, "request_id_conflict")
      assert.strictEqual(conflict.code, "request_id_conflict")
      assert.strictEqual(secondState.revision, firstState.revision)
      assert.strictEqual(secondState.preview?.id, firstState.preview?.id)
      assert.strictEqual(secondState.preview?.clip.kind, "midi")
      assert.strictEqual(secondState.bpm, 138)
      assert.strictEqual(secondState.mutationCount, 1)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("journals accepted mutations once with actor, revisions, inputs, and cursor filters", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const empty = yield* studio.mutationHistory({})
      assert.strictEqual(empty.schemaVersion, 2)
      assert.strictEqual(empty.retentionLimit, 2_048)
      assert.strictEqual(empty.totalMutationCount, 0)
      assert.strictEqual(empty.nextCursor, 0)
      assert.deepStrictEqual(empty.mutations, [])

      const selected = yield* studio.selectBeatRange(8, 24, {
        requestId: "journal-selection",
        expectedRevision: 1,
        actor: "AGENT"
      })
      yield* studio.selectBeatRange(8, 24, {
        requestId: "journal-selection",
        expectedRevision: 1,
        actor: "AGENT"
      })
      yield* Effect.flip(
        studio.setTempo(132, {
          requestId: "journal-stale-tempo",
          expectedRevision: 99,
          actor: "AGENT"
        })
      )
      const midi = yield* studio.writeMidi(
        {
          mode: "create",
          trackName: "Journaled MIDI",
          notes: [{ pitch: "C4", startBeat: 0, durationBeats: 1, velocity: 101 }]
        },
        {
          requestId: "journal-midi",
          expectedRevision: selected.revision,
          actor: "AGENT"
        }
      )

      const history = yield* studio.mutationHistory({ limit: 10 })
      const state = yield* studio.snapshot
      assert.strictEqual(history.totalMutationCount, 2)
      assert.strictEqual(state.mutationCount, 2)
      assert.strictEqual(history.nextCursor, 2)
      assert.strictEqual(history.hasMore, false)
      assert.strictEqual(history.hasOlder, false)
      assert.strictEqual(history.context.selectionStartBeat, 8)
      assert.strictEqual(history.context.selectionEndBeat, 24)
      assert.deepStrictEqual(
        history.mutations.map((event) => [
          event.sequence,
          event.actor,
          event.action,
          event.revisionBefore,
          event.revisionAfter,
          event.requestId
        ]),
        [
          [1, "AGENT", "select_beat_range", 1, 2, "journal-selection"],
          [2, "AGENT", "write_midi", 2, 3, "journal-midi"]
        ]
      )
      assert.match(history.mutations[0]?.recordedAt ?? "", /^\d{4}-\d{2}-\d{2}T/)
      assert.deepStrictEqual(history.mutations[0]?.input, { start_beat: 8, end_beat: 24 })
      assert.deepStrictEqual(history.mutations[1]?.targets, {
        trackId: midi.trackId,
        clipId: midi.clipId
      })
      assert.deepStrictEqual(history.mutations[1]?.input, {
        mode: "create",
        notes: [{ pitch: "C4", start_beat: 0, duration_beats: 1, velocity: 101 }],
        track_name: "Journaled MIDI"
      })

      const newest = yield* studio.mutationHistory({ limit: 1 })
      assert.deepStrictEqual(
        newest.mutations.map((event) => event.action),
        ["write_midi"]
      )
      assert.strictEqual(newest.hasOlder, true)

      const polled = yield* studio.mutationHistory({
        afterSequence: 1,
        actions: ["write_midi"],
        limit: 1
      })
      assert.deepStrictEqual(
        polled.mutations.map((event) => event.sequence),
        [2]
      )
      assert.strictEqual(polled.nextCursor, 2)

      const noNewEvents = yield* studio.mutationHistory({ afterSequence: polled.nextCursor })
      assert.deepStrictEqual(noNewEvents.mutations, [])
      assert.strictEqual(noNewEvents.nextCursor, 2)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("rejects stale revisions without corrupting state", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const error = yield* Effect.flip(
        studio.setTempo(132, { requestId: "stale-tempo", expectedRevision: 99 })
      )
      const state = yield* studio.snapshot

      assert.strictEqual(error._tag, "StudioRuleError")
      assert.strictEqual(error.code, "revision_conflict")
      assert.strictEqual(error.currentRevision, 1)
      assert.strictEqual(state.bpm, 138)
      assert.strictEqual(state.revision, 1)
      assert.strictEqual(state.historyDepth, 0)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("rejects invalid selections", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const backwards = yield* Effect.flip(
        studio.selectBeatRange(24, 16, { requestId: "backwards-selection" })
      )
      const tooLong = yield* Effect.flip(studio.selectBeatRange(0, 100, { requestId: "long-selection" }))
      const belowResolution = yield* Effect.flip(
        studio.selectBeatRange(0, 0.00000001, { requestId: "sub-microbeat-selection" })
      )

      assert.strictEqual(backwards.code, "invalid_selection")
      assert.strictEqual(tooLong.code, "invalid_selection")
      assert.strictEqual(belowResolution.code, "invalid_selection")
      const state = yield* studio.snapshot
      assert.deepStrictEqual(state.selection, { start: (16 * 60) / 138, end: (32 * 60) / 138 })
      assert.strictEqual(state.revision, 1)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("preserves the minimum canonical beat resolution", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const before = studioMidiView(yield* studio.snapshot)
      const invalidMidi = yield* Effect.flip(
        studio.writeMidi(
          {
            mode: "create",
            notes: [{ pitch: "C4", startBeat: 0, durationBeats: 0.00000001 }]
          },
          { requestId: "sub-microbeat-midi", expectedRevision: 1 }
        )
      )

      assert.strictEqual(invalidMidi.code, "invalid_midi")
      assert.deepStrictEqual(studioMidiView(yield* studio.snapshot), before)

      yield* studio.selectBeatRange(0, 0.000001, {
        requestId: "minimum-selection",
        expectedRevision: 1
      })
      yield* studio.stagePart("tiny lead", {
        requestId: "minimum-stage",
        expectedRevision: 2
      })
      const staged = studioMidiView(yield* studio.snapshot)

      assert.deepStrictEqual(staged.selection, { start_beat: 0, end_beat: 0.000001 })
      assert.strictEqual(staged.pending_preview?.clip?.duration_beats, 0.000001)
      assert.isTrue(
        staged.pending_preview?.clip?.notes.every(
          (note) => note.duration_beats >= 0.000001 && note.start_beat + note.duration_beats <= 0.000001
        ) ?? false
      )

      const created = yield* studio.writeMidi(
        {
          mode: "create",
          notes: [{ pitch: "C4", startBeat: 0, durationBeats: 0.000001 }]
        },
        { requestId: "minimum-midi", expectedRevision: 3 }
      )
      const document = studioMidiView(yield* studio.snapshot)
      const clip = document.tracks
        .flatMap((track) => track.clips)
        .find((candidate) => candidate.clip_id === created.clipId)

      assert.strictEqual(clip?.duration_beats, 0.000001)
      assert.strictEqual(clip?.notes[0]?.duration_beats, 0.000001)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("creates editable note data for staged MIDI parts", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      yield* studio.selectBeatRange(8, 16, { requestId: "midi-range" })
      yield* studio.stagePart("Write a minor-key bass hook", {
        requestId: "midi-stage",
        expectedRevision: 2
      })
      const state = yield* studio.snapshot

      assert.strictEqual(state.preview?.clip.kind, "midi")
      assert.isAbove(state.preview?.clip.notes.length ?? 0, 0)
      assert.isTrue(state.preview?.clip.notes.every((note) => note.time < 4))
      assert.strictEqual(state.preview?.targetTrackId, "track-generated-midi")
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("stages piano prompts with a General MIDI piano program", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      yield* studio.stagePart("Write spacious piano chords", {
        requestId: "piano-stage",
        expectedRevision: 1
      })
      const state = yield* studio.snapshot

      assert.strictEqual(state.preview?.clip.kind, "midi")
      assert.strictEqual(state.preview?.clip.name, "Piano chords alternate")
      assert.strictEqual(state.preview?.clip.midiProgram, 0)
      assert.strictEqual(state.preview?.clip.midiChannel, 0)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("writes exact beat-based MIDI as one undoable transaction", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const created = yield* studio.writeMidi(
        {
          mode: "create",
          trackName: "AI Harmony",
          clipName: "Four-bar answer",
          program: 80,
          channel: 0,
          notes: [
            { pitch: "C4", startBeat: 4, durationBeats: 1, velocity: 100 },
            { pitch: 64, startBeat: 4, durationBeats: 0.5, velocity: 91 },
            { pitch: "Bb3", startBeat: 6, durationBeats: 1, velocity: 84 }
          ]
        },
        { requestId: "write-exact-midi", expectedRevision: 1 }
      )
      const written = yield* studio.snapshot
      const track = written.tracks.find((candidate) => candidate.id === created.trackId)
      const clip = track?.clips.find((candidate) => candidate.id === created.clipId)
      const view = studioMidiView(written)
      const viewedClip = view.tracks
        .find((candidate) => candidate.track_id === created.trackId)
        ?.clips.find((candidate) => candidate.clip_id === created.clipId)

      assert.strictEqual(created.change, "midi_created")
      assert.strictEqual(created.notesWritten, 3)
      assert.strictEqual(created.totalNotes, 3)
      assert.strictEqual(track?.kind, "midi")
      assert.strictEqual(track?.name, "AI Harmony")
      const secondsPerBeat = 60 / 138
      assert.strictEqual(clip?.start, 4 * secondsPerBeat)
      assert.strictEqual(clip?.duration, 3 * secondsPerBeat)
      assert.deepStrictEqual(
        clip?.notes.map((note) => [note.midi, note.time, note.duration, note.midiVelocity]),
        [
          [60, 0, secondsPerBeat, 100],
          [64, 0, 0.5 * secondsPerBeat, 91],
          [58, 2 * secondsPerBeat, secondsPerBeat, 84]
        ]
      )
      assert.strictEqual(view.timebase, "absolute_zero_based_quarter_note_beats")
      assert.deepStrictEqual(
        viewedClip?.notes.map((note) => [
          note.pitch_name,
          note.start_beat,
          note.duration_beats,
          note.velocity
        ]),
        [
          ["C4", 4, 1, 100],
          ["E4", 4, 0.5, 91],
          ["A#3", 6, 1, 84]
        ]
      )
      assert.strictEqual(written.historyDepth, 1)

      yield* studio.undo({ requestId: "undo-exact-midi", expectedRevision: written.revision })
      const undone = yield* studio.snapshot
      assert.isFalse(undone.tracks.some((candidate) => candidate.id === created.trackId))
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("appends idempotently while preserving stable MIDI clip and note IDs", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const created = yield* studio.writeMidi(
        {
          mode: "create",
          notes: [{ pitch: "G3", startBeat: 2, durationBeats: 1, velocity: 90 }]
        },
        { requestId: "create-before-append", expectedRevision: 1 }
      )
      const beforeAppend = yield* studio.snapshot
      const originalNoteId = studioMidiView(beforeAppend)
        .tracks.find((track) => track.track_id === created.trackId)
        ?.clips.find((clip) => clip.clip_id === created.clipId)?.notes[0]?.note_id

      const appended = yield* studio.writeMidi(
        {
          mode: "append",
          trackId: created.trackId,
          clipId: created.clipId,
          notes: [
            { pitch: "D4", startBeat: 0, durationBeats: 0.5, velocity: 70 },
            { pitch: "F4", startBeat: 4, durationBeats: 2, velocity: 105 }
          ]
        },
        { requestId: "append-midi", expectedRevision: beforeAppend.revision }
      )
      const afterAppend = yield* studio.snapshot
      const replay = yield* studio.writeMidi(
        {
          mode: "append",
          trackId: created.trackId,
          clipId: created.clipId,
          notes: [
            { pitch: "D4", startBeat: 0, durationBeats: 0.5, velocity: 70 },
            { pitch: "F4", startBeat: 4, durationBeats: 2, velocity: 105 }
          ]
        },
        { requestId: "append-midi", expectedRevision: beforeAppend.revision }
      )
      const afterReplay = yield* studio.snapshot
      const view = studioMidiView(afterReplay)
      const viewedClip = view.tracks
        .find((track) => track.track_id === created.trackId)
        ?.clips.find((clip) => clip.clip_id === created.clipId)

      assert.strictEqual(appended.clipId, created.clipId)
      assert.strictEqual(appended.totalNotes, 3)
      assert.strictEqual(replay.replayed, true)
      assert.strictEqual(replay.totalNotes, 3)
      assert.strictEqual(afterReplay.revision, afterAppend.revision)
      assert.strictEqual(viewedClip?.clip_id, created.clipId)
      assert.strictEqual(viewedClip?.start_beat, 0)
      assert.strictEqual(viewedClip?.duration_beats, 6)
      assert.strictEqual(viewedClip?.notes.length, 3)
      assert.isTrue(viewedClip?.notes.some((note) => note.note_id === originalNoteId) ?? false)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("keeps agent-authored MIDI on musical beats when tempo changes", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const created = yield* studio.writeMidi(
        {
          mode: "create",
          notes: [{ pitch: "C4", startBeat: 4, durationBeats: 2, velocity: 100 }]
        },
        { requestId: "create-before-tempo", expectedRevision: 1 }
      )
      yield* studio.setTempo(60, { requestId: "slow-tempo", expectedRevision: 2 })
      const slowed = yield* studio.snapshot
      const document = studioMidiView(slowed)
      const clip = slowed.tracks
        .find((track) => track.id === created.trackId)
        ?.clips.find((candidate) => candidate.id === created.clipId)
      const note = document.tracks
        .find((track) => track.track_id === created.trackId)
        ?.clips.find((candidate) => candidate.clip_id === created.clipId)?.notes[0]

      assert.deepStrictEqual(document.selection, { start_beat: 16, end_beat: 32 })
      assert.strictEqual(clip?.start, 4)
      assert.strictEqual(clip?.duration, 2)
      assert.strictEqual(clip?.notes[0]?.duration, 2)
      assert.strictEqual(note?.start_beat, 4)
      assert.strictEqual(note?.duration_beats, 2)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("atomically replaces MIDI notes and rejects invalid batches without state changes", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const created = yield* studio.writeMidi(
        {
          mode: "create",
          notes: [
            { pitch: "C3", startBeat: 8, durationBeats: 1 },
            { pitch: "G3", startBeat: 9, durationBeats: 1 }
          ]
        },
        { requestId: "create-before-replace", expectedRevision: 1 }
      )
      const beforeReplace = yield* studio.snapshot
      const originalNotes = studioMidiView(beforeReplace)
        .tracks.find((track) => track.track_id === created.trackId)
        ?.clips.find((clip) => clip.clip_id === created.clipId)?.notes

      yield* studio.writeMidi(
        {
          mode: "replace",
          clipId: created.clipId,
          notes: [{ pitch: "F#4", startBeat: 12, durationBeats: 4, velocity: 127 }]
        },
        { requestId: "replace-midi", expectedRevision: beforeReplace.revision }
      )
      const replaced = yield* studio.snapshot
      const replacedClip = studioMidiView(replaced)
        .tracks.find((track) => track.track_id === created.trackId)
        ?.clips.find((clip) => clip.clip_id === created.clipId)
      assert.strictEqual(replacedClip?.clip_id, created.clipId)
      assert.deepStrictEqual(
        replacedClip?.notes.map((note) => [note.pitch, note.start_beat, note.duration_beats]),
        [[66, 12, 4]]
      )
      assert.strictEqual(replaced.historyDepth, 2)

      const invalid = yield* Effect.flip(
        studio.writeMidi(
          {
            mode: "replace",
            clipId: created.clipId,
            notes: [{ pitch: "H4", startBeat: 0, durationBeats: 1 }]
          },
          { requestId: "invalid-midi", expectedRevision: replaced.revision }
        )
      )
      const afterInvalid = yield* studio.snapshot
      assert.strictEqual(invalid.code, "invalid_midi")
      assert.strictEqual(afterInvalid.revision, replaced.revision)
      assert.deepStrictEqual(studioMidiView(afterInvalid), studioMidiView(replaced))

      yield* studio.undo({ requestId: "undo-replace", expectedRevision: afterInvalid.revision })
      const restored = yield* studio.snapshot
      const restoredNotes = studioMidiView(restored)
        .tracks.find((track) => track.track_id === created.trackId)
        ?.clips.find((clip) => clip.clip_id === created.clipId)?.notes
      assert.deepStrictEqual(restoredNotes, originalNotes)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("keeps uploaded recordings as explicit references outside the symbolic score", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      yield* studio.addUploadedTrack("asset-vocal-take", "Vocal take", 5, {
        requestId: "upload-vocal-reference",
        expectedRevision: 1,
        actor: "HUMAN"
      })
      const uploaded = yield* studio.snapshot
      const document = studioMidiView(uploaded)

      assert.strictEqual(document.summary.midi_track_count, 9)
      assert.strictEqual(document.summary.note_count, 605)
      assert.strictEqual(document.summary.referenced_audio_asset_count, 1)
      assert.deepStrictEqual(document.referenced_audio_assets[0], {
        track_id: "track-upload-1",
        track_name: "Vocal take",
        clip_id: "clip-upload-1",
        clip_name: "Vocal take",
        start_beat: 16,
        duration_beats: 11.5,
        gain: 0.85,
        source: { kind: "uploaded_audio", asset_id: "asset-vocal-take" },
        mix: { volume: 0.72, pan: 0, muted: false, soloed: false }
      })

      const error = yield* Effect.flip(
        studio.writeMidi(
          {
            mode: "create",
            trackId: "track-upload-1",
            notes: [{ pitch: "C4", startBeat: 16, durationBeats: 1 }]
          },
          { requestId: "write-into-audio-reference", expectedRevision: uploaded.revision }
        )
      )
      assert.strictEqual(error.code, "invalid_midi")
      assert.deepStrictEqual(studioMidiView(yield* studio.snapshot), document)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("mix edits use stable track IDs and can be undone", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      yield* studio.setTrackMix(
        "track-electric-bass",
        { volume: 0.31, muted: true },
        {
          requestId: "mix-bass",
          expectedRevision: 1
        }
      )
      const mixed = yield* studio.snapshot
      const bass = mixed.tracks.find((track) => track.id === "track-electric-bass")
      assert.strictEqual(bass?.volume, 0.31)
      assert.strictEqual(bass?.muted, true)

      yield* studio.undo({ requestId: "undo-mix", expectedRevision: mixed.revision })
      const restored = yield* studio.snapshot
      const restoredBass = restored.tracks.find((track) => track.id === "track-electric-bass")
      assert.strictEqual(restoredBass?.volume, 0.56)
      assert.strictEqual(restoredBass?.muted, false)
    }).pipe(Effect.provide(Studio.layer))
  )

  it.effect("imports an immutable shared MIDI snapshot as one retry-safe undoable copy", () =>
    Effect.gen(function* () {
      const studio = yield* Studio
      const before = yield* studio.snapshot
      const payload: StudioSharePayload = {
        schema_version: 1,
        source_project_id: "shared-source-project",
        source_revision: 7,
        title: "Shared C Loop",
        song_slug: "shared-c-loop",
        attribution: null,
        practice_bed: null,
        bpm: 100,
        meter: { numerator: 4, denominator: 4 },
        selection: { start_beat: 0, end_beat: 4 },
        tracks: [
          {
            track_id: "track-shared-guitar",
            order: 0,
            name: "Shared Guitar",
            mix: { volume: 0.8, pan: 0, muted: false, soloed: false },
            clips: [
              {
                clip_id: "clip-shared-c-loop",
                name: "C Loop",
                gain: 0.9,
                program: 24,
                channel: 0,
                notes: [
                  {
                    note_id: "note-shared-c4",
                    pitch: 60,
                    start_beat: 0,
                    duration_beats: 4,
                    velocity: 96
                  }
                ]
              }
            ]
          }
        ],
        karaoke_guide: null,
        karaoke_count_in_beats: 4,
        lesson_configuration: {
          instrument: "guitar",
          tuning: "standard",
          track_id: "track-shared-guitar",
          start_beat: 0,
          end_beat: 4,
          hand_position: 0,
          max_fret: 24
        },
        omitted_audio_asset_count: 2
      }
      const options = {
        requestId: "import-shared-c-loop",
        expectedRevision: before.revision,
        actor: "HUMAN" as const
      }

      const invalid = yield* Effect.flip(
        studio.importSharedSession(
          {
            ...payload,
            lesson_configuration: {
              ...payload.lesson_configuration!,
              hand_position: 20,
              max_fret: 12
            }
          },
          "share_bbbbbbbbbbbbbbbbbbbb",
          {
            requestId: "reject-invalid-shared-lesson",
            expectedRevision: before.revision,
            actor: "HUMAN"
          }
        )
      )
      assert.strictEqual(invalid.code, "invalid_shared_session")
      assert.strictEqual((yield* studio.snapshot).revision, before.revision)

      const imported = yield* studio.importSharedSession(payload, "share_aaaaaaaaaaaaaaaaaaaa", options)
      const replay = yield* studio.importSharedSession(payload, "share_aaaaaaaaaaaaaaaaaaaa", options)
      const after = yield* studio.snapshot
      const midi = studioMidiView(after)

      assert.strictEqual(imported.change, "shared_session_imported")
      assert.strictEqual(replay.replayed, true)
      assert.strictEqual(after.projectId, before.projectId)
      assert.strictEqual(after.title, "Shared C Loop")
      assert.strictEqual(after.historyDepth, 1)
      assert.strictEqual(after.mutationCount, 1)
      assert.strictEqual(midi.summary.midi_track_count, 1)
      assert.strictEqual(midi.summary.note_count, 1)
      assert.strictEqual(midi.summary.referenced_audio_asset_count, 0)
      assert.deepStrictEqual(midi.tracks[0]?.clips[0]?.notes[0], {
        note_id: "note-shared-c4",
        pitch: 60,
        pitch_name: "C4",
        start_beat: 0,
        duration_beats: 4,
        velocity: 96
      })

      const history = yield* studio.mutationHistory({})
      assert.deepStrictEqual(
        history.mutations.map((mutation) => mutation.action),
        ["import_shared_session"]
      )

      yield* studio.undo({ requestId: "undo-shared-c-loop", expectedRevision: after.revision })
      const undone = yield* studio.snapshot
      assert.strictEqual(undone.title, before.title)
      assert.strictEqual(undone.tracks.length, before.tracks.length)
    }).pipe(Effect.provide(Studio.layer))
  )
})
