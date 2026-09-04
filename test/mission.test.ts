import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { Mission } from "../src/Mission.ts"

const totalPower = (powers: Readonly<Record<string, number>>): number =>
  Object.values(powers).reduce((total, power) => total + power, 0)

describe("Driftline mission service", () => {
  it.effect("conserves power and rejects destination overflow atomically", () =>
    Effect.gen(function* () {
      const mission = yield* Mission
      const initial = yield* mission.snapshot

      yield* mission.reroute("shields", "decoder", 18)
      yield* mission.reroute("thrusters", "decoder", 20)
      const fullDecoder = yield* mission.snapshot

      assert.deepStrictEqual(fullDecoder.powers, {
        decoder: 100,
        thrusters: 61,
        shields: 25
      })
      assert.strictEqual(totalPower(fullDecoder.powers), totalPower(initial.powers))

      const overflow = yield* Effect.flip(mission.reroute("shields", "decoder", 1))
      const afterRejected = yield* mission.snapshot

      assert.include(overflow.message, "without exceeding 100%")
      assert.deepStrictEqual(afterRejected, fullDecoder)
      assert.strictEqual(totalPower(afterRejected.powers), totalPower(initial.powers))
    }).pipe(Effect.provide(Mission.layer))
  )
})
