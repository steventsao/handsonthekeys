# WebMCP Challenge

A collection of browser-native WebMCP experiments in which people and agents use the same typed
application capabilities. The repository currently includes a cooperative agent room, a shared
generative-visual queue, an instrument-learning studio, a rescue workflow, and a voice-controlled
recipe demo.

## HEX RELAY // cooperative agent room

Hex Relay is a shareable collaboration room. The creating tab becomes lead; every other tab starts
as an observer and may explicitly offer a `copy`, `palette`, or `iconography` interface. The lead
freezes a deterministic three-task poster plan, cells claim and submit typed pieces, and the lead
accepts or reopens each submission. Three accepted pieces assemble a live seven-cell SVG poster.

The room backend is Effect-driven: Effect Schema owns every HTTP and WebMCP boundary,
`Context.Service` and `Layer` provide the D1 runtime, `Effect.fn` names service operations, and tagged
errors preserve role and transition failures. D1 stores stable room, cell, and task IDs; hashed tab
tokens; authoritative projections; and one monotonically revised event log. Seven page-scoped WebMCP
tools call the same Effect API as the visible controls.

## INFINITE SLOP // visual queue

Infinite Slop is a shared generative-visual channel where people and agents operate the same prompt
queue. The `/slop.html` page includes a portrait reel, playing-next and generating pipeline, ranked
queue, activity stream, and prompt composer.

Four Effect-backed WebMCP tools are registered on that page:

| Tool           | Capability                                                             |
| -------------- | ---------------------------------------------------------------------- |
| `queue_prompt` | Queue one visual prompt and immediately return its durable run ID.     |
| `get_status`   | Read queue position, progress, revision, steering history, and output. |
| `batch_queue`  | Atomically queue 1–6 prompts in input order.                           |
| `steer_prompt` | Apply revision-checked creative direction; completed work is requeued. |

Every tool result is also painted into the visible activity stream as an interactive result card.
The protocol response stays structured JSON; the page supplies the visual representation and lets a
person select the affected run in the reel.

## STUDIO // WebMCP instrument learning

[`/?mode=session`](./index.html) is the default Session surface: a simplified Garage-style rack that always
shows Piano, Drums, and Metronome. Piano and Drums illuminate only when an unmuted canonical MIDI clip
covers the shared musical playhead while track playback is running; otherwise they truthfully show
ready, muted, silent, or no-current-segment state. Each musical tile exposes at most one stable current
clip and one real upcoming clip/start beat, without synthesizing a future segment. The Metronome tile
follows the page-persistent DAW audio clock and remains active during click-only operation. The click can
be enabled independently of musical-track playback, but it never creates a MIDI track, moves the parked
DAW playhead, or changes the musical project revision.
[`/?mode=tab`](./index.html) opens Tab Mode, which deterministically maps one canonical non-drum MIDI
track onto standard six-string tuning and presents synchronized treble-8vb notation and guitar
tablature. The score shows measures, rests, chords, accidentals, beamed rhythm, articulation, exact
fret positions, and a shared playhead while the learner chooses the passage and hand position. It
does not create a second score or tab arrangement: both staves reference the same stable, bounded
MIDI-event IDs that appear in Studio Mode. If an agent or person edits those notes, the paired score
updates at the same project revision.

The read-only score projection is an Effect Schema-validated data model built from
[MusicXML 4.0 guitar semantics](https://www.w3.org/2021/06/musicxml40/tutorial/tablature/): explicit
meter and measures, a transposing guitar clef, paired standard/TAB staves, and string/fret technique
references. [VexFlow 5](https://github.com/0xfe/vexflow) engraves that projection as browser SVG.
Performed MIDI gates remain exact; when written rhythm comes from the inter-onset pulse or requires
quantization, that choice and its error are exposed in the same view model. The studio does not
adopt alphaTab's separate `Score` and playback state, because canonical Studio MIDI and the shared DAW
engine remain the sole musical authority.

[`/?mode=daw`](./index.html) is a browser-local arrangement workstation inspired by Suno Studio's
preview-first editing loop. Its multitrack timeline is powered by the MIT-licensed
[`@dawcore/components`](https://github.com/naomiaro/waveform-playlist) custom elements, while
MIDI playback, deterministic note-derived preview audio, mixing, and WAV export stay in the browser.

The visible Session, Tab, and Studio controls and the one public WebMCP Code Mode tool share the Effect
modules, one canonical MIDI document, one undo history, and one page-persistent DAW-owned `AudioContext`
and native transport.
The metronome is an independently enabled capability of that transport, not a second clock. It can keep
pulsing in click-only mode while musical tracks are stopped; starting tracks then atomically rephases
the click and musical scheduler at the DAW playhead so a late Play action cannot preserve an old phase
offset. A bounded signed BPM step can accelerate or slow the same transport after each bar. Code Mode
can read the bounded session, toggle that click, add an original drum practice beat, control playback
and looping, prepare or stop a recording, and create a share link without inferring music from the GUI.
The same MIDI document drives the piano-roll/timeline projection and audio engine; uploaded recordings
remain explicitly referenced opaque assets because MIDI cannot encode their waveforms. Mutations accept
retry-safe request IDs and optional expected revisions so a stale agent cannot silently overwrite a newer
edit. Every accepted human or agent mutation also lands in an ordered Effect journal; rejected calls and
idempotent retries do not create false events.

The public `getInstruments` method returns the same fixed, bounded Session rack projection. Its
Piano/Drums state is derived from canonical track and clip IDs, exact clip beat bounds, mix state, and
the shared playhead; its Metronome state comes from the shared DAW transport. It does not inspect
rendered audio, predict repeated music, or maintain a second arrangement.

The committed structured MIDI project, bounded undo/redo history, retry ledger, and mutation journal
are saved per project in browser session storage before a successful mutation returns. Session, Tab,
and Studio are query-addressed views of the same root document and Effect runtime, so switching
`?mode=session|tab|daw` does not reload the page or recreate the WebMCP registry. The legacy karaoke
route can reconstruct the same revision, MIDI arrangement, and mix settings from browser session
storage. Lesson configuration has its own retry-safe lesson revision and never increments the musical
project revision. Raw audio, rendered buffers, microphone frames, and object/blob URLs are never
serialized into that handoff; page-local uploaded recordings are not carried across a reload.

Studio also has an explicit browser recording lane. Code Mode can prepare a named take with a
one-to-four-bar count-in, but a visible human click is the only path that may call `getUserMedia` and
show the browser's microphone permission prompt. The UI then shows `COUNT-IN N` on every beat before
switching to an unmistakable `● RECORDING` state; the metronome continues while capture runs. Code
Mode can read bounded status metadata and stop a take that the person already started. Stopping
commits an opaque page-local audio asset through the same Effect Studio module used by the UI. Tool
responses never include samples, encoded audio, object/blob URLs, or the private asset ID.

Share links are backed by Cloudflare D1. A person or ChatGPT/WebMCP agent can create an immutable,
unlisted snapshot link containing canonical MIDI, lesson configuration, timed lyrics, and rights
provenance. Anyone with the URL can read the snapshot for 30 days. Browser recordings and uploaded
audio are always omitted, and every share receipt reports the number of omitted audio assets. Opening
the link imports an undoable local copy rather than joining two browsers to one mutable project.

One page-scoped WebMCP tool, `codemode`, forms the focused public contract. It is built with
Cloudflare's
[`createBrowserCodeTool` and `IframeSandboxExecutor`](https://developers.cloudflare.com/agents/tools/codemode/browser/),
runs one bounded JavaScript async function in a fresh sandbox, and exposes a deliberately small
schema-validated interface. Those methods call the same Effect modules as the visible controls; the
broader domain surface remains internal so it does not burden agent discovery. The one public tool
description is at most 500 characters, its one parameter description is at most 150 characters, and
its serialized result is capped at 1,000 characters before the concise envelope is added.

| Code Mode method   | Capability                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `getSession`       | Read bounded tempo, mode, metronome, loop, recording, and track-count state.                 |
| `getInstruments`   | Read the fixed, bounded Session rack derived from canonical MIDI and the shared transport.   |
| `setMetronome`     | Start or stop the shared-transport click, set BPM, or configure a bounded tempo ramp.        |
| `addDrumBeat`      | Add an original, undoable channel-10 MIDI practice beat and reveal it in Studio Mode.        |
| `controlTransport` | Play, pause, stop, seek, play a range, or set an exact persistent loop on the shared engine. |
| `recordTake`       | Prepare a human-started browser recording or stop and commit the active take.                |
| `shareSession`     | Create a retry-safe 30-day MIDI/lesson snapshot that explicitly omits local audio.           |

The intended demo is a short conversation rather than a catalog of GUI-shaped calls:

1. “Start the metronome so I can warm up.”
2. “Set it to the tempo of John Mayer's _Stop This Train_.” Code Mode may use the factual tempo only;
   it does not import the song, riff, recording, MIDI, notation, or tablature.
3. “Add a simple drum beat over it.” The result is a new original channel-10 MIDI pattern.
4. “Record it.” Code Mode prepares the take; the person presses the visible recording control, sees
   the count-in, and grants the browser microphone permission if needed.
5. “Share it.” The link contains MIDI and lesson settings, while local audio remains omitted.
6. “Slow it down by 2 BPM after every bar.” A negative signed step makes that request unambiguous;
   a positive step speeds it up.

The loop is transport state, not copied music. `controlTransport({ action: "set_loop", ... })`
flows through the Effect `InstrumentLearning` service to the persistent DAW controller, then
uses the installed `@waveform-playlist/engine` loop region and the `@dawcore/transport` playout
adapter. Enabling or disabling it changes the lesson revision, leaves canonical MIDI and project
undo history untouched, and is reflected by the visible loop button and timeline range.

The source-controlled [song catalog](./SONG_CATALOG.md) admits a playable song only after its
composition, lyrics, arrangement, recording, timing chart, and visuals are documented. Open-source
software, a public GitHub repository, or nonprofit use is never treated as blanket permission for
the music. The internal `get_studio_song_catalog` domain view exposes that same allowlist and keeps research leads in a
separate intake-only section so an agent cannot promise an uncleared title.

Instrument learning does not create a copyright exemption. Protected song melodies, signature
riffs, note-for-note arrangements, and third-party tablature are not admitted merely because the UI
calls them lessons. The clean production paths are project-authored exercises, user-authored music,
properly licensed works, and public-domain compositions with an independently cleared arrangement.
The facts-only practice-bed workflow may use approximate tempo, key, meter, and general harmonic
vocabulary as references, but it excludes source lyrics, melody, riffs, notation, MIDI, recordings,
and exact arrangement choices.

The retained internal `write_studio_midi` domain action accepts 1–512 notes per call. Note starts and durations use absolute,
zero-based quarter-note beats; pitches may be MIDI numbers or names such as `C4`, `F#3`, and `Bb2`;
velocity uses the standard 1–127 range. `create` can make a new MIDI track and clip, `append` adds to
one stable clip ID, and `replace` swaps that clip's whole note set atomically. Each call is one
undoable transaction, while request IDs and expected revisions make retries and concurrent edits
safe. General MIDI program and channel are preserved with the clip (channel 9 is the drum channel).
Its paired internal `get_studio_midi` view deliberately returns normalized event JSON rather than Standard MIDI File bytes:
the complete document includes tempo and meter maps, PPQ, selection, mix state, every track, clip,
stable note ID, staged preview, and separately identified audio references in one revisioned read.

The legacy karaoke route remains available while the product transitions. Its console makes the browser itself the runtime: it plays the arrangement, advances
authorized or user-authored lyric tokens against canonical MIDI beats, requests microphone access
only after a person presses **Start singing**, detects monophonic vocal pitch, and scores confident
frames locally. Raw microphone samples never enter Studio state or WebMCP output. The agent can
stage musical setup and read bounded results such as cents error, evidence coverage, range, and
phrase scores, but it cannot start the microphone. The current key-change path transposes MIDI
exactly; it does not claim time-preserving pitch shifting for recorded audio. “Browser-native” is
therefore the precise claim—offline operation and polyphonic transcription are not claimed.

The internal developer bridge retains `query_studio` as a compact read path for tests and advanced
domain work that need the whole session but not the whole
session in model context. Its generated tool description gives the model typed access to
`codemode.getStudioMidi({})` and `codemode.getStudioPresentation({})`. The first method captures one
immutable revision through the Effect Studio service. The second reports only semantic UI state:
surface, active panel, transport, operation, microphone and lyric phases, tool readiness, and the
latest accepted mutation transition. It never includes raw audio, sample frames, or animation
frames. Each execution passes these point-in-time snapshots into a fresh sandboxed browser iframe
and accepts only a JSON-serializable result up to 2,500 characters. Console content is not returned.
The preferred program shape is explicit and easy to repair:

```text
async () => {
  const midi = await codemode.getStudioMidi({})
  const presentation = await codemode.getStudioPresentation({})
  const bass = midi.tracks.find((track) => track.name === "Piano Bass")
  return {
    bass_notes_before_beat_16: bass.clips
      .flatMap((clip) => clip.notes)
      .filter((note) => note.start_beat < 16).length,
    presentation
  }
}
```

For short queries, Code Mode also normalizes a body such as
`const midi = await codemode.getStudioMidi({}); midi.tracks.map(({ track_id, name }) => ({ track_id, name }))`
into an async function and returns its final expression. These advanced query and exact-note actions
are not registered in the page-scoped public WebMCP list; the public `codemode` contract above is the
agent-facing surface.

The internal `compose_studio` action is the writing counterpart. Its tests author a short JavaScript music program instead
of spelling out hundreds of MIDI note objects. Its typed sandbox API exposes `getStudioContext`,
`listInstruments`, `chords`, `arpeggio`, and `writeTracks`:

```text
async () => {
  const studio = await codemode.getStudioContext({})
  const progression = ["Am7", "Fmaj7", "Cmaj7", "G7"]
  const pad = await codemode.chords({
    symbols: progression,
    start_beat: 0,
    beats_per_chord: 4,
    octave: 3,
    voicing: "open"
  })
  const arp = await codemode.arpeggio({
    symbols: progression,
    start_beat: 0,
    beats_per_chord: 4,
    step_beats: 0.5,
    octave: 4,
    octaves: 2,
    direction: "up_down"
  })
  return await codemode.writeTracks({
    request_id: "compose-am-f-c-g-v1",
    expected_revision: studio.revision,
    tracks: [
      { name: "Warm Chords", instrument: "warm_pad", notes: pad.notes },
      { name: "Rising Arp", instrument: "saw_lead", notes: arp.notes }
    ]
  })
}
```

Chord symbols cover major and minor triads, power chords, sixths, sevenths, diminished, augmented,
suspended and added-ninth chords, inversions, open and drop-2 voicings, and slash bass notes such as
`C/E`. Arpeggios support step rate, octave range, up/down/up-down directions, and explicit chord-tone
index patterns. Nineteen friendly instrument aliases map to exact General MIDI programs and channels,
including pianos, organs, guitars, basses, ensembles, winds, synth leads, pads, and channel-10 drums.
The note expansions never enter model context. `writeTracks` only stages the validated plan inside
the sandbox; the Effect Studio service commits all 1–8 tracks after the complete program succeeds.
The commit is one revision-checked, retry-safe, undoable transaction, so an exception after staging
cannot leave a partial arrangement.

The internal `get_studio_mutations` domain view returns a versioned event schema with actor, action, timestamp, request ID,
before/after revisions, stable targets, normalized input, and a concise current-state context for
each successful state change. It supports action filters, a bounded page size, and cursor polling
for new events. The latest 2,048 events are retained and the response always reports the retention
limit and first retained sequence. The journal is session-local and is not a second public WebMCP
tool.

Studio follows a strict monochrome interaction contract: product surfaces use only black, white,
and achromatic grays; non-editable content cannot present an I-beam or text caret; and real text
fields remain visibly editable. `pnpm check:studio-brand` rejects chromatic color literals in the
Studio source before release, while the browser suite audits computed colors and cursor semantics
across the app and the embedded DAW's open shadow roots.

## Privacy and rights

- Playback, MIDI synthesis, MIDI-to-tab mapping, transposition, visualization, export, and vocal
  pitch detection run in the browser.
- Raw microphone samples, encoded audio, sample arrays, object URLs, and blob URLs are never returned
  through WebMCP or serialized into a shared snapshot.
- A microphone can be armed through WebMCP, but capture always requires a visible person to act and
  accept the browser permission flow.
- Read-only tools do not change the project revision, selection, history, microphone state, or
  mutation journal.
- Instrument learning is not treated as a copyright exemption. The catalog accepts project-authored
  exercises, user-authored music, properly licensed works, and public-domain compositions with an
  independently cleared arrangement.

See [SONG_CATALOG.md](./SONG_CATALOG.md) for asset provenance. The MIT license covers the source code;
bundled songs and generated media may have separate terms stated beside those assets.

## Architecture

```text
visible controls ─┐
                 ├─ shared Effect modules ─ browser engines and HTTP APIs
WebMCP tools ─────┘                              │
                                                 ├─ canonical application state
                                                 ├─ revisions + retry ledgers
                                                 ├─ undo/history + mutation journals
                                                 └─ bounded, privacy-safe results
```

- `QueueApi` is an Effect `Context.Service`; every network response is decoded with Effect Schema.
- `@effect/platform-browser/WebMcp` owns scoped registration, discovery, execution, and cancellation.
- Studio registers one Code Mode tool. Secondary demos keep their own page-scoped contracts. Shared D1 state and a `BroadcastChannel` refresh hint keep separate tabs on one channel without making one tab reach into another.
- Mutations use stable per-origin browser identity plus retry-safe `client_request_id` values.
- Steering requires the exact current revision and is limited to runs created by that browser.
- The D1 queue is bounded to 36 active runs globally and 6 per browser. New results advance from queued → generating → succeeded as the channel is polled.
- A seeded fal.ai H3 Max clip demonstrates real portrait video; new public demo jobs use deterministic animated procedural output, avoiding unbounded generation cost.
- Chrome without native WebMCP gets the project’s inspectable local `document.modelContext` adapter, so the ordinary UI and automated flows still work.

Effect Schema validates browser tool and HTTP boundaries. Stable track, clip, note, preview, phrase,
and session IDs keep the interface independent of screen coordinates. Cloudflare D1 stores relay
state and immutable Studio shares; browser session storage holds the local canonical project.

## Local development

Requirements:

- Node.js 20 or newer
- pnpm 9.5.0

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Vite uses an all-zero D1 identifier for local development so a deployment resource ID is never
committed. To target an explicitly provisioned development database, set
`CLOUDFLARE_DATABASE_ID` in your local environment. Keep credentials in the deployment platform or an
ignored local environment file.

## Routes

- `/?mode=session` — Session Mode, the default fixed Piano/Drums/Metronome rack on the shared DAW clock.
- `/?mode=tab` — Tab Mode over the same canonical MIDI session.
- `/?mode=daw` — Studio Mode over the same canonical MIDI session and one Code Mode tool.
- `/`, `/tab.html`, `/studio.html`, and `/studio/*` — compatibility URLs that normalize to a root `mode` URL.
- `/karaoke.html` — the preserved browser-local karaoke experience during the transition.
- `/cell.html` — the Hex Relay cooperative agent room.
- `/slop.html` — the preserved Infinite Slop shared visual channel.
- `/driftline.html` — the original five-tool rescue collaboration demo.
- `/cook.html` — the seven-tool voice-controlled recipe demo.
- `/api/channel` — shared channel snapshot.
- `/api/runs` and `/api/runs/batch` — single and atomic batch enqueue.
- `/api/runs/:id` and `/api/runs/:id/steer` — status and revision-checked steering.

Compatibility URLs such as `/tab.html`, `/studio.html`, and `/studio/*` normalize to the canonical
root mode URL.

## Validation

```bash
pnpm audit:public
pnpm check
pnpm exec playwright install chromium
pnpm e2e
```

`pnpm check` runs the public-data audit, formatting, Studio brand rules, lint, type checking, unit and
coverage tests, and the production build. The browser suite verifies WebMCP discovery and execution,
canonical MIDI round trips, preview/apply/undo behavior, microphone isolation, phone-sized Tab Mode,
deterministic fret mapping, the shared transport, recording, and audio-omitting share flows.

Before changing repository visibility, also run:

```bash
pnpm audit:public -- --history
```

That stricter mode checks reachable commit author and committer emails as well as historical patch
content. Follow [PUBLIC_RELEASE.md](./PUBLIC_RELEASE.md) when publishing or mirroring the repository.

## Project documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md) — development and fixture rules
- [SECURITY.md](./SECURITY.md) — private vulnerability reporting guidance
- [PUBLIC_RELEASE.md](./PUBLIC_RELEASE.md) — repository publication checklist
- [RESEARCH.md](./RESEARCH.md) — WebMCP architecture findings
- [JUDGING.md](./JUDGING.md) — challenge criteria and evidence map
- [SONG_CATALOG.md](./SONG_CATALOG.md) — music and asset provenance

## License

Source code is available under the [MIT License](./LICENSE). Asset-specific notices remain in the
catalog and adjacent license files and take precedence for those assets.
