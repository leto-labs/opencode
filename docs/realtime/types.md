# TypeScript Types for Realtime

This document describes the TypeScript types used for realtime voice support.

## Message Parts

### TextPart with Realtime Metadata

Transcripts are stored as regular `TextPart` with realtime metadata:

```typescript
interface TextPart {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean // true for transcribed audio
  time?: {
    start: number
    end?: number
  }
  metadata?: {
    realtime?: boolean
    source?: "user_audio" | "assistant_audio" | "assistant_text"
    item_id?: string
    response_id?: string
  }
}
```

### RealtimeEventPart

Represents VAD and conversation flow events:

```typescript
interface RealtimeEventPart {
  id: string
  sessionID: string
  messageID: string
  type: "realtime_event"
  event: "speech_started" | "speech_stopped"
  time: number
  metadata?: {
    audio_start_ms?: number
    audio_end_ms?: number
    item_id?: string
  }
}
```

### ToolState Extension

```typescript
type ToolStatus = "pending" | "running" | "completed" | "error" | "interrupted" // New for realtime

interface ToolStateInterrupted {
  status: "interrupted"
  input: Record<string, any>
  reason: "user_speech" | "response_cancel" | "connection_lost"
  partialOutput?: string
  time: {
    start: number
    end: number
  }
}
```

## API Types

### Transcript Event (Client → Server)

```typescript
interface TranscriptEvent {
  type: "user_transcript" | "assistant_transcript" | "speech_started" | "speech_stopped"
  text?: string
  item_id?: string
  response_id?: string
  timestamp: number
}

interface TranscriptInput {
  events: TranscriptEvent[]
}
```

### Tool Call (Client → Server)

```typescript
interface ToolCallInput {
  call_id: string
  name: string
  arguments: string // JSON string
}

interface ToolCallOutput {
  call_id: string
  output: string
  error?: string
}
```

### Ephemeral Token

```typescript
interface EphemeralTokenInput {
  model?: string
  voice?: string
  instructions?: string
}

interface EphemeralTokenOutput {
  token: string // ek_...
  expires_at: number // Unix timestamp
  model: string
}
```

### Tool Definition

```typescript
interface ToolDefinition {
  type: "function"
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<
      string,
      {
        type: string
        description?: string
        enum?: string[]
      }
    >
    required?: string[]
  }
}
```

## Client Hook Types

### UseRealtimeV2 Options

```typescript
interface UseRealtimeV2Options {
  sessionID: string
  serverUrl: string
  model?: string
  voice?: string
  enableVoice?: boolean
  enablePersistence?: boolean
  enableTools?: boolean
  onToolCall?: (name: string, args: any) => void
  onToolResult?: (name: string, result: any) => void
}
```

### UseRealtimeV2 Return

```typescript
interface UseRealtimeV2Return {
  status: "disconnected" | "connecting" | "connected"
  messages: Message[]
  error: Error | null
  connect: () => Promise<void>
  disconnect: () => void
  sendMessage: (text: string) => void
  isCapturing: boolean
  isPlaying: boolean
  toggleMute: () => void
  tokenExpiry?: number
}

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: number
}
```

## SDK Types (from @openai/agents-realtime)

### Transport Events

```typescript
// Connection state
type ConnectionStatus = "disconnected" | "connecting" | "connected"

// Audio event
interface TransportLayerAudio {
  type: "audio"
  data: ArrayBuffer
  responseId: string
}

// Function call event
interface TransportToolCallEvent {
  id: string
  type: "function_call"
  callId: string
  name: string
  arguments: string
}
```

### Session Config

```typescript
interface RealtimeSessionConfig {
  model?: string
  instructions?: string
  voice?: string
  outputModalities?: ("text" | "audio")[]
  tools?: ToolDefinition[]
  toolChoice?: "auto" | "none" | "required"
  audio?: {
    input?: {
      format?: AudioFormat
      transcription?: { model: string }
      turnDetection?: TurnDetectionConfig
    }
    output?: {
      format?: AudioFormat
      voice?: string
      speed?: number
    }
  }
}

type AudioFormat = { type: "audio/pcm"; rate: number } | { type: "audio/pcmu" } | { type: "audio/pcma" }

interface TurnDetectionConfig {
  type: "semantic_vad" | "server_vad" | "none"
  eagerness?: "low" | "medium" | "high"
  threshold?: number
  silence_duration_ms?: number
}
```

## Server Event Types (Zod Schemas)

The SDK exports Zod schemas for all events. Key ones:

```typescript
import { z } from "zod"
import {
  conversationItemInputAudioTranscriptionCompletedEventSchema,
  responseAudioTranscriptDeltaEventSchema,
  responseAudioTranscriptDoneEventSchema,
  inputAudioBufferSpeechStartedEventSchema,
  inputAudioBufferSpeechStoppedEventSchema,
  type RealtimeServerEvent,
} from "@openai/agents-realtime/dist/openaiRealtimeEvents"

// Derive types
type UserTranscriptEvent = z.infer<typeof conversationItemInputAudioTranscriptionCompletedEventSchema>
type AssistantTranscriptEvent = z.infer<typeof responseAudioTranscriptDoneEventSchema>
```

## Audio Utility Types

```typescript
interface PCM16Options {
  sampleRate: number // 24000
  channels: number // 1 (mono)
}

// Conversion functions
function float32ToPcm16(float32: Float32Array): Int16Array
function pcm16ToFloat32(pcm16: Int16Array): Float32Array
function encodeBase64(pcm16: Int16Array): string
function decodeBase64(base64: string): Int16Array
```

## Error Types

```typescript
class RealtimeError extends Error {
  code?: string
}

class RealtimeConnectionError extends RealtimeError {
  retryable = true
  socketCode?: string
}

class RealtimeAuthError extends RealtimeError {
  retryable = false
}

class RealtimeTimeoutError extends RealtimeError {
  retryable = true
}
```
