# Phase 5: Ephemeral Key Generation (Production)

## Goal

Replace client-side API keys with ephemeral tokens. The client requests a short-lived token from the OpenCode server, which generates it using the main API key. This keeps the main key secure on the server.

## Architecture

```
┌─────────────────┐                          ┌─────────────────┐
│   Web Client    │                          │  OpenAI Realtime│
│                 │                          │       API       │
│  1. Request     │                          │                 │
│     token       │                          │                 │
└────────┬────────┘                          └────────▲────────┘
         │                                            │
         │ GET /realtime-v2/:sessionID/token          │
         ▼                                            │
┌─────────────────┐     POST /realtime/sessions      │
│  OpenCode Server│─────────────────────────────────►│
│                 │◄────────────────────────────────  │
│  Uses main API  │     { client_secret: "ek_..." }  │
│  key to get     │                                   │
│  ephemeral key  │                                   │
└─────────────────┘                                   │
         │                                            │
         │ 2. Return ephemeral token                  │
         ▼                                            │
┌─────────────────┐                                   │
│   Web Client    │                                   │
│                 │    3. Connect with ephemeral key  │
│  ek_abc123...   │───────────────────────────────────┘
└─────────────────┘
```

## Server Implementation

### 1. Ephemeral Key Endpoint

```typescript
// src/realtime-v2/server/ephemeral.ts

import { z } from "zod"
import { Provider } from "../../provider/provider"
import { Log } from "../../util/log"

const log = Log.create({ service: "realtime-v2.ephemeral" })

export const EphemeralTokenInput = z.object({
  model: z.string().optional().default("gpt-4o-realtime-preview"),
  voice: z.string().optional().default("alloy"),
  instructions: z.string().optional(),
})

export const EphemeralTokenOutput = z.object({
  token: z.string(),
  expires_at: z.number(),
  model: z.string(),
})

export async function generateEphemeralToken(
  sessionID: string,
  input: z.infer<typeof EphemeralTokenInput>,
): Promise<z.infer<typeof EphemeralTokenOutput>> {
  log.info("generating ephemeral token", { sessionID, model: input.model })

  // Get OpenAI API key from provider config
  const openaiProvider = await Provider.getProvider("openai")
  if (!openaiProvider?.key) {
    throw new Error("OpenAI API key not configured")
  }

  // Call OpenAI's session creation endpoint
  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiProvider.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      voice: input.voice,
      instructions: input.instructions,
      // Tools can be configured here too
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    log.error("failed to generate ephemeral token", { sessionID, error })
    throw new Error(`Failed to generate token: ${error}`)
  }

  const data = await response.json()

  log.info("ephemeral token generated", {
    sessionID,
    expires_at: data.expires_at,
  })

  return {
    token: data.client_secret.value,
    expires_at: data.expires_at,
    model: input.model,
  }
}
```

### 2. Add Route

```typescript
// Update src/realtime-v2/server/routes.ts

import { generateEphemeralToken, EphemeralTokenInput, EphemeralTokenOutput } from "./ephemeral"

// Add to RealtimeV2Routes:
.post(
  "/:sessionID/token",
  validator("param", z.object({ sessionID: z.string() })),
  validator("json", EphemeralTokenInput.optional()),
  async (c) => {
    const { sessionID } = c.req.valid("param")
    const input = c.req.valid("json") ?? {}

    try {
      const result = await generateEphemeralToken(sessionID, input)
      return c.json(result)
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Token generation failed" },
        500,
      )
    }
  },
)
```

## Client Implementation

### 1. Update Hook to Use Ephemeral Keys

```typescript
// Update useRealtimeV2.ts

interface UseRealtimeV2Options {
  // Remove: apiKey: string
  sessionID: string
  serverUrl: string
  model?: string
  voice?: string
  // ... other options
}

export function useRealtimeV2(options: UseRealtimeV2Options) {
  const [token, setToken] = useState<string | null>(null)
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(null)

  // Fetch ephemeral token from server
  const fetchToken = useCallback(async () => {
    const res = await fetch(`${options.serverUrl}/realtime-v2/${options.sessionID}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        voice: options.voice,
      }),
    })

    if (!res.ok) {
      throw new Error("Failed to get token")
    }

    const data = await res.json()
    setToken(data.token)
    setTokenExpiry(data.expires_at)
    return data.token
  }, [options.serverUrl, options.sessionID, options.model, options.voice])

  const connect = useCallback(async () => {
    // Get fresh token
    const ephemeralToken = await fetchToken()

    const transport = new OpenAIRealtimeWebSocket({
      apiKey: ephemeralToken,  // Use ephemeral token
      model: options.model ?? "gpt-4o-realtime-preview",
      // No useInsecureApiKey needed - ephemeral keys are designed for client use
    })

    // ... rest of connection setup
  }, [fetchToken, options.model])

  // Token refresh logic
  useEffect(() => {
    if (!tokenExpiry) return

    // Refresh token 5 minutes before expiry
    const refreshTime = (tokenExpiry * 1000) - Date.now() - (5 * 60 * 1000)

    if (refreshTime > 0) {
      const timeout = setTimeout(async () => {
        const newToken = await fetchToken()
        // Note: May need to reconnect with new token
        console.log("[realtime] token refreshed")
      }, refreshTime)

      return () => clearTimeout(timeout)
    }
  }, [tokenExpiry, fetchToken])

  return {
    // ... existing returns
    tokenExpiry,
  }
}
```

### 2. Remove API Key Input from UI

```typescript
// Update RealtimeV2Full.tsx

// No more API key input needed!
export function RealtimeV2Full({ sessionID, serverUrl }: Props) {
  const realtime = useRealtimeV2({
    sessionID,
    serverUrl,
    enableVoice: true,
    enablePersistence: true,
    enableTools: true,
  })

  // ...
}
```

## OpenAI Session API

The session creation endpoint: `POST https://api.openai.com/v1/realtime/sessions`

Request:
```json
{
  "model": "gpt-4o-realtime-preview",
  "voice": "alloy",
  "instructions": "You are a helpful assistant.",
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "description": "Get current weather",
      "parameters": { ... }
    }
  ]
}
```

Response:
```json
{
  "id": "sess_abc123",
  "object": "realtime.session",
  "model": "gpt-4o-realtime-preview",
  "voice": "alloy",
  "expires_at": 1699000000,
  "client_secret": {
    "value": "ek_abc123...",
    "expires_at": 1699000000
  }
}
```

## Security Benefits

1. **Main API key never exposed to client**
2. **Tokens are short-lived** (typically 1 hour)
3. **Tokens are scoped** to specific model/voice/tools
4. **Revocation**: If compromised, wait for expiry (or implement revocation)
5. **Audit trail**: Server logs all token generations

## Token Lifecycle

```
1. Client requests token → Server generates with main key
2. Server returns ephemeral token (expires in ~1 hour)
3. Client connects to OpenAI with ephemeral token
4. Before expiry, client requests new token
5. Client reconnects with new token
```

## Error Handling

```typescript
// Handle token expiry during session
transport.on("error", async (err) => {
  if (err.error?.code === "token_expired") {
    console.log("[realtime] token expired, refreshing...")
    const newToken = await fetchToken()
    // Reconnect logic
  }
})
```

## Success Criteria

- [ ] Server generates ephemeral tokens
- [ ] Client fetches token before connecting
- [ ] Connection works with ephemeral token
- [ ] Token refresh before expiry
- [ ] Graceful reconnection on token expiry
- [ ] Main API key never sent to client

## Rate Limiting

Consider rate limiting token generation:

```typescript
// Simple in-memory rate limiting
const tokenRequests = new Map<string, number[]>()
const MAX_REQUESTS_PER_MINUTE = 10

function checkRateLimit(sessionID: string): boolean {
  const now = Date.now()
  const requests = tokenRequests.get(sessionID) ?? []
  const recentRequests = requests.filter((t) => now - t < 60000)

  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    return false
  }

  tokenRequests.set(sessionID, [...recentRequests, now])
  return true
}
```

## Notes

- Ephemeral keys start with `ek_` prefix
- Default expiry is 1 hour
- Tools configured at token creation are immutable for that session
- For production, consider caching tokens until near expiry
