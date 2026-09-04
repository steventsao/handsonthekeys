import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const BPM = 100
const PPQ = 480
const SONG_END_BEAT = 72

const chordPitches = {
  A: [57, 61, 64, 69],
  "E/G#": [56, 59, 64, 68],
  E: [52, 56, 59, 64],
  "F#m": [54, 57, 61, 66],
  D: [50, 54, 57, 62],
  Bm: [47, 50, 54, 59]
}

const bassRoots = {
  A: 45,
  "E/G#": 44,
  E: 40,
  "F#m": 42,
  D: 38,
  Bm: 35
}

const bars = [
  "F#m",
  "D",
  "F#m",
  "D",
  "A",
  "E",
  "Bm",
  "D",
  "A",
  "E/G#",
  "F#m",
  "D",
  "A",
  "E",
  "Bm",
  "D",
  "A",
  "E"
]

const note = (pitch, startBeat, durationBeats, velocity) => [
  pitch,
  Number(startBeat.toFixed(6)),
  Number(durationBeats.toFixed(6)),
  velocity
]

const drumNotes = []
for (let beat = 0; beat < SONG_END_BEAT; beat += 0.5) {
  const barBeat = beat % 4
  const chorus = beat >= 32 && beat < 64
  drumNotes.push(note(42, beat, 0.11, chorus ? (Number.isInteger(beat) ? 82 : 68) : 54))
  if (barBeat === 0 || barBeat === 2 || (chorus && barBeat === 2.5)) {
    drumNotes.push(note(36, beat, 0.2, chorus ? 116 : 98))
  }
  if (barBeat === 1 || barBeat === 3) drumNotes.push(note(38, beat, 0.18, chorus ? 112 : 92))
  if (barBeat === 3.5 && chorus) drumNotes.push(note(46, beat, 0.12, 72))
}
for (const beat of [0, 24, 32, 48, 64]) drumNotes.push(note(49, beat, 0.45, 108))

const bassNotes = bars.flatMap((symbol, barIndex) => {
  const start = barIndex * 4
  const root = bassRoots[symbol]
  const fifth = root + 7
  const chorus = start >= 32 && start < 64
  const pattern = chorus ? [root, root + 12, fifth, root + 12] : [root, root, fifth, root + 12]
  return pattern.map((pitch, index) => note(pitch, start + index, 0.82, chorus ? 104 : 88))
})

const guitarNotes = bars.flatMap((symbol, barIndex) => {
  const start = barIndex * 4
  const chord = chordPitches[symbol].map((pitch) => pitch + 12)
  const pattern = [0, 1, 2, 1, 3, 2, 1, 2]
  const chorus = start >= 32 && start < 64
  return pattern.map((index, step) => note(chord[index], start + step * 0.5, 0.39, chorus ? 91 : 73))
})

const keysNotes = bars.flatMap((symbol, barIndex) => {
  const start = barIndex * 4
  if (start < 8) return []
  const chord = chordPitches[symbol]
  const velocity = start >= 32 && start < 64 ? 94 : 72
  return [0, 2].flatMap((offset) =>
    chord.slice(1).map((pitch) => note(pitch + 12, start + offset, 1.72, velocity))
  )
})

const padNotes = bars.flatMap((symbol, barIndex) => {
  const start = barIndex * 4
  const velocity = start >= 32 && start < 64 ? 78 : 58
  return chordPitches[symbol].map((pitch) => note(pitch, start, 3.82, velocity))
})

const harmonyNotes = bars.flatMap((symbol, barIndex) => {
  const start = barIndex * 4
  if (start < 24 || start >= 64) return []
  const chord = chordPitches[symbol]
  return chord.slice(1, 3).map((pitch) => note(pitch + 12, start, 3.65, start >= 32 ? 72 : 52))
})

const guideMelody = [
  note(73, 32, 0.8, 104),
  note(71, 33, 0.8, 98),
  note(69, 34, 0.8, 102),
  note(73, 35, 0.9, 108),
  note(71, 36, 1.8, 104),
  note(68, 38, 0.8, 96),
  note(66, 39, 0.9, 100),
  note(69, 40, 0.8, 104),
  note(69, 41, 0.8, 96),
  note(73, 42, 0.8, 108),
  note(71, 43, 0.9, 102),
  note(69, 44, 0.8, 98),
  note(66, 45, 0.8, 96),
  note(64, 46, 0.8, 94),
  note(66, 47, 0.9, 102),
  note(73, 48, 0.7, 108),
  note(73, 48.75, 0.7, 100),
  note(71, 49.5, 0.45, 96),
  note(69, 50, 1.8, 106),
  note(71, 52, 0.8, 102),
  note(68, 53, 0.8, 96),
  note(66, 54, 1.8, 100),
  note(66, 56, 0.8, 98),
  note(69, 57, 0.8, 102),
  note(71, 58, 0.8, 104),
  note(73, 59, 0.9, 108),
  note(69, 60, 0.8, 100),
  note(66, 61, 0.8, 96),
  note(64, 62, 0.8, 94),
  note(69, 63, 0.9, 108)
]

const tracks = [
  {
    id: "drums",
    name: "Chrome Pop Drums",
    color: "#ff9d42",
    volume: 0.72,
    pan: 0,
    sound: "drums",
    seed: 2001,
    program: 0,
    channel: 9,
    sourceKind: "midi_asset",
    sourceTrackName: "Signal Studio original drum arrangement",
    notes: drumNotes
  },
  {
    id: "finger-bass",
    name: "Midnight Finger Bass",
    color: "#39d98a",
    volume: 0.62,
    pan: 0,
    sound: "bass",
    seed: 99,
    program: 33,
    channel: 1,
    sourceKind: "midi_asset",
    sourceTrackName: "Signal Studio original bass arrangement",
    notes: bassNotes
  },
  {
    id: "clean-guitar",
    name: "Silver Clean Guitar",
    color: "#59b8ff",
    volume: 0.44,
    pan: -0.32,
    sound: "lead",
    seed: 27,
    program: 27,
    channel: 2,
    sourceKind: "midi_asset",
    sourceTrackName: "Signal Studio original guitar arpeggio",
    notes: guitarNotes
  },
  {
    id: "electric-keys",
    name: "Glass Electric Keys",
    color: "#d782ff",
    volume: 0.4,
    pan: 0.28,
    sound: "lead",
    seed: 4,
    program: 4,
    channel: 3,
    sourceKind: "midi_asset",
    sourceTrackName: "Signal Studio original keyboard arrangement",
    notes: keysNotes
  },
  {
    id: "wide-pads",
    name: "Afterglow Pads",
    color: "#7657ff",
    volume: 0.38,
    pan: 0,
    sound: "pad",
    seed: 89,
    program: 89,
    channel: 4,
    sourceKind: "midi_asset",
    sourceTrackName: "Signal Studio original pad arrangement",
    notes: padNotes
  },
  {
    id: "backing-harmony",
    name: "Wordless Harmony Pad",
    color: "#ff5eae",
    volume: 0.28,
    pan: 0.18,
    sound: "pad",
    seed: 52,
    program: 52,
    channel: 5,
    sourceKind: "midi_asset",
    sourceTrackName: "Signal Studio original wordless harmony arrangement",
    notes: harmonyNotes
  },
  {
    id: "guide-melody",
    name: "Guide Melody",
    color: "#ffe066",
    volume: 0.24,
    pan: 0,
    sound: "lead",
    seed: 80,
    program: 80,
    channel: 6,
    sourceKind: "midi_asset",
    sourceTrackName: "Signal Studio original vocal guide melody",
    notes: guideMelody
  }
]

const variableLength = (value) => {
  let buffer = value & 0x7f
  const bytes = []
  while ((value >>= 7) > 0) {
    buffer <<= 8
    buffer |= (value & 0x7f) | 0x80
  }
  for (;;) {
    bytes.push(buffer & 0xff)
    if (buffer & 0x80) buffer >>= 8
    else break
  }
  return bytes
}

const uint32 = (value) => [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const uint16 = (value) => [(value >>> 8) & 0xff, value & 0xff]

const trackChunk = (events) => {
  const bytes = []
  let previousTick = 0
  for (const event of events) {
    bytes.push(...variableLength(event.tick - previousTick), ...event.bytes)
    previousTick = event.tick
  }
  bytes.push(0, 0xff, 0x2f, 0)
  return Buffer.from([...Buffer.from("MTrk"), ...uint32(bytes.length), ...bytes])
}

const midiTrack = (track) => {
  const nameBytes = [...Buffer.from(track.name)]
  const events = [
    { tick: 0, order: 0, bytes: [0xff, 0x03, nameBytes.length, ...nameBytes] },
    { tick: 0, order: 1, bytes: [0xc0 | track.channel, track.program] }
  ]
  for (const [pitch, startBeat, durationBeats, velocity] of track.notes) {
    const start = Math.round(startBeat * PPQ)
    const end = Math.round((startBeat + durationBeats) * PPQ)
    events.push({ tick: start, order: 2, bytes: [0x90 | track.channel, pitch, velocity] })
    events.push({ tick: end, order: 1, bytes: [0x80 | track.channel, pitch, 0] })
  }
  events.sort((left, right) => left.tick - right.tick || left.order - right.order)
  return trackChunk(events)
}

const microsecondsPerBeat = Math.round(60_000_000 / BPM)
const tempoTrack = trackChunk([
  {
    tick: 0,
    bytes: [
      0xff,
      0x51,
      0x03,
      (microsecondsPerBeat >>> 16) & 0xff,
      (microsecondsPerBeat >>> 8) & 0xff,
      microsecondsPerBeat & 0xff
    ]
  },
  { tick: 0, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] }
])
const midi = Buffer.concat([
  Buffer.from([
    ...Buffer.from("MThd"),
    ...uint32(6),
    ...uint16(1),
    ...uint16(tracks.length + 1),
    ...uint16(PPQ)
  ]),
  tempoTrack,
  ...tracks.map(midiTrack)
])

const sourceMidiSha256 = createHash("sha256").update(midi).digest("hex")
const song = {
  slug: "afterglow",
  projectId: "signal-studio-afterglow-calling",
  title: "Afterglow Calling // Y2K Pop",
  bpm: BPM,
  timeSignature: [4, 4],
  selection: [32, 48],
  countInBeats: 8,
  sessionEndBeat: SONG_END_BEAT,
  source: {
    title: "Afterglow Calling",
    creator: "Signal Studio",
    sourceUrl: "/?mode=daw&song=afterglow",
    licenseName: "Project-authored original",
    licenseUrl: "/studio-songs/afterglow.LICENSE.txt",
    sourceMidiUrl: "/studio-songs/afterglow.mid",
    sourceMidiSha256,
    changes: "Original composition, lyrics, MIDI arrangement, timing, and browser-rendered recording."
  },
  sourcePpq: PPQ,
  tracks
}

const root = resolve(import.meta.dirname, "..")
writeFileSync(resolve(root, "public/studio-songs/afterglow.mid"), midi)
writeFileSync(
  resolve(root, "src/studio/songs/afterglow.generated.ts"),
  `// Generated by scripts/generate-afterglow-song.mjs. Do not edit by hand.\nexport const afterglowSong = ${JSON.stringify(song, null, 2)} as const\n`
)
