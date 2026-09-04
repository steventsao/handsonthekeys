# Signal Studio karaoke concept

> Archived concept-production record. The generated videos in this directory are not screen
> recordings and must not be used as proof of the current product. [README.md](../README.md) defines
> the current public contract.

## Generated artifact

- Model: `minimax/h3-max-turbo/text-to-video` on fal.ai
- fal request ID: `01a06895-890c-76b0-aeb3-7f73dee8c0e0`
- Format: 15.104 seconds, 1344×768, H.264/AAC, 16:9
- Intended use: concept teaser or opening montage for a real product demo

Files:

- `signal-studio-karaoke-concept-voiceover-only.mp4` — recommended rights-safe concept cut;
  locally generated narration is the only audio
- `signal-studio-karaoke-concept-with-voiceover.mp4` — alternate cut retaining the model's generated
  sound bed under the same narration
- `signal-studio-karaoke-concept-h3-max-turbo.mp4` — untouched fal.ai result
- `signal-studio-karaoke-concept-contact-sheet.png` — four-frame visual overview

The generated visual borrows the current Studio's product language: a dark browser DAW, nine
color-coded tracks, rectangular MIDI notes, blue transport controls, a green play button, a violet
Magic Bar, staged changes, and a visible revision transition. It turns selected MIDI into a timed
karaoke view and stages a `KARAOKE GUIDE` track before the human applies it.

## Narration mixed into the concept cut

> Meet Signal Studio, an agent-native browser D A W. Using Web M C P, an assistant reads exact
> M I D I, stages a beat-accurate karaoke guide, and applies it only after you approve—turning
> conversation into visible, reversible music edits.

## Current implementation vs. concept footage

Implemented in the current app:

- Nine-track Korobeiniki arrangement with 605 exact MIDI notes
- One page-scoped `codemode` WebMCP tool with bounded session, instrument, metronome, drum,
  transport, recording, and share methods
- Canonical MIDI reads, compact internal developer queries, and atomic multi-track composition
- Exact beat selection, non-destructive staging, apply/discard, undo/redo, tempo, and track mix
- Stable IDs, revision checks, retry-safe request IDs, and an Effect mutation journal
- Browser-local audio preview, WAV export, timed karaoke guides, and monophonic local pitch scoring

Conceptualized rather than literally screen-recorded in the generated clip:

- The exact transformation animation, visual layout, and motion shown in the generated footage
- A dedicated `KARAOKE GUIDE` MIDI track; the shipped guide is structured staged state over canonical
  MIDI instead
- Any implication that an agent may supply protected lyrics or begin microphone capture

The final submission must not present the speculative pieces as working unless they are implemented
and visible in the live app. The generated clip is safest as a short “vision” opener followed
immediately by genuine screen capture of the current app and real WebMCP calls.

## Historical 75–90 second submission edit plan

1. **0:00–0:07 — Hook.** Use the strongest generated transformation: exact MIDI blocks become
   timed karaoke words. Label it verbally as the product vision, not proof of current functionality.
2. **0:07–0:18 — Real app.** Show the live Signal Studio timeline and say that the browser exposes
   the same canonical session to the human and the agent.
3. **0:18–0:32 — Read without guessing.** Use the public `codemode` tool to inspect bounded session
   state. Show the result and the corresponding passage.
4. **0:32–0:50 — Collaborate.** Use `codemode` to add an original drum practice beat or adjust the
   shared transport. Emphasize that the agent works from exact beats and MIDI rather than screen
   coordinates.
5. **0:50–1:04 — Human control.** Audition the staged take, apply it, then show undo and redo.
   Point out the visible revision change and mutation journal.
6. **1:04–1:17 — Why WebMCP.** Explain that the page publishes typed, contextual capabilities;
   the agent and visible controls share one Effect service and one history.
7. **1:17–1:25 — Close.** Return to the generated hero lockup and state the impact: people can
   direct precise, reversible music edits through ordinary conversation.

The shipped karaoke path implements the narrow staged workflow with project-authored or authorized
lyrics, exact canonical-MIDI timing, visible apply/discard controls, local monophonic pitch analysis,
and the same revision, undo/redo, and mutation-journal semantics. It does not create a second MIDI
arrangement or a dedicated public karaoke tool.

## Rules checklist based on the official page

- The project must be a working WebMCP-powered web app and function as depicted.
- Judges need a working live URL in the in-app browser or WebMCP-enabled Chrome.
- Existing projects need clear documentation distinguishing prior work from WebMCP work added
  during the submission period, supported by dated commits or equivalent evidence.
- The public repository needs all source/assets/instructions and a visible open-source license.
- The submission description must explain why WebMCP fits, how UX improves, what humans and agents
  can do together, and how WebMCP was implemented.
- The demo must be under three minutes, publicly visible on YouTube, and include explanatory audio.
- Do not use third-party marks, music, imagery, or other copyrighted material without permission.
  Keep the existing Korobeiniki source attribution and CC BY 3.0 notice visible wherever its
  arrangement or recording is used.
- The official rules state that the submission period ends September 3, 2026 at 1:00 p.m. Pacific
  Time. Verify the countdown on Devpost before relying on any conflicting display.

## fal.ai generation prompt

```text
Create a polished 15-second 16:9 product-demo concept for a fictional browser-based music
workstation named SIGNAL STUDIO. It must feel directly inspired by a modern dark DAW: charcoal
panels, a left sound library, a large horizontal arrangement timeline, nine stacked color-coded MIDI
tracks, crisp rectangular note blocks, blue primary buttons, a green play control, and a glowing
violet Magic Bar along the bottom. No people, no outside brands, no third-party logos, no copyrighted
imagery, no commercial song references, and no random decorative objects.

0.0–4.0 seconds: Start on a precise wide view of the workstation. Nine music tracks pulse subtly in
time. A selected 16-beat region gains a clean outline. An elegant unbranded agent-intent bubble
appears with the short command MAKE THIS CHORUS KARAOKE-READY. Small structured tool cards animate
in sequence beside it: READ MIDI, ANALYZE PHRASE, STAGE TAKE.

4.0–9.0 seconds: The violet Magic Bar sweeps across the selection. Exact MIDI note blocks lift from
the timeline and reorganize into a karaoke visualization inside the same app: large centered original
words SING, TOGETHER, NOW on a black stage, each word highlighting from cool blue to white exactly on
the beat, with a minimal bouncing dot following the timing. Keep the arrangement visible behind or
below so the transformation clearly comes from the music data.

9.0–13.0 seconds: Smoothly return to split view. The left half shows the timed karaoke preview; the
right half shows the arrangement gaining one new track named KARAOKE GUIDE. One final structured tool
card lands: APPLY PREVIEW. A small revision indicator changes from REV 1 to REV 2.

13.0–15.0 seconds: Pull back to a stable hero view. Show only three large final lines of readable
typography: SIGNAL STUDIO, MUSIC YOU CAN TALK TO, WEBMCP NATIVE. Hold the final frame. Premium product
motion design, ultra-crisp editorial UI, subtle 2.5D depth, smooth easing, minimal motion blur,
accurate spelling, high contrast, no glitches, no illegible extra text.
```
