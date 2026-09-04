# Studio music catalog

The public instrument-learning catalog is deliberately allowlisted. Calling tablature educational,
or publishing its player as open-source software, does not clear the composition, arrangement, MIDI,
recording, or third-party tab inside it. Nonprofit or prototype use does not by itself grant
permission to publish a song online.

## Admission rule

A song becomes `cleared_for_online_playback` only when the repository records evidence for every
asset layer used by its lesson and legacy karaoke views:

1. composition;
2. lyrics;
3. arrangement or source MIDI;
4. instrumental or other recording;
5. any source notation, tab, or timed lyric / pitch chart; and
6. cover, background, and video assets, when used.

The default catalog accepts public-domain, CC0, CC BY, CC BY-SA, or directly licensed material.
It excludes NonCommercial and NoDerivatives material so a prototype cannot accidentally become
unusable when hosting, sponsorship, or product ownership changes. A repository-level software
license is not accepted as evidence for song assets unless it explicitly covers them.

Every imported file needs a stable source URL, license URL or permission record, attribution, change
notice, and checksum. When one layer is unclear, the song remains intake-only and is not returned by
`get_studio_song_catalog` as playable.

Tab Mode derives string and fret choices from already-cleared canonical MIDI; it does not import a
third-party transcription.

## Playable seed

| Song                         | Composition                                                                | Arrangement / MIDI                                                         | Recording                                                                                           | Lyrics, timing, visuals                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Afterglow Calling // Y2K Pop | Project-authored original inspired only by broad era and genre conventions | Project-authored seven-track arrangement; generated MIDI checksum recorded | Rendered in-browser from the project-authored MIDI; no third-party master                           | Project-authored lyrics and timing; project-generated interface; no imported cover, background, or video |
| Korobeiniki // Arcade Pop    | Traditional composition identified by the source as public domain          | “Tetris forever” by rocavaco, CC BY 3.0; vendored MIDI checksum recorded   | Rendered in-browser from the licensed MIDI plus a project-authored drum part; no third-party master | Project-authored lyrics and timing; project-generated interface; no imported cover, background, or video |

Source and license evidence:

- [`public/studio-songs/afterglow.LICENSE.txt`](public/studio-songs/afterglow.LICENSE.txt)
- <https://ccmixter.org/files/rocavaco/44418>
- <https://creativecommons.org/licenses/by/3.0/>

## Intake sources

These are useful upstreams, not blanket clearance. Each imported song still needs the six-layer
review above.

| Source                                                                   | Good for                                                      | Current intake decision                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [UltraStar Deluxe open songs](https://github.com/UltraStar-Deluxe/songs) | Timed lyrics, licensed audio, and some instrumental mixes     | Review every `license.txt`; licenses vary and chart / art provenance can be separate. CC BY candidates should be re-charted or explicitly cleared when the chart license is missing. |
| [Mutopia Project](https://github.com/MutopiaProject/MutopiaProject)      | Public-domain editions and symbolic scores                    | Verify each score and composition; produce a new instrumental recording and lyric chart.                                                                                             |
| [OpenScore Lieder](https://github.com/mbrukman/OpenScore-Lieder)         | CC0 scores and historic vocal repertoire                      | Verify the poem and composition by territory; produce a new arrangement, recording, timing chart, and visuals.                                                                       |
| [ccMixter](https://ccmixter.org/)                                        | Per-upload Creative Commons audio, stems, and occasional MIDI | Review the upload license and every included asset; retain attribution and change notices.                                                                                           |

Two promising UltraStar intake examples are intentionally not playable yet:

- “Verdächtig” documents CC0 lyrics, audio, and background, but does not include an instrumental
  mix and does not independently establish a reusable timing-chart license.
- “Chasing Marks” includes a CC BY 4.0 song and instrumental, but the package needs a separate
  timing-chart review and any third-party or fan artwork should be omitted.

Do not seed the catalog from commercial-song tab sites, pop-song MIDI dumps, YouTube audio, karaoke
video downloads, separated stems made from an unlicensed commercial master, or an open-source
notation/player repository whose song rights are not documented separately.
