# Phase 2: Transcript & Tool Endpoints

**Status: COMPLETE**

## PRD

Add server-side endpoints for transcript storage and tool execution. Enables client-side inference with server-side persistence and tool execution.

## Tasks

- [x] `POST /session/:id/transcript` - Store user/assistant text
- [x] `POST /session/:id/tool/call` - Execute tool and return result
- [x] Unit tests for both endpoints
- [x] Documentation for message flow

## Implementation Summary

### Transcript Endpoint

```
POST /session/:sessionID/transcript
{
  role: "user" | "assistant",
  text: string,
  messageID?: string,    // Optional: for deduplication with optimistic UI
  parts?: Part[]         // Optional: structured parts
}
```

### Tool Call Endpoint

```
POST /session/:sessionID/tool/call
{
  toolName: string,
  callId: string,
  arguments: object
}
```

### Files Changed

| File                                                       | Purpose                            |
| ---------------------------------------------------------- | ---------------------------------- |
| `packages/opencode/src/server/routes/session.ts`           | Transcript and tool/call endpoints |
| `packages/opencode/src/session/transcript.ts`              | Transcript storage logic           |
| `packages/opencode/test/server/session-transcript.test.ts` | Transcript tests                   |
| `packages/opencode/test/server/session-tool-call.test.ts`  | Tool call tests                    |
| `docs/architecture/message-flow.md`                        | Message flow documentation         |

## Key Decisions

1. **Session-scoped** - All endpoints are under `/session/:id/` for isolation
2. **Optional messageID** - Allows clients to pass IDs for optimistic update deduplication
3. **Decoupled from agent** - Transcript endpoint doesn't trigger inference
4. **Module pattern** - Logic in `session/*.ts` modules, routes call module functions
