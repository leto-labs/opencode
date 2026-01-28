# OpenCode Message Flow

This document describes how messages are processed in OpenCode.

## Two Inference Modes

OpenCode supports two inference modes:

| Mode            | Inference Location        | Tool Execution   | Use Case                                 |
| --------------- | ------------------------- | ---------------- | ---------------------------------------- |
| **Server-side** | Server calls LLM provider | Server           | Traditional agents (Claude, GPT-4, etc.) |
| **Client-side** | Client handles inference  | Server (relayed) | Realtime/WebRTC (GPT Realtime)           |

---

## Server-Side Inference (Traditional)

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
  const message = await createUserMessage(input) // Store user message
  await Session.touch(input.sessionID)

  if (input.noReply === true) return message // Skip agent if noReply

  return loop(input.sessionID) // Run agent loop
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

### 6. Optimistic Updates & MessageID

The client uses **optimistic updates** for responsive UI - messages appear immediately before server confirmation. To prevent duplicates, the client generates the `messageID` and passes it to the server.

**Flow:**

```
Client                                Server
  │                                     │
  │  1. Generate messageID              │
  │     messageID = Identifier.ascending("message")
  │                                     │
  │  2. Add optimistic message to UI    │
  │     (id: messageID)                 │
  │                                     │
  │  3. POST /session/:id/message       │
  │     { messageID, parts, ... }       │
  │────────────────────────────────────►│
  │                                     │  4. Server uses SAME messageID
  │                                     │     (not generating a new one)
  │                                     │
  │◄────────────────────────────────────│  5. SSE: message.updated
  │  (messageID matches optimistic)     │     (id: messageID)
  │                                     │
  │  6. UI reconciles: same ID          │
  │     = update existing, not insert   │
```

**Why this matters:**

- Without passing `messageID`: Server generates new ID → SSE inserts duplicate message
- With passing `messageID`: Server uses same ID → SSE updates existing message

**Server-side handling (`session/prompt.ts:createUserMessage`):**

```typescript
const info: MessageV2.Info = {
  id: input.messageID ?? Identifier.ascending("message"), // Use client ID if provided
  // ...
}
```

This pattern is used by both inference modes:

- **Server-side**: `POST /session/:id/message` with `messageID`
- **Client-side**: `POST /session/:id/transcript` with `messageID`

## PromptInput Schema

```typescript
export const PromptInput = z.object({
  sessionID: Identifier.schema("session"),
  messageID: Identifier.schema("message").optional(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  agent: z.string().optional(),
  noReply: z.boolean().optional(), // Skip agent loop, just store message
  system: z.string().optional(),
  parts: z.array(TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput),
})
```

---

## Client-Side Inference (Realtime)

For client-side models like GPT Realtime (WebRTC), inference happens in the browser. The server is used only for:

- **Message persistence** - Store transcripts for history
- **Tool execution** - Execute tools on behalf of the client

### User Message Flow

```
Client (Browser)                    Server                         OpenAI Realtime
      │                               │                                   │
      │  User types message           │                                   │
      │  messageID = Identifier.ascending("message")                      │
      │  ┌─────────────────────┐      │                                   │
      │  │ Optimistic update   │      │                                   │
      │  │ (id: messageID)     │      │                                   │
      │  └─────────────────────┘      │                                   │
      │                               │                                   │
      │  POST /session/:id/transcript │                                   │
      │  { role, text, messageID }    │  ◄── Client passes messageID      │
      │──────────────────────────────►│                                   │
      │                               │  Use provided messageID           │
      │                               │  Session.updateMessage()          │
      │                               │  ─► SSE: message.updated          │
      │◄──────────────────────────────│      (same messageID = update)    │
      │  { messageID, partID }        │                                   │
      │                               │                                   │
      │  voiceMode.sendText(text)     │                                   │
      │───────────────────────────────────────────────────────────────────►│
      │                               │                                   │
```

**Key points:**

- Uses `/transcript` endpoint (not `/message`) since inference happens client-side
- Client passes `messageID` to prevent duplicates (same pattern as server-side agents)
- SSE event uses same ID → updates optimistic message instead of inserting duplicate

### Assistant Response Flow

```
Client (Browser)                    Server                         OpenAI Realtime
      │                               │                                   │
      │◄──────────────────────────────────────────────────────────────────│
      │  response.output_audio_transcript.done                            │
      │  { transcript: "..." }        │                                   │
      │                               │                                   │
      │  POST /session/:id/transcript │                                   │
      │  { role: "assistant", text }  │                                   │
      │──────────────────────────────►│                                   │
      │                               │  Session.updateMessage()          │
      │                               │  Session.updatePart()             │
      │                               │  ─► SSE: message.updated          │
      │                               │  ─► SSE: message.part.updated     │
      │◄──────────────────────────────│                                   │
      │  { messageID, partID }        │                                   │
      │                               │                                   │
      │  UI updates via SSE events    │                                   │
```

### Tool Execution Flow

See [tool-flow.md](./tool-flow.md) for details on how tool calls work in both modes.

### Endpoints Used

| Endpoint                       | Purpose                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `POST /session/:id/transcript` | Store user/assistant transcript (accepts optional `messageID` for optimistic updates) |
| `POST /session/:id/tool/call`  | Execute tool and return result                                                        |

**Note:** The `/transcript` endpoint accepts optional `messageID` and `partID` parameters. When provided, the server uses these IDs instead of generating new ones, enabling the optimistic update pattern.

### Input Types

Client-side inference handles two input types:

| Input     | Source                     | Transcription      | Storage                                              |
| --------- | -------------------------- | ------------------ | ---------------------------------------------------- |
| **Text**  | User types in prompt input | Not needed         | `voice-mode.tsx` stores via transcript endpoint      |
| **Voice** | User speaks via microphone | OpenAI transcribes | `voice-mode.tsx` stores when transcription completes |

### Client-Side Architecture

**Principle:** `voice-mode.tsx` owns ALL transcript management for realtime mode, mirroring how the server-side prompt endpoint owns message handling.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Server-side Flow (Claude, GPT-4, etc.)                             │
│                                                                     │
│  prompt-input.tsx ──POST /session/:id/message──► Server handles all │
│                                                   (storage + agent) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Client-side Flow (GPT Realtime)                                    │
│                                                                     │
│  prompt-input.tsx ──voiceMode.sendText()──► voice-mode.tsx handles  │
│                                              (storage + send)       │
│                                                                     │
│  [microphone] ────voice input────────────► voice-mode.tsx handles   │
│                                              (transcription + store)│
│                                                                     │
│  [agent response] ──────────────────────► voice-mode.tsx handles    │
│                                              (transcription + store)│
└─────────────────────────────────────────────────────────────────────┘
```

**Why this design:**

- Single source of truth for realtime transcript management
- Mirrors server-side pattern where prompt endpoint handles everything
- `prompt-input.tsx` doesn't need to know about transcript storage details
- User voice input and text input handled consistently

### Voice Input Flow

When user speaks (microphone unmuted):

```
Microphone                           OpenAI Realtime                    voice-mode.tsx
    │                                      │                                  │
    │  Audio stream (WebRTC)               │                                  │
    │─────────────────────────────────────►│                                  │
    │                                      │                                  │
    │                                      │  input_audio_transcription       │
    │                                      │  .completed { transcript }       │
    │                                      │─────────────────────────────────►│
    │                                      │                                  │
    │                                      │                                  │  addUserMessageToUI()
    │                                      │                                  │  storeTranscript("user")
    │                                      │                                  │
    │                                      │  (Agent processes and responds)  │
    │                                      │                                  │
    │                                      │  output_audio_transcript         │
    │                                      │  .done { transcript }            │
    │                                      │─────────────────────────────────►│
    │                                      │                                  │
    │                                      │                                  │  addAssistantMessageToUI()
    │                                      │                                  │  storeTranscript("assistant")
```

**Key OpenAI Realtime events:**

- `conversation.item.input_audio_transcription.completed` - User voice transcription
- `response.output_audio_transcript.done` - Assistant response transcription

### SSE Event Flow

Both modes use the same SSE events for real-time UI updates:

```
Server ─────────────────────────────► Client
         SSE: message.updated          │
         SSE: message.part.updated     │
                                       ▼
                                   UI updates
```

**Critical:** API calls must include the `x-opencode-directory` header for SSE events to route correctly. The SDK handles this automatically when initialized with a directory.

---

## Related Files

| File                             | Purpose                          |
| -------------------------------- | -------------------------------- |
| `server/routes/session.ts`       | HTTP route handlers              |
| `session/prompt.ts`              | Prompt processing and agent loop |
| `session/message-v2.ts`          | Message and part schemas         |
| `session/index.ts`               | Session CRUD operations          |
| `provider/provider.ts`           | Model resolution                 |
| `app/src/context/voice-mode.tsx` | Client-side realtime handling    |
