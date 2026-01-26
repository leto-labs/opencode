# Phase 2: Server-Side Transcript & Tool Execution

**Status: COMPLETE**

## Goal

Add server-side endpoints for transcript storage and tool execution. This enables the architecture where the client connects directly to a provider (e.g., OpenAI Realtime) while using the opencode server for:
1. **Transcript persistence** - Store conversation history
2. **Tool execution** - Execute tools in the server's sandboxed environment

This phase is **server-side only** and decoupled from voice/realtime. The endpoints work for any client that needs to store transcripts or execute tools independently of the main agent loop.

## Architecture

```
┌─────────────────┐                          ┌─────────────────┐
│   Any Client    │◄────── Direct ──────────►│    Provider     │
│  (Web, Voice,   │       Connection         │  (OpenAI, etc)  │
│   CLI, etc)     │                          └─────────────────┘
└────────┬────────┘
         │
         │ POST /session/:id/transcript  (store conversation)
         │ POST /session/:id/tool/call   (execute tool)
         │ GET  /session/:id/message     (retrieve history)
         ▼
┌─────────────────┐
│  OpenCode Server│
│                 │
│  - Storage      │
│  - Tool Runner  │
│  - No Agent     │
└─────────────────┘
```

## Existing Infrastructure

### Routes to Leverage

| Route | File | Purpose |
|-------|------|---------|
| `POST /session` | `routes/session.ts:185` | Create session |
| `GET /session/:id/message` | `routes/session.ts:546` | Get all messages |
| `GET /session/:id/message/:msgId` | `routes/session.ts:585` | Get single message |
| `GET /tool` | `routes/experimental.ts:38` | List available tools |
| `GET /tool/ids` | `routes/experimental.ts:15` | List tool IDs |

### Data Model

Messages are stored via `MessageV2` (`session/message-v2.ts`):
- **TextPart** - Text content with optional `metadata` field (`z.record(z.string(), z.any())`)
- **ToolPart** - Tool call with `callID`, `tool`, `state` (pending/running/completed/error)

Key insight: `TextPart.metadata` is already a flexible record - clients can optionally include origin info (e.g., `metadata.source`) without any schema changes.

## New Endpoints

### 1. Add Transcript

**Endpoint:** `POST /session/:sessionID/transcript`

Adds user or assistant text to a session without triggering agent execution. This is for storing transcripts from external sources (voice, other clients).

```typescript
// Request body
{
  role: "user" | "assistant",
  text: string,
  metadata?: Record<string, any>  // Client-controlled, stored as-is
}

// Response
{
  messageID: string,
  partID: string
}
```

**Implementation approach:**
- Similar to how `SessionPrompt.prompt()` creates messages (see `session/prompt.ts`)
- But skip the agent execution loop - just store the message/part
- Store client-provided `metadata` as-is (client decides what to include, e.g., `source`, `itemId`)

### 2. Execute Tool

**Endpoint:** `POST /session/:sessionID/tool/call`

Executes a tool and returns the result. The client is responsible for sending the result back to the provider.

```typescript
// Request body
{
  toolName: string,
  callId: string,         // Provider's tool call ID
  arguments: object       // Tool arguments
}

// Response
{
  callId: string,
  result: any,
  error?: string
}
```

**Implementation approach:**
- Use `ToolRegistry.get()` to find the tool (see `tool/registry.ts`)
- Execute via the tool's `execute()` method
- Store a `ToolPart` in the session for history
- Return result for client to relay to provider

### 3. Get Transcript (existing)

The existing `GET /session/:id/message` endpoint already returns all messages with parts. No changes needed - clients can filter by `metadata` as needed.

## Implementation Plan

### Step 1: Add transcript endpoint to session routes

Modify `packages/opencode/src/server/routes/session.ts`:
- Add `POST /:sessionID/transcript` route
- Create message with role, add TextPart with metadata
- No agent execution

### Step 2: Add tool execution endpoint

Modify `packages/opencode/src/server/routes/session.ts` or create new file:
- Add `POST /:sessionID/tool/call` route
- Look up tool from registry
- Execute with provided arguments
- Store ToolPart for history
- Return result

### Step 3: Unit tests

Create test file that validates:
1. Create session
2. Add user transcript
3. Add assistant transcript
4. Execute tool call
5. Retrieve messages and verify all parts present

## Success Criteria

- [x] `POST /session/:id/transcript` stores text without agent execution
- [x] `POST /session/:id/tool/call` executes tool and returns result
- [x] Transcripts retrievable via existing `GET /session/:id/message`
- [x] Tool calls stored in session history as ToolParts
- [x] Unit tests pass for: create session → add transcript → call tool → verify

## Files Changed

| File | Purpose |
|------|---------|
| `packages/opencode/src/server/routes/session.ts` | Added `POST /:sessionID/transcript` and `POST /:sessionID/tool/call` endpoints |
| `packages/opencode/test/server/session-transcript.test.ts` | Unit tests for transcript endpoint (4 tests) |
| `packages/opencode/test/server/session-tool-call.test.ts` | Unit tests for tool call endpoint (4 tests) |
| `docs/architecture/message-flow.md` | New documentation for message flow architecture |

## Key Files to Reference

| File | What to look at |
|------|-----------------|
| `session/prompt.ts` | How messages are created (`SessionPrompt.prompt`) |
| `session/message-v2.ts` | Message and Part schemas |
| `tool/registry.ts` | How tools are looked up and executed |
| `server/routes/session.ts` | Existing session routes pattern |
| [Message Flow Architecture](../architecture/message-flow.md) | How `POST /session/:id/message` works end-to-end |

## Notes

- This phase has **no client-side changes** - purely server endpoints
- The endpoints are generic - usable by any client doing client-side inference (voice, CLI, web, etc.)
- Tool execution runs in server context with proper sandboxing
- Client controls `metadata` content - server stores it as-is without schema changes

### Model Resolution & Client-Side Sessions

Sessions don't store a model - instead, the model is resolved per-request. See [Message Flow Architecture](../architecture/message-flow.md) for details.

For client-side inference sessions:
- Create a normal session (no special flags needed)
- Use `POST /session/:id/transcript` and `POST /session/:id/tool/call` endpoints
- **Avoid** `POST /session/:id/message` - this triggers server-side inference

If `POST /session/:id/message` is accidentally called on a client-side session, it will resolve a model using the fallback chain (agent → last message → default) and attempt server-side inference. This is currently undocumented behavior - for now, clients should simply not call this endpoint on sessions intended for client-side inference.

## Future Considerations

- Batch transcript endpoint for efficiency
- WebSocket for real-time transcript streaming
- Tool execution timeout handling
- Permission checks for tool execution
