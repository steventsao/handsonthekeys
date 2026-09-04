import * as PlatformWebMcp from "@effect/platform-browser/WebMcp"
import { WebMcp } from "../src/index.js"
import { assert, describe, it } from "vitest"

describe("package exports", () => {
  it("re-exports the platform-browser WebMcp module", () => {
    assert.strictEqual(WebMcp.registerTool, PlatformWebMcp.registerTool)
    assert.strictEqual(WebMcp.layerDocument, PlatformWebMcp.layerDocument)
    assert.strictEqual(WebMcp.layerModelContext, PlatformWebMcp.layerModelContext)
    assert.strictEqual(WebMcp.make, PlatformWebMcp.make)
  })
})
