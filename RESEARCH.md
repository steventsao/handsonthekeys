# WebMCP research notes

Research snapshot: 2026-08-31.

## Current browser boundary

The current imperative API is document-owned: a page registers a named tool with `document.modelContext.registerTool()`, including a description, JSON Schema input, optional annotations, and an async callback. Discovery and execution operate on registered document tools. See the [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp) and [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/).

This shapes the channel in four ways:

1. Every tab registers the same four tools independently.
2. D1—not a tab—is the source of truth for the shared queue.
3. `BroadcastChannel` is only a same-origin refresh hint; it is not the tool bus.
4. Tools return a durable run ID immediately, while `get_status` is the polling boundary for long-running visual work.

## Multiple tabs

WebMCP does not turn the browser into one cross-tab registry. Registration belongs to the document that owns the callback. Two tabs can still operate one product when each registers the same contract and both call the same authenticated backend. That is the model used here.

## Iframes

Tools are associated with the document that registers them. A same-origin frame can participate in the frame tree under the default policy. A cross-origin iframe must be explicitly delegated the `tools` permission (for example, `allow="tools"`), and origin-aware discovery is still required. Iframes are therefore useful when a CMS embeds a separately owned tool surface, but unnecessary for this queue because all four operations belong to the top-level channel.

## Existing sites and browser extensions

A product normally provides its own stable WebMCP contract. An extension can inject code or expose a separate automation layer when granted permission, but that is not equivalent to the origin publishing tools tied to its real authorization, validation, and product semantics. For a reliable integration, register tools in the site and route both human and agent actions through the same service boundary.

## Results and visual output

The current callback returns one JSON-serializable result; WebMCP does not standardize an MCP Apps-style interactive widget payload. This project therefore uses a dual result:

- the caller receives structured status, revisions, and output metadata;
- the page emits the same result into a visible, selectable activity card and updates the portrait reel.

This keeps the tool contract machine-readable while making every call observable to the person sharing the page.

## Why these four tools

| Tool           | Boundary decision                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `queue_prompt` | Asynchronous mutation that returns an opaque run ID rather than holding a tool call open.      |
| `get_status`   | Read-only observation boundary for queue position, progress, revision, and output.             |
| `batch_queue`  | One atomic request prevents agents from partially enqueuing a planned set.                     |
| `steer_prompt` | Optimistic revision checking prevents a stale agent from silently overwriting newer direction. |

The same-origin API revalidates prompt sizes, batch size, ownership, revisions, queue capacity, and idempotency. Browser annotations are useful hints, not substitutes for those controls.

## Hosting choice

The existing Vite application is extended with Cloudflare’s official Vite plugin, which supports SPAs with integrated Worker APIs and static assets. D1 provides one durable queue for all tabs and visitors. Relevant primary references: [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/), [React SPA with an API tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/), and [Workers bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/).
