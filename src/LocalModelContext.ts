import type {
  ModelContext,
  ModelContextExecuteToolOptions,
  ModelContextGetToolOptions,
  ModelContextRegisterToolOptions,
  ModelContextTool,
  RegisteredTool,
  ToolInput
} from "@effect/platform-browser/WebMcp"

export class LocalModelContext extends EventTarget implements ModelContext {
  readonly #tools = new Map<string, ModelContextTool>()

  readonly registerTool = async (
    tool: ModelContextTool,
    options: ModelContextRegisterToolOptions = {}
  ): Promise<void> => {
    this.#tools.set(tool.name, tool)
    options.signal?.addEventListener(
      "abort",
      () => {
        this.#tools.delete(tool.name)
        this.dispatchEvent(new Event("toolchange"))
      },
      { once: true }
    )
    this.dispatchEvent(new Event("toolchange"))
  }

  readonly getTools = async (_options: ModelContextGetToolOptions = {}): Promise<Array<RegisteredTool>> =>
    Array.from(this.#tools.values(), (tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      window,
      origin: window.location.origin
    }))

  readonly executeTool = async (
    registered: RegisteredTool,
    input: ToolInput = {},
    options: ModelContextExecuteToolOptions = {}
  ): Promise<string> => {
    const tool = this.#tools.get(registered.name)
    if (tool === undefined) {
      throw new DOMException(`Tool ${registered.name} is no longer registered`, "NotFoundError")
    }
    const signal = options.signal ?? new AbortController().signal
    const result = await tool.execute(input, { signal })
    return typeof result === "string" ? result : JSON.stringify(result ?? null)
  }
}
