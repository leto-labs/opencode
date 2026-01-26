# OpenCode Message Flow

This document describes how messages are processed in OpenCode's server-side inference architecture.

## Overview

When a client sends a message via `POST /session/:id/message`, the server:
1. Creates a user message
2. Runs the agent loop (LLM calls + tool execution)
3. Returns the assistant response

```
Client                          Server                           Provider
  │                               │                                 │
  │  POST /session/:id/message    │                                 │
  │  { parts, model?, agent? }    │                                 │
  │──────────────────────────────►│                                 │
  │                               │                                 │
  │                               │  SessionPrompt.prompt()         │
  │                               │  ├─ createUserMessage()         │
  │                               │  │   └─ resolve model           │
  │                               │  │       (input → agent → last → default)
  │                               │  │                               │
  │                               │  └─ loop(sessionID)             │
  │                               │      │                           │
  │                               │      │  LLM Request              │
  │                               │      │─────────────────────────►│
  │                               │      │◄─────────────────────────│
  │                               │      │  Response + Tool Calls   │
  │                               │      │                           │
  │                               │      │  Execute tools locally    │
  │                               │      │  Store ToolPart           │
  │                               │      │                           │
  │                               │      │  (repeat until finished)  │
  │                               │                                 │
  │◄──────────────────────────────│                                 │
  │  { info, parts }              │                                 │
```

## Key Components

### 1. Route Handler (`routes/session.ts:697`)

```typescript
.post("/:sessionID/message", ...)
  validator("json", SessionPrompt.PromptInput.omit({ sessionID: true }))
  → SessionPrompt.prompt({ ...body, sessionID })
```

### 2. Prompt Function (`session/prompt.ts:151`)

```typescript
export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  const message = await createUserMessage(input)  // Store user message
  await Session.touch(input.sessionID)

  if (input.noReply === true) return message      // Skip agent if noReply

  return loop(input.sessionID)                    // Run agent loop
})
```

### 3. Model Resolution (`session/prompt.ts:833`)

The model is resolved in order:
1. `input.model` - Explicitly provided in request
2. `agent.model` - From agent configuration
3. `lastModel(sessionID)` - From previous user message
4. `Provider.defaultModel()` - System default

```typescript
model: input.model ?? agent.model ?? (await lastModel(input.sessionID))
```

### 4. Agent Loop (`session/prompt.ts:258`)

The `loop()` function runs until the assistant finishes:

```typescript
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  while (true) {
    // Get message history
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

    // Find last user/assistant messages
    let lastUser, lastAssistant, lastFinished
    // ...

    // Exit if assistant finished (not tool-calls)
    if (lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish)) {
      break
    }

    // Call LLM via streamText()
    // Process tool calls
    // Store parts
  }
})
```

### 5. Message Storage

Messages are stored via `MessageV2`:
- **Info** - Message metadata (id, role, sessionID, model, time, etc.)
- **Parts** - Content pieces (TextPart, ToolPart, FilePart, etc.)

Each user message stores the model used:
```typescript
const info: MessageV2.Info = {
  id: ...,
  role: "user",
  sessionID: input.sessionID,
  model: input.model ?? agent.model ?? (await lastModel(sessionID)),
  // ...
}
```

## PromptInput Schema

```typescript
export const PromptInput = z.object({
  sessionID: Identifier.schema("session"),
  messageID: Identifier.schema("message").optional(),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).optional(),
  agent: z.string().optional(),
  noReply: z.boolean().optional(),  // Skip agent loop, just store message
  system: z.string().optional(),
  parts: z.array(TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput),
})
```

## Related Files

| File | Purpose |
|------|---------|
| `server/routes/session.ts` | HTTP route handlers |
| `session/prompt.ts` | Prompt processing and agent loop |
| `session/message-v2.ts` | Message and part schemas |
| `session/index.ts` | Session CRUD operations |
| `provider/provider.ts` | Model resolution |
