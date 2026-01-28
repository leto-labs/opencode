import z from "zod"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Log } from "../util/log"
import { fn } from "@/util/fn"
import { Instance } from "../project/instance"

/**
 * SessionTranscript handles storage of messages for client-side inference.
 *
 * Unlike SessionPrompt which handles server-side inference (LLM calls + tool execution),
 * SessionTranscript is used when inference happens client-side (e.g., voice/realtime)
 * and the server is used only for persistence.
 *
 * Key differences from SessionPrompt:
 * - Supports both "user" and "assistant" roles (SessionPrompt only creates user messages)
 * - No agent loop - just stores the message
 * - No file processing, MCP resource fetching, etc. - parts are stored as-is
 */
export namespace SessionTranscript {
  const log = Log.create({ service: "session.transcript" })

  /**
   * Part input schema - matches SessionPrompt.PromptInput.parts
   * Parts are stored as-is without the file/MCP processing that happens in prompt.ts
   */
  const PartInput = z.discriminatedUnion("type", [
    MessageV2.TextPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "TranscriptTextPartInput",
      }),
    MessageV2.FilePart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "TranscriptFilePartInput",
      }),
    MessageV2.AgentPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "TranscriptAgentPartInput",
      }),
    MessageV2.SubtaskPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "TranscriptSubtaskPartInput",
      }),
  ])

  /**
   * Input schema for adding a transcript.
   *
   * Matches SessionPrompt.PromptInput structure but:
   * - Adds `role` field (user or assistant) since prompt only creates user messages
   * - Removes `noReply` (always true for transcripts - no agent loop)
   * - Removes `tools` (deprecated, not relevant for client-side inference)
   * - Removes `system` (no system prompt for transcripts)
   * - Removes `variant` (not relevant for client-side inference)
   */
  export const AddInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    role: z.enum(["user", "assistant"]),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    agent: z.string().optional(),
    parts: z.array(PartInput),
  })
  export type AddInput = z.infer<typeof AddInput>

  /**
   * Output schema for add operation.
   */
  export const AddOutput = z.object({
    info: MessageV2.Info,
    parts: z.array(MessageV2.Part),
  })
  export type AddOutput = z.infer<typeof AddOutput>

  /**
   * Add a transcript message to a session for client-side inference.
   *
   * Creates a message and parts for either a user or assistant transcript.
   * Used by client-side inference sessions (e.g., voice/realtime) to persist
   * conversation history without triggering server-side agent execution.
   */
  export const add = fn(AddInput, async (input): Promise<AddOutput> => {
    const { sessionID, role, parts: inputParts } = input

    // Verify session exists
    const session = await Session.get(sessionID)
    if (!session) {
      throw new Error(`Session not found: ${sessionID}`)
    }

    const now = Date.now()
    const messageID = input.messageID ?? Identifier.ascending("message")

    // Default model for client-side inference
    const model = input.model ?? { providerID: "client", modelID: "client" }
    const agent = input.agent ?? "client"

    // Create message based on role
    let info: MessageV2.Info
    if (role === "user") {
      info = {
        id: messageID,
        role: "user",
        sessionID,
        time: { created: now },
        agent,
        model,
      } satisfies MessageV2.User
    } else {
      // For assistant messages, find the last user message to use as parentID
      const messages = await Session.messages({ sessionID, limit: 10 })
      const lastUserMsg = messages.reverse().find((m) => m.info.role === "user")
      const parentID = lastUserMsg?.info.id ?? messageID

      info = {
        id: messageID,
        role: "assistant",
        sessionID,
        time: { created: now },
        parentID,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: agent,
        agent,
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      } satisfies MessageV2.Assistant
    }

    // Process parts - add messageID and sessionID, generate IDs if not provided
    const parts: MessageV2.Part[] = inputParts.map((part) => ({
      ...part,
      id: part.id ?? Identifier.ascending("part"),
      messageID,
      sessionID,
    })) as MessageV2.Part[]

    // Store message and parts
    await Session.updateMessage(info)
    for (const part of parts) {
      await Session.updatePart(part)
    }

    // Touch session to update timestamp
    await Session.touch(sessionID)

    log.info("created transcript", { sessionID, messageID, role, partCount: parts.length })

    return { info, parts }
  })
}
