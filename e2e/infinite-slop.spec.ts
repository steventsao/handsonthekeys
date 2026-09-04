import { expect, test, type Page } from "@playwright/test"

declare global {
  interface Document {
    modelContext?: {
      getTools: () => Promise<Array<{ name: string }>>
      executeTool: (tool: { name: string }, input: Record<string, unknown>) => Promise<string>
    }
  }
}

const executeTool = (page: Page, name: string, input: Record<string, unknown>) =>
  page.evaluate(
    async ([toolName, toolInput]) => {
      const modelContext = document.modelContext!
      const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName)
      return tool === undefined ? "waiting" : modelContext.executeTool(tool, toolInput)
    },
    [name, input] as const
  )

test("the legacy visual channel exposes exactly four visual queue tools", async ({ page }) => {
  await page.goto("/slop.html")

  await expect
    .poll(() =>
      page.evaluate(() =>
        document.modelContext!.getTools().then((tools) => tools.map(({ name }) => name).sort())
      )
    )
    .toEqual(["batch_queue", "get_status", "queue_prompt", "steer_prompt"])

  await expect(page.getByTestId("mcp-state")).toContainText(/WEBMCP|EFFECT ADAPTER/)
  await expect(page.getByTestId("visual-reel")).toBeVisible()
})

test("tool calls paint their structured results into the visible stream", async ({ page }) => {
  await page.goto("/slop.html")
  const prompt = "A crystal subway tunneling through the memory of a thunderstorm"
  const requestId = `e2e-queue-${crypto.randomUUID()}`

  await expect
    .poll(() => executeTool(page, "queue_prompt", { prompt, client_request_id: requestId }))
    .not.toBe("waiting")

  const queuedText = await executeTool(page, "queue_prompt", { prompt, client_request_id: requestId })
  const queued = JSON.parse(String(queuedText)) as { run: { id: string; revision: number } }
  await expect(page.getByTestId("activity-stream")).toContainText("queue_prompt")
  await expect(page.getByTestId("activity-stream")).toContainText(prompt)

  await executeTool(page, "get_status", { run_id: queued.run.id })
  await expect(page.getByTestId("activity-stream")).toContainText("get_status")

  await executeTool(page, "steer_prompt", {
    run_id: queued.run.id,
    instruction: "Make the lightning amber and slow the camera to a floating orbit",
    expected_revision: queued.run.revision,
    client_request_id: `e2e-steer-${crypto.randomUUID()}`
  })
  await expect(page.getByTestId("activity-stream")).toContainText("steer_prompt")
  await expect(page.getByTestId("activity-stream")).toContainText("CREATIVE DIRECTION APPLIED")
})

test("batch_queue returns one visual card with multiple selectable run links", async ({ page }) => {
  await page.goto("/slop.html")
  const items = [
    "A miniature aurora learning choreography inside an elevator",
    "A brass whale surfacing through a library floor"
  ].map((prompt) => ({ prompt, client_request_id: `e2e-batch-${crypto.randomUUID()}` }))

  await expect.poll(() => executeTool(page, "batch_queue", { items })).not.toBe("waiting")

  const stream = page.getByTestId("activity-stream")
  await expect(stream).toContainText("batch_queue")
  await expect(stream).toContainText("2 PROMPTS ENTERED THE PIPELINE")
  await expect(stream.getByRole("button")).toHaveCount(2)
})
