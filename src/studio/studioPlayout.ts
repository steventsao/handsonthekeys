import { NativePlayoutAdapter } from "@dawcore/transport"
import type { AudioClip, ClipTrack, MidiNoteData } from "@waveform-playlist/core"
import type { PlayoutAdapter } from "@waveform-playlist/engine"
import type {
  BrowserMetronomeConfig,
  BrowserMetronomeTransport,
  BrowserMetronomeTransportPosition
} from "./browserMetronome.ts"
import type { StudioSound } from "./Studio.ts"
import { renderStudioMidiSamples, studioAudioSampleRate } from "./audioAssets.ts"

const hashText = (value: string): number => {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

const soundOf = (track: ClipTrack, clip: AudioClip): StudioSound => {
  if (clip.midiChannel === 9 || /drum|percussion/i.test(track.name)) return "drums"
  if (clip.midiProgram !== undefined && clip.midiProgram >= 0 && clip.midiProgram <= 7) return "lead"
  if (
    (clip.midiProgram !== undefined && clip.midiProgram >= 32 && clip.midiProgram <= 39) ||
    /bass|sub|808/i.test(track.name)
  ) {
    return "bass"
  }
  if (
    (clip.midiProgram !== undefined && clip.midiProgram >= 48 && clip.midiProgram <= 55) ||
    /pad|string|ambient|atmosphere/i.test(track.name)
  ) {
    return "pad"
  }
  return /lead|piano|square|pulse|synth/i.test(track.name) ? "lead" : "texture"
}

const noteFingerprint = (notes: ReadonlyArray<MidiNoteData>): string =>
  notes.map((note) => `${note.midi}:${note.time}:${note.duration}:${note.velocity}`).join(";")

const playbackKey = (track: ClipTrack, clip: AudioClip): string =>
  [
    track.id,
    clip.id,
    clip.sampleRate,
    clip.sourceDurationSamples,
    clip.midiChannel ?? "",
    clip.midiProgram ?? "",
    noteFingerprint(clip.midiNotes ?? [])
  ].join("|")

const sourceDurationOf = (clip: AudioClip, notes: ReadonlyArray<MidiNoteData>): number => {
  const declaredDuration = clip.sourceDurationSamples / clip.sampleRate
  const visibleEnd = (clip.offsetSamples + clip.durationSamples) / clip.sampleRate
  const noteEnd = notes.reduce((maximum, note) => Math.max(maximum, note.time + note.duration), 0)
  return Math.max(0.25, declaredDuration, visibleEnd, noteEnd)
}

const renderMidiBuffer = (audioContext: AudioContext, track: ClipTrack, clip: AudioClip): AudioBuffer => {
  const notes = clip.midiNotes ?? []
  const duration = sourceDurationOf(clip, notes)
  const sampleCount = Math.ceil(duration * studioAudioSampleRate)
  const samples = renderStudioMidiSamples(
    notes,
    soundOf(track, clip),
    sampleCount,
    studioAudioSampleRate,
    hashText(`${track.id}:${clip.id}`),
    clip.midiProgram
  )

  for (let sample = 0; sample < samples.length; sample += 1) {
    const time = sample / studioAudioSampleRate
    const edgeFade = Math.min(1, time * 80, (duration - time) * 80)
    samples[sample] = Math.max(-1, Math.min(1, (samples[sample] ?? 0) * edgeFade))
  }

  const buffer = audioContext.createBuffer(1, sampleCount, studioAudioSampleRate)
  buffer.getChannelData(0).set(samples)
  return buffer
}

const secondsAt = (samples: number, sampleRate: number): number => samples / sampleRate

const audioClipOf = (
  audioContext: AudioContext,
  track: ClipTrack,
  clip: AudioClip,
  renderedBuffers: Map<string, AudioBuffer>
): AudioClip => {
  if (clip.midiNotes === undefined || clip.midiNotes.length === 0) return clip

  const key = playbackKey(track, clip)
  let audioBuffer = renderedBuffers.get(key)
  if (audioBuffer === undefined) {
    audioBuffer = renderMidiBuffer(audioContext, track, clip)
    renderedBuffers.set(key, audioBuffer)
  }

  const start = secondsAt(clip.startSample, clip.sampleRate)
  const duration = secondsAt(clip.durationSamples, clip.sampleRate)
  const offset = secondsAt(clip.offsetSamples, clip.sampleRate)
  const { midiNotes: _midiNotes, midiChannel: _midiChannel, midiProgram: _midiProgram, ...audioClip } = clip

  return {
    ...audioClip,
    audioBuffer,
    startSample: Math.round(start * studioAudioSampleRate),
    durationSamples: Math.round(duration * studioAudioSampleRate),
    offsetSamples: Math.round(offset * studioAudioSampleRate),
    sampleRate: studioAudioSampleRate,
    sourceDurationSamples: audioBuffer.length
  }
}

const audioTrackOf = (
  audioContext: AudioContext,
  track: ClipTrack,
  renderedBuffers: Map<string, AudioBuffer>
): ClipTrack => ({
  ...track,
  clips: track.clips.map((clip) => audioClipOf(audioContext, track, clip, renderedBuffers))
})

export interface StudioPlayoutAdapter extends PlayoutAdapter, BrowserMetronomeTransport {
  readonly musicIsPlaying: () => boolean
}

interface StudioPlayoutOptions {
  readonly audioContext?: AudioContext
  readonly initial?: {
    readonly bpm?: number
    readonly meter?: readonly [number, number]
    readonly playheadSeconds?: number
  }
}

const audioContextOf = (): AudioContext => {
  const AudioContextClass =
    globalThis.AudioContext ??
    (globalThis as typeof globalThis & { readonly webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (AudioContextClass === undefined) {
    throw new Error("This browser does not provide Web Audio for the shared Studio transport.")
  }
  return new AudioContextClass({ latencyHint: "interactive" })
}

const assertTiming = (bpm: number, [numerator, denominator]: readonly [number, number]): void => {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    throw new Error("Transport tempo must be between 40 and 240 BPM.")
  }
  if (
    !Number.isInteger(numerator) ||
    numerator < 1 ||
    numerator > 32 ||
    ![2, 4, 8, 16].includes(denominator)
  ) {
    throw new Error("Transport meter must use 1–32 beats and a 2, 4, 8, or 16 denominator.")
  }
}

const sameMeter = (left: readonly [number, number], right: readonly [number, number]): boolean =>
  left[0] === right[0] && left[1] === right[1]

type MetronomeRamp = NonNullable<BrowserMetronomeConfig["ramp"]>

const sameRamp = (left: MetronomeRamp | null, right: MetronomeRamp | null): boolean =>
  left?.bpmPerBar === right?.bpmPerBar && left?.barCount === right?.barCount

const boundedBpm = (value: number): number => Math.max(40, Math.min(240, value))

type MusicalTimeAdapter = Pick<PlayoutAdapter, "ppqn" | "secondsToTicks" | "ticksToSeconds">

/** Convert a canonical quarter-note beat through the active DAW tempo map. */
export const studioTransportSecondsAtBeat = (
  adapter: MusicalTimeAdapter,
  beat: number,
  fallbackBpm: number
): number =>
  adapter.ticksToSeconds?.(Math.max(0, beat) * adapter.ppqn) ?? (Math.max(0, beat) * 60) / fallbackBpm

/** Convert DAW transport seconds back to a canonical quarter-note beat. */
export const studioTransportBeatAtSeconds = (
  adapter: MusicalTimeAdapter,
  seconds: number,
  fallbackBpm: number
): number => {
  const ticks = adapter.secondsToTicks?.(Math.max(0, seconds))
  return ticks === undefined ? (Math.max(0, seconds) * fallbackBpm) / 60 : ticks / adapter.ppqn
}

/**
 * Build the one page-scoped audio transport used by Session, Tab, and Studio.
 *
 * The native DAW transport owns both ClipPlayer and MetronomePlayer. In
 * click-only mode its track list is temporarily empty; starting musical
 * playback restores the exact same rendered tracks and restarts that same
 * native transport at the requested playhead. The click and every clip are
 * consequently generated by one scheduler and one Clock.toAudioTime mapping.
 */
export const createStudioPlayoutAdapter = (options?: StudioPlayoutOptions): StudioPlayoutAdapter => {
  const ownsAudioContext = options?.audioContext === undefined
  const audioContext = options?.audioContext ?? audioContextOf()
  const initialBpm = options?.initial?.bpm ?? 120
  const initialMeter = options?.initial?.meter ?? ([4, 4] as const)
  const initialPlayhead = Math.max(0, options?.initial?.playheadSeconds ?? 0)
  assertTiming(initialBpm, initialMeter)

  const native = new NativePlayoutAdapter(audioContext, {
    ppqn: 960,
    tempo: initialBpm,
    numerator: initialMeter[0],
    denominator: initialMeter[1]
  })
  const renderedBuffers = new Map<string, AudioBuffer>()
  const renderTrack = (track: ClipTrack) => audioTrackOf(audioContext, track, renderedBuffers)
  let tracks: ClipTrack[] = []
  let bpm = initialBpm
  let meter: readonly [number, number] = [...initialMeter] as [number, number]
  let playheadSeconds = initialPlayhead
  let musicPlaying = false
  let metronomeEnabled = false
  let metronomeRamp: MetronomeRamp | null = null
  let phaseRevision = 0
  let playEndTick: number | null = null
  let disposed = false

  const audioIsRunning = (): boolean => audioContext.state === "running"

  const ensureActive = (): void => {
    if (disposed) throw new Error("The shared Studio transport has been disposed.")
  }

  const nativeHasMusicalTracks = (): boolean => musicPlaying || !native.isPlaying()

  const replaceNativeTracks = (): void => {
    native.setTracks(musicPlaying ? tracks : [])
  }

  const restartAtTick = (tick: number): void => {
    if (native.isPlaying()) native.stop()
    replaceNativeTracks()
    native.transport.setMetronomeEnabled(metronomeEnabled)
    const startSeconds = native.ticksToSeconds(tick)
    const endSeconds = playEndTick === null ? undefined : native.ticksToSeconds(playEndTick)
    native.play(startSeconds, endSeconds)
    phaseRevision += 1
  }

  const reconcileCompletedMusicalRun = (): void => {
    if (!musicPlaying || native.isPlaying()) return

    // Native Transport resets its clock when a bounded range reaches its end.
    // Preserve that exact musical tick for the editor, then keep the same
    // transport alive in click-only mode when the metronome is enabled.
    const completedTick = playEndTick ?? native.secondsToTicks(playheadSeconds)
    playheadSeconds = native.ticksToSeconds(completedTick)
    playEndTick = null
    musicPlaying = false
    if (metronomeEnabled) restartAtTick(completedTick)
    else native.setTracks(tracks)
  }

  const currentTransportSeconds = (): number => {
    reconcileCompletedMusicalRun()
    return native.isPlaying() ? native.getCurrentTime() : playheadSeconds
  }

  const reconfigureTiming = (
    nextBpm: number,
    nextMeter: readonly [number, number],
    nextRamp: MetronomeRamp | null = metronomeRamp
  ): boolean => {
    assertTiming(nextBpm, nextMeter)
    const meterChanged = !sameMeter(nextMeter, meter)
    const rampChanged = !sameRamp(nextRamp, metronomeRamp)
    if (nextBpm === bpm && !meterChanged && !rampChanged) return false

    const transportSeconds = currentTransportSeconds()
    const wasRunning = native.isPlaying()
    const transportTick = native.secondsToTicks(transportSeconds)
    const playheadTick = native.secondsToTicks(playheadSeconds)
    if (wasRunning) native.stop()

    if (nextBpm !== bpm || rampChanged || (meterChanged && nextRamp !== null)) {
      native.transport.clearTempos()
      native.setTempo(nextBpm, 0)
      if (nextRamp !== null) {
        const ticksPerBar = native.ppqn * nextMeter[0] * (4 / nextMeter[1])
        for (let bar = 1; bar <= nextRamp.barCount; bar += 1) {
          native.setTempo(boundedBpm(nextBpm + nextRamp.bpmPerBar * bar), Math.round(ticksPerBar * bar))
        }
      }
    }
    if (meterChanged) native.setMeter(nextMeter[0], nextMeter[1], 0)
    bpm = nextBpm
    meter = [...nextMeter] as [number, number]
    metronomeRamp = nextRamp
    playheadSeconds = native.ticksToSeconds(playheadTick)

    if (wasRunning) restartAtTick(transportTick)
    return true
  }

  const updateStoredTrack = (trackId: string, update: (track: ClipTrack) => ClipTrack): void => {
    tracks = tracks.map((track) => (track.id === trackId ? update(track) : track))
  }

  native.transport.setMetronomeEnabled(false)

  return {
    audioContext,
    ppqn: native.ppqn,
    lookAhead: 0,
    init: () => native.init(),
    setTracks: (nextTracks) => {
      tracks = nextTracks.map(renderTrack)
      if (nativeHasMusicalTracks()) native.setTracks(tracks)
    },
    addTrack: (track) => {
      const rendered = renderTrack(track)
      tracks = [...tracks, rendered]
      if (nativeHasMusicalTracks()) native.addTrack(rendered)
    },
    removeTrack: (trackId) => {
      tracks = tracks.filter((track) => track.id !== trackId)
      if (nativeHasMusicalTracks()) native.removeTrack(trackId)
    },
    updateTrack: (trackId, track) => {
      const rendered = renderTrack(track)
      tracks = tracks.map((current) => (current.id === trackId ? rendered : current))
      if (nativeHasMusicalTracks()) native.updateTrack(trackId, rendered)
    },
    play: (startTime, endTime) => {
      ensureActive()
      const startTick = native.secondsToTicks(Math.max(0, startTime))
      playEndTick = endTime === undefined ? null : native.secondsToTicks(Math.max(0, endTime))
      playheadSeconds = native.ticksToSeconds(startTick)
      musicPlaying = true
      // This is the deterministic metronome-first -> music policy: cancel the
      // click-only run, restore tracks, and launch both native scheduler
      // listeners from one clock origin at the DAW playhead.
      restartAtTick(startTick)
    },
    pause: () => {
      reconcileCompletedMusicalRun()
      if (!musicPlaying) return
      const pauseTick = native.secondsToTicks(native.getCurrentTime())
      native.pause()
      playheadSeconds = native.ticksToSeconds(pauseTick)
      playEndTick = null
      musicPlaying = false
      if (metronomeEnabled) restartAtTick(pauseTick)
      else native.setTracks(tracks)
    },
    stop: () => {
      if (native.isPlaying()) native.stop()
      musicPlaying = false
      playEndTick = null
      // PlaylistEngine immediately follows stop() with seek(playStartPosition).
      // Waiting for that exact seek avoids briefly establishing a false click
      // origin before the authoritative DAW playhead arrives.
      native.setTracks(tracks)
      phaseRevision += 1
    },
    seek: (time) => {
      ensureActive()
      reconcileCompletedMusicalRun()
      const targetTick = native.secondsToTicks(Math.max(0, time))
      playheadSeconds = native.ticksToSeconds(targetTick)
      if (musicPlaying) {
        native.seek(playheadSeconds)
        phaseRevision += 1
        return
      }
      if (metronomeEnabled) restartAtTick(targetTick)
      else native.seek(playheadSeconds)
    },
    getCurrentTime: () => {
      reconcileCompletedMusicalRun()
      return musicPlaying ? native.getCurrentTime() : playheadSeconds
    },
    isPlaying: () => {
      reconcileCompletedMusicalRun()
      return musicPlaying
    },
    setMasterVolume: (volume) => native.setMasterVolume(volume),
    setTrackVolume: (trackId, volume) => {
      updateStoredTrack(trackId, (track) => ({ ...track, volume }))
      if (nativeHasMusicalTracks()) native.setTrackVolume(trackId, volume)
    },
    setTrackMute: (trackId, muted) => {
      updateStoredTrack(trackId, (track) => ({ ...track, muted }))
      if (nativeHasMusicalTracks()) native.setTrackMute(trackId, muted)
    },
    setTrackSolo: (trackId, soloed) => {
      updateStoredTrack(trackId, (track) => ({ ...track, soloed }))
      if (nativeHasMusicalTracks()) native.setTrackSolo(trackId, soloed)
    },
    setTrackPan: (trackId, pan) => {
      updateStoredTrack(trackId, (track) => ({ ...track, pan }))
      if (nativeHasMusicalTracks()) native.setTrackPan(trackId, pan)
    },
    setLoop: (enabled, start, end) => native.setLoop(enabled, start, end),
    setTempo: (nextBpm, atTick) => {
      if (atTick !== undefined && atTick !== 0) return native.setTempo(nextBpm, atTick)
      reconfigureTiming(nextBpm, meter)
      return true
    },
    setMeter: (numerator, denominator, atTick) => {
      if (atTick !== undefined && atTick !== 0) {
        native.setMeter(numerator, denominator, atTick)
        return
      }
      reconfigureTiming(bpm, [numerator, denominator])
    },
    ticksToSeconds: (ticks) => native.ticksToSeconds(ticks),
    secondsToTicks: (seconds) => native.secondsToTicks(seconds),
    addWorkletModule: (url) => audioContext.audioWorklet.addModule(url),
    createAudioWorkletNode: (name, options) => new AudioWorkletNode(audioContext, name, options),
    createMediaStreamSource: (stream) => audioContext.createMediaStreamSource(stream),
    masterOutputNode: native.masterOutputNode,
    audioState: () => audioContext.state,
    unlock: async () => {
      ensureActive()
      if (!audioIsRunning()) await audioContext.resume()
      if (!audioIsRunning()) {
        throw new Error("Audio is waiting for a visible Start metronome action in the browser.")
      }
    },
    syncMetronome: async (config: BrowserMetronomeConfig) => {
      ensureActive()
      reconcileCompletedMusicalRun()
      assertTiming(config.bpm, config.meter)
      if (config.enabled && !audioIsRunning()) {
        await audioContext.resume()
        if (!audioIsRunning()) {
          throw new Error("Audio is waiting for a visible Start metronome action in the browser.")
        }
      }

      const enabledChanged = metronomeEnabled !== config.enabled
      metronomeEnabled = config.enabled
      native.transport.setMetronomeEnabled(metronomeEnabled)
      const timingChanged = reconfigureTiming(
        config.bpm,
        config.meter,
        metronomeEnabled ? (config.ramp ?? null) : null
      )

      if (metronomeEnabled && !musicPlaying && !native.isPlaying()) {
        restartAtTick(native.secondsToTicks(playheadSeconds))
      } else if (!metronomeEnabled && !musicPlaying && native.isPlaying()) {
        native.stop()
        native.setTracks(tracks)
        phaseRevision += 1
      } else if (enabledChanged && !timingChanged) {
        // Enabling while music plays joins the existing transport grid;
        // disabling silences only MetronomePlayer. Neither path establishes a
        // second origin or reschedules musical sources.
        phaseRevision += 1
      }
    },
    metronomePosition: (): BrowserMetronomeTransportPosition => {
      const transportSeconds = currentTransportSeconds()
      return {
        clockRunning: native.isPlaying(),
        transportSeconds,
        phaseRevision
      }
    },
    musicIsPlaying: () => {
      reconcileCompletedMusicalRun()
      return musicPlaying
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      renderedBuffers.clear()
      native.dispose()
      if (ownsAudioContext) void audioContext.close()
    }
  }
}
