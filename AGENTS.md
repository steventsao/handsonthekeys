# Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

# Studio product goal

Build this browser-native, WebMCP-powered instrument learning
studio. The defensible product claim is:

> The studio gives a learner two synchronized views of one musical session:
> responsive guitar tablature for practice and a full DAW for arrangement. Both
> are derived from canonical MIDI and expose exact musician-grade controls to
> people and WebMCP agents.

Do not claim that speculative or mocked behavior is implemented. The live app,
the public description, and the demonstration video must agree.

## Non-negotiable browser, rights, and privacy boundaries

- Perform playback, MIDI synthesis, MIDI-to-tab mapping, semitone transposition,
  visualization, and export in the browser. Do not require a server-side audio
  processing path.
- "Instrument learning" is not treated as a copyright exemption. Lessons may use
  project-authored exercises, user-authored music, properly licensed works, and
  public-domain compositions with independently cleared arrangements. Do not
  import or generate protected melodies, signature riffs, exact arrangements,
  recordings, MIDI, or third-party tablature without permission.
- Facts-only practice beds may reference approximate tempo, key, meter, and
  general harmonic vocabulary, but must use original rhythm, voicing, texture,
  form, and note choices and must not be described as licensed merely because
  protected expression was excluded.
- Raw microphone samples and uploaded vocal audio must never leave the page.
  WebMCP may return bounded structured musical results such as notes, cents,
  confidence, phrase scores, and range summaries, but never raw audio, encoded
  audio, sample arrays, object URLs, or blob URLs.
- Microphone capture always requires an explicit visible human action and the
  browser's normal permission flow. A WebMCP tool may configure or arm a session,
  but it must not silently start microphone capture.
- Do not describe the product as offline unless the full tested flow, including
  required assets, works without a network. "Browser-native" is the preferred
  wording.
- If any runtime feature later uses a hosted model or API, disclose that boundary
  and narrow the browser-only claim. Generation of marketing assets outside the
  running product does not change the runtime claim.

## Instrument learning feature contract

- Treat canonical MIDI as the sole authoritative musical session. Tab Mode, DAW
  Mode, playback, and any legacy karaoke guide must project from that state; do
  not maintain a second tab arrangement or re-detect notes from rendered audio.
- Map MIDI to guitar strings and frets deterministically against an explicit
  tuning, hand position, and maximum fret. Preserve stable note IDs and exact
  beats/durations. Simultaneous notes may not occupy one string; out-of-range or
  physically unmappable notes must be reported instead of fabricated.
- Start with six-string guitar in standard tuning. Do not claim alternate
  tunings, technique inference, fingering optimization, or other instruments
  until those paths are implemented and tested.
- Tab Mode must be phone-first: touch targets are at least 44 CSS pixels, the
  page itself does not overflow horizontally, and wide notation scrolls inside
  a clearly bounded tab viewport.
- Tab and DAW mode changes never mutate the musical project revision. Lesson
  configuration has its own revision and retry-safe request IDs. MIDI edits in
  DAW Mode or through WebMCP must appear in Tab Mode at the same project revision.
- Both visible transport controls and WebMCP transport calls must reach the same
  browser DAW audio engine. Never bypass browser autoplay, permission, or user
  activation rules; report when a visible audio-unlock action is required.
- Add exact semitone transposition for existing MIDI notes. Preserve beat,
  duration, velocity, stable targets, and MIDI range validation.
- Stage transposition and karaoke-guide changes before commit. Reuse the existing
  preview, apply/discard, revision check, retry-safe request ID, undo/redo, and
  Effect mutation-journal semantics.
- The preserved legacy karaoke guide must use authorized, bundled, or
  user-authored lyrics and map
  lyric tokens to exact musical time. Keep the current source and license
  attribution visible when the bundled Korobeiniki arrangement is used.
- Detect live monophonic vocal pitch locally from browser audio frames. Report
  frequency, nearest MIDI note, cents deviation, confidence, and time. Silence or
  low-confidence frames must produce no detected note rather than fabricated
  pitch.
- Compare detected vocal pitch with the expected MIDI melody and expose useful,
  bounded summaries: in-tune percentage, median cents error, detected range, and
  phrase scores. Do not present a score when coverage or confidence is
  insufficient.
- Start with monophonic voice. Do not claim polyphonic transcription, source
  separation, or full-song key detection unless those paths are independently
  implemented and tested.
- Basic `AudioBufferSourceNode.detune` or `playbackRate` changes both pitch and
  duration. Do not call that DAW-quality audio transposition. Any recorded-audio
  key change that claims to preserve duration must use and test a real
  time-preserving pitch-shift processor.

## WebMCP and domain rules

- WebMCP exposes application capabilities; it is not the audio engine. Every
  tool must call the same Effect domain service as the corresponding visible UI.
- Prefer a small musical contract over GUI-shaped tools. The intended learning
  surface is centered on mode selection, lesson configuration, bounded tab
  reads, shared transport control, exact MIDI edits, and staged project changes.
- Validate all tool and domain input with Effect Schema. Use stable track, clip,
  note, preview, phrase, and session identifiers instead of screen coordinates.
- Mutating tools require a retry-safe `request_id` and accept an optional
  `expected_revision`. Rejected calls and idempotent retries must not create false
  journal entries.
- Read-only analysis tools must be marked read-only and must not change project
  revision, selection, history, microphone state, or the mutation journal.
- Keep agent-returned data concise. Full sample buffers, continuous pitch-frame
  streams, and the complete canonical session do not belong in model context.
- Preserve visible human control: the UI must show the lesson track, beat range,
  tuning, hand position, current note, and rights provenance; allow transport
  and mode switching without an agent; and keep apply, discard, and undo obvious
  for project edits.

## Definition of done

A browser-native instrument-learning slice is complete only when automated tests and a real
browser flow demonstrate all of the following:

1. A stable MIDI track and exact beat passage map deterministically to standard
   guitar tab, including explicit unplayable notes and collision-free chord
   strings.
2. The phone layout keeps controls touch-sized and contains wide notation in an
   internal horizontal scroller.
3. A person or WebMCP agent can configure the lesson and switch Tab/DAW modes
   without changing the musical project revision.
4. Both surfaces play and seek through the same DAW engine, and the active fret
   follows its canonical MIDI beat.
5. Exact MIDI edits remain revision-checked, retry-safe, undoable, and visible in
   both modes without timing drift.
6. WebMCP exposes bounded lesson reads and musician-shaped writes, but does not
   return raw audio or bypass browser permission and activation boundaries.
7. Rights provenance remains visible and the product never claims that an
   educational label clears protected music or tablature.
8. The preserved karaoke privacy tests, Studio brand checks, Effect tests,
   browser tests, typecheck, and build continue to pass.
