import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { format } from "prettier"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = resolve(repositoryRoot, "public/studio-songs/korobeiniki.mid")
const outputPath = resolve(repositoryRoot, "src/studio/songs/korobeiniki.generated.ts")
const expectedSha256 = "84c71f223e62419ecbbb58b4a9a114ded11ab5c7d4ec394b4f97c20815c0b67e"

const rootRequire = createRequire(import.meta.url)
const dawMidiEntry = rootRequire.resolve("@dawcore/midi")
const dawMidiRequire = createRequire(dawMidiEntry)
const { Midi } = dawMidiRequire("@tonejs/midi")

const sourceTracks = [
  {
    id: "square-lead",
    name: "Square Lead",
    color: "#4fa3ff",
    volume: 0.72,
    pan: -0.08,
    sound: "lead",
    seed: 101,
    program: 80,
    channel: 0
  },
  {
    id: "pulse-harmony",
    name: "Pulse Harmony",
    color: "#a97bf5",
    volume: 0.46,
    pan: 0.12,
    sound: "lead",
    seed: 103,
    program: 81,
    channel: 0
  },
  {
    id: "synth-bass",
    name: "Synth Bass",
    color: "#39c2d0",
    volume: 0.58,
    pan: 0,
    sound: "bass",
    seed: 107,
    program: 38,
    channel: 0
  },
  {
    id: "electric-bass",
    name: "Electric Bass",
    color: "#5bc77a",
    volume: 0.56,
    pan: -0.04,
    sound: "bass",
    seed: 109,
    program: 33,
    channel: 0
  },
  {
    id: "string-pad",
    name: "String Pad",
    color: "#cb76e8",
    volume: 0.38,
    pan: 0.08,
    sound: "pad",
    seed: 113,
    program: 48,
    channel: 0
  },
  {
    id: "piano-lead",
    name: "Piano Lead",
    color: "#f2c94c",
    volume: 0.62,
    pan: -0.1,
    sound: "lead",
    seed: 127,
    program: 4,
    channel: 0
  },
  {
    id: "piano-harmony",
    name: "Piano Harmony",
    color: "#ed6f9d",
    volume: 0.44,
    pan: 0.12,
    sound: "lead",
    seed: 131,
    program: 4,
    channel: 0
  },
  {
    id: "piano-bass",
    name: "Piano Bass",
    color: "#5ca7a1",
    volume: 0.48,
    pan: 0,
    sound: "bass",
    seed: 137,
    program: 38,
    channel: 0
  }
]

const clean = (value) => Number(value.toFixed(6))
const midiVelocity = (velocity) => Math.max(1, Math.min(127, Math.round(velocity * 127)))

const sourceBytes = await readFile(sourcePath)
const actualSha256 = createHash("sha256").update(sourceBytes).digest("hex")
if (actualSha256 !== expectedSha256) {
  throw new Error(`Refusing to import an unverified MIDI asset: ${actualSha256}`)
}

const midi = new Midi(sourceBytes)
if (midi.tracks.length !== sourceTracks.length) {
  throw new Error(`Expected ${sourceTracks.length} note tracks, received ${midi.tracks.length}`)
}

const importedTracks = midi.tracks.map((track, trackIndex) => {
  const definition = sourceTracks[trackIndex]
  if (definition === undefined) throw new Error(`Missing definition for MIDI track ${trackIndex}`)
  return {
    ...definition,
    sourceKind: "midi_asset",
    sourceTrackName: track.name,
    notes: track.notes
      .map((note) => [
        note.midi,
        clean(note.ticks / midi.header.ppq),
        clean(note.durationTicks / midi.header.ppq),
        midiVelocity(note.velocity)
      ])
      .sort((left, right) => left[1] - right[1] || left[0] - right[0])
  }
})

const sessionEndBeat = clean(
  Math.max(...importedTracks.flatMap((track) => track.notes.map((note) => Number(note[1]) + Number(note[2]))))
)

const drumNotes = []
const addDrum = (midiNumber, startBeat, durationBeats, velocity) => {
  if (startBeat < sessionEndBeat) drumNotes.push([midiNumber, clean(startBeat), durationBeats, velocity])
}

for (let beat = 0; beat < sessionEndBeat; beat += 0.5) {
  addDrum(beat % 4 === 3.5 ? 46 : 42, beat, 0.12, beat % 1 === 0 ? 78 : 58)
}
for (let bar = 0; bar * 4 < sessionEndBeat; bar += 1) {
  const startBeat = bar * 4
  addDrum(36, startBeat, 0.24, 112)
  addDrum(38, startBeat + 1, 0.2, 102)
  addDrum(36, startBeat + 2, 0.24, 106)
  if (bar % 2 === 1) addDrum(36, startBeat + 2.5, 0.18, 84)
  addDrum(38, startBeat + 3, 0.2, 106)
  if (bar % 8 === 0) addDrum(49, startBeat, 0.5, 92)
}

const tracks = [
  {
    id: "drums",
    name: "Pop Drums",
    color: "#f5a44b",
    volume: 0.64,
    pan: 0,
    sound: "drums",
    seed: 97,
    program: 0,
    channel: 9,
    sourceKind: "generated",
    sourceTrackName: "Signal Studio pop drum adaptation",
    notes: drumNotes.sort((left, right) => left[1] - right[1] || left[0] - right[0])
  },
  ...importedTracks
]

const song = {
  slug: "korobeiniki",
  projectId: "signal-studio-korobeiniki",
  title: "Korobeiniki // Arcade Pop",
  bpm: 138,
  timeSignature: [4, 4],
  selection: [16, 32],
  source: {
    title: "Tetris forever",
    creator: "rocavaco",
    sourceUrl: "https://ccmixter.org/files/rocavaco/44418",
    licenseName: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourceMidiUrl: "/studio-songs/korobeiniki.mid",
    sourceMidiSha256: expectedSha256,
    changes:
      "Track labels and General MIDI programs normalized, tempo set to 138 BPM, and an original pop drum part added for Signal Studio."
  },
  sourcePpq: midi.header.ppq,
  sessionEndBeat,
  tracks
}

const unformattedOutput =
  `// Generated by scripts/import-studio-midi.mjs. Do not edit by hand.\n` +
  `export const korobeinikiSong = ${JSON.stringify(song, null, 2)} as const\n`
const output = await format(unformattedOutput, {
  parser: "typescript",
  printWidth: 110,
  semi: false,
  singleQuote: false,
  trailingComma: "none"
})

await writeFile(outputPath, output)
console.log(
  `Imported ${tracks.length} tracks and ${tracks.reduce((sum, track) => sum + track.notes.length, 0)} notes.`
)
