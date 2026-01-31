# Architecture Docs

Developer-facing documentation for how OpenCode is structured (server, client, SDK generation, storage, and tools).

- For the docs hub, see [`docs/README.md`](../README.md).

## Table of Contents

- [Index](#index)
- [Key source files](#key-source-files)

## Index

- **Packages & layout**
  - [`packages.md`](./packages.md) — monorepo package breakdown and key entry points
- **Message flow**
  - [`message-flow.md`](./message-flow.md) — server-side vs client-side inference, transcripts, SSE
- **Adding routes / SDK generation**
  - [`adding-routes.md`](./adding-routes.md) — Hono + OpenAPI → generated TypeScript SDK
- **Tools**
  - [`tool-flow.md`](./tool-flow.md) — how tool calling works (server-side + client-side inference)
  - [`tool-permissions.md`](./tool-permissions.md) — permission system and approval flow
  - [`tool-api.md`](./tool-api.md) — tool endpoint and tool IO formats
  - [`tool-integration.md`](./tool-integration.md) — integrating OpenCode tools from external agents
- **Frontend state patterns**
  - [`solidjs-contexts.md`](./solidjs-contexts.md) — SolidJS contexts/stores patterns used by the app
- **Persistence**
  - [`storage.md`](./storage.md) — file-based JSON storage module and layout

## Key source files

- **Server routes**
  - [`packages/opencode/src/server/routes/`](../../packages/opencode/src/server/routes/)
  - [`packages/opencode/src/server/routes/session.ts`](../../packages/opencode/src/server/routes/session.ts)
- **Agent loop**
  - [`packages/opencode/src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts)
- **Client-side inference persistence**
  - [`packages/opencode/src/session/transcript.ts`](../../packages/opencode/src/session/transcript.ts)
  - [`packages/opencode/src/session/client_secret.ts`](../../packages/opencode/src/session/client_secret.ts)
- **SDK generation**
  - [`packages/sdk/js/script/build.ts`](../../packages/sdk/js/script/build.ts)
  - [`script/generate.ts`](../../script/generate.ts)
