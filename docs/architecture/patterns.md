# Architecture Patterns & Conventions

This document describes the key patterns and conventions used throughout the OpenCode codebase.

## 1. Namespace Pattern

Business logic is organized into namespaces. Routes are thin wrappers that delegate to namespaces.

### Structure

```typescript
// src/session/transcript.ts
export namespace SessionTranscript {
  // Input/output schemas using Zod
  export const AddInput = z.object({
    sessionID: Identifier.schema("session"),
    role: z.enum(["user", "assistant"]),
    parts: z.array(PartInput),
  })
  export type AddInput = z.infer<typeof AddInput>

  export const AddOutput = z.object({
    info: MessageV2.Info,
    parts: z.array(MessageV2.Part),
  })
  export type AddOutput = z.infer<typeof AddOutput>

  // Main function with validation
  export const add = fn(AddInput, async (input): Promise<AddOutput> => {
    // Implementation
  })
}
```

### Route Integration

```typescript
// src/server/routes/session.ts
.post(
  "/:sessionID/transcript",
  describeRoute({
    summary: "Add transcript",
    operationId: "session.transcript.add",
    responses: {
      200: { schema: resolver(SessionTranscript.AddOutput) }
    }
  }),
  validator("json", SessionTranscript.AddInput.omit({ sessionID: true })),
  async (c) => {
    const { sessionID } = c.req.valid("param")
    const body = c.req.valid("json")
    const result = await SessionTranscript.add({ ...body, sessionID })
    return c.json(result)
  }
)
```

### Benefits

- **Separation of concerns:** Route handles HTTP, namespace handles logic
- **Type safety:** Zod schemas validate at runtime and generate TypeScript types
- **Testability:** Namespaces can be tested without HTTP layer
- **SDK generation:** Schemas feed into OpenAPI spec generation

### Naming Convention

| Namespace | Location | Purpose |
|-----------|----------|---------|
| `Session` | `src/session/index.ts` | Session CRUD |
| `SessionPrompt` | `src/session/prompt.ts` | Server-side inference |
| `SessionTranscript` | `src/session/transcript.ts` | Client-side inference storage |
| `SessionRevert` | `src/session/revert.ts` | Message revert |
| `MessageV2` | `src/session/message-v2.ts` | Message schemas |

---

## 2. SDK Generation Pattern

API contracts are defined once in route files and automatically generate TypeScript SDK.

### Flow

```
1. Define Route
   └─ Hono route with hono-openapi annotations
   └─ Zod schemas for request/response

2. Extract OpenAPI Spec
   └─ `bun dev generate` in packages/opencode
   └─ Outputs to packages/sdk/openapi.json

3. Generate TypeScript
   └─ @hey-api/openapi-ts processes spec
   └─ Generates sdk.gen.ts and types.gen.ts

4. Use in App
   └─ Import from @opencode-ai/sdk/v2/client
   └─ Full type safety
```

### Route Definition

```typescript
import { describeRoute, resolver } from "hono-openapi"

.post(
  "/:sessionID/transcript",
  describeRoute({
    summary: "Add transcript to session",
    description: "Store a message for client-side inference",
    operationId: "session.transcript.add",  // SDK method name
    tags: ["session"],
    responses: {
      200: {
        description: "Transcript added",
        content: {
          "application/json": {
            schema: resolver(SessionTranscript.AddOutput),
          },
        },
      },
      400: { description: "Invalid request" },
      404: { description: "Session not found" },
    },
  }),
  validator("param", z.object({ sessionID: z.string() })),
  validator("json", SessionTranscript.AddInput.omit({ sessionID: true })),
  async (c) => { /* ... */ }
)
```

### SDK Usage

```typescript
// Auto-generated method from operationId
const result = await client.session.transcript.add({
  sessionID: "ses_123",
  role: "user",
  parts: [{ type: "text", text: "Hello" }],
})
```

### operationId Convention

Format: `{resource}.{action}` or `{resource}.{subresource}.{action}`

Examples:
- `session.list` → `client.session.list()`
- `session.transcript.add` → `client.session.transcript.add()`
- `file.read` → `client.file.read()`

---

## 3. Event Bus Pattern

Components communicate via a central event bus for decoupling.

### Publishing Events

```typescript
import { Bus } from "../bus"
import { MessageV2 } from "./message-v2"

// Publish when message is created/updated
Bus.publish(MessageV2.Event.Updated, { info: messageInfo })
Bus.publish(MessageV2.Event.PartUpdated, { part: messagePart })
```

### Subscribing to Events

```typescript
const unsubscribe = Bus.subscribe(MessageV2.Event.Updated, (event) => {
  console.log("Message updated:", event.properties.info)
})

// Later: cleanup
unsubscribe()
```

### SSE Integration

The server routes subscribe to events and forward them to clients via SSE:

```typescript
// Server-side
const stream = new ReadableStream({
  start(controller) {
    const unsub = Bus.subscribe(MessageV2.Event.Updated, (event) => {
      controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
    })
  }
})

// Client receives
const events = client.session.subscribe({ sessionID })
for await (const event of events) {
  // Handle event
}
```

---

## 4. Context Provider Pattern (SolidJS)

State is managed through SolidJS contexts using a factory pattern.

### Context Definition

```typescript
// src/context/voice-mode.tsx
import { createSimpleContext } from "@opencode-ai/ui/context"

export const { use: useVoiceMode, provider: VoiceModeProvider } = createSimpleContext({
  name: "VoiceMode",
  init: () => {
    // Initialize state
    const [status, setStatus] = createSignal<VoiceStatus>("disconnected")

    // Define methods
    const connect = async () => { /* ... */ }
    const disconnect = () => { /* ... */ }

    // Cleanup on unmount
    onCleanup(() => { /* cleanup */ })

    // Return public API
    return {
      status,
      connect,
      disconnect,
    }
  },
})
```

### Usage in Components

```typescript
// Provider in app root
<VoiceModeProvider>
  <App />
</VoiceModeProvider>

// Consumer in any component
const voiceMode = useVoiceMode()
voiceMode.connect()
console.log(voiceMode.status())
```

### Key Contexts

| Context | Purpose |
|---------|---------|
| `GlobalSDK` | SDK client instance |
| `GlobalSync` | SSE subscription, synced data |
| `VoiceMode` | Realtime voice client |
| `Local` | Local UI state |

---

## 5. Identifier Pattern

IDs are generated using ULID-based identifiers with type prefixes.

### Generation

```typescript
import { Identifier } from "../id/id"

// Generate ascending IDs (sortable by time)
const messageID = Identifier.ascending("message")  // "msg_01HGX..."
const partID = Identifier.ascending("part")        // "prt_01HGX..."
const sessionID = Identifier.ascending("session")  // "ses_01HGX..."
```

### Schema Validation

```typescript
// Validate ID format in Zod schemas
const MyInput = z.object({
  sessionID: Identifier.schema("session"),  // Must start with "ses_"
  messageID: Identifier.schema("message").optional(),
})
```

### Prefixes

| Prefix | Type |
|--------|------|
| `ses_` | Session |
| `msg_` | Message |
| `prt_` | Part |
| `prv_` | Provider |

---

## 6. Optimistic Update Pattern

Client generates IDs before sending to server to enable optimistic UI updates.

### Problem

Without optimistic updates:
1. Client sends message
2. Server creates message with new ID
3. SSE sends `message.created` event
4. Client shows duplicate if it already rendered a pending message

### Solution

```typescript
// Client generates ID
const messageID = Identifier.ascending("message")
const partID = Identifier.ascending("part")

// Immediately add to UI (optimistic)
addMessageToStore({
  id: messageID,
  parts: [{ id: partID, text: "..." }]
})

// Send to server with same ID
await client.session.transcript.add({
  sessionID,
  messageID,
  parts: [{ id: partID, type: "text", text: "..." }]
})

// Server uses provided ID (no duplicate)
// SSE event updates existing message instead of inserting new one
```

See [message-flow.md](message-flow.md#optimistic-updates) for details.

---

## 7. Validation Pattern

Use Zod for runtime validation with the `fn()` helper.

### Definition

```typescript
import { fn } from "@/util/fn"

export const add = fn(AddInput, async (input): Promise<AddOutput> => {
  // `input` is validated and typed
  const { sessionID, role, parts } = input
  // ...
})
```

### Benefits

- Runtime validation of inputs
- TypeScript type inference
- Consistent error handling
- Self-documenting API

### Route Validators

```typescript
.post(
  "/:sessionID/action",
  validator("param", z.object({ sessionID: z.string() })),
  validator("json", ActionInput),
  validator("query", z.object({ limit: z.number().optional() })),
  async (c) => {
    const params = c.req.valid("param")  // Validated
    const body = c.req.valid("json")     // Validated
    const query = c.req.valid("query")   // Validated
  }
)
```

---

## 8. Error Handling Pattern

Use typed errors with `NamedError` for consistent error handling.

### Definition

```typescript
import { NamedError } from "@opencode-ai/util/error"

export class SessionNotFoundError extends NamedError {
  readonly name = "SessionNotFoundError"
  constructor(public sessionID: string) {
    super(`Session not found: ${sessionID}`)
  }
}
```

### Usage

```typescript
try {
  const session = await Session.get(sessionID)
  if (!session) {
    throw new SessionNotFoundError(sessionID)
  }
} catch (err) {
  if (err instanceof SessionNotFoundError) {
    return c.json({ error: err.message }, { status: 404 })
  }
  throw err
}
```

---

## 9. Directory-Scoped Pattern

Operations are scoped to a project directory for isolation.

### SDK Client

```typescript
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project",  // All operations scoped to this
})
```

### Header

Requests include `x-opencode-directory` header:

```
POST /session/ses_123/message
x-opencode-directory: /path/to/project
```

### SSE Routing

Events are published to the correct directory scope:

```typescript
// Server publishes to directory-specific channel
Bus.publish(MessageV2.Event.Updated, { info }, { directory })

// Client only receives events for their directory
```

---

## 10. Async Iteration for Streams

Use async iteration for streaming responses.

### Server (SSE)

```typescript
const stream = new ReadableStream({
  start(controller) {
    const unsub = Bus.subscribe(event, (data) => {
      controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
    })
  }
})
return new Response(stream, {
  headers: { "Content-Type": "text/event-stream" }
})
```

### Client

```typescript
const events = client.session.subscribe({ sessionID })

for await (const event of events) {
  switch (event.type) {
    case "message.created":
      handleMessageCreated(event.data)
      break
    case "message.part.updated":
      handlePartUpdated(event.data)
      break
  }
}
```

---

## Summary

| Pattern | Purpose | Key Files |
|---------|---------|-----------|
| Namespace | Organize business logic | `src/session/*.ts` |
| SDK Generation | Type-safe API client | Routes → OpenAPI → SDK |
| Event Bus | Decoupled communication | `src/bus/` |
| Context Provider | SolidJS state management | `packages/app/src/context/` |
| Identifier | Sortable unique IDs | `src/id/id.ts` |
| Optimistic Update | Prevent duplicate UI | Client-generated IDs |
| Validation | Runtime type checking | `fn()` helper, Zod |
| Named Error | Typed error handling | `NamedError` class |
| Directory Scope | Project isolation | `x-opencode-directory` header |
| Async Iteration | Stream handling | SSE subscriptions |
