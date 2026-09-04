import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"

export interface VoiceCommand {
  readonly tool: string
  readonly input: Record<string, unknown>
}

const numberWords: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8
}

export const parseCommand = (transcript: string): VoiceCommand | null => {
  const text = transcript.toLowerCase().trim().replace(/\s+/g, " ")
  if (text === "") return null

  const stepMatch = /\bstep\s+(\d+|one|two|three|four|five|six|seven|eight)\b/.exec(text)
  if (stepMatch !== null) {
    const token = stepMatch[1]
    const word = token === undefined ? undefined : numberWords[token]
    const step = word ?? Number(token)
    if (Number.isInteger(step) && step >= 1 && step <= 8) {
      return { tool: "go_to_step", input: { step } }
    }
  }
  if (/\b(?:start|begin)(?:\s+the)?\s+timer\b/.test(text)) {
    return { tool: "start_step_timer", input: {} }
  }
  if (/\b(?:stop|cancel)(?:\s+the)?\s+timer\b/.test(text)) {
    return { tool: "stop_timer", input: {} }
  }
  if (/\breset\s+zoom\b|\bzoom\s+reset\b/.test(text)) {
    return { tool: "adjust_zoom", input: { direction: "reset" } }
  }
  if (/\bzoom\s+in\b/.test(text)) {
    return { tool: "adjust_zoom", input: { direction: "in" } }
  }
  if (/\bzoom\s+out\b/.test(text)) {
    return { tool: "adjust_zoom", input: { direction: "out" } }
  }
  if (/\bingredients?\b/.test(text)) {
    return { tool: "set_view", input: { view: "ingredients" } }
  }
  if (/\boverview\b/.test(text)) {
    return { tool: "set_view", input: { view: "overview" } }
  }
  if (/\bsteps\b/.test(text)) {
    return { tool: "set_view", input: { view: "steps" } }
  }
  if (/\b(?:next|go on|forward)\b/.test(text)) {
    return { tool: "move_step", input: { direction: "next" } }
  }
  if (/\b(?:back|previous)\b/.test(text)) {
    return { tool: "move_step", input: { direction: "previous" } }
  }
  return null
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { readonly error: string }) => void) | null
  start(): void
  abort(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const recognitionConstructor = (): SpeechRecognitionConstructor | undefined => {
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

export interface VoiceControl {
  readonly supported: boolean
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
}

export const voiceUnavailableMessage =
  "Voice control needs the Web Speech API — try Chrome or Edge. Every tool also works from the page."

export const makeVoiceControl = (options: {
  readonly executeTool: (name: string, input: Record<string, unknown>) => Promise<string>
  readonly onTranscript: (transcript: string, isFinal: boolean) => void
  readonly onListeningChange: (listening: boolean) => void
  readonly onError: (message: string) => void
}): VoiceControl => {
  const Recognition = recognitionConstructor()

  if (Recognition === undefined) {
    return {
      supported: false,
      start: () => {
        options.onError(voiceUnavailableMessage)
        return Promise.resolve()
      },
      stop: () => Promise.resolve()
    }
  }

  let closeScope: (() => Promise<void>) | null = null

  const start = async (): Promise<void> => {
    if (closeScope !== null) return
    const scope = Scope.makeUnsafe()
    closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void))

    const program = Effect.gen(function* () {
      const recognition = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const instance = new Recognition()
          instance.lang = "en-US"
          instance.continuous = true
          instance.interimResults = true
          return instance
        }),
        (instance) =>
          Effect.sync(() => {
            instance.onresult = null
            instance.onend = null
            instance.onerror = null
            instance.abort()
          })
      )

      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const alternative = result?.[0]
          if (result === undefined || alternative === undefined) continue
          options.onTranscript(alternative.transcript, result.isFinal)
          if (!result.isFinal) continue
          const command = parseCommand(alternative.transcript)
          if (command === null) continue
          options.executeTool(command.tool, command.input).catch((cause: unknown) => {
            options.onError(cause instanceof Error ? cause.message : String(cause))
          })
        }
      }
      recognition.onerror = (event) => {
        if (event.error !== "aborted") options.onError(`Microphone error: ${event.error}`)
      }
      recognition.onend = () => {
        closeScope = null
        options.onListeningChange(false)
      }
      recognition.start()
    })

    await Effect.runPromise(Scope.provide(program, scope)).then(
      () => options.onListeningChange(true),
      (cause: unknown) => {
        closeScope = null
        options.onError(cause instanceof Error ? cause.message : String(cause))
      }
    )
  }

  const stop = async (): Promise<void> => {
    const close = closeScope
    closeScope = null
    if (close !== null) await close()
    options.onListeningChange(false)
  }

  return { supported: true, start, stop }
}
