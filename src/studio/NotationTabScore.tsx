import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react"
import {
  Accidental,
  Articulation,
  Beam,
  Dot,
  Formatter,
  GhostNote,
  ModifierPosition,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  TabNote,
  TabStave,
  Voice
} from "vexflow/bravura"
import type { InstrumentTabView } from "./InstrumentLearning.ts"
import type { NotationDuration, NotationSlot } from "./MusicNotation.ts"

const measureWidth = 408
const scorePadding = 24
const scoreHeight = 318
const standardStaveY = 70
const tabStaveY = 194

const baseDurationOf = (duration: NotationDuration): string => duration.vexflow.replace(/d+$/, "")

const safeDomId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "-")

const writtenPitchKey = (soundingMidi: number): string => {
  const pitchClasses = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"] as const
  const writtenMidi = soundingMidi + 12
  return `${pitchClasses[writtenMidi % 12]}/${Math.floor(writtenMidi / 12) - 1}`
}

const addDots = (note: StaveNote | TabNote, duration: NotationDuration): void => {
  if (duration.dots > 0) Dot.buildAndAttach([note], { all: true })
}

const standardNoteOf = (
  slot: NotationSlot,
  eventById: ReadonlyMap<string, InstrumentTabView["events"][number]>,
  activeEventId: string | undefined
): StaveNote => {
  const baseDuration = baseDurationOf(slot.duration)
  if (slot.kind === "rest") {
    const rest = new StaveNote({
      keys: ["b/4"],
      duration: baseDuration,
      dots: slot.duration.dots,
      type: "r",
      clef: "treble"
    })
    addDots(rest, slot.duration)
    return rest
  }

  const events = slot.event_ids
    .map((eventId) => eventById.get(eventId))
    .filter((event): event is InstrumentTabView["events"][number] => event !== undefined)
    .sort((left, right) => left.pitch - right.pitch || left.note_id.localeCompare(right.note_id))
  const note = new StaveNote({
    keys: events.length === 0 ? ["b/4"] : events.map((event) => writtenPitchKey(event.pitch)),
    duration: baseDuration,
    dots: slot.duration.dots,
    autoStem: true,
    clef: "treble"
  }).setAttribute("id", `notation-${safeDomId(slot.slot_id)}`)
  addDots(note, slot.duration)
  if (slot.articulation === "staccato") {
    note.addModifier(new Articulation("a.").setPosition(ModifierPosition.ABOVE), 0)
  }
  if (activeEventId !== undefined && slot.event_ids.includes(activeEventId)) {
    note.setStyle({ fillStyle: "#1467c9", strokeStyle: "#1467c9", shadowColor: "#83b8ff", shadowBlur: 7 })
  }
  return note
}

const tabNoteOf = (
  slot: NotationSlot,
  eventById: ReadonlyMap<string, InstrumentTabView["events"][number]>,
  activeEventId: string | undefined
): GhostNote | TabNote => {
  const baseDuration = baseDurationOf(slot.duration)
  if (slot.kind === "rest") {
    return new GhostNote({ duration: baseDuration, dots: slot.duration.dots })
  }
  const positions = slot.event_ids.flatMap((eventId) => {
    const event = eventById.get(eventId)
    return event?.string_number === null || event?.fret === null || event === undefined
      ? []
      : [{ str: event.string_number, fret: event.fret }]
  })
  if (positions.length === 0) {
    return new GhostNote({ duration: baseDuration, dots: slot.duration.dots })
  }
  const note = new TabNote(
    { positions, duration: baseDuration, dots: slot.duration.dots, autoStem: true },
    true
  ).setAttribute("id", `tab-${safeDomId(slot.slot_id)}`)
  note.renderOptions.drawStemThroughStave = false
  addDots(note, slot.duration)
  if (activeEventId !== undefined && slot.event_ids.includes(activeEventId)) {
    note.setStyle({ fillStyle: "#1467c9", strokeStyle: "#1467c9", shadowColor: "#83b8ff", shadowBlur: 7 })
  }
  return note
}

interface NotationTabScoreProps {
  readonly tab: InstrumentTabView
  readonly activeEventId?: string | undefined
  readonly playheadBeat: number
  readonly onSeek: (beat: number) => void
}

export const NotationTabScore = ({ tab, activeEventId, playheadBeat, onSeek }: NotationTabScoreProps) => {
  const rendererRef = useRef<HTMLDivElement>(null)
  const eventById = useMemo(
    () => new Map(tab.events.map((event) => [event.note_id, event] as const)),
    [tab.events]
  )
  const scoreWidth = Math.max(760, tab.notation.measures.length * measureWidth + scorePadding * 2)
  const chordSlots = useMemo(
    () =>
      tab.notation.measures.flatMap((measure, measureIndex) =>
        measure.slots.flatMap((slot) => (slot.kind === "chord" ? [{ measure, measureIndex, slot }] : []))
      ),
    [tab.notation.measures]
  )

  useLayoutEffect(() => {
    const container = rendererRef.current
    if (container === null) return
    container.replaceChildren()

    const renderer = new Renderer(container, Renderer.Backends.SVG)
    renderer.resize(scoreWidth, scoreHeight)
    const context = renderer.getContext()

    tab.notation.measures.forEach((measure, measureIndex) => {
      const x = scorePadding + measureIndex * measureWidth
      const stave = new Stave(x, standardStaveY, measureWidth)
      const tabStave = new TabStave(x, tabStaveY, measureWidth)
      if (measureIndex === 0) {
        stave.addClef("treble", "default", "8vb")
        stave.addTimeSignature(`${tab.notation.meter.beats}/${tab.notation.meter.beat_type}`)
        tabStave.addTabGlyph()
        tabStave.addTimeSignature(`${tab.notation.meter.beats}/${tab.notation.meter.beat_type}`)
      }

      context.setFillStyle("#15191e").setStrokeStyle("#15191e")
      stave.setContext(context).draw()
      tabStave.setContext(context).draw()
      new StaveConnector(stave, tabStave).setType("singleLeft").setContext(context).draw()
      new StaveConnector(stave, tabStave).setType("singleRight").setContext(context).draw()

      context.setFont("Arial", 9, 700).setFillStyle("#6a7078")
      context.fillText(`M${measure.number}${measure.partial ? " · PARTIAL" : ""}`, x + 9, 44)
      context.setFillStyle("#15191e").setStrokeStyle("#15191e")

      const standardNotes = measure.slots.map((slot) => standardNoteOf(slot, eventById, activeEventId))
      const tabNotes = measure.slots.map((slot) => tabNoteOf(slot, eventById, activeEventId))
      if (standardNotes.length === 0) return

      const voiceTime = {
        numBeats: tab.notation.meter.beats,
        beatValue: tab.notation.meter.beat_type
      }
      const standardVoice = new Voice(voiceTime).setMode(Voice.Mode.SOFT).addTickables(standardNotes)
      const tabVoice = new Voice(voiceTime).setMode(Voice.Mode.SOFT).addTickables(tabNotes)
      Accidental.applyAccidentals([standardVoice], "C")
      const beams = Beam.applyAndGetBeams(standardVoice)
      new Formatter()
        .joinVoices([standardVoice])
        .joinVoices([tabVoice])
        .formatToStave([standardVoice, tabVoice], stave, { alignRests: true, context })
      standardVoice.setContext(context).setStave(stave).draw()
      tabVoice.setContext(context).setStave(tabStave).draw()
      beams.forEach((beam) => beam.setContext(context).draw())
    })

    const svg = container.querySelector("svg")
    svg?.setAttribute("aria-hidden", "true")
    svg?.setAttribute("focusable", "false")
  }, [activeEventId, eventById, scoreWidth, tab.notation])

  const positionOf = (measureIndex: number, startBeat: number, measureStart: number, measureEnd: number) => {
    const measureBeats = Math.max(0.0625, measureEnd - measureStart)
    const ratio = Math.max(0, Math.min(1, (startBeat - measureStart) / measureBeats))
    return scorePadding + measureIndex * measureWidth + 62 + ratio * (measureWidth - 92)
  }

  const playheadMeasureIndex = tab.notation.measures.findIndex(
    (measure) => playheadBeat >= measure.start_beat && playheadBeat <= measure.end_beat
  )
  const playheadMeasure = tab.notation.measures[playheadMeasureIndex]
  const playheadLeft =
    playheadMeasure === undefined
      ? scorePadding
      : positionOf(playheadMeasureIndex, playheadBeat, playheadMeasure.start_beat, playheadMeasure.end_beat)

  return (
    <div
      className="notation-score"
      data-testid="guitar-tab"
      data-notation-semantics={tab.notation.semantics}
      style={{ "--notation-score-width": `${scoreWidth}px` } as CSSProperties}
      role="group"
      aria-label={`${tab.summary.event_count} guitar notes as synchronized standard notation and tablature from beat ${tab.range.start_beat} to ${tab.range.end_beat}`}
    >
      <div className="notation-staff-label notation-staff-label-standard" aria-hidden="true">
        STANDARD
      </div>
      <div className="notation-staff-label notation-staff-label-tab" aria-hidden="true">
        TAB
      </div>
      <div className="notation-vexflow" ref={rendererRef} data-testid="notation-svg" />
      <div
        className="notation-playhead"
        data-testid="notation-playhead"
        aria-hidden="true"
        style={{ "--notation-playhead-left": `${playheadLeft}px` } as CSSProperties}
      />
      {chordSlots.map(({ measure, measureIndex, slot }) => {
        const events = slot.event_ids.flatMap((eventId) => {
          const event = eventById.get(eventId)
          return event === undefined ? [] : [event]
        })
        const isActive = activeEventId !== undefined && slot.event_ids.includes(activeEventId)
        const hasUnplayable = events.some((event) => !event.playable)
        const left = positionOf(measureIndex, slot.start_beat, measure.start_beat, measure.end_beat)
        const label = events
          .map((event) =>
            event.playable
              ? `${event.pitch_name}, string ${event.string_number}, fret ${event.fret}`
              : `${event.pitch_name}, unplayable in the configured fretboard`
          )
          .join("; ")
        return (
          <div className="notation-slot-anchor" style={{ left }} key={slot.slot_id}>
            {slot.event_ids.map((eventId) => (
              <span data-tab-note-id={eventId} key={eventId} />
            ))}
            <button
              type="button"
              className={`notation-hit-target${isActive ? " active" : ""}${hasUnplayable ? " unplayable" : ""}`}
              aria-label={`${label}; beat ${slot.start_beat}`}
              title={`${label} · beat ${slot.start_beat}`}
              onClick={() => onSeek(slot.start_beat)}
            >
              <span>{hasUnplayable ? "!" : ""}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
