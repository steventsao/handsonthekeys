export const studioSongRightsPolicy = {
  catalogVersion: 2,
  policy:
    "Only songs with documented composition, lyrics, arrangement, recording, timing-chart, and visual rights may be returned as playable.",
  commercialFriendlyOnly: true,
  note: "Nonprofit or prototype use is not treated as copyright permission. Intake sources stay separate from playable songs until every shipped asset is cleared."
} as const

export const studioPlayableSongCatalog = [
  {
    id: "signal-afterglow-calling-y2k-pop",
    slug: "afterglow",
    title: "Afterglow Calling // Y2K Pop",
    artist: "Signal Studio",
    language: "English",
    playbackRoute: "/?mode=session&song=afterglow",
    studioRoute: "/?mode=daw&song=afterglow",
    clearanceStatus: "cleared_for_online_playback",
    reviewedOn: "2026-09-03",
    attribution: {
      title: "Afterglow Calling",
      creator: "Signal Studio",
      sourceUrl: "/?mode=daw&song=afterglow",
      licenseName: "Project-authored original",
      licenseUrl: "/studio-songs/afterglow.LICENSE.txt",
      changes: "Original composition, lyrics, MIDI arrangement, timing, and browser-rendered recording."
    },
    assets: {
      sourceMidiUrl: "/studio-songs/afterglow.mid",
      sourceMidiSha256: "1e0d711c0e696dfcd61bb0082dd953c17cf3136df1bee4d3adf13b7819a58d36",
      thirdPartyMasterRecording: false
    },
    rights: {
      composition: {
        status: "project_authored",
        work: "Afterglow Calling",
        evidenceUrl: "/studio-songs/afterglow.LICENSE.txt",
        note: "The melody, harmony, and form were composed for Signal Studio without transcribing a third-party song or tab."
      },
      lyrics: {
        status: "project_authored",
        work: "Afterglow Calling English chorus",
        evidenceUrl: "/studio-songs/afterglow.LICENSE.txt",
        note: "The displayed chorus lyric was written for this project."
      },
      arrangement: {
        status: "project_authored",
        work: "Afterglow Calling seven-track MIDI arrangement",
        creator: "Signal Studio",
        licenseName: "Project-authored original",
        licenseUrl: "/studio-songs/afterglow.LICENSE.txt",
        evidenceUrl: "/studio-songs/afterglow.mid"
      },
      recording: {
        status: "project_rendered",
        work: "Signal Studio browser render",
        evidenceUrl: "/?mode=daw&song=afterglow",
        note: "All audible parts are synthesized locally from the bundled original MIDI; no third-party master recording ships."
      },
      timingChart: {
        status: "project_generated",
        work: "Afterglow Calling beat-timed chorus guide",
        evidenceUrl: "/?mode=session&song=afterglow"
      },
      visuals: {
        status: "project_generated",
        work: "Signal Studio karaoke interface",
        evidenceUrl: "/?mode=session&song=afterglow",
        note: "No third-party cover, background, performer likeness, or music video is used."
      }
    }
  },
  {
    id: "signal-korobeiniki-arcade-pop",
    slug: "korobeiniki",
    title: "Korobeiniki // Arcade Pop",
    artist: "Traditional / Signal Studio adaptation",
    language: "Japanese project lyrics",
    playbackRoute: "/?mode=session&song=korobeiniki",
    studioRoute: "/?mode=daw&song=korobeiniki",
    clearanceStatus: "cleared_for_online_playback",
    reviewedOn: "2026-09-03",
    attribution: {
      title: "Tetris forever",
      creator: "rocavaco",
      sourceUrl: "https://ccmixter.org/files/rocavaco/44418",
      licenseName: "CC BY 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      changes:
        "Track labels and General MIDI programs were normalized, tempo was set to 138 BPM, and an original pop drum part and project-authored Japanese lyric guide were added."
    },
    assets: {
      sourceMidiUrl: "/studio-songs/korobeiniki.mid",
      sourceMidiSha256: "84c71f223e62419ecbbb58b4a9a114ded11ab5c7d4ec394b4f97c20815c0b67e",
      thirdPartyMasterRecording: false
    },
    rights: {
      composition: {
        status: "public_domain",
        work: "Korobeiniki",
        evidenceUrl: "https://ccmixter.org/files/rocavaco/44418",
        note: "The source package identifies the underlying traditional composition as public domain."
      },
      lyrics: {
        status: "project_authored",
        work: "Neon Signals Japanese lyric guide",
        evidenceUrl: "/?mode=session&song=korobeiniki",
        note: "No third-party lyric text was imported."
      },
      arrangement: {
        status: "licensed",
        work: "Tetris forever MIDI arrangement",
        creator: "rocavaco",
        licenseName: "CC BY 3.0",
        licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
        evidenceUrl: "https://ccmixter.org/files/rocavaco/44418"
      },
      recording: {
        status: "project_rendered",
        work: "Signal Studio browser render",
        evidenceUrl: "/?mode=daw&song=korobeiniki",
        note: "Audio is rendered from the licensed MIDI adaptation and project-authored drum part; no third-party master recording ships."
      },
      timingChart: {
        status: "project_generated",
        work: "Signal Studio timed lyric guide",
        evidenceUrl: "/?mode=session&song=korobeiniki"
      },
      visuals: {
        status: "project_generated",
        work: "Signal Studio karaoke interface",
        evidenceUrl: "/?mode=session&song=korobeiniki",
        note: "No third-party cover, background, or music video is used."
      }
    }
  }
] as const

export const studioSongIntakeSources = [
  {
    name: "UltraStar Deluxe open songs",
    url: "https://github.com/UltraStar-Deluxe/songs",
    usefulFor: ["timed lyrics", "licensed audio", "some instrumental mixes"],
    status: "intake_only",
    verificationRequired:
      "Review each song's license.txt separately and verify the composition, lyrics, timing chart, audio, cover, background, and video. Do not admit NC or ND assets to the commercial-friendly catalog."
  },
  {
    name: "Mutopia Project",
    url: "https://github.com/MutopiaProject/MutopiaProject",
    usefulFor: ["public-domain editions", "LilyPond scores", "symbolic arrangements"],
    status: "intake_only",
    verificationRequired:
      "Check the individual score license and the composition's public-domain status, then create or license lyrics, a timing chart, and a new recording."
  },
  {
    name: "OpenScore Lieder Corpus",
    url: "https://github.com/mbrukman/OpenScore-Lieder",
    usefulFor: ["CC0 scores", "MusicXML", "historic song repertoire"],
    status: "intake_only",
    verificationRequired:
      "Verify the composition and poem in every target territory, then create a new arrangement, timing chart, instrumental recording, and visuals."
  },
  {
    name: "ccMixter",
    url: "https://ccmixter.org/",
    usefulFor: ["per-upload Creative Commons audio", "stems", "MIDI when supplied"],
    status: "intake_only",
    verificationRequired:
      "Use only uploads with a license that covers the intended adaptation and online playback; confirm every included file and preserve attribution and change notices."
  }
] as const

export const studioSongCatalogView = () => ({
  schema_version: studioSongRightsPolicy.catalogVersion,
  policy: studioSongRightsPolicy.policy,
  commercial_friendly_only: studioSongRightsPolicy.commercialFriendlyOnly,
  legal_note: studioSongRightsPolicy.note,
  playable_song_count: studioPlayableSongCatalog.length,
  playable_songs: studioPlayableSongCatalog.map((song) => ({
    song_id: song.id,
    slug: song.slug,
    title: song.title,
    artist: song.artist,
    language: song.language,
    playback_route: song.playbackRoute,
    studio_route: song.studioRoute,
    clearance_status: song.clearanceStatus,
    reviewed_on: song.reviewedOn,
    attribution: {
      title: song.attribution.title,
      creator: song.attribution.creator,
      source_url: song.attribution.sourceUrl,
      license_name: song.attribution.licenseName,
      license_url: song.attribution.licenseUrl,
      changes: song.attribution.changes
    },
    assets: {
      source_midi_url: song.assets.sourceMidiUrl,
      source_midi_sha256: song.assets.sourceMidiSha256,
      third_party_master_recording: song.assets.thirdPartyMasterRecording
    },
    rights: {
      composition: {
        status: song.rights.composition.status,
        work: song.rights.composition.work,
        evidence_url: song.rights.composition.evidenceUrl,
        note: song.rights.composition.note
      },
      lyrics: {
        status: song.rights.lyrics.status,
        work: song.rights.lyrics.work,
        evidence_url: song.rights.lyrics.evidenceUrl,
        note: song.rights.lyrics.note
      },
      arrangement: {
        status: song.rights.arrangement.status,
        work: song.rights.arrangement.work,
        creator: song.rights.arrangement.creator,
        license_name: song.rights.arrangement.licenseName,
        license_url: song.rights.arrangement.licenseUrl,
        evidence_url: song.rights.arrangement.evidenceUrl
      },
      recording: {
        status: song.rights.recording.status,
        work: song.rights.recording.work,
        evidence_url: song.rights.recording.evidenceUrl,
        note: song.rights.recording.note
      },
      timing_chart: {
        status: song.rights.timingChart.status,
        work: song.rights.timingChart.work,
        evidence_url: song.rights.timingChart.evidenceUrl
      },
      visuals: {
        status: song.rights.visuals.status,
        work: song.rights.visuals.work,
        evidence_url: song.rights.visuals.evidenceUrl,
        note: song.rights.visuals.note
      }
    }
  })),
  intake_sources: studioSongIntakeSources.map((source) => ({
    name: source.name,
    url: source.url,
    useful_for: source.usefulFor,
    status: source.status,
    verification_required: source.verificationRequired
  }))
})
