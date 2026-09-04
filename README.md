# Hands on the keys

A session assistant that helps musicians stay in flow.

[Try it](https://handsonthekeys.com/) · [Devpost submission](https://devpost.com/software/hands-on-the-keys)

Practicing with digital sheet music and recording software usually means stopping to turn pages, adjust a metronome, or manage tracks. Hands on the keys gives those session controls to a WebMCP agent so the musician can keep playing.

## What it does

- Lets an agent control the piano, drums, metronome, and transport.
- Records through the browser's audio APIs after the musician starts capture.
- Uses one Code Mode tool to read the current session and edit instruments, notation, and rhythm in one turn.
- Keeps the agent and visible controls on the same musical session.

## How it works

The app is built with TypeScript, Effect, WebMCP, the Web Audio API, and Waveform Playlist. The browser owns the audio engine, transport, MIDI session, and recording flow. WebMCP calls the same Effect services as the on-screen controls.

Recording always requires a visible user action and the browser's normal microphone permission flow. Raw microphone audio is not returned through WebMCP.

## Run locally

Requires Node.js 20+ and pnpm 9.5.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run the full check or browser tests with:

```bash
pnpm check
pnpm e2e
```

## Status

This project was built for the WebMCP Challenge. The main open UX issue is keeping voice-mode work in the same browser session when ChatGPT dispatches a subagent.

MIT licensed. See [SONG_CATALOG.md](./SONG_CATALOG.md) for music and asset provenance.
