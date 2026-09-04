import { describe, expect, it } from "vitest"
import { studioPracticeCodeModeTool } from "../src/studio/studioPracticeCodeMode.ts"

describe("Studio Code Mode contract", () => {
  it("publishes one focused WebMCP descriptor with a complete practice workflow", () => {
    expect(studioPracticeCodeModeTool.name).toBe("codemode")
    expect(studioPracticeCodeModeTool.title).toBe("Use Studio with Code Mode")
    expect(studioPracticeCodeModeTool.name.length).toBeLessThanOrEqual(30)
    expect(studioPracticeCodeModeTool.description.length).toBeLessThanOrEqual(1_500)
    expect(studioPracticeCodeModeTool.description).toContain("const session = await codemode.getSession({})")
    expect(studioPracticeCodeModeTool.description).toContain("expected_revision: session.project_revision")
    expect(studioPracticeCodeModeTool.description).toContain("expected_revision: metronome.project_revision")
    expect(studioPracticeCodeModeTool.description).toContain(
      "expected_lesson_revision: drums.lesson_revision"
    )
    expect(studioPracticeCodeModeTool.description).toContain("setMetronome")
    expect(studioPracticeCodeModeTool.description).toContain("addDrumBeat")
    expect(studioPracticeCodeModeTool.description).toContain("controlTransport")
    expect(studioPracticeCodeModeTool.description).toContain("recordTake")
    expect(studioPracticeCodeModeTool.description).toContain("shareSession")

    const schema = studioPracticeCodeModeTool.inputSchema as {
      readonly required: ReadonlyArray<string>
      readonly properties: Readonly<Record<string, { readonly description?: string }>>
    }
    expect(schema.required).toEqual(["code"])
    expect(Object.keys(schema.properties)).toEqual(["code"])
    expect(schema.properties.code?.description?.length ?? 0).toBeLessThanOrEqual(150)
  })
})
