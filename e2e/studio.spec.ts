import { expect, test, type Page } from "@playwright/test"

interface StudioE2ETool {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: object
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly untrustedContentHint?: boolean }
}

interface StudioE2EModelContext {
  readonly getTools: () => Promise<Array<StudioE2ETool>>
  readonly executeTool: (tool: { name: string }, input: Record<string, unknown>) => Promise<string>
}

const getTools = () => {
  const modelContext = (document as unknown as { modelContext?: StudioE2EModelContext }).modelContext
  return modelContext?.getTools() ?? Promise.resolve([])
}

const waitForStudioTools = (page: Page) =>
  expect.poll(() => page.evaluate(getTools), { timeout: 15_000 }).toHaveLength(1)

const executeTool = ([name, input]: readonly [string, Record<string, unknown>]) =>
  (document as unknown as { modelContext: StudioE2EModelContext }).modelContext.getTools().then((tools) => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool !== undefined) {
      return (document as unknown as { modelContext: StudioE2EModelContext }).modelContext.executeTool(
        tool,
        input
      )
    }
    const bridge = (
      window as unknown as {
        readonly __signalStudioTest?: {
          readonly executeTool: (toolName: string, toolInput: Record<string, unknown>) => Promise<string>
        }
      }
    ).__signalStudioTest
    if (bridge === undefined) throw new Error(`Missing tool ${name}`)
    return bridge.executeTool(name, input)
  })

const executeToolError = async ([name, input]: readonly [string, Record<string, unknown>]) => {
  try {
    const modelContext = (document as unknown as { modelContext: StudioE2EModelContext }).modelContext
    const tool = (await modelContext.getTools()).find((candidate) => candidate.name === name)
    if (tool !== undefined) await modelContext.executeTool(tool, input)
    else {
      const bridge = (
        window as unknown as {
          readonly __signalStudioTest?: {
            readonly executeTool: (toolName: string, toolInput: Record<string, unknown>) => Promise<string>
          }
        }
      ).__signalStudioTest
      if (bridge === undefined) throw new Error(`Missing tool ${name}`)
      await bridge.executeTool(name, input)
    }
    return "unexpected-success"
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

const runCodeMode = async <Result>(page: Page, code: string): Promise<Result> => {
  const envelope = JSON.parse(await page.evaluate(executeTool, ["codemode", { code }] as const)) as {
    readonly status: string
    readonly result: Result
  }
  expect(envelope.status).toBe("completed")
  return envelope.result
}

test("Home starts without bundled music until a song is requested", async ({ page }) => {
  await page.goto("/")
  await waitForStudioTools(page)

  await expect(page.getByTestId("session-mode")).toBeVisible()
  await expect(page.getByRole("button", { name: "SESSION MODE" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator("daw-editor")).toHaveCount(0)

  const midi = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    title: string
    song: { slug: string; attribution: unknown }
    session_end_beat: number
    summary: {
      midi_track_count: number
      midi_clip_count: number
      note_count: number
      referenced_audio_asset_count: number
    }
    tracks: unknown[]
    referenced_audio_assets: unknown[]
  }

  expect(midi).toMatchObject({
    title: "Untitled Session",
    song: { slug: "untitled", attribution: null },
    session_end_beat: 0,
    summary: {
      midi_track_count: 0,
      midi_clip_count: 0,
      note_count: 0,
      referenced_audio_asset_count: 0
    },
    tracks: [],
    referenced_audio_assets: []
  })
})

test("Studio keeps audible output after the opening and near the end of the song", async ({ page }) => {
  await page.addInitScript(() => {
    const telemetry = { destinationConnections: 0, bufferStarts: 0 }
    const connect = AudioNode.prototype.connect
    ;(
      AudioNode.prototype as unknown as {
        connect: (this: AudioNode, ...arguments_: ReadonlyArray<unknown>) => unknown
      }
    ).connect = function (this: AudioNode, ...arguments_) {
      const result = Reflect.apply(connect, this, arguments_)
      const destination = arguments_[0]
      if (destination instanceof AudioDestinationNode) telemetry.destinationConnections += 1
      return result
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...arguments_) {
      telemetry.bufferStarts += 1
      return start.apply(this, arguments_)
    }
    ;(
      window as unknown as {
        studioAudioTelemetry: typeof telemetry & {
          analyser?: AnalyserNode
          sink?: MediaStreamAudioDestinationNode
        }
      }
    ).studioAudioTelemetry = telemetry
  })

  await page.goto("/?mode=daw&song=korobeiniki")
  await page.getByRole("button", { name: "Play", exact: true }).waitFor()

  await page.evaluate(() => {
    const editor = document.querySelector("daw-editor") as HTMLElement & {
      adapter: {
        readonly audioContext: AudioContext
        readonly masterOutputNode?: AudioNode
      }
    }
    const output = editor.adapter.masterOutputNode
    if (output === undefined) throw new Error("The Studio playback adapter has no master output.")
    const analyser = editor.adapter.audioContext.createAnalyser()
    analyser.fftSize = 2_048
    analyser.smoothingTimeConstant = 0
    const sink = editor.adapter.audioContext.createMediaStreamDestination()
    output.connect(analyser)
    analyser.connect(sink)
    const telemetry = (
      window as unknown as {
        studioAudioTelemetry: {
          analyser?: AnalyserNode
          sink?: MediaStreamAudioDestinationNode
        }
      }
    ).studioAudioTelemetry
    telemetry.analyser = analyser
    telemetry.sink = sink
  })

  const audibleLevel = () =>
    page.evaluate(() => {
      const analyser = (window as unknown as { studioAudioTelemetry: { readonly analyser?: AnalyserNode } })
        .studioAudioTelemetry.analyser
      if (analyser === undefined) return 0
      const samples = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(samples)
      return Math.max(...samples.map((sample) => Math.abs(sample)))
    })

  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect
    .poll(
      () =>
        page
          .locator("daw-editor")
          .evaluate((editor) => (editor as unknown as { currentTime: number }).currentTime),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(3.1)
  await expect.poll(audibleLevel, { timeout: 2_000 }).toBeGreaterThan(0.0001)

  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.locator("daw-editor").evaluate((editor) => {
    ;(editor as unknown as { seekTo: (time: number) => void }).seekTo(30)
  })
  await page.getByRole("button", { name: "Play", exact: true }).click()
  await expect.poll(audibleLevel, { timeout: 2_000 }).toBeGreaterThan(0.0001)

  const telemetry = await page.evaluate(
    () =>
      (
        window as unknown as {
          studioAudioTelemetry: { readonly destinationConnections: number; readonly bufferStarts: number }
        }
      ).studioAudioTelemetry
  )
  expect(telemetry.destinationConnections).toBeLessThanOrEqual(4)
  expect(telemetry.bufferStarts).toBeGreaterThan(0)
})

test("the root Session route registers the focused WebMCP contract", async ({ page }) => {
  await page.goto("/?mode=session&song=korobeiniki")
  await waitForStudioTools(page)

  const registered = await page.evaluate(getTools)
  expect(registered.map((tool) => tool.name)).toEqual(["codemode"])

  for (const tool of registered) {
    expect(tool.name.length).toBeLessThanOrEqual(30)
    expect(tool.description?.length ?? 0).toBeLessThanOrEqual(1_500)
    const properties = (
      tool.inputSchema as {
        readonly properties?: Readonly<Record<string, { readonly description?: string }>>
      }
    ).properties
    for (const [name, property] of Object.entries(properties ?? {})) {
      expect(name.length).toBeLessThanOrEqual(30)
      expect(property.description?.length ?? 0).toBeLessThanOrEqual(150)
    }
  }

  expect(registered[0]?.inputSchema).toMatchObject({
    properties: {
      code: { type: "string", minLength: 1, maxLength: 8_000 }
    }
  })
  expect(registered[0]?.description).toContain("codemode.getSession")
  expect(registered[0]?.description).toContain("getInstruments")
  expect(registered[0]?.description).toContain("setMetronome")
  expect(registered[0]?.description).toContain("addDrumBeat")
  expect(registered[0]?.description).toContain("controlTransport")
  expect(registered[0]?.description).toContain("const session = await codemode.getSession({})")
  expect(registered[0]?.description).toContain("expected_revision: metronome.project_revision")
  expect(registered[0]?.description).toContain("expected_lesson_revision: drums.lesson_revision")
  expect(registered[0]?.description).toContain("set_loop")
  expect(registered[0]?.description).toContain("recordTake")
  expect(registered[0]?.description).toContain("shareSession")

  const session = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      { code: "async () => await codemode.getSession({})" }
    ] as const)
  ) as {
    status: string
    result: {
      bpm: number
      mode: string
      transport: { loop_enabled: boolean; loop_start_beat: number; loop_end_beat: number }
      raw_audio_shared: boolean
    }
  }
  expect(session).toMatchObject({
    status: "completed",
    result: {
      mode: "session",
      transport: { loop_enabled: false },
      raw_audio_shared: false
    }
  })
  expect(session.result.bpm).toBeGreaterThanOrEqual(40)
  expect(session.result.bpm).toBeLessThanOrEqual(240)
  expect(session.result.transport.loop_end_beat).toBeGreaterThan(session.result.transport.loop_start_beat)
})

test("Session, Tab, and Studio share one persistent click and musical transport", async ({ page }) => {
  await page.goto("/?mode=session&song=afterglow")
  await waitForStudioTools(page)

  await expect(page.getByTestId("session-mode")).toBeVisible()
  await expect(page.getByRole("button", { name: "SESSION MODE" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator("daw-editor")).toHaveCount(1)
  await page.locator("daw-editor").evaluate((editor) => {
    editor.setAttribute("data-shared-transport-instance", "session-origin")
  })

  const toggle = page.getByRole("button", { name: "Start metronome" })
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute("aria-pressed", "false")

  const midiBefore = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    tempo_map: Array<{ bpm: number }>
    tracks: unknown[]
  }
  const lessonBefore = JSON.parse(await page.evaluate(executeTool, ["get_tab_lesson", {}] as const)) as {
    lesson_revision: number
    metronome: {
      enabled: boolean
      follows_project_tempo: boolean
      included_in_export: boolean
      independently_enabled: boolean
      clock_source: string
      rephases_with_track_start: boolean
    }
  }
  expect(lessonBefore.metronome).toEqual({
    enabled: false,
    follows_project_tempo: true,
    accented_downbeat: true,
    included_in_export: false,
    independently_enabled: true,
    clock_source: "shared_daw_transport",
    rephases_with_track_start: true
  })

  await page.evaluate(executeTool, [
    "set_studio_tempo",
    {
      request_id: "e2e-stop-this-train-tempo",
      expected_revision: midiBefore.revision,
      bpm: 90
    }
  ] as const)
  const midiAt90 = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    tempo_map: Array<{ bpm: number }>
    tracks: unknown[]
  }
  expect(midiAt90).toMatchObject({
    revision: midiBefore.revision + 1,
    tempo_map: [{ beat: 0, bpm: 90 }],
    tracks: midiBefore.tracks
  })
  await expect(page.getByRole("spinbutton", { name: "Session tempo in beats per minute" })).toHaveValue("90")

  await toggle.click()
  await expect(page.getByRole("button", { name: "Stop metronome" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("session-mode")).toHaveAttribute("data-metronome-status", "running")
  await expect
    .poll(async () => Number(await page.getByTestId("session-mode").getAttribute("data-metronome-sequence")))
    .toBeGreaterThan(0)

  const afterHumanStart = JSON.parse(await page.evaluate(executeTool, ["get_tab_lesson", {}] as const)) as {
    lesson_revision: number
  }

  const stopped = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_metronome",
      {
        request_id: "e2e-stop-shared-metronome",
        expected_lesson_revision: afterHumanStart.lesson_revision,
        enabled: false
      }
    ] as const)
  ) as { lesson_revision: number; musical_playback_changed: boolean }
  expect(stopped.musical_playback_changed).toBe(false)
  await expect(page.getByRole("button", { name: "Start metronome" })).toHaveAttribute("aria-pressed", "false")

  const enabled = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_metronome",
      {
        request_id: "e2e-enable-metronome",
        expected_lesson_revision: stopped.lesson_revision,
        enabled: true
      }
    ] as const)
  ) as {
    change: string
    enabled: boolean
    lesson_revision: number
    project_revision: number
    replayed: boolean
    metronome_engine: string
    clock_source: string
    starts_immediately: boolean
    click_only_when_tracks_stopped: boolean
    rephases_with_track_start: boolean
    musical_playback_changed: boolean
  }
  expect(enabled).toMatchObject({
    change: "metronome_enabled",
    enabled: true,
    lesson_revision: stopped.lesson_revision + 1,
    project_revision: midiAt90.revision,
    replayed: false,
    metronome_engine: "shared_daw_transport",
    clock_source: "shared_daw_transport",
    click_only_when_tracks_stopped: true,
    rephases_with_track_start: true,
    starts_immediately: true,
    musical_playback_changed: false
  })
  await expect(page.getByRole("button", { name: "Stop metronome" })).toHaveAttribute("aria-pressed", "true")

  const presentation = JSON.parse(
    await page.evaluate(executeTool, [
      "query_studio",
      {
        code: "async () => { const ui = await codemode.getStudioPresentation({}); return { surface: ui.surface, transport: ui.transport }; }"
      }
    ] as const)
  ) as {
    result: { surface: string; transport: { status: string; playhead_beat: number } }
  }
  expect(presentation.result).toMatchObject({
    surface: "session",
    transport: { status: "click_only", playhead_beat: 0 }
  })

  const clickOnly = await page.locator("daw-editor").evaluate((editor) => {
    const adapter = (
      editor as unknown as {
        adapter: {
          musicIsPlaying: () => boolean
          metronomePosition: () => { clockRunning: boolean; phaseRevision: number }
        }
      }
    ).adapter
    return {
      musicPlaying: adapter.musicIsPlaying(),
      clock: adapter.metronomePosition()
    }
  })
  expect(clickOnly.musicPlaying).toBe(false)
  expect(clickOnly.clock.clockRunning).toBe(true)

  const metronomeFirstPhase = clickOnly.clock.phaseRevision
  await page.evaluate(executeTool, [
    "control_learning_transport",
    {
      request_id: "e2e-metronome-first-play",
      action: "play_range",
      start_beat: 0,
      end_beat: 8
    }
  ] as const)
  const musicAndClick = await page.locator("daw-editor").evaluate((editor) => {
    const adapter = (
      editor as unknown as {
        adapter: {
          musicIsPlaying: () => boolean
          metronomePosition: () => { clockRunning: boolean; phaseRevision: number }
        }
      }
    ).adapter
    return {
      musicPlaying: adapter.musicIsPlaying(),
      clock: adapter.metronomePosition()
    }
  })
  expect(musicAndClick.musicPlaying).toBe(true)
  expect(musicAndClick.clock.clockRunning).toBe(true)
  expect(musicAndClick.clock.phaseRevision).toBeGreaterThan(metronomeFirstPhase)

  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-pause-music-keep-click", action: "pause" }
  ] as const)
  await expect(page.getByRole("button", { name: "Stop metronome" })).toHaveAttribute("aria-pressed", "true")
  const pausedWithClick = await page.locator("daw-editor").evaluate((editor) => {
    const adapter = (
      editor as unknown as {
        adapter: {
          musicIsPlaying: () => boolean
          metronomePosition: () => { clockRunning: boolean }
        }
      }
    ).adapter
    return {
      musicPlaying: adapter.musicIsPlaying(),
      clockRunning: adapter.metronomePosition().clockRunning
    }
  })
  expect(pausedWithClick).toEqual({ musicPlaying: false, clockRunning: true })

  const tabMode = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_mode",
      {
        request_id: "e2e-metronome-open-tab",
        expected_lesson_revision: enabled.lesson_revision,
        mode: "tab"
      }
    ] as const)
  ) as { lesson_revision: number; mode: string }
  expect(tabMode).toMatchObject({ lesson_revision: enabled.lesson_revision + 1, mode: "tab" })
  await expect(page).toHaveURL(/\/\?mode=tab&song=afterglow$/)
  await expect(page.getByRole("button", { name: "Stop metronome" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('daw-editor[data-shared-transport-instance="session-origin"]')).toHaveCount(1)

  const dawMode = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_mode",
      {
        request_id: "e2e-metronome-open-daw",
        expected_lesson_revision: tabMode.lesson_revision,
        mode: "daw"
      }
    ] as const)
  ) as { lesson_revision: number; mode: string }
  expect(dawMode.mode).toBe("daw")
  await expect(page).toHaveURL(/\/\?mode=daw&song=afterglow$/)
  await expect(page.locator('daw-editor[data-shared-transport-instance="session-origin"]')).toBeVisible()

  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-shared-seek", action: "seek", beat: 4 }
  ] as const)
  const seekPhase = await page
    .locator("daw-editor")
    .evaluate(
      (editor) =>
        (
          editor as unknown as { adapter: { metronomePosition: () => { phaseRevision: number } } }
        ).adapter.metronomePosition().phaseRevision
    )
  await page.evaluate(executeTool, [
    "control_learning_transport",
    {
      request_id: "e2e-shared-restart",
      action: "play_range",
      start_beat: 4,
      end_beat: 8
    }
  ] as const)
  await expect
    .poll(() =>
      page
        .locator("daw-editor")
        .evaluate(
          (editor) =>
            (
              editor as unknown as { adapter: { metronomePosition: () => { phaseRevision: number } } }
            ).adapter.metronomePosition().phaseRevision
        )
    )
    .toBeGreaterThan(seekPhase)
  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-shared-restart-pause", action: "pause" }
  ] as const)

  const replayed = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_metronome",
      {
        request_id: "e2e-enable-metronome",
        expected_lesson_revision: stopped.lesson_revision,
        enabled: true
      }
    ] as const)
  ) as { lesson_revision: number; replayed: boolean }
  expect(replayed).toMatchObject({ lesson_revision: enabled.lesson_revision, replayed: true })

  const midiWhileEnabled = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", {}] as const)
  ) as typeof midiAt90
  expect(midiWhileEnabled).toEqual(midiAt90)

  await page.getByRole("button", { name: "Stop metronome" }).click()
  await expect(page.getByRole("button", { name: "Start metronome" })).toHaveAttribute("aria-pressed", "false")
  const afterHumanDisable = JSON.parse(await page.evaluate(executeTool, ["get_tab_lesson", {}] as const)) as {
    lesson_revision: number
  }

  await page.evaluate(executeTool, [
    "control_learning_transport",
    {
      request_id: "e2e-daw-first-play",
      action: "play_range",
      start_beat: 0,
      end_beat: 8
    }
  ] as const)
  const beforeDawFirstEnable = await page
    .locator("daw-editor")
    .evaluate(
      (editor) =>
        (
          editor as unknown as { adapter: { metronomePosition: () => { phaseRevision: number } } }
        ).adapter.metronomePosition().phaseRevision
    )
  const dawFirstEnabled = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_metronome",
      {
        request_id: "e2e-daw-first-enable-metronome",
        expected_lesson_revision: afterHumanDisable.lesson_revision,
        enabled: true
      }
    ] as const)
  ) as { lesson_revision: number }
  await expect(page.getByRole("button", { name: "Stop metronome" })).toHaveAttribute("aria-pressed", "true")
  const afterDawFirstEnable = await page.locator("daw-editor").evaluate((editor) => {
    const adapter = (
      editor as unknown as {
        adapter: {
          musicIsPlaying: () => boolean
          metronomePosition: () => { clockRunning: boolean; phaseRevision: number }
        }
      }
    ).adapter
    return {
      musicPlaying: adapter.musicIsPlaying(),
      clock: adapter.metronomePosition()
    }
  })
  expect(afterDawFirstEnable.musicPlaying).toBe(true)
  expect(afterDawFirstEnable.clock.clockRunning).toBe(true)
  expect(afterDawFirstEnable.clock.phaseRevision).toBeGreaterThan(beforeDawFirstEnable)

  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-daw-first-pause", action: "pause" }
  ] as const)
  await page.evaluate(executeTool, [
    "set_learning_metronome",
    {
      request_id: "e2e-final-disable-metronome",
      expected_lesson_revision: dawFirstEnabled.lesson_revision,
      enabled: false
    }
  ] as const)

  const midiAfter = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const))
  expect(midiAfter).toEqual(midiAt90)
})

test("the single Cloudflare Code Mode tool runs the core practice workflow", async ({ page }) => {
  await page.goto("/?mode=session&song=afterglow")
  await waitForStudioTools(page)

  // Browser autoplay policy still requires one visible human activation.
  await page.getByRole("button", { name: "Start metronome" }).click()
  await page.getByRole("button", { name: "Stop metronome" }).click()

  const before = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      { code: "async () => await codemode.getSession({})" }
    ] as const)
  ) as {
    status: string
    result: {
      project_revision: number
      lesson_revision: number
      summary: { midi_track_count: number; note_count: number }
    }
  }

  const metronomeCode = `async () => await codemode.setMetronome({
    request_id: "codemode-stop-this-train-90",
    enabled: true,
    bpm: 90,
    bpm_step_per_bar: 2,
    ramp_bar_count: 4,
    expected_revision: ${before.result.project_revision},
    expected_lesson_revision: ${before.result.lesson_revision}
  })`
  const metronome = JSON.parse(
    await page.evaluate(executeTool, ["codemode", { code: metronomeCode }] as const)
  ) as {
    status: string
    result: {
      replayed: boolean
      enabled: boolean
      base_bpm: number
      project_revision: number
      ramp: { bpm_step_per_bar: number; bar_count: number }
    }
  }
  expect(metronome).toMatchObject({
    status: "completed",
    result: {
      replayed: false,
      enabled: true,
      base_bpm: 90,
      project_revision: before.result.project_revision + 1,
      ramp: { bpm_step_per_bar: 2, bar_count: 4 }
    }
  })
  expect(JSON.stringify(metronome).length).toBeLessThanOrEqual(1_500)
  await expect(page.getByRole("button", { name: "Stop metronome" })).toBeVisible()
  await expect(page.getByText("+2/BAR · 4 BARS", { exact: true })).toBeVisible()

  const metronomeReplay = JSON.parse(
    await page.evaluate(executeTool, ["codemode", { code: metronomeCode }] as const)
  ) as { result: { replayed: boolean; project_revision: number } }
  expect(metronomeReplay.result).toMatchObject({
    replayed: true,
    project_revision: metronome.result.project_revision
  })

  const drumsCode = `async () => await codemode.addDrumBeat({
    request_id: "codemode-two-bar-drums",
    bars: 2,
    expected_revision: ${metronome.result.project_revision}
  })`
  const drums = JSON.parse(await page.evaluate(executeTool, ["codemode", { code: drumsCode }] as const)) as {
    status: string
    result: {
      replayed: boolean
      project_revision: number
      notes_written: number
      midi_channel: number
      visible_mode: string
    }
  }
  expect(drums).toMatchObject({
    status: "completed",
    result: {
      replayed: false,
      project_revision: metronome.result.project_revision + 1,
      notes_written: 24,
      midi_channel: 10,
      visible_mode: "daw"
    }
  })
  await expect(page).toHaveURL(/mode=daw/)
  await expect(page.getByText("Practice Drums", { exact: true })).toBeVisible()

  const drumReplay = JSON.parse(
    await page.evaluate(executeTool, ["codemode", { code: drumsCode }] as const)
  ) as { result: { replayed: boolean; project_revision: number } }
  expect(drumReplay.result).toMatchObject({
    replayed: true,
    project_revision: drums.result.project_revision
  })

  const after = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      { code: "async () => await codemode.getSession({})" }
    ] as const)
  ) as { result: { summary: { midi_track_count: number; note_count: number } } }
  expect(after.result.summary).toEqual({
    midi_track_count: before.result.summary.midi_track_count + 1,
    note_count: before.result.summary.note_count + 24,
    local_audio_asset_count: 0
  })

  const seek = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      {
        code: 'async () => await codemode.controlTransport({ request_id: "codemode-seek", action: "seek", beat: 5 })'
      }
    ] as const)
  ) as { status: string; result: { action: string; playhead_beat: number; music_changed: boolean } }
  expect(seek).toMatchObject({
    status: "completed",
    result: { action: "seek", playhead_beat: 5, music_changed: false }
  })
  const rampedSeek = await page.locator("daw-editor").evaluate((editor) => {
    const daw = editor as unknown as {
      adapter: {
        ppqn: number
        secondsToTicks: (seconds: number) => number
        ticksToSeconds: (ticks: number) => number
      }
      currentTime: number
    }
    return {
      currentTime: daw.currentTime,
      expectedTime: daw.adapter.ticksToSeconds(5 * daw.adapter.ppqn),
      actualBeat: daw.adapter.secondsToTicks(daw.currentTime) / daw.adapter.ppqn
    }
  })
  expect(rampedSeek.currentTime).toBeCloseTo(rampedSeek.expectedTime, 4)
  expect(rampedSeek.actualBeat).toBeCloseTo(5, 4)

  const invalid = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      {
        code: 'async () => await codemode.addDrumBeat({ request_id: "codemode-bad-drums", bars: 0 })'
      }
    ] as const)
  ) as { status: string; error: string }
  expect(invalid).toMatchObject({ status: "execution_error", error: "codemode_execution_failed" })
})

test("Session presents a fixed predictive instrument rack from canonical segments and shared transport", async ({
  page
}) => {
  await page.goto("/?mode=session&song=afterglow")
  await waitForStudioTools(page)

  const cards = page.locator(".session-instrument-card")
  const piano = page.getByTestId("session-instrument-piano")
  const drums = page.getByTestId("session-instrument-drums")
  const metronome = page.getByTestId("session-instrument-metronome")

  await expect(page.locator(".session-project")).not.toContainText("SESSION INSTRUMENTS")
  await expect(page.locator(".session-project h1")).toHaveCount(0)
  await expect(cards).toHaveCount(3)
  await expect(cards.locator("header > strong")).toHaveText(["Piano", "Drums", "Metronome"])
  await expect(piano).toHaveAttribute("data-activity", "idle")
  await expect(piano).toHaveAttribute("data-playing-now", "false")
  await expect(piano).toHaveAttribute("data-idle-no-current-segment", "true")
  await expect(piano).toHaveAttribute("data-next-segment-id", "clip-electric-keys")
  await expect(piano).toContainText("NEXT")
  await expect(piano).toContainText("BEAT 8")
  await expect(drums).toHaveAttribute("data-activity", "ready")
  await expect(drums).toHaveAttribute("data-current-segment-id", "clip-drums")
  await expect(drums).toHaveAttribute("data-playing-now", "false")
  await expect(metronome).toHaveAttribute("data-activity", "ready")

  await page.getByRole("button", { name: "Start metronome" }).click()
  await expect(metronome).toHaveAttribute("data-activity", "playing_now")
  await expect(metronome).toHaveAttribute("data-playing-now", "true")
  await expect(piano).toHaveAttribute("data-playing-now", "false")
  await expect(drums).toHaveAttribute("data-playing-now", "false")

  await page.evaluate(executeTool, [
    "control_learning_transport",
    {
      request_id: "e2e-session-rack-drums-only",
      action: "play_range",
      start_beat: 0,
      end_beat: 4
    }
  ] as const)
  await expect(drums).toHaveAttribute("data-activity", "playing_now")
  await expect(drums).toHaveAttribute("data-playing-now", "true")
  await expect(piano).toHaveAttribute("data-activity", "idle")
  await expect(metronome).toHaveAttribute("data-playing-now", "true")

  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-session-rack-pause", action: "pause" }
  ] as const)
  const beforeMix = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
  }
  await page.evaluate(executeTool, [
    "set_studio_track_mix",
    {
      request_id: "e2e-session-rack-mute-piano",
      expected_revision: beforeMix.revision,
      track_id: "track-electric-keys",
      muted: true
    }
  ] as const)

  await page.evaluate(executeTool, [
    "control_learning_transport",
    {
      request_id: "e2e-session-rack-piano-segment",
      action: "play_range",
      start_beat: 8,
      end_beat: 40
    }
  ] as const)
  await expect(piano).toHaveAttribute("data-current-segment-id", "clip-electric-keys")
  await expect(piano).toHaveAttribute("data-activity", "muted")
  await expect(piano).toHaveAttribute("data-muted", "true")
  await expect(piano).toHaveAttribute("data-playing-now", "false")
  await expect(drums).toHaveAttribute("data-playing-now", "true")
  await expect(metronome).toHaveAttribute("data-playing-now", "true")

  const inspected = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      {
        code: `async () => {
          const instruments = await codemode.getInstruments({});
          return {
            representation: instruments.representation,
            project_revision: instruments.project_revision,
            transport: instruments.transport,
            instruments: instruments.instruments.map((item) => ({
              instrument_id: item.instrument_id,
              activity: item.activity,
              playing_now: item.playing_now,
              current_segment: item.current_segment === null ? null : {
                track_id: item.current_segment.track_id,
                clip_id: item.current_segment.clip_id
              }
            }))
          };
        }`
      }
    ] as const)
  ) as {
    result: {
      representation: string
      project_revision: number
      transport: {
        musical_playback_running: boolean
        shared_click_running: boolean
      }
      instruments: Array<{
        instrument_id: string
        activity: string
        playing_now: boolean
        current_segment: null | { track_id: string; clip_id: string }
      }>
    }
  }
  expect(inspected.result).toMatchObject({
    representation: "derived_session_instrument_projection",
    project_revision: beforeMix.revision + 1,
    transport: {
      musical_playback_running: true,
      shared_click_running: true
    },
    instruments: [
      {
        instrument_id: "piano",
        activity: "muted",
        playing_now: false,
        current_segment: {
          track_id: "track-electric-keys",
          clip_id: "clip-electric-keys"
        }
      },
      { instrument_id: "drums", activity: "playing_now", playing_now: true },
      { instrument_id: "metronome", activity: "playing_now", playing_now: true }
    ]
  })

  await page.getByRole("button", { name: "TAB MODE" }).click()
  await expect(page).toHaveURL(/\/\?mode=tab&song=afterglow$/)
  await page.getByRole("button", { name: "STUDIO MODE" }).click()
  await expect(page).toHaveURL(/\/\?mode=daw&song=afterglow$/)
  const whileDaw = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      {
        code: `async () => {
          const instruments = await codemode.getInstruments({});
          return instruments.instruments.map((item) => [item.instrument_id, item.activity]);
        }`
      }
    ] as const)
  ) as { result: Array<[string, string]> }
  expect(whileDaw.result).toEqual([
    ["piano", "muted"],
    ["drums", "playing_now"],
    ["metronome", "playing_now"]
  ])
  await page.getByRole("button", { name: "SESSION MODE" }).click()
  await expect(page).toHaveURL(/\/\?mode=session&song=afterglow$/)

  await expect(cards).toHaveCount(3)
  await expect(piano).toHaveAttribute("data-current-segment-id", "clip-electric-keys")
  await expect(piano).toHaveAttribute("data-activity", "muted")
  await expect(drums).toHaveAttribute("data-playing-now", "true")
  await expect(metronome).toHaveAttribute("data-playing-now", "true")

  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-session-rack-cleanup-pause", action: "pause" }
  ] as const)
})

test("a human-started browser take can be stopped by MCP and is omitted from share links", async ({
  page,
  context
}) => {
  await page.addInitScript(() => {
    const telemetry = { getUserMediaCalls: 0, stoppedTracks: 0 }
    const track = {
      stop: () => {
        telemetry.stoppedTracks += 1
      }
    }
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track]
    } as unknown as MediaStream

    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported = () => true
      readonly mimeType = "audio/wav"
      state: RecordingState = "inactive"

      constructor(readonly stream: MediaStream) {
        super()
      }

      start() {
        this.state = "recording"
      }

      stop() {
        const sampleCount = 4_410
        const bytes = new ArrayBuffer(44 + sampleCount * 2)
        const view = new DataView(bytes)
        const ascii = (offset: number, value: string) => {
          for (let index = 0; index < value.length; index += 1) {
            view.setUint8(offset + index, value.charCodeAt(index))
          }
        }
        ascii(0, "RIFF")
        view.setUint32(4, 36 + sampleCount * 2, true)
        ascii(8, "WAVE")
        ascii(12, "fmt ")
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, 1, true)
        view.setUint32(24, 44_100, true)
        view.setUint32(28, 88_200, true)
        view.setUint16(32, 2, true)
        view.setUint16(34, 16, true)
        ascii(36, "data")
        view.setUint32(40, sampleCount * 2, true)
        const data = new Event("dataavailable")
        Object.defineProperty(data, "data", { value: new Blob([bytes], { type: "audio/wav" }) })
        this.dispatchEvent(data)
        this.state = "inactive"
        this.dispatchEvent(new Event("stop"))
      }
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          telemetry.getUserMediaCalls += 1
          return stream
        }
      }
    })
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder
    })
    ;(window as unknown as { recordingTelemetry: typeof telemetry }).recordingTelemetry = telemetry
  })

  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)
  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    summary: { note_count: number; referenced_audio_asset_count: number }
  }

  const armRequestId = `recording-arm-${Date.now()}`
  const armed = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      {
        code: `async () => await codemode.recordTake({
          action: "prepare",
          request_id: "${armRequestId}",
          expected_recording_revision: 1,
          name: "Phone practice take",
          count_in_bars: 1
        })`
      }
    ] as const)
  ) as {
    status: string
    result: {
      recording_revision: number
      human_action_required: boolean
      raw_audio_shared: boolean
      count_in_beats: number
    }
  }
  expect(armed).toMatchObject({
    status: "completed",
    result: {
      recording_revision: 2,
      human_action_required: true,
      raw_audio_shared: false,
      count_in_beats: 4
    }
  })
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { recordingTelemetry: { getUserMediaCalls: number } }).recordingTelemetry
          .getUserMediaCalls
    )
  ).toBe(0)

  await expect(page.getByTestId("recording-console")).toBeVisible()
  await expect(page.getByTestId("recording-state")).toHaveText("ARMED")
  await page.getByTestId("browser-recording-control").click()
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { recordingTelemetry: { getUserMediaCalls: number } }).recordingTelemetry
              .getUserMediaCalls
        ),
      { timeout: 5_000 }
    )
    .toBe(1)

  await expect(page.getByTestId("recording-state")).toContainText("COUNT-IN")
  await expect(page.getByTestId("recording-state")).toHaveText("● RECORDING", { timeout: 5_000 })

  const active = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      { code: "async () => await codemode.getSession({})" }
    ] as const)
  ) as {
    status: string
    result: {
      recording_revision: number
      recording: { status: string; count_in_remaining: number }
      raw_audio_shared: boolean
    }
  }
  expect(active).toMatchObject({
    status: "completed",
    result: {
      recording: { status: "recording", count_in_remaining: 0 },
      raw_audio_shared: false
    }
  })
  expect(JSON.stringify(active)).not.toContain("blob:")
  expect(JSON.stringify(active)).not.toContain("data:audio")

  const stopRequestId = `recording-stop-${Date.now()}`
  const stopCode = `async () => await codemode.recordTake({
    action: "stop",
    request_id: "${stopRequestId}",
    expected_recording_revision: ${active.result.recording_revision},
    expected_revision: ${before.revision}
  })`
  const stopped = JSON.parse(await page.evaluate(executeTool, ["codemode", { code: stopCode }] as const)) as {
    status: string
    result: {
      replayed: boolean
      project_revision: number
      raw_audio_shared: boolean
      share_links_include_take: boolean
      take: { name: string; byte_length: number }
    }
  }
  expect(stopped).toMatchObject({
    status: "completed",
    result: {
      replayed: false,
      project_revision: before.revision + 1,
      raw_audio_shared: false,
      share_links_include_take: false,
      take: { name: "Phone practice take" }
    }
  })
  expect(stopped.result.take.byte_length).toBeGreaterThan(44)
  expect(JSON.stringify(stopped)).not.toContain("blob:")
  expect(JSON.stringify(stopped)).not.toContain("data:audio")
  expect(JSON.stringify(stopped)).not.toContain("asset_id")

  const replay = JSON.parse(await page.evaluate(executeTool, ["codemode", { code: stopCode }] as const)) as {
    result: { replayed: boolean; project_revision: number }
  }
  expect(replay.result).toMatchObject({
    replayed: true,
    project_revision: stopped.result.project_revision
  })

  const afterRecording = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    summary: { note_count: number; referenced_audio_asset_count: number }
  }
  expect(afterRecording).toMatchObject({
    revision: before.revision + 1,
    summary: {
      note_count: before.summary.note_count,
      referenced_audio_asset_count: 1
    }
  })

  const shareRequestId = `recording-share-${Date.now()}`
  const share = JSON.parse(
    await page.evaluate(executeTool, [
      "codemode",
      {
        code: `async () => await codemode.shareSession({
          request_id: "${shareRequestId}",
          expected_revision: ${afterRecording.revision}
        })`
      }
    ] as const)
  ) as {
    status: string
    result: {
      url: string
      omitted_audio_asset_count: number
      raw_audio_shared: boolean
      note_count: number
    }
  }
  expect(share).toMatchObject({
    status: "completed",
    result: {
      omitted_audio_asset_count: 1,
      raw_audio_shared: false,
      note_count: before.summary.note_count
    }
  })
  expect(JSON.stringify(share).length).toBeLessThanOrEqual(1_500)
  await expect(page.getByTestId("studio-share-link")).toHaveAttribute("href", share.result.url)

  const shareId = new URL(share.result.url).searchParams.get("share")
  if (shareId === null) throw new Error("Share receipt did not contain a share ID.")
  const stored = await page.request.get(new URL(`/api/studio-shares/${shareId}`, share.result.url).toString())
  const storedText = await stored.text()
  expect(stored.ok()).toBe(true)
  expect(storedText).not.toContain("blob:")
  expect(storedText).not.toContain("data:audio")
  expect(storedText).not.toContain("recording-")

  const sharedPage = await context.newPage()
  await sharedPage.goto(share.result.url)
  await waitForStudioTools(sharedPage)
  await expect
    .poll(
      async () => {
        const sharedMidi = JSON.parse(
          await sharedPage.evaluate(executeTool, ["get_studio_midi", {}] as const)
        ) as { revision: number }
        return sharedMidi.revision
      },
      {
        message: "the asynchronous share import reaches its committed project revision",
        timeout: 15_000
      }
    )
    .toBe(2)
  const sharedMidi = JSON.parse(await sharedPage.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    summary: { note_count: number; referenced_audio_asset_count: number }
  }
  expect(sharedMidi).toMatchObject({
    revision: 2,
    summary: {
      note_count: before.summary.note_count,
      referenced_audio_asset_count: 0
    }
  })
  await sharedPage.close()
})

test("recording and share controls stay touch-sized inside the phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)
  await page.getByRole("button", { name: "TAKE LANES" }).click()
  await expect(page.getByTestId("recording-console")).toBeVisible()

  const measurements = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (element === null) throw new Error(`Missing ${selector}`)
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height, right: box.right, left: box.left }
    }
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      record: bounds('[data-testid="browser-recording-control"]'),
      share: bounds('[data-testid="create-share-link"]'),
      takeTab: bounds(".studio-footer button.active"),
      console: bounds('[data-testid="recording-console"]')
    }
  })

  expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth)
  expect(measurements.record.height).toBeGreaterThanOrEqual(44)
  expect(measurements.share.height).toBeGreaterThanOrEqual(44)
  expect(measurements.takeTab.height).toBeGreaterThanOrEqual(44)
  expect(measurements.console.left).toBeGreaterThanOrEqual(0)
  expect(measurements.console.right).toBeLessThanOrEqual(measurements.viewportWidth)

  await page.getByTestId("create-share-link").click()
  await expect(page.getByTestId("studio-share-link")).toBeVisible()
  await expect(page.getByTestId("studio-share-link")).toHaveAttribute(
    "href",
    /\/\?mode=daw&song=korobeiniki&share=share_[a-f0-9]+$/
  )
})

test("Tab and Studio modes share one MCP-controlled MIDI lesson on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/?mode=tab&song=afterglow")
  await waitForStudioTools(page)
  await expect(page.locator("daw-editor")).toHaveCount(1)
  await page.locator("daw-editor").evaluate((editor) => {
    editor.setAttribute("data-mode-persistent-transport", "tab-origin")
  })

  await expect(page.getByTestId("instrument-learning-app")).toBeVisible()
  await expect(page.getByTestId("guitar-tab")).toBeVisible()
  await expect(page.getByTestId("guitar-tab")).toHaveAttribute(
    "data-notation-semantics",
    "musicxml_4_0_guitar_subset"
  )
  await expect(page.getByTestId("notation-svg").locator("svg")).toBeVisible()
  await expect(page.locator(".vf-stavenote").first()).toBeVisible()
  await expect(page.locator(".vf-tabnote").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "TAB MODE" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("1 MCP TOOL", { exact: true })).toHaveCount(0)
  await expect(page.getByText("CATALOG POLICY", { exact: true })).toHaveCount(0)
  await expect(page.getByText("ORIGINAL OR CLEARED MATERIAL", { exact: true })).toHaveCount(0)
  await expect(page.getByTestId("lesson-provenance")).toHaveAccessibleName(/Rights:/)

  const midiBefore = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    project_id: string
    revision: number
    tempo_map: Array<{ bpm: number }>
    summary: { note_count: number }
  }
  const tabBefore = JSON.parse(await page.evaluate(executeTool, ["get_tab_lesson", {}] as const)) as {
    project_id: string
    project_revision: number
    lesson_revision: number
    source_track: { track_id: string }
    range: { start_beat: number; end_beat: number }
    events: Array<{ note_id: string; duration_beats: number }>
    notation: {
      semantics: string
      timing_authority: string
      measures: Array<{
        slots: Array<{ kind: string; event_ids?: string[] }>
      }>
      summary: { event_reference_count: number; quantized_slot_count: number }
    }
    summary: { event_count: number; returned_event_count: number }
    representation: string
  }
  expect(tabBefore).toMatchObject({
    project_id: midiBefore.project_id,
    project_revision: midiBefore.revision,
    representation: "derived_from_canonical_midi"
  })
  expect(tabBefore.summary.event_count).toBeGreaterThan(0)
  expect(tabBefore.summary.returned_event_count).toBeLessThanOrEqual(192)
  expect(tabBefore.notation).toMatchObject({
    semantics: "musicxml_4_0_guitar_subset",
    timing_authority: "canonical_midi_events",
    summary: {
      event_reference_count: tabBefore.events.length,
      quantized_slot_count: 0
    }
  })
  const notationEventIds = tabBefore.notation.measures.flatMap((measure) =>
    measure.slots.flatMap((slot) => slot.event_ids ?? [])
  )
  expect(new Set(notationEventIds)).toEqual(new Set(tabBefore.events.map((event) => event.note_id)))

  const configured = JSON.parse(
    await page.evaluate(executeTool, [
      "configure_tab_lesson",
      {
        request_id: "e2e-configure-phone-tab",
        expected_lesson_revision: tabBefore.lesson_revision,
        instrument: "guitar",
        tuning: "standard",
        track_id: tabBefore.source_track.track_id,
        start_beat: tabBefore.range.start_beat,
        end_beat: Math.min(tabBefore.range.end_beat, tabBefore.range.start_beat + 8),
        hand_position: 5,
        max_fret: 24
      }
    ] as const)
  ) as { lesson_revision: number; hand_position: number; project_revision: number }
  expect(configured).toMatchObject({
    lesson_revision: tabBefore.lesson_revision + 1,
    hand_position: 5,
    project_revision: midiBefore.revision
  })
  await expect(page.getByText("FRET 5", { exact: true })).toBeVisible()

  const phoneLayout = await page.evaluate(() => {
    const play = document.querySelector<HTMLElement>('.learning-transport button[aria-label="Play lesson"]')
    const tab = document.querySelector<HTMLElement>("[data-testid=guitar-tab]")
    if (play === null || tab === null) throw new Error("Missing phone lesson controls")
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      playHeight: play.getBoundingClientRect().height,
      tabWiderThanViewport: tab.scrollWidth > window.innerWidth
    }
  })
  expect(phoneLayout.documentWidth).toBeLessThanOrEqual(phoneLayout.viewportWidth)
  expect(phoneLayout.playHeight).toBeGreaterThanOrEqual(44)
  expect(phoneLayout.tabWiderThanViewport).toBe(true)

  const dawMode = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_mode",
      {
        request_id: "e2e-open-daw-mode",
        expected_lesson_revision: configured.lesson_revision,
        mode: "daw"
      }
    ] as const)
  ) as { lesson_revision: number; mode: string; music_changed: boolean }
  expect(dawMode).toMatchObject({ mode: "daw", music_changed: false })
  await expect(page).toHaveURL(/\/\?mode=daw&song=afterglow$/)
  await expect(page.locator(".studio-shell")).toBeVisible()
  await expect(page.getByRole("button", { name: "STUDIO MODE" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator('daw-editor[data-mode-persistent-transport="tab-origin"]')).toBeVisible()

  const midiInDaw = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", {}] as const)
  ) as typeof midiBefore
  expect(midiInDaw).toEqual(midiBefore)

  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /audio engine ready$/)
  const dawPlaybackStart = tabBefore.range.start_beat + 2
  await page.evaluate(executeTool, [
    "control_learning_transport",
    {
      request_id: "e2e-play-daw-before-tab",
      action: "play_range",
      start_beat: dawPlaybackStart,
      end_beat: dawPlaybackStart + 1
    }
  ] as const)
  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-stop-daw-before-tab", action: "stop" }
  ] as const)

  const tabMode = JSON.parse(
    await page.evaluate(executeTool, [
      "set_learning_mode",
      {
        request_id: "e2e-return-tab-mode",
        expected_lesson_revision: dawMode.lesson_revision,
        mode: "tab"
      }
    ] as const)
  ) as { lesson_revision: number }
  await expect(page).toHaveURL(/\/\?mode=tab&song=afterglow$/)
  await expect(page.getByTestId("instrument-learning-app")).toBeVisible()
  await expect(page.getByText("FRET 5", { exact: true })).toBeVisible()
  await expect(page.locator(".lesson-playhead strong")).toHaveText(dawPlaybackStart.toFixed(2))
  await expect(page.locator('daw-editor[data-mode-persistent-transport="tab-origin"]')).toHaveCount(1)

  await page.locator(".notation-hit-target").nth(1).click()
  await expect(page.locator(".lesson-playhead strong")).toHaveText(
    (tabBefore.range.start_beat + 0.5).toFixed(2)
  )
  await expect(page.locator(".notation-hit-target").nth(1)).toHaveClass(/active/)

  const seekBeat = tabBefore.range.start_beat + 1
  const seek = JSON.parse(
    await page.evaluate(executeTool, [
      "control_learning_transport",
      { request_id: "e2e-seek-tab", action: "seek", beat: seekBeat }
    ] as const)
  ) as { accepted: boolean; status: string; playhead_beat: number }
  expect(seek).toMatchObject({ accepted: true, status: "paused", playhead_beat: seekBeat })

  const played = JSON.parse(
    await page.evaluate(executeTool, [
      "control_learning_transport",
      {
        request_id: "e2e-play-tab-range",
        action: "play_range",
        start_beat: seekBeat,
        end_beat: seekBeat + 2
      }
    ] as const)
  ) as { accepted: boolean; status: string; shared_engine: string }
  expect(played).toMatchObject({ accepted: true, status: "playing", shared_engine: "canonical_daw" })
  await expect
    .poll(() =>
      page
        .locator("daw-editor")
        .evaluate((editor) => (editor as unknown as { currentTime: number }).currentTime)
    )
    .toBeGreaterThan((seekBeat * 60) / midiBefore.tempo_map[0]!.bpm)

  await page.evaluate(executeTool, [
    "control_learning_transport",
    { request_id: "e2e-pause-tab-range", action: "pause" }
  ] as const)
  await expect(page.getByRole("button", { name: "Play lesson" })).toBeVisible()
  expect(tabMode.lesson_revision).toBe(dawMode.lesson_revision + 1)
})

test("public Code Mode MCP adds drums and loops them through the package transport", async ({ page }) => {
  await page.goto("/?mode=session")
  await waitForStudioTools(page)

  const emptyMidi = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    summary: { note_count: number }
  }
  const added = await runCodeMode<{
    project_revision: number
    lesson_revision: number
    notes_written: number
    midi_channel: number
    visible_mode: string
  }>(
    page,
    `async () => await codemode.addDrumBeat({ request_id: "e2e-add-drums-before-loop", expected_revision: ${emptyMidi.revision}, bars: 1 })`
  )
  expect(added).toMatchObject({
    project_revision: emptyMidi.revision + 1,
    midi_channel: 10,
    visible_mode: "daw"
  })
  expect(added.notes_written).toBeGreaterThan(0)
  await expect(page).toHaveURL(/\?mode=daw$/)
  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /audio engine ready$/)

  const midiWithDrums = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    tempo_map: Array<{ bpm: number }>
    summary: { note_count: number }
    tracks: unknown[]
  }
  const lessonBefore = await runCodeMode<{
    lesson_revision: number
    transport: {
      loop_enabled: boolean
      loop_start_beat: number
      loop_end_beat: number
    }
  }>(page, "async () => await codemode.getSession({})")
  expect(lessonBefore.lesson_revision).toBe(added.lesson_revision)
  const loopStartBeat = 0
  const loopEndBeat = 1

  const enabled = await runCodeMode<{
    action: string
    lesson_revision: number
    loop_enabled: boolean
    loop_start_beat: number
    loop_end_beat: number
    project_revision: number
    music_changed: boolean
    shared_engine: string
  }>(
    page,
    `async () => await codemode.controlTransport({ request_id: "e2e-enable-package-loop", expected_lesson_revision: ${lessonBefore.lesson_revision}, action: "set_loop", enabled: true, start_beat: ${loopStartBeat}, end_beat: ${loopEndBeat} })`
  )
  expect(enabled).toMatchObject({
    action: "set_loop",
    lesson_revision: lessonBefore.lesson_revision + 1,
    loop_enabled: true,
    loop_start_beat: loopStartBeat,
    loop_end_beat: loopEndBeat,
    project_revision: midiWithDrums.revision,
    music_changed: false,
    shared_engine: "canonical_daw"
  })
  const replayedEnable = await runCodeMode<{ lesson_revision: number; loop_enabled: boolean }>(
    page,
    `async () => await codemode.controlTransport({ request_id: "e2e-enable-package-loop", expected_lesson_revision: ${lessonBefore.lesson_revision}, action: "set_loop", enabled: true, start_beat: ${loopStartBeat}, end_beat: ${loopEndBeat} })`
  )
  expect(replayedEnable).toMatchObject({
    lesson_revision: enabled.lesson_revision,
    loop_enabled: true
  })
  await expect(page.getByTestId("transport-loop-toggle")).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator("daw-editor").locator(".transport-loop-range").first()).toBeAttached()

  const lessonWithLoop = await runCodeMode<typeof lessonBefore>(
    page,
    "async () => await codemode.getSession({})"
  )
  expect(lessonWithLoop.transport).toEqual({
    loop_enabled: true,
    loop_start_beat: loopStartBeat,
    loop_end_beat: loopEndBeat
  })

  await runCodeMode(
    page,
    'async () => await codemode.controlTransport({ request_id: "e2e-play-package-loop", action: "play" })'
  )

  const bpm = midiWithDrums.tempo_map[0]!.bpm
  const loopStartSeconds = (loopStartBeat * 60) / bpm
  const loopEndSeconds = (loopEndBeat * 60) / bpm
  const wrapObservation = await page.locator("daw-editor").evaluate(
    async (editor, range) => {
      const daw = editor as unknown as { currentTime: number; isPlaying: boolean }
      let previous = daw.currentTime
      let maximum = previous
      let wrapped = false
      const deadline = performance.now() + 2_500
      while (performance.now() < deadline && !wrapped) {
        await new Promise((resolve) => window.setTimeout(resolve, 25))
        const current = daw.currentTime
        maximum = Math.max(maximum, current)
        if (previous - current > Math.max(0.06, (range.end - range.start) * 0.2)) wrapped = true
        previous = current
      }
      return { wrapped, maximum, current: daw.currentTime, isPlaying: daw.isPlaying }
    },
    { start: loopStartSeconds, end: loopEndSeconds }
  )
  expect(wrapObservation.maximum).toBeGreaterThan(
    loopStartSeconds + (loopEndSeconds - loopStartSeconds) * 0.35
  )
  expect(wrapObservation.wrapped).toBe(true)
  expect(wrapObservation.isPlaying).toBe(true)
  expect(wrapObservation.current).toBeLessThan(loopEndSeconds)

  const midiAfter = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    summary: { note_count: number }
    tracks: unknown[]
  }
  expect(midiAfter.revision).toBe(midiWithDrums.revision)
  expect(midiAfter.summary.note_count).toBe(midiWithDrums.summary.note_count)
  expect(midiAfter.tracks).toEqual(midiWithDrums.tracks)

  const disabled = await runCodeMode<{ loop_enabled: boolean; lesson_revision: number }>(
    page,
    `async () => await codemode.controlTransport({ request_id: "e2e-disable-package-loop", expected_lesson_revision: ${enabled.lesson_revision}, action: "set_loop", enabled: false, start_beat: ${loopStartBeat}, end_beat: ${loopEndBeat} })`
  )
  expect(disabled).toMatchObject({
    loop_enabled: false,
    lesson_revision: enabled.lesson_revision + 1
  })
  await expect(page.getByTestId("transport-loop-toggle")).toHaveAttribute("aria-pressed", "false")
  await runCodeMode(
    page,
    'async () => await codemode.controlTransport({ request_id: "e2e-stop-package-loop", action: "stop" })'
  )
})

test("Session, Tab, and Studio keep one stable outer mode shell", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/?mode=tab&song=afterglow")
  await waitForStudioTools(page)
  await expect(page).toHaveTitle("Tab Mode")

  const modeShell = page.getByTestId("learning-mode-shell")
  const measureShell = () =>
    modeShell.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom }
    })

  await expect(modeShell).toBeVisible()
  await expect(modeShell.locator(".learning-brand")).toHaveCount(0)
  await expect(modeShell).not.toContainText(["SIGNAL", "LESSONS"].join(" "))
  await expect(modeShell).not.toContainText("DAW")
  await expect(modeShell).toContainText("STUDIO")
  await expect(modeShell.locator(".learning-mode-switch")).toHaveCount(1)
  await expect(page.locator(".learning-mode-surface .learning-mode-switch")).toHaveCount(0)
  await expect(page.locator(".lesson-setup")).not.toContainText(/LESSON \d/)
  await expect(page.getByRole("button", { name: "TAB MODE" })).toHaveAttribute("aria-pressed", "true")

  const tabShell = await measureShell()
  expect(tabShell.top).toBe(0)

  await page.getByRole("button", { name: "STUDIO MODE" }).click()
  await expect(page).toHaveURL(/\/\?mode=daw&song=afterglow$/)
  await expect(page).toHaveTitle("Studio Mode")
  await expect(page.locator(".studio-shell")).toBeVisible()
  await expect(page.locator(".studio-topbar .learning-mode-switch")).toHaveCount(0)
  await expect(page.locator(".magic-sigil")).toHaveCount(0)
  await expect(page.locator(".bottom-panel-copy")).toHaveCount(0)
  await expect(page.locator(".magic-copy")).not.toContainText("MAGIC BAR")

  const dawShell = await measureShell()
  const dawToolbarTop = await page
    .locator(".studio-topbar")
    .evaluate((element) => element.getBoundingClientRect().top)
  expect(dawShell).toEqual(tabShell)
  expect(dawToolbarTop).toBeGreaterThanOrEqual(dawShell.bottom - 1)

  await page.getByRole("button", { name: "SESSION MODE" }).click()
  await expect(page).toHaveURL(/\/\?mode=session&song=afterglow$/)
  await expect(page).toHaveTitle("Session Mode")
  await expect(page.getByTestId("session-mode")).toBeVisible()
  await expect(page.locator(".session-instrument-card")).toHaveCount(3)
  await expect(page.getByTestId("session-mode")).not.toContainText("No mapped MIDI segment")
  await expect(page.getByTestId("session-mode")).not.toContainText("No upcoming segment")
  expect(await measureShell()).toEqual(tabShell)

  const modeButtonHeights = await modeShell
    .locator("button")
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height))
  expect(modeButtonHeights.every((height) => height >= 44)).toBe(true)

  const sessionPhoneAudit = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    controlHeights: Array.from(
      document.querySelectorAll<HTMLElement>(".session-stage button, .session-stage input")
    ).map((control) => control.getBoundingClientRect().height),
    cardWidths: Array.from(document.querySelectorAll<HTMLElement>(".session-instrument-card")).map(
      (card) => card.getBoundingClientRect().width
    )
  }))
  expect(sessionPhoneAudit.documentWidth).toBeLessThanOrEqual(sessionPhoneAudit.viewportWidth)
  expect(sessionPhoneAudit.controlHeights.every((height) => height >= 44)).toBe(true)
  expect(
    sessionPhoneAudit.cardWidths.every((width) => width > 0 && width <= sessionPhoneAudit.viewportWidth)
  ).toBe(true)
})

test("Karaoke becomes playable when native WebMCP registers tools but rejects in-page discovery", async ({
  page
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await page.addInitScript(() => {
    const registered = new Map<
      string,
      {
        readonly name: string
        readonly execute: (input: Record<string, unknown>) => PromiseLike<unknown>
      }
    >()
    const modelContext = new EventTarget() as EventTarget & {
      registerTool: (
        tool: {
          readonly name: string
          readonly execute: (input: Record<string, unknown>) => PromiseLike<unknown>
        },
        options?: { readonly signal?: AbortSignal }
      ) => Promise<void>
      getTools: () => Promise<never>
      executeTool: (tool: { readonly name: string }, input: Record<string, unknown>) => Promise<string>
    }
    modelContext.registerTool = async (tool, options) => {
      registered.set(tool.name, tool)
      options?.signal?.addEventListener("abort", () => registered.delete(tool.name), { once: true })
    }
    modelContext.getTools = async () => {
      throw new Error("Page-owned discovery is unavailable")
    }
    modelContext.executeTool = async (tool, input) => {
      const registeredTool = registered.get(tool.name)
      if (registeredTool === undefined) throw new Error(`Missing ${tool.name}`)
      const output = await registeredTool.execute(input)
      return typeof output === "string" ? output : JSON.stringify(output ?? null)
    }
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext })
    Object.defineProperty(window, "registeredStudioToolNames", {
      configurable: true,
      get: () => [...registered.keys()]
    })
  })

  await page.goto("/karaoke.html?song=afterglow")

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              readonly registeredStudioToolNames: ReadonlyArray<string>
            }
          ).registeredStudioToolNames.length
      )
    )
    .toBe(1)
  await expect(page.locator(".agent-link")).toContainText("CONNECTED")
  await expect(page.getByText("AFTERGLOW CALLING", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Play karaoke" })).toBeEnabled({ timeout: 15_000 })
  expect(pageErrors).not.toContain("Failed to discover WebMCP tools")
})

test("Karaoke plays the canonical Studio composition across the full-page handoff", async ({ page }) => {
  test.setTimeout(45_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const telemetry = { bufferStarts: 0 }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...arguments_) {
      telemetry.bufferStarts += 1
      return start.apply(this, arguments_)
    }
    ;(window as unknown as { karaokeDawTelemetry: typeof telemetry }).karaokeDawTelemetry = telemetry
  })

  await page.goto("/karaoke.html?song=afterglow")
  await waitForStudioTools(page)
  await expect(page.getByText("AFTERGLOW CALLING", { exact: true })).toBeVisible()

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    project_id: string
    revision: number
    summary: { midi_track_count: number; note_count: number }
  }
  expect(before.summary).toMatchObject({ midi_track_count: 7, note_count: 671 })

  const composed = JSON.parse(
    await page.evaluate(executeTool, [
      "compose_studio",
      {
        code: `async () => {
          const studio = await codemode.getStudioContext({});
          const notes = Array.from({ length: 52 }, (_, index) => ({
            pitch: 60 + (index % 8),
            start_beat: studio.selection.start_beat + index * 0.25,
            duration_beats: 0.2,
            velocity: 88
          }));
          return await codemode.writeTracks({
            request_id: "compose-before-daw-handoff",
            expected_revision: studio.revision,
            mode: "append",
            basis: { kind: "original" },
            tracks: [
              { name: "Phone Chords", instrument: "warm_pad", notes },
              { name: "Phone Arp", instrument: "saw_lead", notes },
              { name: "Phone Bass", instrument: "finger_bass", notes },
              { name: "Phone Sparkle", instrument: "electric_piano", notes }
            ]
          });
        }`
      }
    ] as const)
  ) as { status: string; revision: number; tracks_created: number; notes_written: number }
  expect(composed).toMatchObject({ status: "committed", tracks_created: 4, notes_written: 208 })

  const composedSnapshot = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", {}] as const)
  ) as typeof before
  expect(composedSnapshot).toMatchObject({
    project_id: before.project_id,
    revision: composed.revision,
    summary: { midi_track_count: 11, note_count: 879 }
  })
  await expect(page.locator(".karaoke-audio-engine")).toHaveAttribute("data-track-count", "11")
  await expect.poll(() => page.locator("daw-editor daw-track").count()).toBe(11)

  const karaokeEditorStart = await page
    .locator("daw-editor")
    .evaluate((editor) => (editor as unknown as { currentTime: number }).currentTime)
  await page.getByRole("button", { name: "Play karaoke" }).click()
  await expect(page.getByRole("button", { name: "Pause karaoke" })).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator("daw-editor")
        .evaluate((editor) => (editor as unknown as { currentTime: number }).currentTime)
    )
    .toBeGreaterThan(karaokeEditorStart + 0.05)
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () => (window as unknown as { karaokeDawTelemetry: { bufferStarts: number } }).karaokeDawTelemetry
          )
          .then(({ bufferStarts }) => bufferStarts),
      { timeout: 2_000 }
    )
    .toBeGreaterThan(0)
  await page.getByRole("button", { name: "Pause karaoke" }).click()

  const persistedSession = await page.evaluate(() =>
    Object.entries(sessionStorage).find(([key]) => key.startsWith("signal-studio:session:"))
  )
  expect(persistedSession?.[1]).toContain("Phone Chords")
  expect(persistedSession?.[1]).not.toContain("blob:")
  expect(persistedSession?.[1]).not.toContain("data:audio")

  const openStudio = page.getByRole("link", { name: "OPEN STUDIO" })
  await expect(openStudio).toBeVisible()
  const openStudioBounds = await openStudio.boundingBox()
  expect(openStudioBounds?.height).toBeGreaterThanOrEqual(44)
  expect(openStudioBounds?.x).toBeGreaterThanOrEqual(0)
  expect((openStudioBounds?.x ?? 0) + (openStudioBounds?.width ?? 0)).toBeLessThanOrEqual(390)
  await openStudio.click()
  await expect(page).toHaveURL(/\/\?mode=daw&song=afterglow$/)
  await waitForStudioTools(page)

  const dawSnapshot = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", {}] as const)
  ) as typeof before
  expect(dawSnapshot).toMatchObject(composedSnapshot)
  await expect(page.locator(".save-state")).toHaveText(`REV ${composed.revision}`)
  await expect.poll(() => page.locator("daw-editor daw-track").count()).toBe(11)

  await page.evaluate(executeTool, [
    "undo_studio_edit",
    { request_id: "undo-after-daw-handoff", expected_revision: dawSnapshot.revision }
  ] as const)
  const undone = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    summary: { midi_track_count: number; note_count: number }
  }
  expect(undone.summary).toEqual({
    midi_track_count: 7,
    midi_clip_count: 7,
    note_count: 671,
    referenced_audio_asset_count: 0
  })

  await page.goto("/karaoke.html?song=afterglow")
  await waitForStudioTools(page)
  await expect(page.getByRole("button", { name: "Play karaoke" })).toBeEnabled()
  await expect(page.locator(".karaoke-audio-engine")).toHaveAttribute("data-track-count", "7")
  await expect.poll(() => page.locator("daw-editor daw-track").count()).toBe(7)
})

test("Studio contains its timeline and exposes touch-sized controls on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/?mode=daw&song=afterglow")
  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /audio engine ready$/)
  await expect.poll(() => page.locator("daw-editor daw-track").count()).toBeGreaterThan(0)
  await page.getByRole("button", { name: "KARAOKE" }).click()
  await expect(page.locator(".karaoke-console")).toBeVisible()

  const layout = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (element === null) throw new Error(`Missing ${selector}`)
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height }
    }
    const editor = document.querySelector("daw-editor")
    const scrollArea = editor?.shadowRoot?.querySelector<HTMLElement>(".scroll-area")
    const controls = editor?.shadowRoot?.querySelector<HTMLElement>(".controls-viewport")
    if (scrollArea === null || scrollArea === undefined || controls === null || controls === undefined) {
      throw new Error("Missing responsive DAW internals")
    }
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      regions: [
        bounds(".studio-topbar"),
        bounds(".arrangement-toolbar"),
        bounds(".timeline-frame"),
        bounds(".karaoke-console"),
        bounds(".magic-dock"),
        bounds(".studio-footer")
      ],
      play: bounds('.transport button[aria-label="Play"]'),
      stageGuide: bounds(".karaoke-setup button:last-child"),
      timeline: {
        clientWidth: scrollArea.clientWidth,
        scrollWidth: scrollArea.scrollWidth,
        controlsWidth: controls.getBoundingClientRect().width
      }
    }
  })

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.regions.every(({ left, right }) => left >= -1 && right <= layout.viewportWidth + 1)).toBe(
    true
  )
  expect(layout.play.width).toBeGreaterThanOrEqual(44)
  expect(layout.play.height).toBeGreaterThanOrEqual(44)
  expect(layout.stageGuide.height).toBeGreaterThanOrEqual(44)
  expect(layout.timeline.scrollWidth).toBeGreaterThan(layout.timeline.clientWidth)
  expect(layout.timeline.controlsWidth).toBeLessThanOrEqual(120)

  const libraryToggle = page.getByRole("button", { name: "LIBRARY" })
  await expect(libraryToggle).toBeVisible()
  await libraryToggle.click()
  await expect(page.getByRole("button", { name: "Close sound library" }).last()).toBeVisible()
  const drawer = await page.locator(".library-panel.mobile-open").evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right }
  })
  expect(drawer.left).toBeGreaterThanOrEqual(0)
  expect(drawer.right).toBeLessThanOrEqual(390)
})

test("WebMCP stages an exact key change and a browser-local karaoke guide", async ({ page }) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    tracks: Array<{
      track_id: string
      clips: Array<{
        notes: Array<{
          note_id: string
          pitch: number
          start_beat: number
          duration_beats: number
        }>
      }>
    }>
  }
  const original = before.tracks
    .find((track) => track.track_id === "track-piano-lead")!
    .clips[0]!.notes.filter((note) => note.start_beat < 32 && note.start_beat + note.duration_beats > 16)

  const stagedTransposition = JSON.parse(
    await page.evaluate(executeTool, [
      "stage_studio_transposition",
      {
        request_id: "e2e-key-down-three",
        expected_revision: before.revision,
        semitones: -3,
        start_beat: 16,
        end_beat: 32,
        track_ids: ["track-piano-lead"]
      }
    ] as const)
  ) as {
    result: { previewId: string; notesAffected: number; change: string }
    state: { revision: number }
  }
  expect(stagedTransposition.result.change).toBe("midi_transposition_staged")
  expect(stagedTransposition.result.notesAffected).toBeGreaterThan(0)

  const whileStaged = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", {}] as const)
  ) as typeof before & { pending_preview: { kind: string } }
  expect(whileStaged.pending_preview.kind).toBe("midi_transposition")
  expect(
    whileStaged.tracks
      .find((track) => track.track_id === "track-piano-lead")!
      .clips[0]!.notes.filter((note) => note.start_beat < 32 && note.start_beat + note.duration_beats > 16)
  ).toEqual(original)

  const appliedTransposition = JSON.parse(
    await page.evaluate(executeTool, [
      "apply_studio_preview",
      {
        request_id: "e2e-apply-key-down-three",
        expected_revision: stagedTransposition.state.revision,
        preview_id: stagedTransposition.result.previewId
      }
    ] as const)
  ) as { state: { revision: number } }
  const transposed = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", {}] as const)
  ) as typeof before
  expect(
    transposed.tracks
      .find((track) => track.track_id === "track-piano-lead")!
      .clips[0]!.notes.filter((note) => note.start_beat < 32 && note.start_beat + note.duration_beats > 16)
      .map((note) => [note.note_id, note.pitch, note.start_beat, note.duration_beats])
  ).toEqual(original.map((note) => [note.note_id, note.pitch - 3, note.start_beat, note.duration_beats]))

  const stagedGuide = JSON.parse(
    await page.evaluate(executeTool, [
      "stage_karaoke_guide",
      {
        request_id: "e2e-stage-karaoke-guide",
        expected_revision: appliedTransposition.state.revision,
        lyrics: "SING TOGETHER NOW",
        melody_track_id: "track-piano-lead",
        start_beat: 16,
        end_beat: 32,
        title: "Browser Karaoke"
      }
    ] as const)
  ) as {
    result: { previewId: string; guideId: string; tokenCount: number }
    state: { revision: number }
  }
  expect(stagedGuide.result.tokenCount).toBe(3)

  await page.evaluate(executeTool, [
    "apply_studio_preview",
    {
      request_id: "e2e-apply-karaoke-guide",
      expected_revision: stagedGuide.state.revision,
      preview_id: stagedGuide.result.previewId
    }
  ] as const)

  const guide = JSON.parse(await page.evaluate(executeTool, ["get_karaoke_guide", {}] as const)) as {
    microphone_active: boolean
    raw_audio_shared: boolean
    guide: { guide_id: string; tokens: Array<{ text: string; expected_pitch_name: string }> }
  }
  expect(guide.raw_audio_shared).toBe(false)
  expect(guide.microphone_active).toBe(false)
  expect(guide.guide.guide_id).toBe(stagedGuide.result.guideId)
  expect(guide.guide.tokens.map((token) => token.text)).toEqual(["SING", "TOGETHER", "NOW"])
  expect(guide.guide.tokens.every((token) => token.expected_pitch_name.length > 1)).toBe(true)

  await expect(page.getByTestId("karaoke-console")).toContainText("SING")
  await expect(page.getByRole("button", { name: "START SINGING" })).toBeVisible()
  const result = JSON.parse(await page.evaluate(executeTool, ["get_karaoke_result", {}] as const)) as {
    microphone_active: boolean
    raw_audio_shared: boolean
    result: unknown
  }
  expect(result.microphone_active).toBe(false)
  expect(result.raw_audio_shared).toBe(false)
  expect(result.result).toBeNull()
})

test("WebMCP Code Mode queries the complete Studio snapshot but returns only bounded answers", async ({
  page
}) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    mutation_count: number
  }
  const explicit = JSON.parse(
    await page.evaluate(executeTool, [
      "query_studio",
      {
        code: `async () => {
          const midi = await codemode.getStudioMidi({});
          const track = midi.tracks.find((candidate) => candidate.track_id === "track-piano-bass");
          if (!track) return { error: "track_not_found" };
          const notes = track.clips.flatMap((clip) => clip.notes);
          const selected = notes.filter(
            (note) => note.start_beat >= midi.selection.start_beat && note.start_beat < midi.selection.end_beat
          );
          return {
            revision: midi.revision,
            track: { track_id: track.track_id, name: track.name },
            selected_note_count: selected.length,
            first_notes: selected.slice(0, 3).map(({ pitch_name, start_beat, duration_beats }) => ({
              pitch_name,
              start_beat,
              duration_beats
            }))
          };
        }`
      }
    ] as const)
  ) as {
    status: string
    result: {
      revision: number
      track: { track_id: string; name: string }
      selected_note_count: number
      first_notes: Array<{ pitch_name: string }>
    }
    serialized_characters: number
  }

  expect(explicit).toMatchObject({
    status: "completed",
    result: {
      revision: before.revision,
      track: { track_id: "track-piano-bass", name: "Piano Bass" }
    }
  })
  expect(explicit.result.selected_note_count).toBeGreaterThan(0)
  expect(explicit.result.first_notes.length).toBeGreaterThan(0)
  expect(explicit.serialized_characters).toBeLessThanOrEqual(2_500)

  const normalized = JSON.parse(
    await page.evaluate(executeTool, [
      "query_studio",
      {
        code: `const midi = await codemode.getStudioMidi({});
          midi.tracks.map(({ track_id, name }) => ({ track_id, name }))`
      }
    ] as const)
  ) as { status: string; result: Array<{ track_id: string; name: string }> }
  expect(normalized.status).toBe("completed")
  expect(normalized.result).toContainEqual({ track_id: "track-piano-bass", name: "Piano Bass" })

  const oversized = JSON.parse(
    await page.evaluate(executeTool, [
      "query_studio",
      { code: "async () => await codemode.getStudioMidi({})" }
    ] as const)
  ) as { status: string; maximum_characters: number; actual_characters: number }
  expect(oversized).toMatchObject({ status: "result_too_large", maximum_characters: 2_500 })
  expect(oversized.actual_characters).toBeGreaterThan(oversized.maximum_characters)

  const loggedSessionResponse = await page.evaluate(executeTool, [
    "query_studio",
    {
      code: `async () => {
        const midi = await codemode.getStudioMidi({});
        console.log(JSON.stringify(midi));
        throw new Error("deliberate test failure");
      }`
    }
  ] as const)
  const loggedSession = JSON.parse(loggedSessionResponse) as { status: string; message: string }
  expect(loggedSession).toMatchObject({
    status: "execution_error",
    message: expect.stringContaining("deliberate test failure")
  })
  expect(loggedSessionResponse).not.toContain("track-piano-bass")

  const wrongApi = JSON.parse(
    await page.evaluate(executeTool, ["query_studio", { code: "async () => get_studio_midi()" }] as const)
  ) as { status: string; guidance: string }
  expect(wrongApi.status).toBe("execution_error")
  expect(wrongApi.guidance).toContain("codemode.getStudioMidi")

  const after = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    mutation_count: number
  }
  expect(after).toMatchObject(before)
})

test("WebMCP mutations enter XState choreography that Code Mode can inspect", async ({ page }) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)
  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /audio engine ready$/)

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    tempo_map: Array<{ bpm: number }>
  }
  const nextTempo = before.tempo_map[0]!.bpm === 126 ? 127 : 126

  await page.evaluate(executeTool, [
    "set_studio_tempo",
    {
      request_id: "xstate-visible-agent-tempo",
      expected_revision: before.revision,
      bpm: nextTempo
    }
  ] as const)

  const shell = page.locator(".studio-shell")
  await expect(shell).toHaveAttribute("data-presentation-actor", "AGENT")
  await expect(shell).toHaveAttribute("data-presentation-action", "set_tempo")
  await expect(shell).toHaveAttribute("data-presentation-phase", /announcing|animating/)
  await expect(page.getByRole("status").filter({ hasText: "SETTING TEMPO" })).toBeVisible()
  await expect(shell).toHaveAttribute("data-presentation-phase", "settled", { timeout: 3_000 })

  const inspected = JSON.parse(
    await page.evaluate(executeTool, [
      "query_studio",
      {
        code: `async () => {
          const ui = await codemode.getStudioPresentation({});
          return {
            manager: ui.manager,
            surface: ui.surface,
            phase: ui.phase,
            tools_ready: ui.tools_ready,
            transition: ui.transition,
            transport: ui.transport,
            raw_audio_present: Object.hasOwn(ui.microphone, "raw_audio")
          };
        }`
      }
    ] as const)
  ) as {
    status: string
    result: {
      manager: string
      surface: string
      phase: string
      tools_ready: boolean
      transition: {
        actor: string
        action: string
        request_id: string
        revision_before: number
        revision_after: number
      }
      transport: { status: string; playhead_beat: number }
      raw_audio_present: boolean
    }
  }

  expect(inspected).toMatchObject({
    status: "completed",
    result: {
      manager: "xstate-v5",
      surface: "studio",
      phase: "settled",
      tools_ready: true,
      transition: {
        actor: "AGENT",
        action: "set_tempo",
        request_id: "xstate-visible-agent-tempo",
        revision_before: before.revision,
        revision_after: before.revision + 1
      },
      raw_audio_present: false
    }
  })
})

test("WebMCP Code Mode composes chords and arpeggios as one atomic multi-track edit", async ({ page }) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    mutation_count: number
    selection: { start_beat: number; end_beat: number }
    tracks: Array<{ track_id: string; name: string }>
  }

  const failedProgram = JSON.parse(
    await page.evaluate(executeTool, [
      "compose_studio",
      {
        code: `async () => {
          const harmony = await codemode.chords({
            symbols: ["Am7"], start_beat: 0, beats_per_chord: 4
          });
          await codemode.writeTracks({
            request_id: "compose-must-not-partially-write",
            expected_revision: ${before.revision},
            mode: "append",
            basis: { kind: "original" },
            tracks: [{ name: "Must Not Exist", instrument: "warm_pad", notes: harmony.notes }]
          });
          throw new Error("fail after staging");
        }`
      }
    ] as const)
  ) as { status: string; message: string }
  expect(failedProgram).toMatchObject({
    status: "execution_error",
    message: expect.stringContaining("fail after staging")
  })

  const afterFailure = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", {}] as const)
  ) as typeof before
  expect(afterFailure.revision).toBe(before.revision)
  expect(afterFailure.mutation_count).toBe(before.mutation_count)
  expect(afterFailure.tracks.find((track) => track.name === "Must Not Exist")).toBeUndefined()

  const composed = JSON.parse(
    await page.evaluate(executeTool, [
      "compose_studio",
      {
        code: `async () => {
          const studio = await codemode.getStudioContext({});
          const pads = await codemode.listInstruments({ family: "pad" });
          if (!pads.instruments.some((instrument) => instrument.alias === "warm_pad")) {
            throw new Error("warm_pad is unavailable");
          }
          const progression = ["Am7", "Fmaj7", "Cmaj7", "G7"];
          const harmony = await codemode.chords({
            symbols: progression,
            start_beat: 0,
            beats_per_chord: 4,
            octave: 3,
            voicing: "open",
            velocity: 84
          });
          const arp = await codemode.arpeggio({
            symbols: progression,
            start_beat: 0,
            beats_per_chord: 4,
            step_beats: 0.5,
            octave: 4,
            octaves: 2,
            direction: "up_down",
            velocity: 98
          });
          return await codemode.writeTracks({
            request_id: "compose-chords-and-arp",
            expected_revision: studio.revision,
            mode: "append",
            basis: { kind: "original" },
            tracks: [
              {
                name: "Code Chords",
                clip_name: "Am–F–C–G Pad",
                instrument: "warm_pad",
                volume: 0.64,
                pan: -0.15,
                notes: harmony.notes
              },
              {
                name: "Code Arpeggio",
                clip_name: "Eighth-note Up Down",
                instrument: "saw_lead",
                volume: 0.58,
                pan: 0.18,
                notes: arp.notes
              }
            ]
          });
        }`
      }
    ] as const)
  ) as {
    status: string
    revision: number
    tracks_created: number
    notes_written: number
    tracks: Array<{
      track_id: string
      clip_id: string
      track_name: string
      program: number
      channel: number
      notes_written: number
    }>
  }

  expect(composed).toMatchObject({
    status: "committed",
    revision: before.revision + 1,
    tracks_created: 2,
    notes_written: 48,
    tracks: [
      { track_name: "Code Chords", program: 89, channel: 0, notes_written: 16 },
      { track_name: "Code Arpeggio", program: 81, channel: 0, notes_written: 32 }
    ]
  })

  const after = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    mutation_count: number
    selection: { start_beat: number; end_beat: number }
    tracks: Array<{
      track_id: string
      name: string
      mix: { volume: number; pan: number }
      clips: Array<{ program: number; channel: number; notes: unknown[] }>
    }>
  }
  expect(after.revision).toBe(before.revision + 1)
  expect(after.mutation_count).toBe(before.mutation_count + 1)
  expect(after.selection).toEqual(before.selection)
  expect(after.tracks.find((track) => track.name === "Code Chords")).toMatchObject({
    mix: { volume: 0.64, pan: -0.15 },
    clips: [{ program: 89, channel: 0 }]
  })
  expect(after.tracks.find((track) => track.name === "Code Arpeggio")).toMatchObject({
    mix: { volume: 0.58, pan: 0.18 },
    clips: [{ program: 81, channel: 0 }]
  })

  await page.evaluate(executeTool, [
    "undo_studio_edit",
    { request_id: "undo-code-composition", expected_revision: after.revision }
  ] as const)
  const undone = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    tracks: Array<{ name: string }>
  }
  expect(undone.tracks.find((track) => track.name === "Code Chords")).toBeUndefined()
  expect(undone.tracks.find((track) => track.name === "Code Arpeggio")).toBeUndefined()
})

test("WebMCP Code Mode replaces the room with a facts-only original practice bed", async ({ page }) => {
  await page.goto("/karaoke.html")
  await waitForStudioTools(page)

  await expect
    .poll(async () => {
      const document = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
        karaoke_guide: null | { title: string }
      }
      return document.karaoke_guide?.title ?? null
    })
    .toBe("AFTERGLOW CALLING")

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    title: string
    revision: number
    summary: { midi_track_count: number }
  }
  const composed = JSON.parse(
    await page.evaluate(executeTool, [
      "compose_studio",
      {
        code: `async () => {
          const studio = await codemode.getStudioContext({});
          const harmony = await codemode.chords({
            symbols: ["E", "B", "C#m", "A"],
            start_beat: 0,
            beats_per_chord: 4,
            octave: 3,
            voicing: "open",
            velocity: 82
          });
          return await codemode.writeTracks({
            request_id: "e2e-facts-only-practice-bed",
            expected_revision: studio.revision,
            mode: "replace_session",
            basis: {
              kind: "reference_practice_bed",
              reference_title: "Requested Pop Song",
              reference_artist: "Reference Artist",
              approximate_bpm: 99,
              key: "E major",
              meter: { numerator: 4, denominator: 4 },
              harmonic_vocabulary: ["E", "B", "C#m", "A"],
              factual_sources: ["https://example.com/song-facts"],
              arrangement: "new_original_accompaniment",
              excludes: "lyrics_melody_signature_riffs_exact_arrangement_source_notation_or_recordings"
            },
            tracks: [{
              name: "Original Practice Chords",
              clip_name: "New Y2K Voicing",
              instrument: "electric_piano",
              notes: harmony.notes
            }]
          });
        }`
      }
    ] as const)
  ) as {
    status: string
    revision: number
    mode: string
    basis: { kind: string; reference_title: string }
    state: { practice_bed: { reference_title: string } }
  }

  expect(composed).toMatchObject({
    status: "committed",
    revision: before.revision + 1,
    mode: "replace_session",
    basis: { kind: "reference_practice_bed", reference_title: "Requested Pop Song" },
    state: { practice_bed: { reference_title: "Requested Pop Song" } }
  })

  const after = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    schema_version: number
    title: string
    revision: number
    practice_bed: {
      reference_title: string
      approximate_bpm: number
      key: string
      meter: { numerator: number; denominator: number }
      excludes: string
    }
    song: { slug: string; attribution: null }
    tempo_map: Array<{ bpm: number }>
    meter_map: Array<{ numerator: number; denominator: number }>
    summary: { midi_track_count: number; referenced_audio_asset_count: number }
    karaoke_guide: null
  }
  expect(after).toMatchObject({
    schema_version: 6,
    title: "Requested Pop Song · ORIGINAL PRACTICE BED",
    revision: before.revision + 1,
    practice_bed: {
      reference_title: "Requested Pop Song",
      approximate_bpm: 99,
      key: "E major",
      meter: { numerator: 4, denominator: 4 },
      excludes: "lyrics_melody_signature_riffs_exact_arrangement_source_notation_or_recordings"
    },
    song: { slug: "practice-bed", attribution: null },
    tempo_map: [{ bpm: 99 }],
    meter_map: [{ numerator: 4, denominator: 4 }],
    summary: { midi_track_count: 1, referenced_audio_asset_count: 0 },
    karaoke_guide: null
  })
  await expect(page.locator(".engine-state-card")).toContainText("Requested Pop Song")
  await expect(page.locator(".engine-state-card")).toContainText("REFERENCE FACTS → ORIGINAL MIDI")

  const history = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_mutations", { actions: ["compose_midi"] }] as const)
  ) as { mutations: Array<{ input: { mode: string; basis: { reference_title: string } } }> }
  expect(history.mutations.at(-1)?.input).toMatchObject({
    mode: "replace_session",
    basis: { reference_title: "Requested Pop Song" }
  })

  const selected = JSON.parse(
    await page.evaluate(executeTool, [
      "select_studio_beat_range",
      {
        request_id: "select-practice-chorus",
        expected_revision: after.revision,
        start_beat: 8,
        end_beat: 16
      }
    ] as const)
  ) as { result: { revision: number } }
  await page.evaluate(executeTool, [
    "set_karaoke_count_in",
    {
      request_id: "count-in-practice-chorus",
      expected_revision: selected.result.revision,
      beats: 4
    }
  ] as const)

  const play = page.getByRole("button", { name: "Play karaoke" })
  await expect(play).toBeEnabled()
  await play.click()
  await expect(page.locator(".count-in-display")).toContainText("4 BEAT LEAD-IN")
  await expect(page.locator(".count-in-display")).toContainText("BEATS TO SELECTED PASSAGE")
})

test("WebMCP zooms and highlights a passage without changing the music document", async ({ page }) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /1 tool/)
  await waitForStudioTools(page)

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    mutation_count: number
    selection: { start_beat: number; end_beat: number }
  }
  const focused = JSON.parse(
    await page.evaluate(executeTool, [
      "zoom_studio_view",
      {
        start_beat: 40,
        end_beat: 48,
        padding_beats: 1,
        track_ids: ["track-piano-bass"],
        label: "Bass turnaround into C"
      }
    ] as const)
  ) as {
    revision: number
    music_changed: boolean
    selection_changed: boolean
    view: { track_names: string[]; vertical_track_scroll: string }
  }

  expect(focused).toMatchObject({
    revision: before.revision,
    music_changed: false,
    selection_changed: false,
    view: { track_names: ["Piano Bass"], vertical_track_scroll: "center_track_ids" }
  })
  await expect(page.getByTestId("studio-view-focus")).toContainText("Bass turnaround into C")
  await expect(page.getByTestId("studio-view-focus")).toContainText("PIANO BASS")

  await expect
    .poll(() =>
      page.locator("daw-editor").evaluate((editor) => {
        const root = editor.shadowRoot
        const scrollArea = root?.querySelector<HTMLElement>(".scroll-area")
        const selection = (
          editor as HTMLElement & {
            readonly selection: { readonly start: number; readonly end: number } | null
          }
        ).selection
        const bpm = (editor as HTMLElement & { readonly bpm: number }).bpm
        const focusedRow = root?.querySelector<HTMLElement>(".track-row[data-agent-focus-track]")
        const controlsColumn = root?.querySelector<HTMLElement>(".controls-column")
        const scrollTop = scrollArea?.scrollTop ?? 0
        const viewportBottom = scrollTop + (scrollArea?.clientHeight ?? 0)
        return {
          focusedRows: root?.querySelectorAll(".track-row[data-agent-focus-track]").length ?? 0,
          focusedControls: root?.querySelectorAll("daw-track-controls[data-agent-focus-track]").length ?? 0,
          focusRanges: root?.querySelectorAll(".agent-focus-range").length ?? 0,
          scrollLeft: scrollArea?.scrollLeft ?? 0,
          scrollTop,
          verticallyScrollable: (scrollArea?.scrollHeight ?? 0) > (scrollArea?.clientHeight ?? 0),
          focusedRowVisible:
            focusedRow !== null &&
            focusedRow !== undefined &&
            focusedRow.offsetTop >= scrollTop &&
            focusedRow.offsetTop + focusedRow.offsetHeight <= viewportBottom,
          controlsSynchronized:
            scrollTop > 0 && controlsColumn !== null && controlsColumn?.style.transform !== "",
          shellFitsViewport: (() => {
            const shellBounds = document.querySelector<HTMLElement>(".studio-shell")!.getBoundingClientRect()
            const surfaceBounds = document
              .querySelector<HTMLElement>(".learning-mode-surface")!
              .getBoundingClientRect()
            return (
              Math.abs(shellBounds.height - surfaceBounds.height) < 1 &&
              shellBounds.top >= 0 &&
              shellBounds.bottom <= window.innerHeight + 1
            )
          })(),
          hasViewFocus: editor.hasAttribute("data-agent-view-focus"),
          selectionStartBeat: selection === null ? null : (selection.start * bpm) / 60,
          selectionEndBeat: selection === null ? null : (selection.end * bpm) / 60
        }
      })
    )
    .toMatchObject({
      focusedRows: 1,
      focusedControls: 1,
      focusRanges: 1,
      verticallyScrollable: true,
      focusedRowVisible: true,
      controlsSynchronized: true,
      shellFitsViewport: true,
      hasViewFocus: true,
      selectionStartBeat: before.selection.start_beat,
      selectionEndBeat: before.selection.end_beat
    })

  const after = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    mutation_count: number
    selection: { start_beat: number; end_beat: number }
  }
  expect(after).toMatchObject(before)

  await page.getByRole("button", { name: "Clear agent focus" }).click()
  await expect(page.getByTestId("studio-view-focus")).toHaveCount(0)
  await expect
    .poll(() =>
      page.locator("daw-editor").evaluate((editor) => ({
        hasViewFocus: editor.hasAttribute("data-agent-view-focus"),
        focusRanges: editor.shadowRoot?.querySelectorAll(".agent-focus-range").length ?? 0
      }))
    )
    .toEqual({ hasViewFocus: false, focusRanges: 0 })
})

test("the canonical query and legacy song routes load the attributed full MIDI arrangement", async ({
  page
}) => {
  for (const route of ["/?mode=daw&song=korobeiniki", "/studio/korobeiniki", "/studio"] as const) {
    await page.goto(route)
    await waitForStudioTools(page)
    const document = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
      schema_version: number
      project_id: string
      title: string
      song: {
        slug: string
        attribution: { creator: string; license_name: string; source_midi_url: string }
      }
      summary: { midi_track_count: number; midi_clip_count: number; note_count: number }
    }

    expect(document).toMatchObject({
      schema_version: 6,
      project_id: "signal-studio-korobeiniki",
      title: "Korobeiniki // Arcade Pop",
      song: {
        slug: "korobeiniki",
        attribution: {
          creator: "rocavaco",
          license_name: "CC BY 3.0",
          source_midi_url: "/studio-songs/korobeiniki.mid"
        }
      },
      summary: { midi_track_count: 9, midi_clip_count: 9, note_count: 605 }
    })
  }
})

test("Karaoke opens the cleared original Y2K song with an eight-beat chorus count-in", async ({ page }) => {
  await page.goto("/karaoke.html")
  await waitForStudioTools(page)

  const document = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    project_id: string
    title: string
    karaoke_count_in_beats: number
    song: { slug: string; attribution: { license_name: string } }
    summary: { midi_track_count: number; note_count: number; referenced_audio_asset_count: number }
  }
  expect(document).toMatchObject({
    project_id: "signal-studio-afterglow-calling",
    title: "Afterglow Calling // Y2K Pop",
    karaoke_count_in_beats: 8,
    song: { slug: "afterglow", attribution: { license_name: "Project-authored original" } },
    summary: { midi_track_count: 7, note_count: 671, referenced_audio_asset_count: 0 }
  })

  await expect(page.getByRole("link", { name: "01 AFTERGLOW" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByText("AFTERGLOW CALLING", { exact: true })).toBeVisible()
  const roomCanvas = page.getByTestId("karaoke-room-canvas")
  await expect(roomCanvas).toBeVisible()
  const canvasState = await roomCanvas.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    hiddenFromAssistiveTechnology: canvas.getAttribute("aria-hidden")
  }))
  expect(canvasState.width).toBeGreaterThan(0)
  expect(canvasState.height).toBeGreaterThan(0)
  expect(canvasState.hiddenFromAssistiveTechnology).toBe("true")
  expect(
    await page.evaluate(() => {
      const theme = getComputedStyle(globalThis.document.documentElement)
      return {
        ink: theme.getPropertyValue("--room-ink").trim(),
        accent: theme.getPropertyValue("--room-amber").trim(),
        plastic: theme.getPropertyValue("--room-plastic").trim()
      }
    })
  ).toEqual({ ink: "#171411", accent: "#e0a44f", plastic: "#a69b83" })

  await expect
    .poll(async () => {
      const result = JSON.parse(await page.evaluate(executeTool, ["get_karaoke_guide", {}] as const)) as {
        guide: null | {
          title: string
          melody_track_id: string
          start_beat: number
          end_beat: number
          tokens: Array<{ text: string }>
        }
      }
      return result.guide === null
        ? null
        : {
            ...result.guide,
            tokens: result.guide.tokens.slice(0, 4)
          }
    })
    .toMatchObject({
      title: "AFTERGLOW CALLING",
      melody_track_id: "track-guide-melody",
      start_beat: 32,
      end_beat: 48,
      tokens: [{ text: "Stay" }, { text: "in" }, { text: "the" }, { text: "afterglow" }]
    })

  const play = page.getByRole("button", { name: "Play karaoke" })
  await expect(play).toBeEnabled({ timeout: 15_000 })
  await play.click()
  await expect(page.getByText("8 BEAT LEAD-IN", { exact: true })).toBeVisible()
  await expect(page.getByText("BEATS TO CHORUS", { exact: true })).toBeVisible()
})

test("Karaoke explains a missing microphone and exposes the issue to WebMCP", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Requested device not found", "NotFoundError")
        }
      }
    })
  })
  await page.goto("/karaoke.html")
  await waitForStudioTools(page)
  await expect(page.getByText("AFTERGLOW CALLING", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Start microphone" }).click()
  await expect(page.getByRole("alert")).toContainText("No microphone was found")
  await expect(page.getByRole("alert")).toContainText("open Signal Karaoke in Chrome or Edge")
  await expect(page.getByRole("button", { name: "Retry microphone" })).toBeVisible()

  const result = JSON.parse(await page.evaluate(executeTool, ["get_karaoke_result", {}] as const)) as {
    status: string
    microphone_active: boolean
    microphone_issue: string | null
    raw_audio_shared: boolean
  }
  expect(result).toMatchObject({
    status: "error",
    microphone_active: false,
    microphone_issue: "no_input_device",
    raw_audio_shared: false
  })
})

test("Studio keeps its Logic-inspired dark palette and reserves text cursors for editable fields", async ({
  page
}) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /audio engine ready$/)
  await expect.poll(() => page.locator("daw-editor daw-track").count()).toBeGreaterThan(0)
  await page.evaluate(executeTool, [
    "set_studio_track_mix",
    {
      request_id: "e2e-logic-theme-active-controls",
      expected_revision: 1,
      track_id: "track-drums",
      muted: true,
      soloed: true
    }
  ] as const)
  await expect.poll(() => page.locator(".btn.active, .btn.muted-active").count()).toBe(2)

  const audit = await page.evaluate(() => {
    const roots: Array<Document | ShadowRoot> = [document]
    const elements: Element[] = []

    while (roots.length > 0) {
      const root = roots.shift()!
      for (const element of root.querySelectorAll("*")) {
        elements.push(element)
        if (element.shadowRoot !== null) roots.push(element.shadowRoot)
      }
    }

    const cursorViolations = new Set<string>()

    const labelOf = (element: Element) => {
      const id = element.id === "" ? "" : `#${element.id}`
      const classes = Array.from(element.classList)
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join("")
      return `${element.localName}${id}${classes}`
    }

    for (const element of elements) {
      if (element.getClientRects().length === 0) continue
      const style = getComputedStyle(element)
      const inputType = element instanceof HTMLInputElement ? element.type : null
      const acceptsText =
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLElement && element.isContentEditable) ||
        (inputType !== null &&
          ["text", "search", "number", "email", "url", "tel", "password"].includes(inputType))
      if (style.cursor === "text" && !acceptsText) {
        cursorViolations.add(`${labelOf(element)} uses a text cursor`)
      }
    }

    const styleOf = (selector: string) => {
      const element = document.querySelector(selector)
      if (element === null) throw new Error(`Missing ${selector}`)
      const style = getComputedStyle(element)
      return { cursor: style.cursor, userSelect: style.userSelect }
    }

    const rootStyle = getComputedStyle(document.documentElement)
    const editor = document.querySelector("daw-editor")
    if (editor?.shadowRoot === null || editor === null) throw new Error("Missing rendered DAW editor")
    const regions = Array.from(
      editor.shadowRoot.querySelectorAll<HTMLElement>(".clip-container[data-studio-color]")
    )
    const coloredControls = Array.from(
      editor.shadowRoot.querySelectorAll<HTMLElement>("daw-track-controls[data-studio-track-color]")
    )

    return {
      theme: {
        background: rootStyle.getPropertyValue("--studio-bg").trim(),
        panel: rootStyle.getPropertyValue("--studio-panel").trim(),
        accent: rootStyle.getPropertyValue("--studio-accent").trim(),
        play: rootStyle.getPropertyValue("--studio-green").trim(),
        record: rootStyle.getPropertyValue("--studio-red").trim(),
        focus: rootStyle.getPropertyValue("--studio-yellow").trim()
      },
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      regionColors: regions.map((region) => region.style.getPropertyValue("--studio-clip-color").trim()),
      regionBackgrounds: regions.map((region) => getComputedStyle(region).backgroundColor),
      coloredControlCount: coloredControls.length,
      cursorViolations: Array.from(cursorViolations),
      label: styleOf(".panel-title"),
      prompt: styleOf('.magic-copy input[aria-label="Describe the part to create"]'),
      action: styleOf(".ask-button"),
      editor: styleOf("daw-editor")
    }
  })

  expect(audit.theme).toEqual({
    background: "#17191d",
    panel: "#202328",
    accent: "#58a6ff",
    play: "#63c766",
    record: "#ff625f",
    focus: "#f3c84b"
  })
  expect(audit.bodyBackground).toBe("rgb(23, 25, 29)")
  expect(new Set(audit.regionColors).size).toBeGreaterThanOrEqual(8)
  expect(new Set(audit.regionBackgrounds).size).toBeGreaterThanOrEqual(8)
  expect(audit.regionBackgrounds).not.toContain("rgba(0, 0, 0, 0)")
  expect(audit.regionColors).toContain("#f5a44b")
  expect(audit.regionColors).toContain("#4fa3ff")
  expect(audit.coloredControlCount).toBe(9)
  expect(audit.cursorViolations).toEqual([])
  expect(audit.label).toEqual({ cursor: "default", userSelect: "none" })
  expect(audit.prompt).toEqual({ cursor: "text", userSelect: "text" })
  expect(audit.action.cursor).toBe("pointer")
  expect(audit.editor).toEqual({ cursor: "default", userSelect: "none" })
})

test("WebMCP stages, applies, and undoes a visible alternate take", async ({ page }) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /audio engine ready$/)
  await waitForStudioTools(page)
  await expect(page.getByTestId("dawcore-host").locator("daw-editor")).toHaveCount(1)
  await expect
    .poll(() => page.locator("daw-editor daw-track").count(), { message: "seed tracks render in the DAW" })
    .toBe(9)

  const initial = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    summary: { midi_clip_count: number }
  }
  const initialClipCount = initial.summary.midi_clip_count

  const stageResult = JSON.parse(
    await page.evaluate(executeTool, [
      "stage_studio_part",
      {
        request_id: "e2e-stage-lead",
        expected_revision: initial.revision,
        prompt: "Add a bright analog lead hook"
      }
    ] as const)
  ) as { state: { revision: number; pending_preview_id: string } }

  await expect(page.getByTestId("studio-preview")).toBeVisible()
  await expect(page.getByTestId("studio-preview")).toContainText("Lead alternate")

  const staged = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    pending_preview: { preview_id: string; clip: { notes: unknown[] } }
    summary: { midi_clip_count: number }
  }
  expect(staged.summary.midi_clip_count).toBe(initialClipCount)
  expect(staged.pending_preview.preview_id).toBe(stageResult.state.pending_preview_id)
  expect(staged.pending_preview.clip.notes.length).toBeGreaterThan(0)

  await page.evaluate(executeTool, [
    "apply_studio_preview",
    {
      request_id: "e2e-apply-lead",
      expected_revision: staged.revision,
      preview_id: staged.pending_preview.preview_id
    }
  ] as const)

  await expect(page.getByTestId("studio-preview")).toHaveCount(0)
  await expect
    .poll(() => page.locator("daw-editor daw-track").count(), {
      message: "the applied take renders as a track"
    })
    .toBe(10)
  const applied = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    can_undo: boolean
    summary: { midi_clip_count: number }
  }
  expect(applied.can_undo).toBe(true)
  expect(applied.summary.midi_clip_count).toBe(initialClipCount + 1)

  await page.evaluate(executeTool, [
    "undo_studio_edit",
    { request_id: "e2e-undo-lead", expected_revision: applied.revision }
  ] as const)
  const undone = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    summary: { midi_clip_count: number }
    can_redo: boolean
  }
  expect(undone.summary.midi_clip_count).toBe(initialClipCount)
  expect(undone.can_redo).toBe(true)
  await expect
    .poll(() => page.locator("daw-editor daw-track").count(), {
      message: "undo removes the generated track from the DAW"
    })
    .toBe(9)
})

test("WebMCP writes, reads, replaces, and undoes exact MIDI", async ({ page }) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await expect(page.getByTestId("studio-runtime")).toHaveAttribute("aria-label", /1 tool/)
  await waitForStudioTools(page)
  await expect
    .poll(() => page.locator("daw-editor daw-track").count(), { message: "seed tracks render in the DAW" })
    .toBe(9)

  const initial = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    representation: string
    complete_session: boolean
    summary: { midi_track_count: number }
  }
  expect(initial).toMatchObject({
    representation: "canonical_midi_event_session",
    complete_session: true,
    summary: { midi_track_count: 9 }
  })
  const created = JSON.parse(
    await page.evaluate(executeTool, [
      "write_studio_midi",
      {
        request_id: "e2e-create-midi",
        expected_revision: initial.revision,
        mode: "create",
        track_name: "Agent Chords",
        clip_name: "Exact progression",
        program: 4,
        channel: 0,
        notes: [
          { pitch: "C4", start_beat: 0, duration_beats: 2, velocity: 100 },
          { pitch: "E4", start_beat: 0, duration_beats: 2, velocity: 92 },
          { pitch: 67, start_beat: 0, duration_beats: 2, velocity: 88 },
          { pitch: "Bb3", start_beat: 2, duration_beats: 2, velocity: 96 }
        ]
      }
    ] as const)
  ) as {
    result: { trackId: string; clipId: string; totalNotes: number }
    state: { revision: number }
  }

  expect(created.result.totalNotes).toBe(4)
  await expect
    .poll(() => page.locator("daw-editor daw-track").count(), {
      message: "the exact MIDI batch renders as a DAW track"
    })
    .toBe(10)
  await expect(page.getByText("AGENT MIDI", { exact: false })).toBeVisible()

  const midi = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    timebase: string
    tracks: Array<{
      track_id: string
      clips: Array<{
        clip_id: string
        start_beat: number
        duration_beats: number
        program: number
        notes: Array<{
          pitch: number
          pitch_name: string
          start_beat: number
          duration_beats: number
          velocity: number
        }>
      }>
    }>
  }
  expect(midi.timebase).toBe("absolute_zero_based_quarter_note_beats")
  const midiTrack = midi.tracks.find((track) => track.track_id === created.result.trackId)
  const midiClip = midiTrack?.clips.find((clip) => clip.clip_id === created.result.clipId)
  expect(midiTrack?.track_id).toBe(created.result.trackId)
  expect(midiClip).toMatchObject({
    clip_id: created.result.clipId,
    start_beat: 0,
    duration_beats: 4,
    program: 4
  })
  expect(midiClip?.notes).toEqual([
    {
      note_id: expect.any(String),
      pitch: 60,
      pitch_name: "C4",
      start_beat: 0,
      duration_beats: 2,
      velocity: 100
    },
    {
      note_id: expect.any(String),
      pitch: 64,
      pitch_name: "E4",
      start_beat: 0,
      duration_beats: 2,
      velocity: 92
    },
    {
      note_id: expect.any(String),
      pitch: 67,
      pitch_name: "G4",
      start_beat: 0,
      duration_beats: 2,
      velocity: 88
    },
    {
      note_id: expect.any(String),
      pitch: 58,
      pitch_name: "A#3",
      start_beat: 2,
      duration_beats: 2,
      velocity: 96
    }
  ])

  const replaced = JSON.parse(
    await page.evaluate(executeTool, [
      "write_studio_midi",
      {
        request_id: "e2e-replace-midi",
        expected_revision: created.state.revision,
        mode: "replace",
        track_id: created.result.trackId,
        clip_id: created.result.clipId,
        notes: [{ pitch: "F#4", start_beat: 8, duration_beats: 4, velocity: 127 }]
      }
    ] as const)
  ) as { result: { clipId: string; totalNotes: number }; state: { revision: number } }
  expect(replaced.result.clipId).toBe(created.result.clipId)
  expect(replaced.result.totalNotes).toBe(1)

  const afterReplace = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    tracks: Array<{ clips: Array<{ notes: Array<{ pitch: number; start_beat: number }> }> }>
  }
  const replacedClip = afterReplace.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.notes.some((note) => note.pitch === 66 && note.start_beat === 8))
  expect(replacedClip?.notes).toEqual([expect.objectContaining({ pitch: 66, start_beat: 8 })])

  await page.evaluate(executeTool, [
    "undo_studio_edit",
    { request_id: "e2e-undo-midi-replace", expected_revision: replaced.state.revision }
  ] as const)
  const restored = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    tracks: Array<{ clips: Array<{ notes: unknown[] }> }>
  }
  const restoredClip = restored.tracks.flatMap((track) => track.clips).find((clip) => clip.notes.length === 4)
  expect(restoredClip?.notes).toHaveLength(4)

  await page.evaluate(executeTool, [
    "undo_studio_edit",
    { request_id: "e2e-undo-midi-create", expected_revision: restored.revision }
  ] as const)
  await expect
    .poll(() => page.locator("daw-editor daw-track").count(), {
      message: "undo removes the agent-created MIDI track"
    })
    .toBe(9)
})

test("Effect journal exposes ordered agent mutations without duplicate or failed attempts", async ({
  page
}) => {
  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)

  const empty = JSON.parse(await page.evaluate(executeTool, ["get_studio_mutations", {}] as const)) as {
    schema_version: number
    retention_limit: number
    total_mutation_count: number
    next_cursor: number
    context: { selection_start_beat: number; selection_end_beat: number }
    mutations: unknown[]
  }
  expect(empty).toMatchObject({
    schema_version: 2,
    retention_limit: 2048,
    total_mutation_count: 0,
    next_cursor: 0,
    context: { selection_start_beat: 16, selection_end_beat: 32 },
    mutations: []
  })

  const selected = JSON.parse(
    await page.evaluate(executeTool, [
      "select_studio_beat_range",
      {
        request_id: "e2e-journal-selection",
        expected_revision: 1,
        start_beat: 8,
        end_beat: 24
      }
    ] as const)
  ) as { result: { revision: number } }
  const replayed = JSON.parse(
    await page.evaluate(executeTool, [
      "select_studio_beat_range",
      {
        request_id: "e2e-journal-selection",
        expected_revision: 1,
        start_beat: 8,
        end_beat: 24
      }
    ] as const)
  ) as { result: { replayed: boolean } }
  expect(replayed.result.replayed).toBe(true)

  const conflictingReuse = await page.evaluate(executeToolError, [
    "set_studio_tempo",
    {
      request_id: "e2e-journal-selection",
      expected_revision: 1,
      bpm: 90
    }
  ] as const)
  expect(conflictingReuse).toContain("already used for a different Studio mutation")

  const midi = JSON.parse(
    await page.evaluate(executeTool, [
      "write_studio_midi",
      {
        request_id: "e2e-journal-midi",
        expected_revision: selected.result.revision,
        mode: "create",
        track_name: "Behavior Context",
        notes: [{ pitch: "C4", start_beat: 0, duration_beats: 1, velocity: 99 }]
      }
    ] as const)
  ) as { result: { trackId: string; clipId: string } }

  const history = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_mutations", { limit: 10 }] as const)
  ) as {
    total_mutation_count: number
    next_cursor: number
    has_older: boolean
    mutations: Array<{
      sequence: number
      actor: string
      action: string
      request_id: string
      revision_before: number
      revision_after: number
      targets: { track_id?: string; clip_id?: string }
      input: Record<string, unknown>
    }>
  }
  expect(history.total_mutation_count).toBe(2)
  expect(history.next_cursor).toBe(2)
  expect(history.has_older).toBe(false)
  expect(history.mutations.map((event) => [event.sequence, event.actor, event.action])).toEqual([
    [1, "AGENT", "select_beat_range"],
    [2, "AGENT", "write_midi"]
  ])
  expect(history.mutations[0]).toMatchObject({
    request_id: "e2e-journal-selection",
    revision_before: 1,
    revision_after: 2,
    input: { start_beat: 8, end_beat: 24 }
  })
  expect(history.mutations[1]?.targets).toEqual({
    track_id: midi.result.trackId,
    clip_id: midi.result.clipId
  })
  await expect(page.getByRole("button", { name: /MUTATIONS 02/ })).toBeVisible()

  const filtered = JSON.parse(
    await page.evaluate(executeTool, [
      "get_studio_mutations",
      { after_sequence: 1, limit: 1, actions: ["write_midi"] }
    ] as const)
  ) as { next_cursor: number; has_more: boolean; mutations: Array<{ action: string }> }
  expect(filtered).toMatchObject({
    next_cursor: 2,
    has_more: false,
    mutations: [{ action: "write_midi" }]
  })

  const noNewEvents = JSON.parse(
    await page.evaluate(executeTool, [
      "get_studio_mutations",
      { after_sequence: filtered.next_cursor }
    ] as const)
  ) as { next_cursor: number; mutations: unknown[] }
  expect(noNewEvents).toEqual(expect.objectContaining({ next_cursor: 2, mutations: [] }))
})

test("invalid WebMCP input fails without changing project state", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (cause) => pageErrors.push(cause.message))
  await page.goto("/?mode=daw&song=korobeiniki")
  await waitForStudioTools(page)

  const before = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    selection: { start_beat: number; end_beat: number }
  }

  const attemptedPartialRead = JSON.parse(
    await page.evaluate(executeTool, ["get_studio_midi", { clip_id: "clip-drums" }] as const)
  ) as { complete_session: boolean; summary: { midi_track_count: number } }
  expect(attemptedPartialRead).toMatchObject({
    complete_session: true,
    summary: { midi_track_count: 9 }
  })

  const failure = await page.evaluate(executeToolError, [
    "select_studio_beat_range",
    {
      request_id: "e2e-invalid-range",
      expected_revision: 1,
      start_beat: 40,
      end_beat: 16
    }
  ] as const)
  expect(failure).not.toBe("unexpected-success")

  const invalidMidi = await page.evaluate(executeToolError, [
    "write_studio_midi",
    {
      request_id: "e2e-invalid-midi",
      expected_revision: 1,
      mode: "create",
      notes: [{ pitch: "H4", start_beat: 0, duration_beats: 1 }]
    }
  ] as const)
  expect(invalidMidi).not.toBe("unexpected-success")

  const subMicrobeatMidi = await page.evaluate(executeToolError, [
    "write_studio_midi",
    {
      request_id: "e2e-sub-microbeat-midi",
      expected_revision: 1,
      mode: "create",
      notes: [{ pitch: "C4", start_beat: 0, duration_beats: 0.00000001 }]
    }
  ] as const)
  expect(subMicrobeatMidi).not.toBe("unexpected-success")

  const subMicrobeatSelection = await page.evaluate(executeToolError, [
    "select_studio_beat_range",
    {
      request_id: "e2e-sub-microbeat-selection",
      expected_revision: 1,
      start_beat: 0,
      end_beat: 0.00000001
    }
  ] as const)
  expect(subMicrobeatSelection).not.toBe("unexpected-success")

  const emptyMix = await page.evaluate(executeToolError, [
    "set_studio_track_mix",
    {
      request_id: "e2e-invalid-empty-mix",
      expected_revision: 1,
      track_id: "track-drums"
    }
  ] as const)
  expect(emptyMix).not.toBe("unexpected-success")

  const after = JSON.parse(await page.evaluate(executeTool, ["get_studio_midi", {}] as const)) as {
    revision: number
    selection: { start_beat: number; end_beat: number }
  }
  expect(after.revision).toBe(before.revision)
  expect(after.selection).toEqual(before.selection)
  const history = JSON.parse(await page.evaluate(executeTool, ["get_studio_mutations", {}] as const)) as {
    total_mutation_count: number
    mutations: unknown[]
  }
  expect(history).toMatchObject({ total_mutation_count: 0, mutations: [] })
  expect(pageErrors).toEqual([])
})
