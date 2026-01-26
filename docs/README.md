# OpenCode Developer Documentation

This documentation is for developers working on OpenCode itself. For user documentation, see [opencode.ai/docs](https://opencode.ai/docs).

## Quick Start

```bash
# Install dependencies
bun install

# Start the server (required for both TUI and web)
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# Start web UI (in another terminal)
cd packages/app
bun dev
```

## Project Overview

OpenCode is an open-source AI coding agent with a modular client/server architecture. The project supports multiple frontends (TUI, Web, Desktop) and multiple LLM providers.

**Key Technologies:**
- Runtime: Bun v1.2.12+
- Server: Hono (with OpenAPI)
- Client: SolidJS
- Desktop: Tauri v2
- Package Manager: Bun workspaces

## Monorepo Structure

```
packages/
├── opencode/       # Core server, CLI, and agent logic
├── app/            # Web UI (SolidJS + Vite)
├── desktop/        # Native desktop app (Tauri)
├── sdk/js/         # Type-safe TypeScript SDK
├── ui/             # Shared component library
├── util/           # Shared utilities
├── plugin/         # Plugin SDK for extensions
├── slack/          # Slack bot integration
├── extensions/     # IDE extensions (Zed, etc.)
├── web/            # Documentation site (Astro)
├── console/        # Enterprise admin dashboard
├── docs/           # Markdown documentation content
├── enterprise/     # Enterprise features
├── script/         # Build scripts
├── function/       # Function utilities
└── identity/       # Authentication utilities
```

## Core Packages

### packages/opencode - Server & CLI

The main package containing the HTTP server, CLI tool, and agent implementation.

```
packages/opencode/src/
├── server/         # Hono HTTP server
│   └── routes/     # API endpoints (session, file, pty, mcp, etc.)
├── session/        # Session & message management
│   ├── index.ts    # Session CRUD
│   ├── prompt.ts   # Agent loop (LLM calls + tool execution)
│   ├── transcript.ts # Client-side inference persistence
│   └── message-v2.ts # Message/Part schemas
├── agent/          # Agent configuration & prompts
├── provider/       # LLM provider integration (OpenAI, Claude, etc.)
├── tool/           # Tool execution engine
├── cli/            # Command-line interface
├── mcp/            # Model Context Protocol support
├── skill/          # Skill/plugin system
└── ...             # Other modules (auth, storage, lsp, etc.)
```

**Key Entry Points:**
- CLI: `./bin/opencode` (yargs commands)
- Server: `./src/server/server.ts` (Hono app)
- Agent Loop: `./src/session/prompt.ts:loop()` (line 258+)

See [architecture/packages.md](architecture/packages.md) for detailed breakdown.

### packages/app - Web UI

SolidJS-based web frontend with real-time updates via SSE.

```
packages/app/src/
├── components/     # UI components
│   └── prompt-input.tsx  # Main message input
├── context/        # State management
│   ├── global-sdk.tsx    # SDK client
│   ├── global-sync.tsx   # SSE sync with server
│   └── voice-mode.tsx    # Realtime voice client
├── pages/          # Route pages
└── hooks/          # Custom hooks
```

### packages/sdk/js - TypeScript SDK

Auto-generated type-safe client for the OpenCode API.

```
packages/sdk/js/src/
├── v2/             # Current SDK version
│   ├── gen/        # Auto-generated from OpenAPI
│   │   ├── sdk.gen.ts    # API methods
│   │   └── types.gen.ts  # TypeScript types
│   └── client.ts   # Client factory
└── index.ts        # Exports
```

**Usage:**
```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })
const sessions = await client.session.list()
```

### packages/ui - Component Library

Shared SolidJS components used by web and desktop apps.

```
packages/ui/src/
├── components/     # 50+ reusable components
├── theme/          # Theme system
├── styles/         # Tailwind configuration
└── assets/         # Icons, fonts, audio
```

## Architecture Patterns

### 1. Generated SDK

Routes define their API contract using Hono + OpenAPI. The SDK is auto-generated.

```typescript
// packages/opencode/src/server/routes/session.ts
.post(
  "/:sessionID/transcript",
  describeRoute({
    summary: "Add transcript",
    operationId: "session.transcript.add",  // -> client.session.transcriptAdd()
    responses: { 200: { schema: resolver(SessionTranscript.AddOutput) } }
  }),
  validator("json", SessionTranscript.AddInput.omit({ sessionID: true })),
  async (c) => { /* ... */ }
)
```

Regenerate SDK after route changes:
```bash
cd packages/opencode && bun dev generate
cd packages/sdk/js && bun run build
```

See [architecture/adding-routes.md](architecture/adding-routes.md) for full guide.

### 2. Two Inference Modes

**Server-Side (Traditional):**
```
Client → POST /session/:id/message → Server → LLM → Tool Calls → Response (SSE)
```

**Client-Side (Realtime/Voice):**
```
Client → OpenAI Realtime API (direct) → Audio Response
         ↓ async
         POST /session/:id/transcript → Server (persistence only)
```

See [architecture/message-flow.md](architecture/message-flow.md) for details.

### 3. Namespace Pattern

Business logic lives in namespaces under `src/session/`, `src/agent/`, etc. Routes are thin wrappers.

```typescript
// src/session/transcript.ts
export namespace SessionTranscript {
  export const AddInput = z.object({ ... })
  export const AddOutput = z.object({ ... })
  export const add = fn(AddInput, async (input) => { ... })
}

// src/server/routes/session.ts
validator("json", SessionTranscript.AddInput)
const result = await SessionTranscript.add(body)
```

### 4. SSE Real-Time Updates

Server pushes events to clients via Server-Sent Events:

```typescript
// Server emits
Bus.publish(MessageV2.Event.Updated, { info })
Bus.publish(MessageV2.Event.PartUpdated, { part })

// Client receives via SSE
const events = client.session.subscribe({ sessionID })
for await (const event of events) {
  // Update UI
}
```

**Important:** Include `x-opencode-directory` header for proper event routing.

### 5. Optimistic Updates

Client generates IDs before sending to server to prevent duplicates:

```typescript
const messageID = Identifier.ascending("message")
await client.session.transcript.add({ sessionID, messageID, ... })
// Server uses client's ID instead of generating new one
```

See [architecture/message-flow.md](architecture/message-flow.md#optimistic-updates).

## Development Workflow

### Running Tests

```bash
# Unit tests (opencode)
cd packages/opencode && bun test

# Specific test file
bun test test/session/transcript.test.ts

# E2E tests (app)
cd packages/app && bun run test:e2e:local
```

### Adding a New Feature

1. **Define types** in relevant namespace (`src/session/*.ts`, etc.)
2. **Add route** in `src/server/routes/*.ts` with OpenAPI annotations
3. **Regenerate SDK** (`bun dev generate && cd ../sdk/js && bun run build`)
4. **Update UI** in `packages/app/src/`
5. **Add tests** in `test/` directory

### Key Files to Know

| What | Where |
|------|-------|
| Server routes | `packages/opencode/src/server/routes/` |
| Agent loop | `packages/opencode/src/session/prompt.ts:258` |
| Message schemas | `packages/opencode/src/session/message-v2.ts` |
| Session CRUD | `packages/opencode/src/session/index.ts` |
| SDK client | `packages/sdk/js/src/v2/client.ts` |
| UI state | `packages/app/src/context/` |
| Voice mode | `packages/app/src/context/voice-mode.tsx` |

## Documentation Index

### Architecture
- [packages.md](architecture/packages.md) - Detailed package breakdown
- [patterns.md](architecture/patterns.md) - Architecture patterns & conventions
- [message-flow.md](architecture/message-flow.md) - Message flow & inference modes
- [adding-routes.md](architecture/adding-routes.md) - How to add API endpoints
- [tool-flow.md](architecture/tool-flow.md) - Tool execution flow

### Features
- [realtime/](realtime/) - Voice/Realtime integration docs
  - [README.md](realtime/README.md) - Overview
  - [architecture.md](realtime/architecture.md) - Realtime system design
  - [PHASE-*.md](realtime/) - Implementation phases

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.
