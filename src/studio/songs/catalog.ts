import type {
  StudioClip,
  StudioClipSource,
  StudioKaraokeCountInBeats,
  StudioNote,
  StudioSound,
  StudioSourceAttribution,
  StudioState,
  StudioTrack
} from "../Studio.ts"
import { afterglowSong } from "./afterglow.generated.ts"
import { korobeinikiSong } from "./korobeiniki.generated.ts"

export const defaultStudioSongSlug = "korobeiniki" as const
export const defaultKaraokeSongSlug = "afterglow" as const

const songs = {
  afterglow: afterglowSong,
  korobeiniki: korobeinikiSong
} as const

export type StudioSongSlug = keyof typeof songs

interface StudioSongTrackDefinition {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly volume: number
  readonly pan: number
  readonly sound: StudioSound
  readonly seed: number
  readonly program: number
  readonly channel: number
  readonly sourceKind: "generated" | "midi_asset"
  readonly sourceTrackName: string
  readonly notes: ReadonlyArray<readonly [number, number, number, number]>
}

interface StudioSongDefinition {
  readonly slug: StudioSongSlug
  readonly projectId: string
  readonly title: string
  readonly bpm: number
  readonly timeSignature: readonly [number, number]
  readonly selection: readonly [number, number]
  readonly countInBeats?: StudioKaraokeCountInBeats
  readonly sessionEndBeat: number
  readonly source: StudioSourceAttribution
  readonly tracks: ReadonlyArray<StudioSongTrackDefinition>
}

export interface StudioKaraokePreset {
  readonly guideTitle: string
  readonly lyrics: string
  readonly melodyTrackId: string
  readonly screenSubtitle: string
  readonly standbyLine: string
}

const karaokePresets: Readonly<Record<StudioSongSlug, StudioKaraokePreset>> = {
  afterglow: {
    guideTitle: "AFTERGLOW CALLING",
    lyrics: "Stay in the afterglow city lights are burning low Every signal leads me home I never sing alone",
    melodyTrackId: "track-guide-melody",
    screenSubtitle: "original Y2K pop · Signal Studio",
    standbyLine: "STAY IN THE AFTERGLOW — enter when the light arrives"
  },
  korobeiniki: {
    guideTitle: "NEON SIGNALS",
    lyrics: "ネオン の 街 で 声 を 合わせ 夢 の つづき を 歌おう",
    melodyTrackId: "track-piano-lead",
    screenSubtitle: "licensed room arrangement",
    standbyLine: "NEON NO MACHI DE — sing when the light arrives"
  }
}

const clean = (value: number) => Number(value.toFixed(6))

const noteName = (midi: number): string => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

const clipSourceOf = (song: StudioSongDefinition, track: StudioSongTrackDefinition): StudioClipSource =>
  track.sourceKind === "generated"
    ? { kind: "generated", sound: track.sound, seed: track.seed }
    : {
        kind: "midi_asset",
        assetId: `${song.slug}-source-midi`,
        sourceTrackName: track.sourceTrackName,
        sound: track.sound,
        seed: track.seed
      }

const trackOf = (song: StudioSongDefinition, track: StudioSongTrackDefinition): StudioTrack => {
  const startBeat = clean(Math.min(...track.notes.map((note) => note[1])))
  const endBeat = clean(Math.max(...track.notes.map((note) => note[1] + note[2])))
  const durationBeats = clean(endBeat - startBeat)
  const secondsPerBeat = 60 / song.bpm
  const notes: ReadonlyArray<StudioNote> = track.notes.map((note, index) => ({
    id: `note-${song.slug}-${track.id}-${index + 1}`,
    midi: note[0],
    name: noteName(note[0]),
    time: clean((note[1] - startBeat) * secondsPerBeat),
    duration: clean(note[2] * secondsPerBeat),
    velocity: clean(note[3] / 127),
    startBeat: note[1],
    durationBeats: note[2],
    midiVelocity: note[3]
  }))
  const clip: StudioClip = {
    id: `clip-${track.id}`,
    kind: "midi",
    name: track.name,
    start: clean(startBeat * secondsPerBeat),
    duration: clean(durationBeats * secondsPerBeat),
    gain: 0.8,
    color: track.color,
    source: clipSourceOf(song, track),
    notes,
    takeGroupId: null,
    startBeat,
    durationBeats,
    midiProgram: track.program,
    midiChannel: track.channel
  }

  return {
    id: `track-${track.id}`,
    kind: "midi",
    name: track.name,
    color: track.color,
    volume: track.volume,
    pan: track.pan,
    muted: false,
    soloed: false,
    clips: [clip]
  }
}

const stateOfSong = (song: StudioSongDefinition): StudioState => {
  const secondsPerBeat = 60 / song.bpm
  const noteCount = song.tracks.reduce((total, track) => total + track.notes.length, 0)
  return {
    projectId: song.projectId,
    songSlug: song.slug,
    title: song.title,
    attribution: { ...song.source },
    revision: 1,
    bpm: song.bpm,
    timeSignature: song.timeSignature,
    selection: {
      start: song.selection[0] * secondsPerBeat,
      end: song.selection[1] * secondsPerBeat
    },
    tracks: song.tracks.map((track) => trackOf(song, track)),
    preview: null,
    karaokeGuide: null,
    karaokeCountInBeats: song.countInBeats ?? 4,
    practiceBed: null,
    historyDepth: 0,
    redoDepth: 0,
    mutationCount: 0,
    logs: [
      {
        id: 1,
        actor: "ENGINE",
        message: `${song.title} loaded as ${noteCount} exact MIDI notes. Agents can read and edit the complete score.`
      }
    ]
  }
}

export const initialEmptyStudioState = (): StudioState => ({
  projectId: "signal-studio-untitled",
  songSlug: "untitled",
  title: "Untitled Session",
  attribution: null,
  revision: 1,
  bpm: 120,
  timeSignature: [4, 4],
  selection: { start: 0, end: 4 },
  tracks: [],
  preview: null,
  karaokeGuide: null,
  karaokeCountInBeats: 4,
  practiceBed: null,
  historyDepth: 0,
  redoDepth: 0,
  mutationCount: 0,
  logs: [
    {
      id: 1,
      actor: "ENGINE",
      message: "Empty session ready for original MIDI, uploaded audio, or an authorized catalog song."
    }
  ]
})

export const studioSongSlugOfPath = (pathname: string): StudioSongSlug => {
  const normalized = pathname.replace(/\/+$/, "") || "/"
  if (normalized === "/studio" || normalized === "/studio.html") return defaultStudioSongSlug
  const candidate = normalized.startsWith("/studio/") ? normalized.slice("/studio/".length) : ""
  return candidate in songs ? (candidate as StudioSongSlug) : defaultStudioSongSlug
}

const isStudioSongSlug = (value: string | null): value is StudioSongSlug => value !== null && value in songs

export const studioSongSlugOfLocation = (pathname: string, search = ""): StudioSongSlug | null => {
  const requested = new URLSearchParams(search).get("song")
  if (isStudioSongSlug(requested)) return requested
  const normalized = pathname.replace(/\/+$/, "") || "/"
  if (normalized === "/") return null
  if (normalized === "/karaoke" || normalized === "/karaoke.html") {
    return defaultKaraokeSongSlug
  }
  return studioSongSlugOfPath(pathname)
}

export const initialStudioStateForSlug = (slug: StudioSongSlug): StudioState => stateOfSong(songs[slug])

export const initialStudioStateForLocation = (pathname: string, search = ""): StudioState => {
  const slug = studioSongSlugOfLocation(pathname, search)
  return slug === null ? initialEmptyStudioState() : initialStudioStateForSlug(slug)
}

export const karaokePresetForSong = (slug: string): StudioKaraokePreset =>
  karaokePresets[isStudioSongSlug(slug) ? slug : defaultKaraokeSongSlug]

export const initialStudioSongState = (): StudioState => {
  if (typeof window === "undefined") return initialStudioStateForSlug(defaultStudioSongSlug)
  return initialStudioStateForLocation(window.location.pathname, window.location.search)
}
