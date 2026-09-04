import type { StudioClip, StudioNote, StudioSound } from "./Studio.ts"

export const studioAudioSampleRate = 44_100
const generatedUrls = new Map<string, string>()
const uploadedUrls = new Map<string, string>()

const clamp = (value: number, minimum = -1, maximum = 1) => Math.max(minimum, Math.min(maximum, value))

const midiToFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

const deterministicNoise = (sample: number, seed: number): number => {
  let value = (sample + Math.imul(seed, 374_761_393)) | 0
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177)
  return ((value ^ (value >>> 16)) >>> 0) / 2_147_483_648 - 1
}

const highPassedNoise = (sample: number, seed: number, stride = 1): number =>
  (deterministicNoise(sample * stride, seed) - deterministicNoise((sample - 1) * stride, seed)) * 0.5

const drumSample = (time: number, sample: number, bpm: number, seed: number): number => {
  const beatDuration = 60 / bpm
  const quarterIndex = Math.floor(time / beatDuration)
  const quarterPhase = time - quarterIndex * beatDuration
  const eighthDuration = beatDuration / 2
  const eighthPhase = time % eighthDuration

  const kickEnvelope = Math.exp(-quarterPhase * 16)
  const kickFrequency = 48 + 64 * Math.exp(-quarterPhase * 28)
  const kick = Math.sin(Math.PI * 2 * kickFrequency * quarterPhase) * kickEnvelope * 0.86

  const snareActive = quarterIndex % 4 === 1 || quarterIndex % 4 === 3
  const snareEnvelope = snareActive ? Math.exp(-quarterPhase * 22) : 0
  const snare =
    deterministicNoise(sample, seed + quarterIndex) * snareEnvelope * 0.46 +
    Math.sin(Math.PI * 2 * 185 * quarterPhase) * snareEnvelope * 0.16

  const hatEnvelope = Math.exp(-eighthPhase * 58)
  const hat = deterministicNoise(sample * 3, seed + 91) * hatEnvelope * 0.15

  return kick + snare + hat
}

const bassSample = (time: number, bpm: number, seed: number): number => {
  const stepDuration = 30 / bpm
  const sequence = [36, 36, 39, 34, 43, 39, 34, 31] as const
  const step = Math.floor(time / stepDuration)
  const phase = time - step * stepDuration
  const midi = sequence[(step + seed) % sequence.length] ?? 36
  const frequency = midiToFrequency(midi)
  const envelope = Math.min(1, phase * 40) * Math.exp(-phase * 2.6)
  const sine = Math.sin(Math.PI * 2 * frequency * phase)
  const saw = 2 * ((phase * frequency) % 1) - 1
  return (sine * 0.72 + saw * 0.22) * envelope * 0.64
}

const padSample = (time: number, bpm: number, seed: number): number => {
  const barDuration = (60 / bpm) * 4
  const roots = [48, 44, 51, 46] as const
  const bar = Math.floor(time / barDuration)
  const root = roots[(bar + seed) % roots.length] ?? 48
  const chord = [root, root + 3, root + 7, root + 12]
  const local = time % barDuration
  const envelope = Math.min(1, local * 1.6) * Math.min(1, (barDuration - local) * 1.4)
  const movement = 0.76 + Math.sin(Math.PI * 2 * 0.11 * time) * 0.09
  return (
    chord.reduce((sum, midi, index) => {
      const frequency = midiToFrequency(midi)
      return sum + Math.sin(Math.PI * 2 * frequency * time + index * 0.7) / chord.length
    }, 0) *
    envelope *
    movement *
    0.46
  )
}

const leadSample = (time: number, bpm: number, seed: number): number => {
  const stepDuration = 30 / bpm
  const sequence = [60, 63, 67, 70, 67, 63, 72, 70] as const
  const step = Math.floor(time / stepDuration)
  const phase = time - step * stepDuration
  const midi = sequence[(step + seed) % sequence.length] ?? 60
  const frequency = midiToFrequency(midi)
  const envelope = Math.min(1, phase * 36) * Math.exp(-phase * 4.8)
  const pulse = (phase * frequency) % 1 < 0.36 ? 1 : -1
  return (pulse * 0.28 + Math.sin(Math.PI * 2 * frequency * phase) * 0.55) * envelope * 0.5
}

const textureSample = (time: number, sample: number, seed: number): number => {
  const noise = deterministicNoise(Math.floor(sample / 22), seed)
  const carrier = Math.sin(Math.PI * 2 * (110 + (seed % 31)) * time)
  const shimmer = Math.sin(Math.PI * 2 * (329.63 + (seed % 17)) * time + Math.sin(time * 0.8))
  const gate = 0.45 + Math.sin(Math.PI * 2 * 0.17 * time) * 0.2
  return (noise * 0.09 + carrier * 0.13 + shimmer * 0.08) * gate
}

const sampleForSound = (
  sound: StudioSound,
  time: number,
  sample: number,
  bpm: number,
  seed: number
): number => {
  switch (sound) {
    case "drums":
      return drumSample(time, sample, bpm, seed)
    case "bass":
      return bassSample(time, bpm, seed)
    case "pad":
      return padSample(time, bpm, seed)
    case "lead":
      return leadSample(time, bpm, seed)
    case "texture":
      return textureSample(time, sample, seed)
  }
}

const drumNoteSample = (midi: number, age: number, sample: number, seed: number): number => {
  const tau = Math.PI * 2

  if (midi === 35 || midi === 36) {
    const phase = 47 * age + (108 * (1 - Math.exp(-age * 34))) / 34
    const body = Math.sin(tau * phase) * Math.exp(-age * 11.5)
    const sub = Math.sin(tau * 43 * age) * Math.exp(-age * 7.5)
    const click = highPassedNoise(sample, seed + midi, 5) * Math.exp(-age * 105)
    return body * 0.82 + sub * 0.17 + click * 0.09
  }

  if (midi === 37) {
    const click = highPassedNoise(sample, seed + midi, 7) * Math.exp(-age * 72)
    const shell = Math.sin(tau * 1_740 * age) * Math.exp(-age * 48)
    return click * 0.62 + shell * 0.25
  }

  if (midi === 38 || midi === 40) {
    const attack = Math.min(1, age * 900)
    const snap = highPassedNoise(sample, seed + midi, 3) * Math.exp(-age * 18)
    const wires = highPassedNoise(sample, seed + midi + 31, 11) * Math.exp(-age * 8.5)
    const body =
      (Math.sin(tau * 181 * age) * 0.72 + Math.sin(tau * 329 * age + 0.35) * 0.28) * Math.exp(-age * 21)
    return (snap * 0.58 + wires * 0.16 + body * 0.32) * attack
  }

  if (midi === 39) {
    const burst = (offset: number): number =>
      age < offset
        ? 0
        : highPassedNoise(sample, seed + Math.round(offset * 10_000), 5) * Math.exp(-(age - offset) * 65)
    return (burst(0) + burst(0.012) * 0.78 + burst(0.025) * 0.58) * 0.58
  }

  if (midi === 41 || midi === 43 || midi === 45 || midi === 47 || midi === 48 || midi === 50) {
    const frequency =
      midi === 41 ? 82 : midi === 43 ? 92 : midi === 45 ? 110 : midi === 47 ? 124 : midi === 48 ? 147 : 165
    const phase = frequency * age + (frequency * 0.34 * (1 - Math.exp(-age * 18))) / 18
    const attack = Math.min(1, age * 320)
    return (
      (Math.sin(tau * phase) * 0.72 +
        Math.sin(tau * phase * 1.51 + 0.25) * 0.18 +
        highPassedNoise(sample, seed + midi, 3) * Math.exp(-age * 42) * 0.08) *
      attack *
      Math.exp(-age * 7.2)
    )
  }

  if (midi === 42 || midi === 44 || midi === 46) {
    const open = midi === 46
    const envelope = Math.min(1, age * 1_200) * Math.exp(-age * (open ? 7.5 : 48))
    const metal =
      Math.sin(tau * 5_270 * age) * 0.26 +
      Math.sin(tau * 7_431 * age + 0.6) * 0.22 +
      Math.sin(tau * 10_139 * age + 1.2) * 0.16
    const air = highPassedNoise(sample, seed + midi, 13) * 0.58
    return (metal + air) * envelope * (open ? 0.5 : 0.42)
  }

  if (midi === 51 || midi === 53 || midi === 59) {
    const envelope = Math.min(1, age * 700) * Math.exp(-age * 3.2)
    const bell =
      Math.sin(tau * 2_750 * age) * 0.3 +
      Math.sin(tau * 4_183 * age + 0.5) * 0.24 +
      Math.sin(tau * 6_917 * age + 1.1) * 0.18
    return (bell + highPassedNoise(sample, seed + midi, 9) * 0.22) * envelope * 0.48
  }

  if (midi === 49 || midi === 52 || midi === 55 || midi === 57) {
    const envelope = Math.min(1, age * 550) * Math.exp(-age * 2.7)
    const shimmer =
      Math.sin(tau * 3_381 * age) * 0.18 +
      Math.sin(tau * 5_707 * age + 0.7) * 0.16 +
      Math.sin(tau * 8_921 * age + 1.4) * 0.13
    return (highPassedNoise(sample, seed + midi, 11) * 0.5 + shimmer) * envelope * 0.45
  }

  return (
    highPassedNoise(sample, seed + midi, 7) * Math.exp(-age * 21) * 0.42 +
    Math.sin(tau * (240 + midi * 8) * age) * Math.exp(-age * 16) * 0.18
  )
}

const percussionTailSeconds = (midi: number): number => {
  if (midi === 35 || midi === 36) return 0.42
  if (midi === 38 || midi === 39 || midi === 40) return 0.36
  if (midi === 41 || midi === 43 || midi === 45 || midi === 47 || midi === 48 || midi === 50) {
    return 0.52
  }
  if (midi === 46) return 0.7
  if (midi === 49 || midi === 51 || midi === 52 || midi === 53 || midi === 55 || midi === 57 || midi === 59) {
    return 1.25
  }
  return 0.14
}

const pitchedNoteSample = (
  note: Pick<StudioNote, "midi" | "duration">,
  sound: StudioSound,
  age: number,
  sample: number,
  seed: number,
  midiProgram?: number
): number => {
  const frequency = midiToFrequency(note.midi)
  const phase = age * frequency

  // Channel-10 percussion is selected by the canonical sound/channel mapping;
  // its General MIDI program value is not an instrument family selector.
  if (sound === "drums") return drumNoteSample(note.midi, age, sample, seed)

  if (midiProgram !== undefined && midiProgram >= 0 && midiProgram <= 3) {
    const attack = Math.min(1, age * 180)
    const release = Math.min(1, Math.max(0, note.duration - age) * 18)
    const fundamental =
      Math.sin(Math.PI * 2 * phase * 0.9988) * 0.34 + Math.sin(Math.PI * 2 * phase * 1.0014 + 0.17) * 0.34
    const overtones =
      Math.sin(Math.PI * 4 * phase + 0.11) * Math.exp(-age * 1.5) * 0.18 +
      Math.sin(Math.PI * 6.02 * phase + 0.4) * Math.exp(-age * 2.6) * 0.09 +
      Math.sin(Math.PI * 8.05 * phase + 0.9) * Math.exp(-age * 4.1) * 0.045
    const hammer = highPassedNoise(sample, seed + note.midi, 5) * Math.exp(-age * 72) * 0.045
    return (fundamental * Math.exp(-age * 0.72) + overtones + hammer) * attack * release * 0.78
  }

  if (midiProgram !== undefined && midiProgram >= 24 && midiProgram <= 31) {
    const attack = Math.min(1, age * 80)
    const release = Math.min(1, Math.max(0, note.duration - age) * 28)
    const pick = deterministicNoise(sample * 11, seed + note.midi) * Math.exp(-age * 38) * 0.04
    return (
      (Math.sin(Math.PI * 2 * phase) * 0.58 +
        Math.sin(Math.PI * 4 * phase + 0.18) * 0.22 +
        Math.sin(Math.PI * 6 * phase + 0.42) * 0.1 +
        pick) *
      attack *
      release *
      Math.exp(-age * 2.4)
    )
  }

  if (midiProgram !== undefined && midiProgram >= 4 && midiProgram <= 7) {
    const attack = Math.min(1, age * 48)
    const release = Math.min(1, Math.max(0, note.duration - age) * 16)
    const tremolo = 0.93 + Math.sin(Math.PI * 2 * 4.8 * age) * 0.07
    return (
      (Math.sin(Math.PI * 2 * phase) * 0.62 +
        Math.sin(Math.PI * 4 * phase + 0.22) * 0.18 +
        Math.sin(Math.PI * 6 * phase + 0.5) * 0.07) *
      attack *
      release *
      Math.exp(-age * 0.65) *
      tremolo
    )
  }

  if (midiProgram !== undefined && midiProgram >= 52 && midiProgram <= 54) {
    const attack = Math.min(1, age * 4)
    const release = Math.min(1, Math.max(0, note.duration - age) * 4)
    return (
      (Math.sin(Math.PI * 2 * frequency * 0.996 * age) * 0.28 +
        Math.sin(Math.PI * 2 * frequency * age) * 0.36 +
        Math.sin(Math.PI * 2 * frequency * 1.004 * age + 0.6) * 0.28) *
      attack *
      release *
      0.58
    )
  }

  const attack = Math.min(1, age * (sound === "pad" ? 5 : 45))
  const release = Math.min(1, Math.max(0, note.duration - age) * (sound === "pad" ? 5 : 24))
  const envelope = attack * release
  switch (sound) {
    case "bass":
      return (
        (Math.sin(Math.PI * 2 * phase) * 0.72 + (2 * (phase % 1) - 1) * 0.2) * envelope * Math.exp(-age * 0.7)
      )
    case "pad":
      return (
        (Math.sin(Math.PI * 2 * phase) * 0.66 + Math.sin(Math.PI * 4 * phase + 0.4) * 0.2) * envelope * 0.5
      )
    case "lead":
      return (
        ((phase % 1 < 0.38 ? 1 : -1) * 0.26 + Math.sin(Math.PI * 2 * phase) * 0.56) *
        envelope *
        Math.exp(-age * 1.4)
      )
    case "texture":
      return (
        (Math.sin(Math.PI * 2 * phase) * 0.44 +
          deterministicNoise(Math.floor(sample / 12), seed + note.midi) * 0.11) *
        envelope
      )
  }
}

export const renderStudioMidiSamples = (
  notes: ReadonlyArray<Pick<StudioNote, "midi" | "time" | "duration" | "velocity">>,
  sound: StudioSound,
  sampleCount: number,
  sampleRate: number,
  seed: number,
  midiProgram?: number
): Float32Array => {
  const rendered = new Float32Array(sampleCount)

  for (const [noteIndex, note] of notes.entries()) {
    const firstSample = Math.max(0, Math.floor(note.time * sampleRate))
    const audibleDuration =
      sound === "drums" ? Math.max(note.duration, percussionTailSeconds(note.midi)) : note.duration
    const lastSample = Math.min(sampleCount, Math.ceil((note.time + audibleDuration) * sampleRate))

    for (let sample = firstSample; sample < lastSample; sample += 1) {
      const age = sample / sampleRate - note.time
      rendered[sample] =
        (rendered[sample] ?? 0) +
        pitchedNoteSample(note, sound, age, sample, seed + noteIndex * 17, midiProgram) * note.velocity
    }
  }

  for (let sample = 0; sample < rendered.length; sample += 1) {
    const value = rendered[sample] ?? 0
    if (Math.abs(value) <= 0.9) continue
    rendered[sample] = Math.sign(value) * (0.9 + Math.tanh((Math.abs(value) - 0.9) * 4) * 0.1)
  }

  return rendered
}

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

const generatedWav = (clip: StudioClip, bpm: number): Blob => {
  const duration = Math.max(0.25, clip.duration)
  const sampleCount = Math.ceil(duration * studioAudioSampleRate)
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + sampleCount * 2, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, studioAudioSampleRate, true)
  view.setUint32(28, studioAudioSampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, sampleCount * 2, true)

  const source = clip.source
  const sound = source.kind === "upload" ? "texture" : source.sound
  const seed = source.kind === "upload" ? 1 : source.seed
  const midiSamples =
    clip.kind === "midi" && clip.notes.length > 0
      ? renderStudioMidiSamples(clip.notes, sound, sampleCount, studioAudioSampleRate, seed, clip.midiProgram)
      : null
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / studioAudioSampleRate
    const edgeFade = Math.min(1, time * 80, (duration - time) * 80)
    const projected = midiSamples?.[sample] ?? sampleForSound(sound, time, sample, bpm, seed)
    const value = clamp(projected * clip.gain * edgeFade)
    view.setInt16(44 + sample * 2, Math.round(value * 32_767), true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

export const registerUploadedAudio = (file: File): { readonly assetId: string; readonly url: string } => {
  const assetId = `upload-${crypto.randomUUID()}`
  const url = URL.createObjectURL(file)
  uploadedUrls.set(assetId, url)
  return { assetId, url }
}

export const registerBrowserRecordingAudio = (
  blob: Blob
): { readonly assetId: string; readonly url: string } => {
  const assetId = `recording-${crypto.randomUUID()}`
  const url = URL.createObjectURL(blob)
  uploadedUrls.set(assetId, url)
  return { assetId, url }
}

export const readAudioDuration = (url: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const audio = new Audio()
    const release = () => {
      audio.removeAttribute("src")
      audio.load()
    }
    audio.addEventListener(
      "loadedmetadata",
      () => {
        const duration = audio.duration
        release()
        if (Number.isFinite(duration) && duration > 0) resolve(duration)
        else reject(new Error("The selected file has no readable duration."))
      },
      { once: true }
    )
    audio.addEventListener(
      "error",
      () => {
        release()
        reject(new Error("The browser could not decode this audio file."))
      },
      { once: true }
    )
    audio.src = url
  })

export const resolveClipAudioUrl = (clip: StudioClip, bpm: number): string => {
  if (clip.source.kind === "upload") {
    const uploaded = uploadedUrls.get(clip.source.assetId)
    if (uploaded === undefined) throw new Error(`Uploaded asset ${clip.source.assetId} is unavailable.`)
    return uploaded
  }

  const noteFingerprint =
    clip.kind === "midi"
      ? clip.notes.map((note) => `${note.midi}:${note.time}:${note.duration}:${note.velocity}`).join(";")
      : "audio"
  const key = `${clip.id}:${clip.source.seed}:${clip.duration}:${clip.gain}:${bpm}:${noteFingerprint}`
  const existing = generatedUrls.get(key)
  if (existing !== undefined) return existing
  const url = URL.createObjectURL(generatedWav(clip, bpm))
  generatedUrls.set(key, url)
  return url
}

export const audioBufferToWavBlob = (audioBuffer: AudioBuffer): Blob => {
  const channelCount = Math.min(2, audioBuffer.numberOfChannels)
  const sampleCount = audioBuffer.length
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const buffer = new ArrayBuffer(44 + sampleCount * blockAlign)
  const view = new DataView(buffer)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + sampleCount * blockAlign, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, audioBuffer.sampleRate, true)
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, sampleCount * blockAlign, true)

  const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index))
  let offset = 44
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (const channel of channels) {
      view.setInt16(offset, Math.round(clamp(channel[sample] ?? 0) * 32_767), true)
      offset += bytesPerSample
    }
  }

  return new Blob([buffer], { type: "audio/wav" })
}
