# Phase 2: Transcript Persistence

## Goal

Add transcript persistence to the OpenCode server. The client continues to connect directly to OpenAI, but now also sends transcript events to the server for storage. The web app displays the conversation from the stored session.

## Architecture

```
┌─────────────────┐        WebSocket         ┌─────────────────┐
│   Web Client    │◄────────────────────────►│  OpenAI Realtime│
│                 │                           │       API       │
└────────┬────────┘                           └─────────────────┘
         │
         │ POST /realtime-v2/:sessionID/transcript
         │ (Send transcript events)
         │
         ▼
┌─────────────────┐
│  OpenCode Server│
│                 │
│  - Create/update│
│    session      │
│  - Store parts  │
│  - No agent     │
│    execution    │
└─────────────────┘
```

## Server Implementation

### 1. Transcript API Endpoint

```typescript
// src/realtime-v2/server/routes.ts

import { Hono } from "hono"
import { z } from "zod"
import { validator } from "hono-openapi"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { Identifier } from "../../id/id"

const TranscriptEventSchema = z.object({
  type: z.enum(["user_transcript", "assistant_transcript", "speech_started", "speech_stopped"]),
  text: z.string().optional(),
  item_id: z.string().optional(),
  response_id: z.string().optional(),
  timestamp: z.number(),
})

const TranscriptInput = z.object({
  events: z.array(TranscriptEventSchema),
})

export const RealtimeV2Routes = new Hono()
  // Initialize a realtime session (creates opencode session if needed)
  .post(
    "/:sessionID/init",
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")

      // Get or create session
      let session = await Session.get(sessionID)
      if (!session) {
        session = await Session.create({})
        // Note: This creates a new session, we might want to use the provided ID
      }

      return c.json({
        sessionID: session.id,
        created: true,
      })
    },
  )

  // Receive transcript events from client
  .post(
    "/:sessionID/transcript",
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", TranscriptInput),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { events } = c.req.valid("json")

      // Verify session exists
      const session = await Session.get(sessionID)
      if (!session) {
        return c.json({ error: "Session not found" }, 404)
      }

      // Get or create a message for realtime transcripts
      // We use a single message per realtime session to hold all parts
      let messageID = session.metadata?.realtimeMessageID as string | undefined

      if (!messageID) {
        // Create a new message for realtime content
        const message = await MessageV2.create({
          sessionID,
          role: "user", // Will contain both user and assistant parts
          parts: [],
        })
        messageID = message.id

        // Store reference in session metadata
        await Session.update(sessionID, {
          metadata: {
            ...session.metadata,
            realtimeMessageID: messageID,
          },
        })
      }

      // Convert events to parts
      const parts: MessageV2.Part[] = []

      for (const event of events) {
        if (event.type === "user_transcript" && event.text) {
          parts.push({
            id: Identifier.ascending("part"),
            sessionID,
            messageID,
            type: "text",
            text: event.text,
            synthetic: true, // Transcribed from audio
            time: {
              start: event.timestamp,
              end: event.timestamp,
            },
            metadata: {
              realtime: true,
              source: "user_audio",
              item_id: event.item_id,
            },
          })
        } else if (event.type === "assistant_transcript" && event.text) {
          parts.push({
            id: Identifier.ascending("part"),
            sessionID,
            messageID,
            type: "text",
            text: event.text,
            time: {
              start: event.timestamp,
              end: event.timestamp,
            },
            metadata: {
              realtime: true,
              source: "assistant_audio",
              item_id: event.item_id,
              response_id: event.response_id,
            },
          })
        }
        // speech_started/stopped events could be stored as RealtimeEventParts
      }

      // Persist parts
      for (const part of parts) {
        await MessageV2.addPart(messageID, part)
      }

      return c.json({
        persisted: parts.length,
      })
    },
  )

  // Get transcript for a session
  .get(
    "/:sessionID/transcript",
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")

      const session = await Session.get(sessionID)
      if (!session) {
        return c.json({ error: "Session not found" }, 404)
      }

      const messageID = session.metadata?.realtimeMessageID as string | undefined
      if (!messageID) {
        return c.json({ events: [] })
      }

      const message = await MessageV2.get(messageID)
      if (!message) {
        return c.json({ events: [] })
      }

      // Convert parts back to transcript events for client
      const events = message.parts
        .filter((p) => p.type === "text" && p.metadata?.realtime)
        .map((p) => ({
          type: p.metadata?.source === "user_audio" ? "user_transcript" : "assistant_transcript",
          text: (p as MessageV2.TextPart).text,
          item_id: p.metadata?.item_id,
          response_id: p.metadata?.response_id,
          timestamp: p.time?.start ?? Date.now(),
        }))

      return c.json({ events })
    },
  )
```

### 2. Register Routes

```typescript
// In src/server/server.ts, add:

import { RealtimeV2Routes } from "../realtime-v2/server/routes"

// ... in route setup:
.route("/realtime-v2", RealtimeV2Routes)
```

## Client Updates

### 1. Add Transcript Sync to Hook

```typescript
// Update useRealtimeV2.ts

interface UseRealtimeV2Options {
  apiKey: string
  model?: string
  sessionID?: string      // OpenCode session ID
  serverUrl?: string      // OpenCode server URL
  enablePersistence?: boolean
}

// Add to the hook:
const pendingEvents = useRef<TranscriptEvent[]>([])
const syncInterval = useRef<NodeJS.Timer | null>(null)

const syncTranscripts = useCallback(async () => {
  if (!options.enablePersistence || !options.sessionID || pendingEvents.current.length === 0) {
    return
  }

  const events = [...pendingEvents.current]
  pendingEvents.current = []

  try {
    await fetch(`${options.serverUrl}/realtime-v2/${options.sessionID}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    })
  } catch (err) {
    // Re-queue failed events
    pendingEvents.current = [...events, ...pendingEvents.current]
    console.error("[realtime] transcript sync failed:", err)
  }
}, [options.enablePersistence, options.sessionID, options.serverUrl])

// In connect(), add event listeners:
transport.on("conversation.item.input_audio_transcription.completed", (event) => {
  pendingEvents.current.push({
    type: "user_transcript",
    text: event.transcript,
    item_id: event.item_id,
    timestamp: Date.now(),
  })
})

transport.on("response.output_audio_transcript.done", (event) => {
  pendingEvents.current.push({
    type: "assistant_transcript",
    text: event.transcript,
    item_id: event.item_id,
    response_id: event.response_id,
    timestamp: Date.now(),
  })
})

// Start sync interval
syncInterval.current = setInterval(syncTranscripts, 1000) // Sync every second
```

### 2. Load Existing Transcript

```typescript
// Add to hook:
const loadTranscript = useCallback(async () => {
  if (!options.enablePersistence || !options.sessionID) return

  try {
    const res = await fetch(`${options.serverUrl}/realtime-v2/${options.sessionID}/transcript`)
    const data = await res.json()

    if (data.events) {
      setMessages(data.events.map((e: any) => ({
        role: e.type === "user_transcript" ? "user" : "assistant",
        content: e.text,
        timestamp: e.timestamp,
      })))
    }
  } catch (err) {
    console.error("[realtime] failed to load transcript:", err)
  }
}, [options.enablePersistence, options.sessionID, options.serverUrl])

// Call on mount or session change
useEffect(() => {
  loadTranscript()
}, [loadTranscript])
```

## Data Flow

1. User speaks → OpenAI transcribes → `input_audio_transcription.completed` event
2. Client captures event → Adds to pending queue
3. Sync interval fires → POST events to server
4. Server creates MessageV2 parts → Stores in database
5. Web app queries session → Displays transcript

## Success Criteria

- [ ] Server endpoint receives transcript events
- [ ] Events are stored as MessageV2 parts
- [ ] Transcript persists across page reloads
- [ ] Web app displays conversation history
- [ ] Multiple clients can view same transcript

## Notes

- We batch transcript events to reduce API calls
- Failed syncs are retried automatically
- The session's `realtimeMessageID` tracks the message holding all parts
- No agent execution happens - this is pure storage

## Next Steps

Phase 3 will enable actual voice input/output on the client side.
