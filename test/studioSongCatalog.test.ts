import { assert, describe, it } from "@effect/vitest"
import {
  defaultStudioSongSlug,
  defaultKaraokeSongSlug,
  initialStudioStateForLocation,
  initialStudioStateForSlug,
  karaokePresetForSong,
  studioSongSlugOfLocation,
  studioSongSlugOfPath
} from "../src/studio/songs/catalog.ts"
import {
  studioPlayableSongCatalog,
  studioSongCatalogView,
  studioSongIntakeSources
} from "../src/studio/songs/rightsCatalog.ts"

describe("Studio song catalog", () => {
  it("starts the home lesson with an empty session until a song is explicitly requested", () => {
    const empty = initialStudioStateForLocation("/")
    const emptyDaw = initialStudioStateForLocation("/", "?mode=daw")
    const invalidRequest = initialStudioStateForLocation("/", "?song=unknown")
    const requested = initialStudioStateForLocation("/", "?mode=tab&song=afterglow")

    assert.deepStrictEqual(
      {
        projectId: empty.projectId,
        songSlug: empty.songSlug,
        title: empty.title,
        attribution: empty.attribution,
        tracks: empty.tracks
      },
      {
        projectId: "signal-studio-untitled",
        songSlug: "untitled",
        title: "Untitled Session",
        attribution: null,
        tracks: []
      }
    )
    assert.deepStrictEqual(emptyDaw.tracks, [])
    assert.deepStrictEqual(invalidRequest.tracks, [])
    assert.strictEqual(requested.songSlug, "afterglow")
    assert.isTrue(requested.tracks.length > 0)
  })

  it("maps the default and named Studio URLs to the static Korobeiniki session", () => {
    assert.strictEqual(studioSongSlugOfPath("/studio"), defaultStudioSongSlug)
    assert.strictEqual(studioSongSlugOfPath("/studio/"), defaultStudioSongSlug)
    assert.strictEqual(studioSongSlugOfPath("/studio.html"), defaultStudioSongSlug)
    assert.strictEqual(studioSongSlugOfPath("/studio/korobeiniki"), "korobeiniki")
    assert.strictEqual(studioSongSlugOfPath("/studio/korobeiniki/"), "korobeiniki")
    assert.isNull(studioSongSlugOfLocation("/"))
    assert.strictEqual(studioSongSlugOfLocation("/", "?song=korobeiniki"), "korobeiniki")
    assert.strictEqual(studioSongSlugOfLocation("/karaoke"), defaultKaraokeSongSlug)
    assert.strictEqual(studioSongSlugOfLocation("/karaoke.html"), "afterglow")
    assert.strictEqual(studioSongSlugOfLocation("/karaoke", "?song=korobeiniki"), "korobeiniki")
    assert.strictEqual(studioSongSlugOfLocation("/studio.html", "?song=afterglow"), "afterglow")
  })

  it("builds the original Y2K karaoke song with its exact chorus preset", () => {
    const state = initialStudioStateForSlug("afterglow")
    const preset = karaokePresetForSong(state.songSlug)
    const noteCount = state.tracks.reduce(
      (total, track) => total + track.clips.reduce((clipTotal, clip) => clipTotal + clip.notes.length, 0),
      0
    )

    assert.strictEqual(state.projectId, "signal-studio-afterglow-calling")
    assert.strictEqual(state.title, "Afterglow Calling // Y2K Pop")
    assert.strictEqual(state.bpm, 100)
    assert.strictEqual(state.karaokeCountInBeats, 8)
    assert.strictEqual(state.tracks.length, 7)
    assert.strictEqual(noteCount, 671)
    assert.strictEqual(preset.melodyTrackId, "track-guide-melody")
    assert.match(preset.lyrics, /afterglow/)
    assert.strictEqual(state.attribution?.licenseName, "Project-authored original")
  })

  it("builds a fresh full-band canonical MIDI state for every load", () => {
    const first = initialStudioStateForSlug("korobeiniki")
    const second = initialStudioStateForSlug("korobeiniki")
    const noteCount = first.tracks.reduce(
      (total, track) => total + track.clips.reduce((clipTotal, clip) => clipTotal + clip.notes.length, 0),
      0
    )

    assert.notStrictEqual(first, second)
    assert.strictEqual(first.songSlug, "korobeiniki")
    assert.strictEqual(first.title, "Korobeiniki // Arcade Pop")
    assert.strictEqual(first.bpm, 138)
    assert.strictEqual(first.tracks.length, 9)
    assert.strictEqual(noteCount, 605)
    assert.strictEqual(first.attribution?.licenseName, "CC BY 3.0")
    assert.isTrue(first.tracks.every((track) => track.kind === "midi"))
  })

  it("publishes only songs with a complete rights chain", () => {
    const catalog = studioSongCatalogView()

    assert.strictEqual(catalog.schema_version, 2)
    assert.strictEqual(catalog.playable_song_count, 2)
    assert.strictEqual(catalog.playable_songs.length, studioPlayableSongCatalog.length)
    assert.isTrue(catalog.commercial_friendly_only)
    assert.deepStrictEqual(
      Object.keys(catalog.playable_songs[0]!.rights).sort(),
      ["arrangement", "composition", "lyrics", "recording", "timing_chart", "visuals"].sort()
    )
    assert.isTrue(
      catalog.playable_songs.every((song) => song.clearance_status === "cleared_for_online_playback")
    )
    assert.isTrue(
      catalog.playable_songs.every((song) => /^[a-f0-9]{64}$/.test(song.assets.source_midi_sha256))
    )
    assert.isTrue(catalog.playable_songs.every((song) => !song.assets.third_party_master_recording))
    assert.deepStrictEqual(
      catalog.playable_songs.map((song) => song.slug),
      ["afterglow", "korobeiniki"]
    )
  })

  it("keeps research leads outside the playable catalog", () => {
    const catalog = studioSongCatalogView()

    assert.strictEqual(catalog.intake_sources.length, studioSongIntakeSources.length)
    assert.isTrue(catalog.intake_sources.every((source) => source.status === "intake_only"))
    assert.isTrue(catalog.intake_sources.every((source) => source.verification_required.length > 80))
    assert.isTrue(catalog.intake_sources.every((source) => !("playback_route" in source)))
  })
})
