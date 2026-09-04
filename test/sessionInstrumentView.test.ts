import { describe, expect, it } from "vitest"
import { initialEmptyStudioState, initialStudioStateForSlug } from "../src/studio/songs/catalog.ts"
import { sessionInstrumentViewOf } from "../src/studio/sessionInstrumentView.ts"

const transport = (
  playheadBeat: number,
  options: {
    readonly musicalPlaybackRunning?: boolean
    readonly metronomeEnabled?: boolean
    readonly metronomeRunning?: boolean
  } = {}
) => ({
  playheadBeat,
  musicalPlaybackRunning: options.musicalPlaybackRunning ?? false,
  metronomeEnabled: options.metronomeEnabled ?? false,
  metronomeRunning: options.metronomeRunning ?? false
})

describe("Session instrument projection", () => {
  it("always returns the fixed Piano, Drums, and Metronome rack for an empty session", () => {
    const state = initialEmptyStudioState()
    const view = sessionInstrumentViewOf(state, transport(0))

    expect(view).toMatchObject({
      representation: "derived_session_instrument_projection",
      project_id: state.projectId,
      project_revision: state.revision,
      playhead_beat: 0,
      transport: {
        musical_playback_running: false,
        shared_click_enabled: false,
        shared_click_running: false
      }
    })
    expect(view.instruments.map((instrument) => instrument.label)).toEqual(["Piano", "Drums", "Metronome"])
    expect(view.instruments.slice(0, 2)).toMatchObject([
      {
        activity: "idle",
        available: false,
        playing_now: false,
        muted: false,
        idle_no_current_segment: true,
        current_segment: null,
        next_segment: null
      },
      {
        activity: "idle",
        available: false,
        playing_now: false,
        muted: false,
        idle_no_current_segment: true,
        current_segment: null,
        next_segment: null
      }
    ])
    expect(view.instruments[2]).toMatchObject({
      instrument_id: "metronome",
      authority: "shared_daw_transport",
      activity: "ready",
      available: true,
      enabled: false,
      playing_now: false,
      current_segment: null,
      next_segment: null
    })
  })

  it("maps actual electric-key and percussion metadata without treating every lead as Piano", () => {
    const state = initialStudioStateForSlug("afterglow")
    const view = sessionInstrumentViewOf(state, transport(0))
    const piano = view.instruments[0]!
    const drums = view.instruments[1]!

    expect(piano).toMatchObject({
      instrument_id: "piano",
      activity: "idle",
      available: true,
      playing_now: false,
      idle_no_current_segment: true,
      current_segment: null,
      next_segment: {
        track_id: "track-electric-keys",
        track_name: "Glass Electric Keys",
        clip_id: "clip-electric-keys",
        start_beat: 8
      }
    })
    expect(piano.next_segment?.track_id).not.toBe("track-clean-guitar")
    expect(drums).toMatchObject({
      instrument_id: "drums",
      activity: "ready",
      available: true,
      idle_no_current_segment: false,
      current_segment: {
        track_id: "track-drums",
        clip_id: "clip-drums",
        start_beat: 0
      }
    })
  })

  it("marks only unmuted current segments active while musical playback runs", () => {
    const state = initialStudioStateForSlug("afterglow")
    const active = sessionInstrumentViewOf(state, transport(8, { musicalPlaybackRunning: true }))

    expect(active.instruments[0]).toMatchObject({
      instrument_id: "piano",
      activity: "playing_now",
      playing_now: true,
      muted: false,
      idle_no_current_segment: false,
      current_segment: {
        track_id: "track-electric-keys",
        clip_id: "clip-electric-keys",
        audible_when_transport_runs: true
      }
    })
    expect(active.instruments[1]).toMatchObject({
      instrument_id: "drums",
      activity: "playing_now",
      playing_now: true
    })

    const mutedState = {
      ...state,
      tracks: state.tracks.map((track) =>
        track.id === "track-electric-keys" ? { ...track, muted: true } : track
      )
    }
    const muted = sessionInstrumentViewOf(mutedState, transport(8, { musicalPlaybackRunning: true }))
    expect(muted.instruments[0]).toMatchObject({
      activity: "muted",
      playing_now: false,
      muted: true,
      idle_no_current_segment: false,
      current_segment: {
        track_id: "track-electric-keys",
        muted: true,
        audible_when_transport_runs: false
      }
    })
    expect(muted.project_revision).toBe(state.revision)
  })

  it("dims a current segment suppressed by another solo and reports a true no-segment idle", () => {
    const state = initialStudioStateForSlug("afterglow")
    const soloed = {
      ...state,
      tracks: state.tracks.map((track) =>
        track.id === "track-clean-guitar" ? { ...track, soloed: true } : track
      )
    }
    const suppressed = sessionInstrumentViewOf(soloed, transport(8, { musicalPlaybackRunning: true }))
    expect(suppressed.instruments[0]).toMatchObject({
      activity: "silent",
      playing_now: false,
      muted: false,
      idle_no_current_segment: false,
      current_segment: { audible_when_transport_runs: false }
    })

    const afterSession = sessionInstrumentViewOf(state, transport(80, { musicalPlaybackRunning: true }))
    expect(afterSession.instruments[0]).toMatchObject({
      activity: "idle",
      playing_now: false,
      idle_no_current_segment: true,
      current_segment: null,
      next_segment: null
    })
    expect(afterSession.instruments[1]).toMatchObject({
      activity: "idle",
      playing_now: false,
      idle_no_current_segment: true,
      current_segment: null,
      next_segment: null
    })
  })

  it("shows the Metronome active from the shared click during click-only operation", () => {
    const state = initialStudioStateForSlug("afterglow")
    const view = sessionInstrumentViewOf(
      state,
      transport(4, {
        musicalPlaybackRunning: false,
        metronomeEnabled: true,
        metronomeRunning: true
      })
    )

    expect(view.transport).toEqual({
      musical_playback_running: false,
      shared_click_enabled: true,
      shared_click_running: true
    })
    expect(view.instruments[0]?.playing_now).toBe(false)
    expect(view.instruments[1]?.playing_now).toBe(false)
    expect(view.instruments[2]).toMatchObject({
      instrument_id: "metronome",
      authority: "shared_daw_transport",
      activity: "playing_now",
      enabled: true,
      playing_now: true,
      muted: false,
      idle_no_current_segment: false,
      current_segment: null,
      next_segment: null
    })
  })
})
