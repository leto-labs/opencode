# Package Reference

Detailed breakdown of all packages in the OpenCode monorepo.

## Table of Contents

- [Core Packages](#core-packages)
- [Frontend Packages](#frontend-packages)
- [Integration Packages](#integration-packages)
- [Utility Packages](#utility-packages)
- [Enterprise Packages](#enterprise-packages)
- [Build & Script Packages](#build--script-packages)
- [Package Dependency Graph](#package-dependency-graph)

## Core Packages

### packages/opencode

**Purpose:** Core OpenCode server, CLI tool, and agent implementation
**Type:** Private workspace package

#### Directory Structure

```
packages/opencode/src/
├── server/              # HTTP server (Hono)
│   ├── routes/          # API endpoints
│   │   ├── session.ts   # Session, message, transcript endpoints
│   │   ├── file.ts      # File operations
│   │   ├── project.ts   # Project/workspace management
│   │   ├── pty.ts       # Terminal emulation
│   │   ├── mcp.ts       # Model Context Protocol
│   │   ├── config.ts    # Configuration
│   │   ├── provider.ts  # Model providers
│   │   ├── question.ts  # User questions
│   │   ├── permission.ts# Permissions
│   │   ├── global.ts    # Global state
│   │   └── tui.ts       # Terminal UI
│   ├── server.ts        # Server initialization
│   ├── error.ts         # Error handling
│   └── mdns.ts          # mDNS discovery
│
├── session/             # Session management
│   ├── index.ts         # Session CRUD (create, get, list, remove)
│   ├── prompt.ts        # Agent loop - LLM calls + tool execution
│   ├── transcript.ts    # Client-side inference persistence
│   ├── message-v2.ts    # Message & Part schemas
│   ├── revert.ts        # Message revert/undo
│   └── prompt/          # System prompt templates
│
├── agent/               # AI agent system
│   ├── agent.ts         # Agent registry & configuration
│   └── prompt/          # Agent-specific prompts
│
├── provider/            # LLM providers
│   ├── provider.ts      # Provider registry
│   └── sdk/             # Provider-specific SDKs
│
├── tool/                # Tool execution
│   └── ...              # Tool implementations
│
├── cli/                 # Command-line interface
│   ├── cmd/             # Command implementations
│   │   ├── run.ts       # Main run command
│   │   ├── serve.ts     # Server command
│   │   └── ...          # Other commands
│   ├── ui.ts            # Terminal UI
│   └── error.ts         # CLI error handling
│
├── mcp/                 # Model Context Protocol
├── skill/               # Skill/plugin system
├── auth/                # Authentication
├── plugin/              # Plugin system
├── storage/             # File & data storage
├── lsp/                 # Language Server Protocol
├── pty/                 # Pseudoterminal
├── project/             # Project management
├── file/                # File operations
├── config/              # Configuration
├── util/                # Utilities
├── id/                  # ID generation (Identifier)
├── bus/                 # Event bus (Bus.publish/subscribe)
└── index.ts             # CLI entrypoint
```

#### Key Modules

**Session (`src/session/`)**

| File            | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| `index.ts`      | Session CRUD: `Session.create()`, `Session.get()`, `Session.list()` |
| `prompt.ts`     | Agent loop: `SessionPrompt.prompt()` runs LLM + tools               |
| `transcript.ts` | Store messages for client-side inference                            |
| `message-v2.ts` | Message/Part Zod schemas and types                                  |

**Server (`src/server/`)**

| Route File    | Endpoints                                        |
| ------------- | ------------------------------------------------ |
| `session.ts`  | `/session/*` - messages, transcripts, tool calls |
| `file.ts`     | `/file/*` - read, write, list files              |
| `project.ts`  | `/project/*` - project management                |
| `pty.ts`      | `/pty/*` - terminal sessions                     |
| `provider.ts` | `/provider/*` - model providers                  |

**Agent (`src/agent/`)**

| File       | Purpose                                  |
| ---------- | ---------------------------------------- |
| `agent.ts` | Agent configurations (build, plan, etc.) |
| `prompt/`  | System prompts per agent type            |

#### Entry Points

```typescript
// CLI entrypoint
import { cli } from "./src/cli"
cli.parse()

// Server entrypoint
import { createServer } from "./src/server/server"
const app = createServer()
```

---

### packages/app

**Purpose:** Web frontend for OpenCode
**Framework:** SolidJS + Vite
**Styling:** Tailwind CSS

#### Directory Structure

```
packages/app/src/
├── components/          # UI components
│   ├── prompt-input.tsx # Main message input
│   ├── file-tree.tsx    # File browser
│   ├── dialog-*.tsx     # Modal dialogs
│   └── session/         # Session-specific components
│
├── context/             # SolidJS contexts (state)
│   ├── global-sdk.tsx   # SDK client initialization
│   ├── global-sync.tsx  # SSE sync with server
│   ├── voice-mode.tsx   # OpenAI Realtime client
│   ├── local.tsx        # Local state
│   ├── layout.tsx       # Layout context
│   ├── sdk.tsx          # SDK provider
│   └── sync.tsx         # Message sync
│
├── hooks/               # Custom hooks
├── pages/               # Route pages
├── i18n/                # Internationalization
└── utils/               # Utilities
```

#### Key Contexts

| Context           | Purpose                                 |
| ----------------- | --------------------------------------- |
| `global-sdk.tsx`  | Creates and provides SDK client         |
| `global-sync.tsx` | SSE subscription, stores synced data    |
| `voice-mode.tsx`  | OpenAI Realtime API client for voice    |
| `local.tsx`       | Local UI state (selected session, etc.) |

#### Development

```bash
cd packages/app
bun dev          # Start Vite dev server (localhost:3000)
bun run build    # Production build
bun run test:e2e:local  # E2E tests with Playwright
```

---

### packages/sdk/js

**Purpose:** Type-safe TypeScript SDK for OpenCode API
**Generation:** Auto-generated from OpenAPI spec

#### Directory Structure

```
packages/sdk/js/src/
├── v2/                  # Current version
│   ├── gen/             # Auto-generated
│   │   ├── sdk.gen.ts   # API methods
│   │   ├── types.gen.ts # TypeScript types
│   │   └── core/        # Core client logic
│   ├── client.ts        # Client factory
│   └── server.ts        # Server factory
└── index.ts             # Exports
```

#### Usage

```typescript
// Client-side
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  fetch: window.fetch,
  directory: "/path/to/project",
})

// API calls
const sessions = await client.session.list()
const result = await client.session.prompt({ sessionID, parts: [...] })
```

#### Exports

| Export Path                  | Purpose         |
| ---------------------------- | --------------- |
| `@opencode-ai/sdk`           | V1 SDK (legacy) |
| `@opencode-ai/sdk/v2`        | V2 SDK          |
| `@opencode-ai/sdk/v2/client` | Client factory  |
| `@opencode-ai/sdk/v2/server` | Server factory  |

#### Regeneration

```bash
# Recommended (regenerates the JS SDK from OpenAPI)
bun ./packages/sdk/js/script/build.ts
```

---

### packages/ui

**Purpose:** Shared SolidJS component library
**Styling:** Tailwind CSS with custom theme

#### Directory Structure

```
packages/ui/src/
├── components/          # 50+ components
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── code.tsx         # Syntax highlighted code
│   ├── diff.tsx         # Diff viewer
│   └── ...
│
├── context/             # Theme & layout
├── hooks/               # Custom hooks
├── styles/              # Global styles
│   └── tailwind/        # Tailwind config
├── theme/               # Theme system
│   └── themes/          # Theme variants
├── pierre/              # Code diff library
└── assets/              # Icons, fonts, audio
```

#### Exports

```typescript
// Components
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Code } from "@opencode-ai/ui/code"

// Styles
import "@opencode-ai/ui/styles"
import "@opencode-ai/ui/styles/tailwind"

// Theme
import { useTheme } from "@opencode-ai/ui/theme"
```

---

## Frontend Packages

### packages/desktop

**Purpose:** Native desktop app
**Framework:** Tauri v2 + SolidJS

```
packages/desktop/
├── src/                 # SolidJS frontend
├── src-tauri/           # Rust backend
│   └── src/             # Tauri commands
└── tauri.conf.json      # Tauri config
```

```bash
# Development
bun run dev              # Web only
bun run tauri dev        # Full native app

# Build
bun run tauri build      # Creates installers
```

---

### packages/web

**Purpose:** Documentation/marketing site
**Framework:** Astro + Starlight

```bash
cd packages/web
bun dev          # Development server
bun run build    # Static build
```

---

## Integration Packages

### packages/slack

**Purpose:** Slack bot for threaded conversations

```bash
# Setup
# 1. Create Slack app at https://api.slack.com/apps
# 2. Enable Socket Mode
# 3. Add OAuth scopes: chat:write, app_mentions:read, channels:history

# Run
cd packages/slack
bun dev
```

Environment variables:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_APP_TOKEN`

---

### packages/extensions

**Purpose:** IDE extensions

Currently includes:

- Zed Editor extension

---

## Utility Packages

### packages/util

**Purpose:** Cross-package utilities

```typescript
import { NamedError } from "@opencode-ai/util/error"
import { Identifier } from "@opencode-ai/util/identifier"
import { Binary } from "@opencode-ai/util/binary"
```

| Module          | Purpose                             |
| --------------- | ----------------------------------- |
| `error.ts`      | `NamedError` class for typed errors |
| `identifier.ts` | ULID-based ID generation            |
| `binary.ts`     | Binary search utilities             |
| `array.ts`      | Array utilities                     |
| `path.ts`       | Path utilities                      |
| `retry.ts`      | Retry logic                         |

---

### packages/plugin

**Purpose:** Public plugin SDK

```typescript
import { definePlugin } from "@opencode-ai/plugin"
import { defineTool } from "@opencode-ai/plugin/tool"

export default definePlugin({
  name: "my-plugin",
  tools: [
    defineTool({
      name: "my-tool",
      description: "Does something",
      execute: async (input) => { ... }
    })
  ]
})
```

---

## Enterprise Packages

### packages/console

**Purpose:** Enterprise administration dashboard
**Framework:** SolidStart

Sub-packages:

- `console/app` - Main UI
- `console/core` - Core logic
- `console/function` - Serverless functions
- `console/mail` - Email integration
- `console/resource` - Resource management

---

### packages/enterprise

**Purpose:** Enterprise-only features

---

## Build & Script Packages

### packages/script

**Purpose:** Build and development scripts

- Version management
- Channel management (dev/release)
- Bun version checking

### packages/function

**Purpose:** Serverless function helpers

### packages/identity

**Purpose:** Authentication utilities

---

## Package Dependency Graph

```
                    ┌─────────────┐
                    │   opencode  │ (core server)
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
     ┌────────┐       ┌────────┐       ┌────────┐
     │  app   │       │  sdk   │       │  util  │
     └───┬────┘       └────────┘       └────────┘
         │
         ▼
     ┌────────┐
     │   ui   │
     └────────┘
         │
         ▼
     ┌────────┐
     │desktop │
     └────────┘
```

Key dependencies:

- `app` depends on `sdk`, `ui`, `util`
- `desktop` depends on `app` (shares components)
- `opencode` depends on `util`, `plugin`
- `sdk` depends on `util`
