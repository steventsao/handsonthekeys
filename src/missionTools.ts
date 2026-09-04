import type { EffectTool, ToolInput } from "@effect/platform-browser/WebMcp"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Mission, sectors, systems } from "./Mission.ts"

const EmptyInput = Schema.Struct({})
const ScanInput = Schema.Struct({ sector: Schema.Literals(sectors) })
const RerouteInput = Schema.Struct({
  from: Schema.Literals(systems),
  to: Schema.Literals(systems),
  units: Schema.Number
})

const jsonSchema = (schema: Schema.Top) => Schema.toJsonSchemaDocument(schema) as object

export const missionTools: ReadonlyArray<EffectTool<ToolInput, unknown, unknown, Mission>> = [
  {
    name: "read_mission_telemetry",
    title: "Read mission telemetry",
    description: "Read the current NYX–7 mission phase, power allocation, scans, and rescue state.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const mission = yield* Mission
        return yield* mission.snapshot
      })
  },
  {
    name: "scan_signal_sector",
    title: "Scan signal sector",
    description: "Scan exactly one sector (A1–F6) and record its distress-carrier strength.",
    inputSchema: jsonSchema(ScanInput),
    execute: (input) =>
      Effect.gen(function* () {
        const { sector } = yield* Schema.decodeUnknownEffect(ScanInput)(input)
        const mission = yield* Mission
        return yield* mission.scan(sector)
      })
  },
  {
    name: "reroute_ship_power",
    title: "Reroute ship power",
    description: "Move 1–20 whole power units between decoder, thrusters, and shields.",
    inputSchema: jsonSchema(RerouteInput),
    execute: (input) =>
      Effect.gen(function* () {
        const { from, to, units } = yield* Schema.decodeUnknownEffect(RerouteInput)(input)
        const mission = yield* Mission
        return yield* mission.reroute(from, to, units)
      })
  },
  {
    name: "decode_distress_signal",
    title: "Decode distress signal",
    description:
      "Recover the isolated distress packet after the signal is found and decoder power reaches 70%.",
    inputSchema: jsonSchema(EmptyInput),
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const mission = yield* Mission
        return yield* mission.decode
      })
  },
  {
    name: "propose_rescue_vector",
    title: "Propose rescue vector",
    description: "Plot a rescue intercept from decoded telemetry. This never authorizes the final burn.",
    inputSchema: jsonSchema(EmptyInput),
    annotations: { readOnlyHint: true },
    execute: (input) =>
      Effect.gen(function* () {
        yield* Schema.decodeUnknownEffect(EmptyInput)(input)
        const mission = yield* Mission
        return yield* mission.proposeVector
      })
  }
]
