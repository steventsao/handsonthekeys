import { expect, test, type Browser, type Page } from "@playwright/test"

type ToolCallResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string }

const toolNames = (page: Page) =>
  page.evaluate(() =>
    document.modelContext!.getTools().then((tools) => tools.map((tool) => tool.name).sort())
  )

const callTool = (page: Page, name: string, input: Record<string, unknown>): Promise<ToolCallResult> =>
  page.evaluate(
    async ([toolName, toolInput]) => {
      try {
        const modelContext = document.modelContext!
        const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName)
        if (tool === undefined) return { ok: false, error: "waiting" } as const
        return { ok: true, value: String(await modelContext.executeTool(tool, toolInput)) } as const
      } catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : String(cause) } as const
      }
    },
    [name, input] as const
  )

const parseRoom = (result: ToolCallResult) => {
  if (!result.ok) throw new Error(result.error)
  return JSON.parse(result.value) as {
    readonly room: { readonly id: string; readonly phase: string; readonly revision: number }
    readonly tasks: ReadonlyArray<{
      readonly id: string
      readonly capability: "copy" | "palette" | "iconography"
      readonly status: string
    }>
  }
}

const openPage = async (browser: Browser, path: string): Promise<Page> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(path)
  return page
}

test("two tab-scoped agents complete one protected Hex Relay room", async ({ browser, page }) => {
  await page.goto("/cell.html")
  await expect(page.getByText("FRIENDS BRING AGENTS.")).toBeVisible()
  await page.getByRole("button", { name: /OPEN RELAY ROOM/ }).click()

  await expect(page.getByTestId("relay-room")).toBeVisible()
  await expect(page.getByTestId("current-cell")).toContainText("Lead Cell")
  await expect(page).toHaveURL(/cell(?:\.html)?\?room=room_/)

  const shareUrl = new URL(page.url())
  expect([...shareUrl.searchParams.keys()]).toEqual(["room"])
  expect(shareUrl.hash).toBe("")

  const expectedTools = [
    "claim_relay_task",
    "create_relay_room",
    "inspect_relay_room",
    "offer_agent_cell",
    "plan_relay_tasks",
    "review_relay_task",
    "submit_relay_task"
  ]
  await expect.poll(() => toolNames(page)).toEqual(expectedTools)

  const guest = await openPage(browser, shareUrl.toString())
  await expect(guest.getByText("OBSERVER MODE")).toBeVisible()
  await guest.getByRole("button", { name: /OFFER THIS TAB AS A CELL/ }).click()
  await expect(guest.getByTestId("current-cell")).toContainText("Guest Cell")
  await expect(page.getByTestId("presence-panel")).toContainText("Guest Cell")

  const forbidden = await callTool(guest, "plan_relay_tasks", {})
  expect(forbidden.ok).toBe(false)
  if (!forbidden.ok) expect(forbidden.error).toContain("Only the room creator")

  const planned = await callTool(page, "plan_relay_tasks", {})
  expect(planned.ok).toBe(true)
  const plan = parseRoom(planned)
  expect(plan.tasks).toHaveLength(3)
  await expect(page.getByTestId("task-panel")).toContainText("Tune the spectrum")

  const task = (capability: "copy" | "palette" | "iconography") => {
    const found = plan.tasks.find((candidate) => candidate.capability === capability)
    if (found === undefined) throw new Error(`Missing ${capability} task`)
    return found
  }

  await callTool(page, "claim_relay_task", { taskId: task("copy").id })
  await callTool(page, "submit_relay_task", {
    taskId: task("copy").id,
    output: { kind: "copy", title: "Moonlight, Shared" }
  })

  await callTool(guest, "claim_relay_task", { taskId: task("palette").id })
  await callTool(guest, "submit_relay_task", {
    taskId: task("palette").id,
    output: { kind: "palette", colors: ["#f4ff7a", "#6ef2d0", "#9b82ff"] }
  })

  await callTool(guest, "claim_relay_task", { taskId: task("iconography").id })
  await callTool(guest, "submit_relay_task", {
    taskId: task("iconography").id,
    output: {
      kind: "iconography",
      motifs: ["moon", "spark", "wave", "leaf", "arch", "star"]
    }
  })

  await expect(page.getByTestId("event-log")).toContainText("Guest Cell submitted")

  for (const capability of ["copy", "palette", "iconography"] as const) {
    const reviewed = await callTool(page, "review_relay_task", {
      taskId: task(capability).id,
      decision: "accept"
    })
    expect(reviewed.ok).toBe(true)
  }

  await expect(page.getByText("3/3 INTERFACES RESOLVED")).toBeVisible()
  await expect(page.getByText("COMPLETED", { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId("hex-poster")).toHaveAttribute("aria-label", /Moonlight, Shared/)

  const observer = await openPage(browser, shareUrl.toString())
  await expect(observer.getByText("OBSERVER MODE")).toBeVisible()
  await expect(observer.getByText("3/3 INTERFACES RESOLVED")).toBeVisible()
  await expect(observer.getByTestId("hex-poster")).toHaveAttribute("aria-label", /Moonlight, Shared/)

  await page.screenshot({ path: "test-results/hex-relay-complete.png", fullPage: true })
})
