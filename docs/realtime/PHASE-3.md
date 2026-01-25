# Phase 3: Enable Voice

## Goal

Enable full voice input and output on the client. User can speak, hear responses, and see the transcript in real-time. All transcripts continue to sync to the OpenCode server.

## Architecture

```
┌─────────────────┐      WebRTC (audio)      ┌─────────────────┐
│   Web Client    │◄────────────────────────►│  OpenAI Realtime│
│                 │                           │       API       │
│  🎤 Microphone  │                           │                 │
│  🔊 Speaker     │                           │  - VAD          │
│  📝 Transcript  │                           │  - STT/TTS      │
└────────┬────────┘                           └─────────────────┘
         │
         │ HTTP (transcript sync)
         ▼
┌─────────────────┐
│  OpenCode Server│
└─────────────────┘
```

## Client Implementation

### 1. Audio Capture Setup

```typescript
// src/hooks/useAudioCapture.ts

import { useRef, useCallback, useState } from "react"

export function useAudioCapture() {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const startCapture = useCallback(async (onAudioData: (data: ArrayBuffer) => void) => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      streamRef.current = stream

      // Set up audio processing
      const audioContext = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0)
        // Convert Float32 to Int16
        const int16Data = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768))
        }
        onAudioData(int16Data.buffer)
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      setIsCapturing(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }, [])

  const stopCapture = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setIsCapturing(false)
  }, [])

  return {
    isCapturing,
    error,
    startCapture,
    stopCapture,
  }
}
```

### 2. Audio Playback

```typescript
// src/hooks/useAudioPlayback.ts

import { useRef, useCallback, useState } from "react"

export function useAudioPlayback() {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const queueRef = useRef<ArrayBuffer[]>([])
  const isProcessingRef = useRef(false)

  const init = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 })
    }
  }, [])

  const playChunk = useCallback(async (audioData: ArrayBuffer) => {
    init()
    queueRef.current.push(audioData)

    if (isProcessingRef.current) return
    isProcessingRef.current = true

    while (queueRef.current.length > 0) {
      const chunk = queueRef.current.shift()!
      const audioContext = audioContextRef.current!

      // Convert Int16 to Float32
      const int16Data = new Int16Array(chunk)
      const float32Data = new Float32Array(int16Data.length)
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768
      }

      const audioBuffer = audioContext.createBuffer(1, float32Data.length, 24000)
      audioBuffer.getChannelData(0).set(float32Data)

      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(audioContext.destination)

      setIsPlaying(true)

      await new Promise<void>((resolve) => {
        source.onended = () => resolve()
        source.start()
      })
    }

    isProcessingRef.current = false
    setIsPlaying(false)
  }, [init])

  const stop = useCallback(() => {
    queueRef.current = []
    setIsPlaying(false)
  }, [])

  return {
    isPlaying,
    playChunk,
    stop,
    init,
  }
}
```

### 3. Update Realtime Hook for Voice

```typescript
// Update useRealtimeV2.ts

import { useAudioCapture } from "./useAudioCapture"
import { useAudioPlayback } from "./useAudioPlayback"

interface UseRealtimeV2Options {
  apiKey: string
  model?: string
  sessionID?: string
  serverUrl?: string
  enablePersistence?: boolean
  enableVoice?: boolean        // NEW
  voice?: string               // NEW: alloy, echo, fable, onyx, nova, shimmer
}

export function useRealtimeV2(options: UseRealtimeV2Options) {
  const audioCapture = useAudioCapture()
  const audioPlayback = useAudioPlayback()

  // ... existing state ...

  const connect = useCallback(async () => {
    // ... existing setup ...

    // Handle audio output from OpenAI
    if (options.enableVoice) {
      transport.on("audio", (event) => {
        audioPlayback.playChunk(event.data)
      })

      transport.on("audio_interrupted", () => {
        audioPlayback.stop()
      })
    }

    // Connect with audio modalities
    await transport.connect({
      model,
      initialSessionConfig: {
        modalities: options.enableVoice ? ["text", "audio"] : ["text"],
        voice: options.voice ?? "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: {
          model: "whisper-1",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        instructions: "You are a helpful assistant. Keep responses concise for voice.",
      },
    })

    // Start audio capture if voice enabled
    if (options.enableVoice) {
      await audioCapture.startCapture((audioData) => {
        transport.sendAudio(audioData)
      })
    }

    // ... rest of setup ...
  }, [/* deps */])

  const disconnect = useCallback(() => {
    audioCapture.stopCapture()
    audioPlayback.stop()
    // ... existing disconnect logic ...
  }, [/* deps */])

  // Toggle mute
  const toggleMute = useCallback(() => {
    // Stop/start audio capture
    if (audioCapture.isCapturing) {
      audioCapture.stopCapture()
    } else {
      audioCapture.startCapture((audioData) => {
        transportRef.current?.sendAudio(audioData)
      })
    }
  }, [audioCapture])

  return {
    // ... existing returns ...
    isCapturing: audioCapture.isCapturing,
    isPlaying: audioPlayback.isPlaying,
    toggleMute,
  }
}
```

### 4. Voice UI Component

```typescript
// src/components/RealtimeV2Voice.tsx

import { useRealtimeV2 } from "../hooks/useRealtimeV2"

export function RealtimeV2Voice({ sessionID, apiKey }: Props) {
  const {
    status,
    messages,
    error,
    connect,
    disconnect,
    isCapturing,
    isPlaying,
    toggleMute,
  } = useRealtimeV2({
    apiKey,
    sessionID,
    enableVoice: true,
    enablePersistence: true,
    voice: "alloy",
  })

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      <div className="flex items-center gap-4 p-4 border-b">
        <button
          onClick={status === "connected" ? disconnect : connect}
          className={`px-4 py-2 rounded ${
            status === "connected" ? "bg-red-500" : "bg-green-500"
          } text-white`}
        >
          {status === "connected" ? "Disconnect" : "Connect"}
        </button>

        {status === "connected" && (
          <button
            onClick={toggleMute}
            className={`px-4 py-2 rounded ${
              isCapturing ? "bg-blue-500" : "bg-gray-500"
            } text-white`}
          >
            {isCapturing ? "🎤 Listening" : "🔇 Muted"}
          </button>
        )}

        {isPlaying && <span className="text-green-500">🔊 Speaking...</span>}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-4 ${msg.role === "user" ? "text-right" : "text-left"}`}
          >
            <div
              className={`inline-block p-3 rounded-lg max-w-[80%] ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-gray-900"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-100 text-red-700">
          {error.message}
        </div>
      )}
    </div>
  )
}
```

## Browser Permissions

The app will need to request microphone permission:

```typescript
// Check permission before connecting
const checkMicrophonePermission = async () => {
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName })
    return result.state
  } catch {
    return "prompt" // Fallback for browsers that don't support permissions API
  }
}
```

## Audio Format Notes

- OpenAI Realtime uses **PCM16 at 24kHz, mono**
- `input_audio_format: "pcm16"` and `output_audio_format: "pcm16"`
- Web Audio API uses Float32, so we convert:
  - Float32 → Int16 for sending
  - Int16 → Float32 for playback

## Success Criteria

- [ ] Microphone capture works
- [ ] Audio streams to OpenAI
- [ ] VAD detects speech start/stop
- [ ] Audio responses play back
- [ ] Transcripts appear in real-time
- [ ] Transcripts sync to server
- [ ] Mute/unmute works
- [ ] Audio playback stops on interruption

## Notes

- VAD (Voice Activity Detection) is handled server-side by OpenAI
- We use ScriptProcessorNode (deprecated but widely supported)
- For production, consider using AudioWorklet instead
- Echo cancellation is enabled in getUserMedia options

## Next Steps

Phase 4 will add tool calling support, allowing the voice assistant to execute actions.
