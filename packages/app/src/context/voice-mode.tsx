import { createSignal, onMount, createEffect, on } from "solid-js"
import { produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "@/context/global-sync"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useRealtimeConnection } from "@/hooks/use-realtime-connection"
import { Identifier } from "@/utils/id"
import { Binary } from "@opencode-ai/util/binary"
import type { Part, AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2/client"

export type VoiceStatus = "disconnected" | "connecting" | "connected" | "error"

interface VoiceModeProps {
  sessionID?: string
}

export const { use: useVoiceMode, provider: VoiceModeProvider } = createSimpleContext({
  name: "VoiceMode",
  gate: false, // Don't block rendering while connecting
  init: (props: VoiceModeProps) => {
    const globalSync = useGlobalSync()
    const local = useLocal()
    const sdk = useSDK()

    // Audio state - both enabled by default when session starts
    const [micMuted, setMicMuted] = createSignal(false)
    const [speakerMuted, setSpeakerMuted] = createSignal(false)

    // Session ID and directory from context
    const sessionID = () => props.sessionID
    const directory = () => sdk.directory

    // Check if the current model supports voice
    const isVoiceModel = () => local.model.current()?.voice === true

    // Helper to get output modalities based on speaker state
    // OpenAI only supports ["text"] OR ["audio"], not both
    const getOutputModalities = (): ("text" | "audio")[] => {
      return speakerMuted() ? ["text"] : ["audio"]
    }

    // Store transcript on the server (for voice input from microphone)
    const storeTranscript = async (
      role: "user" | "assistant",
      text: string,
      messageID?: string,
      partID?: string,
    ) => {
      const sid = sessionID()
      if (!sid || !text.trim()) return

      try {
        const response = await sdk.client.session.transcript.add({
          sessionID: sid,
          role,
          messageID,
          parts: [
            {
              id: partID,
              type: "text",
              text,
              metadata: { source: "realtime" },
            },
          ],
        })
        if (response.error) {
          console.error("[voice] transcript store failed:", response.error)
        } else {
          console.log("[voice] transcript stored:", role, text.substring(0, 50) + "...")
        }
      } catch (err) {
        console.error("[voice] transcript store error:", err)
      }
    }

    // Add assistant message to sync store for immediate UI update
    const addAssistantMessageToUI = (text: string) => {
      const sid = sessionID()
      const dir = directory()
      if (!sid || !dir || !text.trim()) return

      const messageID = Identifier.ascending("message")
      const partID = Identifier.ascending("part")

      const message = {
        id: messageID,
        sessionID: sid,
        role: "assistant" as const,
        time: { created: Date.now() },
        parentID: "",
        modelID: "gpt-realtime",
        providerID: "openai",
        mode: "build",
        agent: "default",
        path: { cwd: dir, root: dir },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      } as AssistantMessage

      const part = {
        id: partID,
        sessionID: sid,
        messageID,
        type: "text" as const,
        text,
      } as Part

      const [store, setStore] = globalSync.child(dir)

      const existingMessages = store.message[sid]
      if (!existingMessages) {
        setStore("message", sid, [message])
      } else {
        const result = Binary.search(existingMessages, messageID, (m: { id: string }) => m.id)
        setStore(
          "message",
          sid,
          produce((draft) => {
            draft.splice(result.index, 0, message)
          }),
        )
      }
      setStore("part", messageID, [part])

      console.log("[voice] added assistant message to UI:", text.substring(0, 50) + "...")
      return { messageID, partID }
    }

    // Add user message to sync store for immediate UI update
    const addUserMessageToUI = (text: string) => {
      const sid = sessionID()
      const dir = directory()
      if (!sid || !dir || !text.trim()) return null

      const messageID = Identifier.ascending("message")
      const partID = Identifier.ascending("part")

      const message = {
        id: messageID,
        sessionID: sid,
        role: "user" as const,
        time: { created: Date.now() },
        agent: "default",
        model: { providerID: "openai", modelID: "gpt-realtime" },
      } as UserMessage

      const part = {
        id: partID,
        sessionID: sid,
        messageID,
        type: "text" as const,
        text,
      } as Part

      const [store, setStore] = globalSync.child(dir)

      const existingMessages = store.message[sid]
      if (!existingMessages) {
        setStore("message", sid, [message])
      } else {
        const result = Binary.search(existingMessages, messageID, (m: { id: string }) => m.id)
        setStore(
          "message",
          sid,
          produce((draft) => {
            draft.splice(result.index, 0, message)
          }),
        )
      }
      setStore("part", messageID, [part])

      console.log("[voice] added user message to UI:", text.substring(0, 50) + "...")
      return { messageID, partID }
    }

    // Handle transport events (voice input transcripts)
    const handleTransportEvent = (event: { type: string; [key: string]: unknown }) => {
      // User voice transcript completed
      if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
        const transcript = event.transcript as string
        console.log("[voice] user voice transcript complete:", transcript.substring(0, 50) + "...")
        const ids = addUserMessageToUI(transcript)
        if (ids) {
          void storeTranscript("user", transcript, ids.messageID, ids.partID)
        }
      }

      // Assistant response completed
      const assistantText =
        (event.type === "response.output_audio_transcript.done" && (event.transcript as string)) ||
        (event.type === "response.output_text.done" && (event.text as string))

      if (assistantText) {
        console.log("[voice] assistant response complete:", assistantText.substring(0, 50) + "...")
        const ids = addAssistantMessageToUI(assistantText)
        if (ids) {
          void storeTranscript("assistant", assistantText, ids.messageID, ids.partID)
        }
      }
    }

    // Handle history added events
    const handleHistoryAdded = (item: unknown) => {
      const historyItem = item as {
        role?: string
        content?: Array<{ type: string; transcript?: string; text?: string }>
      }

      if (historyItem.role === "assistant" && historyItem.content) {
        const transcriptParts = historyItem.content
          .filter((c) => c.type === "audio" || c.type === "text")
          .map((c) => c.transcript || c.text || "")
          .filter(Boolean)

        if (transcriptParts.length > 0) {
          const fullTranscript = transcriptParts.join(" ")
          void storeTranscript("assistant", fullTranscript)
        }
      }
    }

    // Use the realtime connection hook
    const connection = useRealtimeConnection(sessionID, {
      outputModalities: getOutputModalities(),
      onTransportEvent: handleTransportEvent,
      onHistoryAdded: handleHistoryAdded,
    })

    // Toggle microphone
    const toggleMic = () => {
      if (connection.status() !== "connected") {
        console.log("[voice] toggleMic: not connected")
        return
      }

      const newMuted = !micMuted()
      setMicMuted(newMuted)
      connection.muteMic(newMuted)
    }

    // Toggle speaker - mutes audio element AND updates server modalities
    const toggleSpeaker = () => {
      const newMuted = !speakerMuted()
      setSpeakerMuted(newMuted)

      // Mute the audio element
      connection.muteSpeaker(newMuted)

      // Update server modalities (OpenAI only supports ["text"] OR ["audio"])
      if (connection.status() === "connected") {
        const newModalities: ("text" | "audio")[] = newMuted ? ["text"] : ["audio"]
        connection.updateSessionConfig({ outputModalities: newModalities })
      }
    }

    // Send text to the realtime agent (transcript storage handled by caller)
    const sendText = (text: string): boolean => {
      return connection.sendMessage(text)
    }

    // Auto-connect on mount if voice model is selected AND we have a session
    onMount(() => {
      if (isVoiceModel() && sessionID()) {
        console.log("[voice] auto-connecting on mount for session:", sessionID())
        connection.connect()
      }
    })

    // Handle model changes - connect/disconnect WebRTC as needed
    createEffect(
      on(
        () => isVoiceModel(),
        (isVoice, wasVoice) => {
          // Model switched TO voice - connect WebRTC
          if (isVoice && !wasVoice && sessionID()) {
            console.log("[voice] model switched to voice, connecting")
            connection.connect()
          }
          // Model switched AWAY from voice - disconnect WebRTC
          if (!isVoice && wasVoice) {
            console.log("[voice] model switched away from voice, disconnecting")
            connection.disconnect()
          }
        },
        { defer: true },
      ),
    )

    return {
      status: connection.status,
      error: connection.error,
      toggle: connection.toggle,
      connect: connection.connect,
      disconnect: connection.disconnect,
      sendText,
      micMuted,
      speakerMuted,
      toggleMic,
      toggleSpeaker,
    }
  },
})
