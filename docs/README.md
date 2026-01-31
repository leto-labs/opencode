# OpenCode Developer Docs (`docs/`)

Developer-facing documentation for working on OpenCode itself. For user documentation, see [opencode.ai/docs](https://opencode.ai/docs).

## Table of Contents

- [Quick start](#quick-start)
- [Docs map](#docs-map)
- [Key concepts](#key-concepts)
  - [Inference modes](#inference-modes)
  - [Voice mode (OpenAI Realtime)](#voice-mode-openai-realtime)
  - [Tools + permissions](#tools--permissions)
- [Monorepo map](#monorepo-map)
- [Common developer tasks](#common-developer-tasks)
  - [Regenerate the TypeScript SDK](#regenerate-the-typescript-sdk)
  - [Add a new API route](#add-a-new-api-route)
- [Key source entry points](#key-source-entry-points)

## Quick start

```bash
# Install dependencies (repo root)
bun install

# Terminal 1: start the backend server
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2: start the web app
cd packages/app
bun dev -- --port 4444
```

- Web UI: `http://localhost:4444`
- API server: `http://localhost:4096` (OpenAPI docs at `http://localhost:4096/doc`)

## Docs map

- **Architecture** (server, SDK generation, tools, storage): [`docs/architecture/README.md`](./architecture/README.md)
- **Realtime voice** (OpenAI Realtime, WebRTC, transcripts, voice-safe tools): [`docs/realtime/README.md`](./realtime/README.md)
- **Mobile** (Android/iOS via Tauri v2):
  - Setup: [`docs/MOBILE_SETUP.md`](./MOBILE_SETUP.md)
  - Index: [`docs/mobile/README.md`](./mobile/README.md)
- **Headless server deployment**: [`docs/server/README.md`](./server/README.md)
- **Upstream sync** (maintaining sync with upstream opencode): [`docs/UPSTREAM.md`](./UPSTREAM.md)

## Key concepts

### Inference modes

OpenCode has two inference modes:

- **Server-side inference (traditional)**: client sends a message → server calls an LLM → server executes tools → server streams updates (SSE).
  - Primary API: `POST /session/:id/message`
  - Deep dive: [`docs/architecture/message-flow.md`](./architecture/message-flow.md)

- **Client-side inference (voice/realtime)**: client connects directly to OpenAI Realtime over WebRTC → server is used async for **ephemeral keys**, **tools**, and **transcript persistence**.
  - APIs:
    - `POST /session/:id/client_secret` / `GET /session/:id/client_secret`
    - `GET /session/:id/tools`
    - `POST /session/:id/tool/call`
    - `POST /session/:id/transcript`
    - `GET /session/:id/system_prompt`
  - Deep dive: [`docs/realtime/architecture.md`](./realtime/architecture.md)

### Voice mode (OpenAI Realtime)

Voice mode is a **call state**, not a “model” in the picker:

- You keep a normal **text model** selected (used for standard chat, and for `task` subagents).
- When you start a call (phone icon in the prompt bar), the client opens a **WebRTC** connection to OpenAI Realtime and persists transcripts back to the server.

Key files:

- Client:
  - [`packages/app/src/context/voice-mode.tsx`](../packages/app/src/context/voice-mode.tsx)
  - [`packages/app/src/hooks/use-realtime-connection.ts`](../packages/app/src/hooks/use-realtime-connection.ts)
  - [`packages/app/src/util/openai-realtime-tool.ts`](../packages/app/src/util/openai-realtime-tool.ts)
- Server:
  - [`packages/opencode/src/session/client_secret.ts`](../packages/opencode/src/session/client_secret.ts)
  - [`packages/opencode/src/session/tool.ts`](../packages/opencode/src/session/tool.ts)
  - [`packages/opencode/src/session/transcript.ts`](../packages/opencode/src/session/transcript.ts)
  - [`packages/opencode/src/server/routes/session.ts`](../packages/opencode/src/server/routes/session.ts)

### Tools + permissions

- Tool registry: [`packages/opencode/src/tool/registry.ts`](../packages/opencode/src/tool/registry.ts)
- Voice mode tool set (bounded on purpose): `glob`, `grep`, `task` (see `SessionTool.VOICE_MODE_TOOLS` in [`packages/opencode/src/session/tool.ts`](../packages/opencode/src/session/tool.ts)).
- Permissions are enforced in the server-side agent loop; the client-side `POST /session/:id/tool/call` endpoint currently bypasses interactive permission prompts (its `ctx.ask` is a no-op).

Deep dive: [`docs/architecture/tool-flow.md`](./architecture/tool-flow.md) and [`docs/architecture/tool-permissions.md`](./architecture/tool-permissions.md)

## Monorepo map

```
packages/
├── opencode/       # Core server, CLI, and agent logic
├── app/            # Web UI (SolidJS + Vite)
├── desktop/        # Native desktop + mobile app (Tauri v2)
├── sdk/js/         # Type-safe TypeScript SDK (generated)
├── ui/             # Shared component library
├── util/           # Shared utilities
├── plugin/         # Plugin SDK for extensions
├── slack/          # Slack bot integration
├── extensions/     # IDE extensions (Zed, etc.)
├── web/            # Marketing/docs site (Astro)
├── console/        # Enterprise admin dashboard
├── docs/           # User-docs content (MDX, OpenAPI, etc.)
└── ...
```

> This folder (`docs/`) is the _developer_ markdown docs. `packages/docs/` and `packages/web/` are for the public docs site.

## Common developer tasks

### Regenerate the TypeScript SDK

Routes define their API contract using Hono + OpenAPI; the SDK is generated from the OpenAPI spec.

```bash
# Repo root
bun ./packages/sdk/js/script/build.ts
```

Key file: [`packages/sdk/js/script/build.ts`](../packages/sdk/js/script/build.ts)

### Add a new API route

Use this guide: [`docs/architecture/adding-routes.md`](./architecture/adding-routes.md)

## Key source entry points

| Area                               | File                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Server bootstrap                   | [`packages/opencode/src/server/server.ts`](../packages/opencode/src/server/server.ts)                 |
| Session routes                     | [`packages/opencode/src/server/routes/session.ts`](../packages/opencode/src/server/routes/session.ts) |
| Agent loop (server-side inference) | [`packages/opencode/src/session/prompt.ts`](../packages/opencode/src/session/prompt.ts)               |
| Client-side transcript persistence | [`packages/opencode/src/session/transcript.ts`](../packages/opencode/src/session/transcript.ts)       |
| Client-side tool execution         | [`packages/opencode/src/session/tool.ts`](../packages/opencode/src/session/tool.ts)                   |
| Web app prompt UI                  | [`packages/app/src/components/prompt-input.tsx`](../packages/app/src/components/prompt-input.tsx)     |
| Voice mode (client)                | [`packages/app/src/context/voice-mode.tsx`](../packages/app/src/context/voice-mode.tsx)               |
