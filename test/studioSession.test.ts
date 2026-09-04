import { assert, describe, it } from "@effect/vitest"
import {
  initialStudioState,
  type StudioDocument,
  type StudioInternalState,
  type StudioState
} from "../src/studio/Studio.ts"
import { persistStudioSession, restoreStudioSession } from "../src/studio/studioSession.ts"

class MemorySessionStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const documentOf = (state: StudioState): StudioDocument => ({
  songSlug: state.songSlug,
  title: state.title,
  attribution: state.attribution,
  bpm: state.bpm,
  timeSignature: state.timeSignature,
  selection: state.selection,
  tracks: state.tracks,
  karaokeGuide: state.karaokeGuide,
  karaokeCountInBeats: state.karaokeCountInBeats,
  practiceBed: state.practiceBed
})

const internalState = (present: StudioState): StudioInternalState => ({
  present,
  past: [],
  future: [],
  seen: new Map(),
  nextId: 1,
  mutations: [],
  nextMutationSequence: 1
})

describe("Studio browser-session persistence", () => {
  it("round-trips the canonical project, bounded history, and retry ledger without audio URLs", () => {
    const storage = new MemorySessionStorage()
    const initial = initialStudioState()
    const present: StudioState = {
      ...initial,
      revision: 12,
      historyDepth: 10,
      mutationCount: 3,
      logs: [...initial.logs, { id: 99, actor: "AGENT", message: "Composed the shared karaoke mix." }]
    }
    const result = {
      requestId: "compose-before-handoff",
      revision: 12,
      replayed: false,
      change: "composition_committed",
      tracksCreated: 4,
      notesWritten: 208
    }
    const internal: StudioInternalState = {
      ...internalState(present),
      past: Array.from({ length: 10 }, () => documentOf(initial)),
      seen: new Map([
        [
          result.requestId,
          {
            fingerprint: "compose-fingerprint",
            result
          }
        ]
      ]),
      nextId: 44,
      nextMutationSequence: 7
    }

    persistStudioSession(internal, storage)
    const fallback = internalState(initial)
    const restored = restoreStudioSession(fallback, storage)
    const encoded = [...storage.values.values()][0]

    assert.isDefined(encoded)
    assert.notInclude(encoded!, "blob:")
    assert.notInclude(encoded!, "data:audio")
    assert.strictEqual(restored.present.revision, 12)
    assert.strictEqual(restored.present.historyDepth, 8)
    assert.strictEqual(restored.past.length, 8)
    assert.strictEqual(restored.nextId, 44)
    assert.strictEqual(restored.nextMutationSequence, 7)
    assert.deepStrictEqual(restored.seen.get(result.requestId), {
      fingerprint: "compose-fingerprint",
      result
    })
  })

  it("falls back to the fresh project when stored data fails schema validation", () => {
    const storage = new MemorySessionStorage()
    const initial = initialStudioState()
    const fallback = internalState(initial)
    storage.setItem(`signal-studio:session:${initial.projectId}`, '{"schemaVersion":999}')

    assert.strictEqual(restoreStudioSession(fallback, storage), fallback)
  })
})
