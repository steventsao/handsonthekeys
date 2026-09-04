import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"

export const sectors = ["A1", "B2", "C3", "D4", "E5", "F6"] as const
export type Sector = (typeof sectors)[number]

export const systems = ["decoder", "thrusters", "shields"] as const
export type ShipSystem = (typeof systems)[number]

export type MissionPhase = "searching" | "signal-found" | "decoded" | "vector-ready" | "rescued"

export interface MissionLog {
  readonly id: number
  readonly actor: "AGENT" | "SHIP" | "HUMAN"
  readonly message: string
}

export interface RescueVector {
  readonly heading: string
  readonly burnSeconds: number
  readonly interceptMinutes: number
  readonly confidence: number
}

export interface MissionState {
  readonly phase: MissionPhase
  readonly powers: Readonly<Record<ShipSystem, number>>
  readonly scans: Readonly<Record<Sector, number | null>>
  readonly activeSector: Sector | null
  readonly decodedMessage: string | null
  readonly rescueVector: RescueVector | null
  readonly logs: ReadonlyArray<MissionLog>
}

export class MissionRuleError extends Data.TaggedError("MissionRuleError")<{
  readonly message: string
}> {}

const freshScans = (): Record<Sector, number | null> => ({
  A1: null,
  B2: null,
  C3: null,
  D4: null,
  E5: null,
  F6: null
})

export const initialMissionState = (): MissionState => ({
  phase: "searching",
  powers: { decoder: 62, thrusters: 81, shields: 43 },
  scans: freshScans(),
  activeSector: null,
  decodedMessage: null,
  rescueVector: null,
  logs: [{ id: 1, actor: "SHIP", message: "Rescue relay online. Unidentified carrier detected." }]
})

const signalStrength: Readonly<Record<Sector, number>> = {
  A1: 8,
  B2: 21,
  C3: 13,
  D4: 57,
  E5: 34,
  F6: 96
}

const withLog = (
  state: MissionState,
  actor: MissionLog["actor"],
  message: string,
  changes: Partial<MissionState> = {}
): MissionState => ({
  ...state,
  ...changes,
  logs: [...state.logs, { id: state.logs.length + 1, actor, message }]
})

export class Mission extends Context.Service<
  Mission,
  {
    readonly changes: Stream.Stream<MissionState>
    readonly snapshot: Effect.Effect<MissionState>
    readonly reset: Effect.Effect<void>
    readonly scan: (sector: Sector) => Effect.Effect<{ readonly sector: Sector; readonly strength: number }>
    readonly reroute: (
      from: ShipSystem,
      to: ShipSystem,
      units: number
    ) => Effect.Effect<Readonly<Record<ShipSystem, number>>, MissionRuleError>
    readonly decode: Effect.Effect<
      { readonly message: string; readonly confidence: number },
      MissionRuleError
    >
    readonly proposeVector: Effect.Effect<RescueVector, MissionRuleError>
    readonly confirmBurn: Effect.Effect<void, MissionRuleError>
  }
>()("driftline/Mission") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make(initialMissionState())

      const scan = Effect.fn("Mission.scan")(function* (sector: Sector) {
        const strength = signalStrength[sector]
        yield* SubscriptionRef.update(state, (current) =>
          withLog(current, "AGENT", `Sector ${sector} scanned — carrier strength ${strength}%.`, {
            activeSector: sector,
            phase: strength >= 90 ? "signal-found" : current.phase,
            scans: { ...current.scans, [sector]: strength }
          })
        )
        return { sector, strength } as const
      })

      const reroute = Effect.fn("Mission.reroute")(function* (
        from: ShipSystem,
        to: ShipSystem,
        units: number
      ) {
        if (from === to || !Number.isInteger(units) || units < 1 || units > 20) {
          return yield* new MissionRuleError({
            message: "Choose different systems and 1–20 whole power units."
          })
        }
        const current = yield* SubscriptionRef.get(state)
        if (current.powers[from] < units + 10) {
          return yield* new MissionRuleError({ message: `${from} cannot safely release ${units} units.` })
        }
        if (current.powers[to] + units > 100) {
          return yield* new MissionRuleError({
            message: `${to} cannot accept ${units} units without exceeding 100%.`
          })
        }
        const powers = {
          ...current.powers,
          [from]: current.powers[from] - units,
          [to]: current.powers[to] + units
        }
        yield* SubscriptionRef.set(
          state,
          withLog(current, "AGENT", `Rerouted ${units} power units: ${from} → ${to}.`, { powers })
        )
        return powers
      })

      const decode = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        if (current.scans.F6 !== 96) {
          return yield* new MissionRuleError({ message: "The carrier source has not been isolated." })
        }
        if (current.powers.decoder < 70) {
          return yield* new MissionRuleError({ message: "Decoder power must reach 70% before recovery." })
        }
        const message = "NYX–7 CREW SAFE. GUIDANCE OFFLINE. OXYGEN 02:14:09."
        yield* SubscriptionRef.set(
          state,
          withLog(current, "AGENT", `Distress packet recovered: “${message}”`, {
            phase: "decoded",
            decodedMessage: message
          })
        )
        return { message, confidence: 0.98 } as const
      }).pipe(Effect.withSpan("Mission.decode"))

      const proposeVector = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        if (current.decodedMessage === null) {
          return yield* new MissionRuleError({
            message: "A rescue vector requires a decoded distress packet."
          })
        }
        const rescueVector: RescueVector = {
          heading: "047.3° / +12.8°",
          burnSeconds: 19,
          interceptMinutes: 11,
          confidence: 97
        }
        yield* SubscriptionRef.set(
          state,
          withLog(current, "AGENT", "Rescue vector plotted. Awaiting human authorization.", {
            phase: "vector-ready",
            rescueVector
          })
        )
        return rescueVector
      }).pipe(Effect.withSpan("Mission.proposeVector"))

      const confirmBurn = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        if (current.rescueVector === null) {
          return yield* new MissionRuleError({ message: "No rescue vector is awaiting approval." })
        }
        yield* SubscriptionRef.set(
          state,
          withLog(current, "HUMAN", "Burn authorized. NYX–7 intercept confirmed — crew recovered.", {
            phase: "rescued"
          })
        )
      }).pipe(Effect.withSpan("Mission.confirmBurn"))

      return Mission.of({
        changes: SubscriptionRef.changes(state),
        snapshot: SubscriptionRef.get(state),
        reset: SubscriptionRef.set(state, initialMissionState()),
        scan,
        reroute,
        decode,
        proposeVector,
        confirmBurn
      })
    })
  )
}
