import type { StudioClip, StudioState, StudioTrack } from "./Studio.ts"

export const sessionInstrumentIds = ["piano", "drums", "metronome"] as const
export type SessionInstrumentId = (typeof sessionInstrumentIds)[number]

export type SessionInstrumentActivity = "playing_now" | "muted" | "ready" | "idle" | "silent"

export interface SessionInstrumentSegmentView {
  readonly track_id: string
  readonly track_name: string
  readonly clip_id: string
  readonly clip_name: string
  readonly start_beat: number
  readonly end_beat: number
  readonly muted: boolean
  readonly audible_when_transport_runs: boolean
}

export interface SessionInstrumentTileView {
  readonly instrument_id: SessionInstrumentId
  readonly label: "Piano" | "Drums" | "Metronome"
  readonly authority: "canonical_midi" | "shared_daw_transport"
  readonly activity: SessionInstrumentActivity
  readonly available: boolean
  readonly enabled: boolean
  readonly playing_now: boolean
  readonly muted: boolean
  readonly idle_no_current_segment: boolean
  readonly mapped_track_count: number
  readonly current_segment: SessionInstrumentSegmentView | null
  readonly next_segment: SessionInstrumentSegmentView | null
}

export interface SessionInstrumentView {
  readonly representation: "derived_session_instrument_projection"
  readonly project_id: string
  readonly project_revision: number
  readonly playhead_beat: number
  readonly transport: {
    readonly musical_playback_running: boolean
    readonly shared_click_enabled: boolean
    readonly shared_click_running: boolean
  }
  readonly instruments: ReadonlyArray<SessionInstrumentTileView>
}

export interface SessionInstrumentTransportInput {
  readonly playheadBeat: number
  readonly musicalPlaybackRunning: boolean
  readonly metronomeEnabled: boolean
  readonly metronomeRunning: boolean
}

interface SessionSegment extends SessionInstrumentSegmentView {
  readonly track: StudioTrack
  readonly clip: StudioClip
}

const cleanBeat = (beat: number): number =>
  Math.min(4_096, Math.max(0, Math.round((Number.isFinite(beat) ? beat : 0) * 1_000_000) / 1_000_000))

const clipStartBeat = (clip: StudioClip, bpm: number): number =>
  cleanBeat(clip.startBeat ?? (clip.start * bpm) / 60)

const clipEndBeat = (clip: StudioClip, bpm: number): number => {
  const start = clipStartBeat(clip, bpm)
  const duration = clip.durationBeats ?? (clip.duration * bpm) / 60
  return cleanBeat(start + Math.max(0, duration))
}

const clipMetadata = (track: StudioTrack, clip: StudioClip): string => {
  const sourceName = clip.source.kind === "midi_asset" ? clip.source.sourceTrackName : ""
  return `${track.name} ${clip.name} ${sourceName}`
}

const isDrumClip = (track: StudioTrack, clip: StudioClip): boolean =>
  clip.midiChannel === 9 ||
  (clip.source.kind !== "upload" && clip.source.sound === "drums") ||
  (clip.midiChannel === undefined && /\b(?:drums?|percussion|kit)\b/i.test(clipMetadata(track, clip)))

const isPianoClip = (track: StudioTrack, clip: StudioClip): boolean => {
  if (isDrumClip(track, clip)) return false
  if (clip.midiProgram !== undefined) return clip.midiProgram >= 0 && clip.midiProgram <= 7
  return /\b(?:piano|keyboard|keys)\b/i.test(clipMetadata(track, clip))
}

const segmentOrder = (left: SessionSegment, right: SessionSegment): number =>
  left.start_beat - right.start_beat ||
  left.end_beat - right.end_beat ||
  left.track_id.localeCompare(right.track_id) ||
  left.clip_id.localeCompare(right.clip_id)

const publicSegment = ({ track: _track, clip: _clip, ...segment }: SessionSegment) => segment

const segmentsFor = (
  state: StudioState,
  instrument: "piano" | "drums",
  anyTrackSoloed: boolean
): ReadonlyArray<SessionSegment> => {
  const matches = instrument === "piano" ? isPianoClip : isDrumClip
  return state.tracks
    .flatMap((track) =>
      track.kind !== "midi"
        ? []
        : track.clips.flatMap((clip): ReadonlyArray<SessionSegment> => {
            if (clip.kind !== "midi" || clip.notes.length === 0 || !matches(track, clip)) return []
            const startBeat = clipStartBeat(clip, state.bpm)
            const endBeat = clipEndBeat(clip, state.bpm)
            if (endBeat <= startBeat) return []
            const audible =
              !track.muted && track.volume > 0 && clip.gain > 0 && (!anyTrackSoloed || track.soloed)
            return [
              {
                track,
                clip,
                track_id: track.id,
                track_name: track.name,
                clip_id: clip.id,
                clip_name: clip.name,
                start_beat: startBeat,
                end_beat: endBeat,
                muted: track.muted,
                audible_when_transport_runs: audible
              }
            ]
          })
    )
    .sort(segmentOrder)
}

const musicalTile = (
  state: StudioState,
  instrument: "piano" | "drums",
  playheadBeat: number,
  musicalPlaybackRunning: boolean,
  anyTrackSoloed: boolean
): SessionInstrumentTileView => {
  const segments = segmentsFor(state, instrument, anyTrackSoloed)
  const current = segments.filter(
    (segment) => playheadBeat >= segment.start_beat && playheadBeat < segment.end_beat
  )
  const currentAudible = current.filter((segment) => segment.audible_when_transport_runs)
  const next = segments.find((segment) => segment.start_beat > playheadBeat) ?? null
  const muteCandidates = current.length > 0 ? current : segments
  const muted = muteCandidates.length > 0 && muteCandidates.every((segment) => segment.muted)
  const playingNow = musicalPlaybackRunning && currentAudible.length > 0
  const idleNoCurrentSegment = current.length === 0
  const activity: SessionInstrumentActivity = playingNow
    ? "playing_now"
    : muted
      ? "muted"
      : idleNoCurrentSegment
        ? "idle"
        : musicalPlaybackRunning
          ? "silent"
          : "ready"
  const currentSegment = currentAudible[0] ?? current[0] ?? null

  return {
    instrument_id: instrument,
    label: instrument === "piano" ? "Piano" : "Drums",
    authority: "canonical_midi",
    activity,
    available: segments.length > 0,
    enabled: segments.length > 0 && !muted,
    playing_now: playingNow,
    muted,
    idle_no_current_segment: idleNoCurrentSegment,
    mapped_track_count: new Set(segments.map((segment) => segment.track_id)).size,
    current_segment: currentSegment === null ? null : publicSegment(currentSegment),
    next_segment: next === null ? null : publicSegment(next)
  }
}

/**
 * Derive the fixed Session rack from canonical MIDI and the shared transport.
 *
 * The result is intentionally bounded to three tiles and, for musical tiles,
 * one current plus one upcoming segment. It does not infer audio, repeat clips,
 * or create a second playback model.
 */
export const sessionInstrumentViewOf = (
  state: StudioState,
  transport: SessionInstrumentTransportInput
): SessionInstrumentView => {
  const playheadBeat = cleanBeat(transport.playheadBeat)
  const anyTrackSoloed = state.tracks.some((track) => track.soloed)
  const piano = musicalTile(state, "piano", playheadBeat, transport.musicalPlaybackRunning, anyTrackSoloed)
  const drums = musicalTile(state, "drums", playheadBeat, transport.musicalPlaybackRunning, anyTrackSoloed)
  const metronomePlaying = transport.metronomeEnabled && transport.metronomeRunning
  const metronome: SessionInstrumentTileView = {
    instrument_id: "metronome",
    label: "Metronome",
    authority: "shared_daw_transport",
    activity: metronomePlaying ? "playing_now" : "ready",
    available: true,
    enabled: transport.metronomeEnabled,
    playing_now: metronomePlaying,
    muted: false,
    idle_no_current_segment: false,
    mapped_track_count: 0,
    current_segment: null,
    next_segment: null
  }

  return {
    representation: "derived_session_instrument_projection",
    project_id: state.projectId,
    project_revision: state.revision,
    playhead_beat: playheadBeat,
    transport: {
      musical_playback_running: transport.musicalPlaybackRunning,
      shared_click_enabled: transport.metronomeEnabled,
      shared_click_running: metronomePlaying
    },
    instruments: [piano, drums, metronome]
  }
}
