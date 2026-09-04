# Public release checklist

Use this checklist before changing the repository from private to public or copying it to a public
host. A public repository necessarily exposes its hosting account, contributor display names, commit
timestamps, public URLs, and required license attribution. This checklist targets accidental personal
data, credentials, private infrastructure details, and unpublished user content.

## 1. Refresh and validate the source snapshot

```bash
git fetch --prune origin
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm check
pnpm e2e
pnpm audit:public -- --history
git status --short
```

Do not publish from a dirty working tree. Review `git ls-files` manually as a final check, especially
media, generated artifacts, database snapshots, and deployment configuration.

## 2. Resolve history findings

Git commit metadata can contain personal names and email addresses even when the latest source tree is
clean. The history audit reports affected commits without printing the values.

If the existing history does not pass, do not simply change the current repository's visibility. Use
one of these deliberate release paths:

1. Create a new public repository from an audited source-only snapshot. This is the safest choice when
   preserving private development history is unnecessary.
2. Rewrite every reachable branch and tag, coordinate the forced update with collaborators, remove
   stale remote refs, and follow the hosting provider's guidance for cached objects. History rewriting
   is destructive and should be reviewed separately before it is performed.

Re-run both audit modes against the exact refs that will be public.

For a source-only release ref, limit the history audit to that ref:

```bash
pnpm audit:public -- --history --ref <release-ref>
```

## 3. Confirm operational boundaries

- Store hosted secrets and runtime values in the deployment platform, never in Git.
- Keep `.openai/hosting.json` limited to logical Sites capability declarations and its non-secret
  project identifier.
- Use the all-zero D1 identifier for local development or provide `CLOUDFLARE_DATABASE_ID` from the
  local environment. Do not commit a deployment database identifier.
- Confirm that share links omit browser recordings and uploaded audio.
- Confirm that microphone capture still requires a visible human action and browser permission.

## 4. Confirm public project settings

- Enable secret scanning and push protection where the hosting plan supports them.
- Enable dependency alerts and automated security updates.
- Enable private vulnerability reporting, then verify the process in [SECURITY.md](./SECURITY.md).
- Add a concise repository description, the canonical live URL, topics, and the MIT license in the
  repository settings.
- Protect `main` with required CI checks and prevent force pushes after publication.

## 5. Re-check rights and documentation

- Verify every bundled song and generated media asset against [SONG_CATALOG.md](./SONG_CATALOG.md).
- Preserve required attribution and keep separately licensed assets clearly distinguished from the
  MIT-licensed source code.
- Confirm that the live app, [README.md](./README.md), and any public demo video describe the same
  implemented behavior.
