import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import {
  RealtimeSession,
  RealtimeAgent,
  OpenAIRealtimeWebRTC,
} from "@openai/agents/realtime"
import { useServer } from "@/context/server"

export type VoiceStatus = "disconnected" | "connecting" | "connected" | "error"

export const { use: useVoiceMode, provider: VoiceModeProvider } = createSimpleContext({
  name: "VoiceMode",
  init: () => {
    const server = useServer()
    const [status, setStatus] = createSignal<VoiceStatus>("disconnected")
    const [error, setError] = createSignal<string | null>(null)

    let session: RealtimeSession | null = null
    let audioElement: HTMLAudioElement | null = null

    const fetchEphemeralKey = async (): Promise<string | null> => {
      try {
        const response = await fetch(`${server.url}/realtime/session`)
        const data = await response.json()

        if (!response.ok) {
          console.error("[voice] session endpoint error", data)
          return null
        }

        console.log("[voice] session response:", JSON.stringify(data, null, 2))

        // Try new format first (value at top level), then old format (client_secret.value)
        const ephemeralKey = data.value || data.client_secret?.value
        if (!ephemeralKey) {
          console.error("[voice] no ephemeral key in response", data)
          return null
        }

        console.log("[voice] ephemeral key:", ephemeralKey.substring(0, 20) + "...")
        return ephemeralKey
      } catch (err) {
        console.error("[voice] failed to fetch ephemeral key", err)
        return null
      }
    }

    const connect = async () => {
      setStatus("connecting")
      setError(null)

      try {
        // Fetch ephemeral key from server
        const ephemeralKey = await fetchEphemeralKey()
        if (!ephemeralKey) {
          setError("Failed to get session token. Is OpenAI provider configured?")
          setStatus("error")
          return
        }

        // Create hidden audio element for playback
        audioElement = document.createElement("audio")
        audioElement.autoplay = true
        audioElement.style.display = "none"
        document.body.appendChild(audioElement)

        // Create agent
        const agent = new RealtimeAgent({
          name: "Assistant",
          instructions: "You are a helpful assistant. Keep responses concise.",
        })

        // Create session with WebRTC transport
        session = new RealtimeSession(agent, {
          transport: new OpenAIRealtimeWebRTC({
            audioElement,
          }),
          model: "gpt-realtime",
        })

        // Log all events
        session.on("error", (err: unknown) => {
          console.log("[voice] error", err)
          setError(String(err))
          setStatus("error")
        })

        session.on("history_added", (item: unknown) => {
          console.log("[voice] history_added", item)
        })

        session.on("history_updated", (history: unknown) => {
          console.log("[voice] history_updated", history)
        })

        session.on("transport_event", (event: { type: string }) => {
          console.log("[voice] transport_event", event.type, event)
        })

        // Connect with ephemeral key
        await session.connect({ apiKey: ephemeralKey })
        console.log("[voice] connected")
        setStatus("connected")
      } catch (err) {
        console.error("[voice] connection error", err)
        setError(err instanceof Error ? err.message : String(err))
        setStatus("error")
        cleanup()
      }
    }

    const disconnect = () => {
      console.log("[voice] disconnecting")
      cleanup()
      setStatus("disconnected")
    }

    const cleanup = () => {
      if (session) {
        session.close()
        session = null
      }
      if (audioElement) {
        audioElement.remove()
        audioElement = null
      }
    }

    const toggle = () => {
      if (status() === "connected" || status() === "connecting") {
        disconnect()
      } else {
        connect()
      }
    }

    onCleanup(cleanup)

    return {
      status,
      error,
      toggle,
      connect,
      disconnect,
    }
  },
})
