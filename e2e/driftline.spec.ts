import { expect, test } from "@playwright/test"

test("a WebMCP agent finds NYX-7 and a human authorizes the rescue", async ({ page }) => {
  await page.goto("/driftline.html")

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modelContext = (
          document as Document & {
            modelContext: { getTools: () => Promise<Array<{ name: string }>> }
          }
        ).modelContext
        return (await modelContext.getTools()).map((tool) => tool.name).sort()
      })
    )
    .toEqual([
      "decode_distress_signal",
      "propose_rescue_vector",
      "read_mission_telemetry",
      "reroute_ship_power",
      "scan_signal_sector"
    ])

  await page.getByTestId("run-agent-sequence").click()
  await expect(page.getByTestId("rescue-vector")).toContainText("047.3° / +12.8°")
  await expect(page.getByTestId("approval-drawer")).toContainText("HUMAN CHECKPOINT")
  await expect(page.getByTestId("mission-log")).toContainText("Rescue vector plotted")
  await expect(page.getByTestId("last-tool-output")).toContainText("interceptMinutes")

  await page.getByTestId("authorize-burn").click()

  await expect(page.getByTestId("mission-complete")).toHaveText("NYX–7 // CREW RECOVERED")
  await expect(page.getByTestId("relay-status")).toContainText("MISSION COMPLETE")
  await expect(page.getByTestId("mission-log")).toContainText("crew recovered")
  await page.screenshot({ path: "test-results/driftline-rescued.png", fullPage: true })
})

test("a discovered tool can mutate the visible mission directly", async ({ page }) => {
  await page.goto("/driftline.html")

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modelContext = (
          document as Document & {
            modelContext: {
              getTools: () => Promise<Array<{ name: string }>>
              executeTool: (tool: { name: string }, input: Record<string, unknown>) => Promise<string>
            }
          }
        ).modelContext
        const tool = (await modelContext.getTools()).find(({ name }) => name === "scan_signal_sector")
        return tool === undefined ? "waiting" : modelContext.executeTool(tool, { sector: "F6" })
      })
    )
    .not.toBe("waiting")

  await expect(page.getByRole("button", { name: "Scan sector F6" })).toContainText("96%")
  await expect(page.getByTestId("relay-status")).toContainText("SIGNAL FOUND")
})
