export interface StudioViewFocus {
  readonly startBeat: number
  readonly endBeat: number
  readonly paddingBeats: number
  readonly trackIds: ReadonlyArray<string>
  readonly trackNames: ReadonlyArray<string>
  readonly label: string
}

type StudioViewListener = (focus: StudioViewFocus | null) => void

let currentFocus: StudioViewFocus | null = null
const listeners = new Set<StudioViewListener>()

export const setStudioViewFocus = (focus: StudioViewFocus | null): void => {
  currentFocus = focus
  for (const listener of listeners) listener(focus)
}

export const clearStudioViewFocus = (): void => setStudioViewFocus(null)

export const subscribeStudioViewFocus = (listener: StudioViewListener): (() => void) => {
  listeners.add(listener)
  listener(currentFocus)
  return () => listeners.delete(listener)
}
