import { expect, test } from "@playwright/test"

const getToolNames = () =>
  document.modelContext!.getTools().then((tools) => tools.map((tool) => tool.name).sort())

declare global {
  interface Document {
    modelContext?: {
      getTools: () => Promise<Array<{ name: string }>>
      executeTool: (tool: { name: string }, input: Record<string, unknown>) => Promise<string>
    }
  }
  interface Window {
    __cookVoice?: (transcript: string) => Promise<string | null>
  }
}

test("a WebMCP agent discovers exactly the seven recipe tools", async ({ page }) => {
  await page.goto("/cook.html")

  await expect
    .poll(() => page.evaluate(getToolNames))
    .toEqual([
      "adjust_zoom",
      "go_to_step",
      "move_step",
      "read_recipe_state",
      "set_view",
      "start_step_timer",
      "stop_timer"
    ])
})

test("discovered tools visibly drive the recipe page", async ({ page }) => {
  await page.goto("/cook.html")

  const execute = (name: string, input: Record<string, unknown>) =>
    page.evaluate(
      async ([toolName, toolInput]) => {
        const modelContext = document.modelContext!
        const tool = (await modelContext.getTools()).find(({ name }) => name === toolName)
        return tool === undefined ? "waiting" : modelContext.executeTool(tool, toolInput)
      },
      [name, input] as const
    )

  await expect.poll(() => execute("go_to_step", { step: 3 })).not.toBe("waiting")
  await expect(page.getByTestId("step-card")).toContainText("STEP 3 / 8")
  await expect(page.getByTestId("step-card")).toContainText("Scramble the eggs")

  await execute("set_view", { view: "ingredients" })
  await expect(page.getByText("Roma tomatoes")).toBeVisible()

  await execute("set_view", { view: "steps" })
  await execute("adjust_zoom", { direction: "in" })
  await expect(page.getByTestId("zoom-level")).toHaveText("1.2x")
})

test("a spoken command runs the same WebMCP tools as an agent", async ({ page }) => {
  await page.goto("/cook.html")

  await expect.poll(() => page.evaluate(() => window.__cookVoice !== undefined)).toBe(true)

  await page.evaluate(() => window.__cookVoice!("next step"))

  await expect(page.getByTestId("step-card")).toContainText("STEP 2 / 8")
  await expect(page.getByTestId("step-card")).toContainText("Beat the eggs")
  await expect(page.getByTestId("voice-log")).toContainText("VOICE")
  await expect(page.getByTestId("voice-log")).toContainText("Heard “next step”")

  await page.screenshot({ path: "test-results/cook-voice.png", fullPage: true })
})
