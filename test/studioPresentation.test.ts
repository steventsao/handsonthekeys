import { assert, describe, it } from "@effect/vitest"
import { SimulatedClock } from "xstate"
import type { StudioMutationEvent } from "../src/studio/Studio.ts"
import { sessionInstrumentViewOf } from "../src/studio/sessionInstrumentView.ts"
import { initialEmptyStudioState } from "../src/studio/songs/catalog.ts"
import {
  createStudioPresentationActor,
  studioPresentationAnnouncementMs,
  studioPresentationViewOf
} from "../src/studio/studioPresentation.ts"

const mutation = (overrides: Partial<StudioMutationEvent> = {}): StudioMutationEvent => ({
  sequence: 12,
  recordedAt: "2026-09-03T00:00:00.000Z",
  actor: "AGENT",
  action: "set_track_mix",
  requestId: "agent-mix-12",
  expectedRevision: 4,
  revisionBefore: 4,
  revisionAfter: 5,
  result: "track_mix_updated",
  targets: { trackId: "track-drums" },
  input: { track_id: "track-drums", volume: 0.62 },
  ...overrides
})

describe("XState Studio presentation manager", () => {
  it("choreographs an accepted agent mutation without creating intermediate domain revisions", () => {
    const clock = new SimulatedClock()
    const actor = createStudioPresentationActor({ clock }).start()

    actor.send({ type: "studio.mutation.committed", mutation: mutation() })
    let view = studioPresentationViewOf(actor.getSnapshot())

    assert.strictEqual(view.manager, "xstate-v5")
    assert.strictEqual(view.phase, "announcing")
    assert.deepStrictEqual(view.transition, {
      id: "transition-12",
      actor: "AGENT",
      action: "set_track_mix",
      request_id: "agent-mix-12",
      revision_before: 4,
      revision_after: 5,
      targets: { track_id: "track-drums" },
      duration_ms: 420
    })

    clock.increment(studioPresentationAnnouncementMs)
    view = studioPresentationViewOf(actor.getSnapshot())
    assert.strictEqual(view.phase, "animating")
    assert.strictEqual(view.transition?.revision_after, 5)

    clock.increment(420)
    view = studioPresentationViewOf(actor.getSnapshot())
    assert.strictEqual(view.phase, "settled")
    assert.strictEqual(view.transition?.revision_after, 5)
    actor.stop()
  })

  it("keeps reduced-motion clients settled while retaining the semantic transition", () => {
    const clock = new SimulatedClock()
    const actor = createStudioPresentationActor({ reducedMotion: true, clock }).start()

    actor.send({
      type: "studio.mutation.committed",
      mutation: mutation({ action: "set_tempo", requestId: "agent-tempo-12", targets: {} })
    })
    const view = studioPresentationViewOf(actor.getSnapshot())

    assert.strictEqual(view.phase, "settled")
    assert.strictEqual(view.reduced_motion, true)
    assert.strictEqual(view.transition?.action, "set_tempo")
    assert.strictEqual(view.transition?.duration_ms, 560)
    actor.stop()
  })

  it("publishes bounded transport, Session instruments, microphone, lyric, and operation state", () => {
    const actor = createStudioPresentationActor().start()
    actor.send({
      type: "studio.surface.updated",
      surface: "karaoke",
      activePanel: "room",
      toolsReady: true
    })
    actor.send({ type: "studio.transport.updated", status: "counting_in", playheadBeat: 27.456 })
    actor.send({ type: "studio.transport.loop.updated", enabled: true, startBeat: 24, endBeat: 28 })
    actor.send({
      type: "studio.microphone.updated",
      status: "error",
      issue: "no_input_device"
    })
    actor.send({
      type: "studio.lyrics.updated",
      status: "counting_in",
      activeTokenId: null,
      countInRemaining: 4
    })
    actor.send({
      type: "studio.operation.updated",
      busy: "microphone",
      error: "x".repeat(400)
    })
    actor.send({
      type: "studio.session_instruments.updated",
      view: sessionInstrumentViewOf(initialEmptyStudioState(), {
        playheadBeat: 27.456,
        musicalPlaybackRunning: false,
        metronomeEnabled: true,
        metronomeRunning: true
      })
    })
    const view = studioPresentationViewOf(actor.getSnapshot())

    assert.strictEqual(view.schema_version, 2)
    assert.strictEqual(view.surface, "karaoke")
    assert.strictEqual(view.active_panel, "room")
    assert.strictEqual(view.tools_ready, true)
    assert.deepStrictEqual(view.transport, {
      status: "counting_in",
      playhead_beat: 27.46,
      loop_enabled: true,
      loop_start_beat: 24,
      loop_end_beat: 28
    })
    assert.deepStrictEqual(view.microphone, { status: "error", issue: "no_input_device" })
    assert.deepStrictEqual(view.lyrics, {
      status: "counting_in",
      active_token_id: null,
      count_in_remaining: 4
    })
    assert.strictEqual(view.operation.busy, "microphone")
    assert.strictEqual(view.operation.error?.length, 240)
    assert.strictEqual(view.session_instruments?.instruments.length, 3)
    assert.deepStrictEqual(view.session_instruments?.instruments[2], {
      instrument_id: "metronome",
      label: "Metronome",
      authority: "shared_daw_transport",
      activity: "playing_now",
      available: true,
      enabled: true,
      playing_now: true,
      muted: false,
      idle_no_current_segment: false,
      mapped_track_count: 0,
      current_segment: null,
      next_segment: null
    })
    actor.stop()
  })
})
