import { createSignal, onCleanup, createEffect, on, type Accessor } from "solid-js"
import { RealtimeSession, RealtimeAgent, OpenAIRealtimeWebRTC } from "@openai/agents/realtime"
import type { RealtimeItem } from "@openai/agents-realtime"
import { useSDK } from "@/context/sdk"
import { toOpenAIAgentTools, type ServerToolDefinition } from "@/util/openai-realtime-tool"

export type RealtimeStatus = "disconnected" | "connecting" | "connected" | "error"

export interface RealtimeConnectionConfig {
  /** Output modalities for the session */
  outputModalities?: ("text" | "audio")[]
  /** Callback when transport events occur */
  onTransportEvent?: (event: { type: string; [key: string]: unknown }) => void
  /** Callback when history is added */
  onHistoryAdded?: (item: unknown) => void
  /** Callback when history is updated */
  onHistoryUpdated?: (history: unknown) => void
  /** Callback when a tool is called (for logging/UI) */
  onToolCall?: (toolCall: { name: string; callId: string; arguments: unknown }) => void
}

/**
 * Hook for managing OpenAI Realtime WebRTC connections.
 *
 * Handles:
 * - Token fetching (with caching via client_secret API)
 * - WebRTC connection lifecycle
 * - Session/transport management
 * - Automatic cleanup on unmount
 *
 * Does NOT handle:
 * - Transcript storage (caller's responsibility)
 * - UI updates (caller's responsibility)
 */
export function useRealtimeConnection(
  sessionID: Accessor<string | undefined>,
  config: RealtimeConnectionConfig,
) {
  const [status, setStatus] = createSignal<RealtimeStatus>("disconnected")
  const [error, setError] = createSignal<string | null>(null)
  const sdk = useSDK()

  let session: RealtimeSession | null = null
  let transport: OpenAIRealtimeWebRTC | null = null
  let audioElement: HTMLAudioElement | null = null
  let connectAborted = false

  // Fetch ephemeral key from server (with caching)
  const fetchEphemeralKey = async (): Promise<string | null> => {
    const sid = sessionID()
    if (!sid) {
      console.error("[realtime] fetchEphemeralKey: no session ID")
      return null
    }

    try {
      // First try to get a cached token
      const cachedResponse = await sdk.client.session.clientSecret.get({ sessionID: sid })
      if (cachedResponse.data?.value) {
        console.log("[realtime] using cached ephemeral key")
        return cachedResponse.data.value
      }

      // No cached token, create a new one
      const response = await sdk.client.session.clientSecret.create({ sessionID: sid })

      if (response.error) {
        console.error("[realtime] client_secret endpoint error", response.error)
        return null
      }

      const ephemeralKey = response.data?.value
      if (!ephemeralKey) {
        console.error("[realtime] no ephemeral key in response", response.data)
        return null
      }

      console.log("[realtime] ephemeral key:", ephemeralKey.substring(0, 20) + "...")
      return ephemeralKey
    } catch (err) {
      console.error("[realtime] failed to fetch ephemeral key", err)
      return null
    }
  }

  // Fetch tools from server
  const fetchToolDefinitions = async (): Promise<ServerToolDefinition[]> => {
    const sid = sessionID()
    if (!sid) return []

    try {
      const response = await sdk.client.session.tools.list({ sessionID: sid })
      if (response.error || !response.data) {
        console.log("[realtime] failed to fetch tools:", response.error)
        return []
      }
      console.log("[realtime] fetched", response.data.length, "tool definitions")
      return response.data as ServerToolDefinition[]
    } catch (err) {
      console.error("[realtime] failed to fetch tools:", err)
      return []
    }
  }

  // Fetch system prompt from server
  const fetchSystemPrompt = async (): Promise<string> => {
    const sid = sessionID()
    if (!sid) return "You are a helpful assistant."

    try {
      const response = await sdk.client.session.systemPrompt.get({
        sessionID: sid,
        modelID: "gpt-realtime",
        providerID: "openai",
      })
      if (response.error || !response.data) {
        console.log("[realtime] failed to fetch system prompt:", response.error)
        return "You are a helpful assistant."
      }
      console.log("[realtime] fetched system prompt:", response.data.instructions.substring(0, 100) + "...")
      return response.data.instructions
    } catch (err) {
      console.error("[realtime] failed to fetch system prompt:", err)
      return "You are a helpful assistant."
    }
  }

  // Load conversation history from session
  const loadConversationHistory = async (): Promise<RealtimeItem[] | null> => {
    const sid = sessionID()
    if (!sid) return null

    try {
      const response = await sdk.client.session.messages({
        sessionID: sid,
        limit: 20,
      })

      if (response.error || !response.data) {
        console.log("[realtime] no conversation history to load")
        return null
      }

      const messages = response.data
      if (messages.length === 0) {
        console.log("[realtime] empty conversation history")
        return null
      }

      const historyItems: RealtimeItem[] = []
      let prevItemId: string | null = null

      for (const m of messages) {
        if (m.info.role !== "user" && m.info.role !== "assistant") continue

        const textParts = m.parts
          .filter((p: { type: string }) => p.type === "text")
          .map((p: { type: string; text?: string }) => p.text ?? "")
          .join("\n")

        if (!textParts.trim()) continue

        const itemId = `hist_${historyItems.length}`

        if (m.info.role === "user") {
          historyItems.push({
            itemId,
            previousItemId: prevItemId,
            type: "message",
            role: "user",
            status: "completed",
            content: [{ type: "input_text", text: textParts }],
          })
        } else {
          historyItems.push({
            itemId,
            previousItemId: prevItemId,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: textParts }],
          })
        }

        prevItemId = itemId
      }

      console.log("[realtime] loaded conversation history:", historyItems.length, "items")
      return historyItems.length > 0 ? historyItems : null
    } catch (err) {
      console.error("[realtime] failed to load conversation history:", err)
      return null
    }
  }

  const connect = async () => {
    const sid = sessionID()
    if (!sid) {
      console.log("[realtime] connect: no session ID")
      return
    }

    // Already connected or connecting
    if (status() === "connected" || status() === "connecting") {
      console.log("[realtime] already", status())
      return
    }

    console.log("[realtime] connecting to session:", sid)
    connectAborted = false
    setStatus("connecting")
    setError(null)

    try {
      // Fetch ephemeral key from server
      const ephemeralKey = await fetchEphemeralKey()

      // Check if connection was aborted during async operation
      if (connectAborted) {
        console.log("[realtime] connection aborted during key fetch")
        setStatus("disconnected")
        return
      }

      if (!ephemeralKey) {
        setError("Failed to get session token. Is OpenAI provider configured?")
        setStatus("error")
        return
      }

      // Fetch tool definitions and system prompt from server in parallel
      const [allToolDefinitions, instructions] = await Promise.all([fetchToolDefinitions(), fetchSystemPrompt()])

      // Filter to only voice-safe tools (exclude tools that spawn sub-agents or require UI)
      const VOICE_SAFE_TOOLS = new Set(["read", "glob", "grep", "write", "edit", "bash", "webfetch", "websearch", "codesearch"])
      const toolDefinitions = allToolDefinitions.filter((t) => VOICE_SAFE_TOOLS.has(t.name))

      // Log tool definitions for debugging
      console.log("[realtime] fetched tool definitions:", allToolDefinitions.map((t) => t.name))
      console.log("[realtime] filtered to voice-safe tools:", toolDefinitions.map((t) => t.name))

      // Convert server tool definitions to executable OpenAI Agent SDK tools
      const tools = toOpenAIAgentTools(toolDefinitions, {
        sessionID: sid,
        sdk,
        onExecute: (toolName, args) => {
          console.log("[realtime] tool execution started:", toolName, args)
          config.onToolCall?.({ name: toolName, callId: "pending", arguments: args })
        },
        onComplete: (toolName, result, error) => {
          if (error) {
            console.log("[realtime] tool execution failed:", toolName, error)
          } else {
            console.log("[realtime] tool execution completed:", toolName, result)
          }
        },
      })
      console.log("[realtime] created", tools.length, "executable tools:", tools.map((t) => t.name))

      // Check if connection was aborted during async operation
      if (connectAborted) {
        console.log("[realtime] connection aborted during config fetch")
        setStatus("disconnected")
        return
      }

      // Create hidden audio element for playback
      audioElement = document.createElement("audio")
      audioElement.autoplay = true
      audioElement.style.display = "none"
      document.body.appendChild(audioElement)

      // Create agent with server-provided instructions and tools
      const agent = new RealtimeAgent({
        name: "OpenCode",
        instructions,
        tools,
      })

      // Create transport
      transport = new OpenAIRealtimeWebRTC({
        audioElement,
      })

      // Create session
      session = new RealtimeSession(agent, {
        transport,
        model: "gpt-realtime",
        historyStoreAudio: false,
        config: {
          // OpenAI only supports ["text"] OR ["audio"], not both
          outputModalities: config.outputModalities ?? ["audio"],
          audio: {
            input: {
              noiseReduction: { type: "near_field" },
              transcription: {
                model: "gpt-4o-transcribe",
                language: "en",
              },
              turnDetection: {
                type: "semantic_vad",
                eagerness: "medium",
                createResponse: true,
                interruptResponse: true,
              },
            },
            output: {
              voice: "cedar",
              speed: 1.0,
            },
          },
        },
      })

      // Event handlers
      session.on("error", (err: unknown) => {
        console.log("[realtime] error", JSON.stringify(err, null, 2))
        setError(String(err))
        setStatus("error")
      })

      session.on("history_added", (item: unknown) => {
        console.log("[realtime] history_added", item)
        config.onHistoryAdded?.(item)
      })

      session.on("history_updated", (history: unknown) => {
        console.log("[realtime] history_updated", history)
        config.onHistoryUpdated?.(history)
      })

      session.on("transport_event", (event: { type: string; [key: string]: unknown }) => {
        // Log important events for debugging tool calls
        if (
          event.type.includes("function") ||
          event.type.includes("tool") ||
          event.type === "response.created" ||
          event.type === "response.done"
        ) {
          console.log("[realtime] transport_event", event.type, JSON.stringify(event, null, 2))
        } else {
          console.log("[realtime] transport_event", event.type)
        }
        config.onTransportEvent?.(event)
      })

      // Tool execution lifecycle events from SDK
      session.on("agent_tool_start", (item: unknown) => {
        console.log("[realtime] agent_tool_start", JSON.stringify(item, null, 2))
      })

      session.on("agent_tool_end", (item: unknown) => {
        console.log("[realtime] agent_tool_end", JSON.stringify(item, null, 2))
      })

      // Check abort again before expensive WebRTC connection
      if (connectAborted) {
        console.log("[realtime] connection aborted before WebRTC connect")
        cleanup()
        setStatus("disconnected")
        return
      }

      // Connect with ephemeral key
      await session.connect({ apiKey: ephemeralKey })
      console.log("[realtime] connected to session:", sid)

      // Check abort after WebRTC connection
      if (connectAborted) {
        console.log("[realtime] connection aborted after WebRTC connect")
        cleanup()
        setStatus("disconnected")
        return
      }

      // Load and inject conversation history
      const conversationHistory = await loadConversationHistory()
      const historyToInject = conversationHistory ?? []
      session.updateHistory(historyToInject)
      console.log("[realtime] set conversation history:", historyToInject.length, "items")

      setStatus("connected")
      console.log("[realtime] successfully connected to session:", sid)
    } catch (err) {
      console.error("[realtime] connection error", err)
      setError(err instanceof Error ? err.message : String(err))
      setStatus("error")
      cleanup()
    }
  }

  const disconnect = () => {
    console.log("[realtime] disconnecting")
    connectAborted = true
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
    transport = null
  }

  const toggle = () => {
    if (status() === "connected" || status() === "connecting") {
      disconnect()
    } else {
      connect()
    }
  }

  // Send text to the realtime agent
  const sendMessage = (text: string): boolean => {
    if (!session || status() !== "connected") {
      console.log("[realtime] sendMessage: not connected")
      return false
    }

    session.sendMessage(text)
    console.log("[realtime] sendMessage:", text)
    return true
  }

  // Mute/unmute the microphone
  const muteMic = (muted: boolean) => {
    if (!transport || status() !== "connected") {
      console.log("[realtime] muteMic: not connected")
      return
    }
    transport.mute(muted)
    console.log("[realtime] microphone", muted ? "muted" : "unmuted")
  }

  // Mute/unmute the speaker (audio element)
  const muteSpeaker = (muted: boolean) => {
    if (audioElement) {
      audioElement.muted = muted
    }
    console.log("[realtime] speaker", muted ? "muted" : "unmuted")
  }

  // Update session config (e.g., output modalities)
  const updateSessionConfig = (sessionConfig: { outputModalities?: ("text" | "audio")[] }) => {
    if (!transport || status() !== "connected") {
      console.log("[realtime] updateSessionConfig: not connected")
      return
    }
    try {
      transport.updateSessionConfig(sessionConfig)
      console.log("[realtime] session config updated:", sessionConfig)
    } catch (err) {
      console.warn("[realtime] failed to update session config:", err)
    }
  }

  // Cleanup on unmount
  onCleanup(() => {
    console.log("[realtime] hook cleanup")
    disconnect()
  })

  // Disconnect when sessionID changes to a different value
  createEffect(
    on(sessionID, (newSid, oldSid) => {
      if (oldSid && newSid !== oldSid && status() !== "disconnected") {
        console.log("[realtime] sessionID changed, disconnecting")
        disconnect()
      }
    }),
  )

  return {
    status,
    error,
    connect,
    disconnect,
    toggle,
    sendMessage,
    muteMic,
    muteSpeaker,
    updateSessionConfig,
  }
}
