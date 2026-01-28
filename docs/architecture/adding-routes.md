# Adding New API Routes

This document describes the process for adding new API endpoints to OpenCode. Following this process ensures type safety, consistency, and proper client integration.

## Overview

OpenCode uses a **generated SDK pattern**:
1. Server routes are defined with OpenAPI annotations (via `hono-openapi`)
2. An OpenAPI spec is extracted from the server
3. `@hey-api/openapi-ts` generates TypeScript client code from the spec
4. The app uses the generated client for all API calls

```
┌─────────────────┐     OpenAPI     ┌─────────────────┐     Generated    ┌─────────────────┐
│   Server Route  │────────────────►│   openapi.json  │────────────────►│    SDK Client   │
│ (Hono + OpenAPI)│     Extract     │                 │      Build       │  (TypeScript)   │
└─────────────────┘                 └─────────────────┘                  └─────────────────┘
```

## Step-by-Step Guide

### Step 1: Add Server Route

Add your route in the appropriate file under `packages/opencode/src/server/routes/`:

```typescript
// packages/opencode/src/server/routes/session.ts
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"

export const SessionRoutes = lazy(() =>
  new Hono()
    // ... existing routes ...
    .post(
      "/:sessionID/transcript",
      describeRoute({
        summary: "Add transcript",
        description: "Add a user or assistant transcript to a session.",
        operationId: "session.transcript.add",  // This becomes the SDK method name
        responses: {
          200: {
            description: "Transcript added",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    messageID: z.string(),
                    partID: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({
        sessionID: z.string(),
      })),
      validator("json", z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
      })),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const { role, text, metadata } = c.req.valid("json")

        // Implementation...

        return c.json({ messageID, partID })
      },
    )
)
```

**Key elements:**
- `operationId`: Becomes the SDK method name (e.g., `session.transcript.add` → `sdk.client.session.transcriptAdd()`)
- `describeRoute()`: OpenAPI documentation
- `validator()`: Request validation with Zod schemas
- `resolver()`: Response schema for type generation

### Step 2: Add Tests

Create tests in `packages/opencode/test/server/`:

```typescript
// packages/opencode/test/server/session-transcript.test.ts
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"

describe("session.transcript", () => {
  test("adds user transcript", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        const response = await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            text: "Hello, world!",
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.messageID).toBeDefined()
        expect(body.partID).toBeDefined()

        await Session.remove(session.id)
      },
    })
  })
})
```

Run tests:
```bash
cd packages/opencode
bun test test/server/session-transcript.test.ts
```

### Step 3: Regenerate SDK

After adding server routes, regenerate the SDK:

```bash
cd packages/sdk/js
bun run build
```

This will:
1. Run `bun dev generate` to extract OpenAPI spec from the server
2. Generate TypeScript types and client methods
3. Build the SDK package

**Verify the new types exist:**
```bash
grep -r "transcriptAdd" packages/sdk/js/src/v2/gen/
```

### Step 4: Use in Client App

Now use the generated SDK in the app:

```typescript
// packages/app/src/components/prompt-input.tsx
import { useSDK } from "@/context/sdk"

function MyComponent() {
  const sdk = useSDK()

  const sendTranscript = async () => {
    // Type-safe API call with proper headers
    const response = await sdk.client.session.transcriptAdd({
      sessionID: session.id,
      role: "user",
      text: "Hello!",
      metadata: { source: "text" },
    })

    if (response.data) {
      console.log("Created message:", response.data.messageID)
    }
  }
}
```

## Why This Pattern?

### Type Safety
Generated types ensure request and response shapes are correct at compile time.

### Automatic Headers
The SDK client automatically includes:
- `x-opencode-directory` header for project context
- Proper Content-Type headers
- Custom timeout handling

### Consistency
All API calls follow the same pattern, making the codebase easier to maintain.

### Error Handling
Generated client provides consistent error handling across all endpoints.

## Common Mistakes

### Using Raw Fetch
```typescript
// WRONG - Missing headers, no type safety
await fetch(`${url}/session/${id}/transcript`, {
  method: "POST",
  body: JSON.stringify({ role: "user", text }),
})

// CORRECT - Use SDK client
await sdk.client.session.transcriptAdd({
  sessionID: id,
  role: "user",
  text,
})
```

### Forgetting to Regenerate SDK
If you add a server route but don't regenerate the SDK, the client method won't exist. Always run:
```bash
cd packages/sdk/js && bun run build
```

### Missing OpenAPI Annotations
Routes without `describeRoute()` won't be included in the generated SDK.

## File Reference

| File | Purpose |
|------|---------|
| `packages/opencode/src/server/routes/*.ts` | Server route definitions |
| `packages/opencode/src/server/server.ts` | Route registration |
| `packages/sdk/js/script/build.ts` | SDK generation script |
| `packages/sdk/js/src/v2/gen/*.ts` | Generated SDK files |
| `packages/sdk/js/src/v2/client.ts` | Client factory function |
| `packages/app/src/context/sdk.tsx` | App SDK context |
