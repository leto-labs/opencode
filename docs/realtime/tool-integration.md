# Tool Integration for Realtime

How “tool calling” works while a voice call is active (OpenAI Realtime over WebRTC + OpenCode server-side tool execution).

## Table of Contents

- [TL;DR](#tldr)
- [When are tools called?](#when-are-tools-called)
- [How this repo implements it](#how-this-repo-implements-it)
  - [Client](#client)
  - [Server](#server)
- [API shapes](#api-shapes)
  - [`GET /session/:id/tools`](#get-sessionidtools)
  - [`POST /session/:id/tool/call`](#post-sessionidtoolcall)
- [Interruption + cancellation](#interruption--cancellation)
- [Permissions + security](#permissions--security)
- [Best practices (voice)](#best-practices-voice)

## TL;DR

- OpenAI Realtime emits function calls (“tool calls”) to the browser.
- The browser executes them by calling OpenCode’s `POST /session/:id/tool/call`.
- The server stores the execution as a `ToolPart` and returns `{ callId, result, error? }`.
- Voice mode intentionally exposes a **small tool set** to the realtime model: `glob`, `grep`, `task`.
  - Heavy work (read/write/edit/bash/web) is delegated via `task` to a text subagent to keep realtime token usage bounded.

## When are tools called?

Tool calls happen after OpenAI decides a user turn ended (VAD):

1. User speaks → audio streamed to OpenAI over WebRTC
2. User pauses → VAD closes the turn
3. Model responds → may include tool calls
4. Tool results are provided back to the model → response continues

## How this repo implements it

### Client

The client does **not** manually handle raw function-call events. Instead, it:

1. Fetches tool definitions from the server (`GET /session/:id/tools`)
2. Wraps them as executable SDK tools (Agents SDK `tool()` wrappers)
3. Passes them into `new RealtimeAgent({ tools })`

Key files:

- [`packages/app/src/hooks/use-realtime-connection.ts`](../../packages/app/src/hooks/use-realtime-connection.ts)
- [`packages/app/src/util/openai-realtime-tool.ts`](../../packages/app/src/util/openai-realtime-tool.ts)
- [`packages/app/src/context/voice-mode.tsx`](../../packages/app/src/context/voice-mode.tsx) (transcripts + UI)

### Server

The server implementation is the `SessionTool` module:

- `SessionTool.list()` returns tool definitions in OpenAI “function tool” format (JSON Schema) and filters to the voice-safe subset.
- `SessionTool.call()` executes the tool via `ToolRegistry`, stores a `ToolPart`, and returns the tool output to the client.

Key files:

- [`packages/opencode/src/session/tool.ts`](../../packages/opencode/src/session/tool.ts)
- [`packages/opencode/src/tool/registry.ts`](../../packages/opencode/src/tool/registry.ts)
- Routes: [`packages/opencode/src/server/routes/session.ts`](../../packages/opencode/src/server/routes/session.ts)

## API shapes

### `GET /session/:id/tools`

Returns tools in OpenAI function format (already filtered to the voice-safe subset):

- `glob` — file path discovery (bounded output)
- `grep` — content search (bounded output)
- `task` — delegate heavy work to a text subagent

Shape (simplified):

```ts
type ToolDefinition = {
  type: "function"
  name: string
  description: string
  parameters: unknown // JSON Schema
  strict: true
}
```

Implementation: `SessionTool.list()` in [`packages/opencode/src/session/tool.ts`](../../packages/opencode/src/session/tool.ts)

### `POST /session/:id/tool/call`

Executes a tool in the context of a session and returns a result suitable to relay back into the realtime model.

Request body (current):

```ts
{
  toolName: string
  callId: string
  arguments: Record<string, unknown>
  model: { providerID: string; modelID: string } // used for tool selection + task subagent inheritance
  agent?: string                                // tool context labeling
}
```

Response body (current):

```ts
{
  callId: string
  result: unknown
  error?: string
}
```

Implementation: `SessionTool.call()` in [`packages/opencode/src/session/tool.ts`](../../packages/opencode/src/session/tool.ts)

## Interruption + cancellation

- The realtime model supports interruption (VAD “speech_started” can stop audio playback).
- Tool execution via `POST /session/:id/tool/call` is currently **synchronous** and does not propagate cancellation to the server.

If we need true cancellation, likely options are:

- Make `/tool/call` async (return a handle, stream progress over SSE, poll for completion)
- Or propagate an AbortSignal-like mechanism over HTTP + store `interrupted` tool state

See the discussion in [`PHASE-4.md`](./PHASE-4.md).

## Permissions + security

Important current behavior:

- `POST /session/:id/tool/call` runs with `ctx.ask` as a **no-op**, so it bypasses interactive permission prompts.
- Safety for realtime is currently achieved by:
  - Keeping the tool set small (`glob`, `grep`, `task`)
  - Delegating heavy operations to server-side text subagents (where permission UX exists)

If you expose an OpenCode server publicly, follow the hardening guidance in [`docs/server/README.md`](../server/README.md).

## Best practices (voice)

- Prefer `glob` + `grep` for quick, bounded operations.
- Prefer `task` for anything that might produce large outputs (file reads, edits, long commands, web fetch/search).
- Keep the voice prompt small; avoid injecting large instruction files into the realtime context.
