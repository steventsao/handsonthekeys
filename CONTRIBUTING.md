# Contributing

Thanks for helping improve Signal Lessons. Keep changes focused, reproducible, and consistent with
the browser, privacy, and music-rights boundaries in [AGENTS.md](./AGENTS.md).

## Local setup

Requirements: Node.js 20 or newer and pnpm 9.5.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run the full validation suite before opening a pull request:

```bash
pnpm check
pnpm e2e
```

## Data and fixture rules

- Use invented names, synthetic identifiers, reserved example domains, and generated data in tests
  and screenshots.
- Never commit credentials, environment files, private endpoints, personal contact details, raw
  microphone data, user recordings, or machine-specific home-directory paths.
- Run `pnpm audit:public` before committing. Maintainers must also run
  `pnpm audit:public -- --history` before changing repository visibility or publishing a mirror.
- Do not add music, lyrics, recordings, MIDI, tablature, artwork, or video unless the repository can
  document the applicable rights and required attribution.
- Keep microphone capture behind a visible human action. WebMCP results must remain bounded and must
  not contain raw or encoded audio.

## Pull requests

Describe the user-visible behavior, tests run, privacy impact, and rights provenance for any added
asset. Keep unrelated formatting or generated-file churn out of the change.
