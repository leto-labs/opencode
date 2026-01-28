import z from "zod"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Log } from "../util/log"
import { fn } from "@/util/fn"
import { Instance } from "../project/instance"
import { ToolRegistry } from "../tool/registry"
import type { Tool } from "../tool/tool"

/**
 * SessionTool handles tool execution for client-side inference sessions.
 *
 * This module executes tools and stores the results when inference happens
 * client-side (e.g., voice/realtime) and the server is used for tool execution.
 *
 * Key differences from server-side tool execution:
 * - Called directly by client with tool name and arguments
 * - Creates its own assistant message to hold the tool call
 * - Returns result to client for relay back to the inference provider
 */
export namespace SessionTool {
  const log = Log.create({ service: "session.tool" })

  /**
   * Input schema for calling a tool.
   */
  export const CallInput = z.object({
    sessionID: Identifier.schema("session"),
    toolName: z.string(),
    callId: z.string(),
    arguments: z.record(z.string(), z.any()),
  })
  export type CallInput = z.infer<typeof CallInput>

  /**
   * Output schema for tool call.
   */
  export const CallOutput = z.object({
    callId: z.string(),
    result: z.any(),
    error: z.string().optional(),
  })
  export type CallOutput = z.infer<typeof CallOutput>

  /**
   * Execute a tool and return the result.
   *
   * Creates an assistant message to hold the tool call, executes the tool,
   * and updates the tool part with the result or error.
   */
  export const call = fn(CallInput, async (input): Promise<CallOutput> => {
    const { sessionID, toolName, callId, arguments: args } = input

    // Verify session exists
    const session = await Session.get(sessionID)
    if (!session) {
      throw new Error(`Session not found: ${sessionID}`)
    }

    // Find the tool
    const allTools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4" })
    const tool = allTools.find((t) => t.id === toolName)
    if (!tool) {
      return { callId, result: null, error: `Tool not found: ${toolName}` }
    }

    const startTime = Date.now()
    const messageID = Identifier.ascending("message")

    // Get messages for context (required by Tool.Context)
    const messages = await Session.messages({ sessionID, limit: 50 })

    // Find the last user message to use as parentID
    const lastUserMsg = [...messages].reverse().find((m) => m.info.role === "user")
    const parentID = lastUserMsg?.info.id ?? messageID

    // Create assistant message to hold the tool call
    const assistantMessage: MessageV2.Assistant = {
      id: messageID,
      role: "assistant",
      sessionID,
      time: { created: startTime },
      parentID,
      modelID: "client",
      providerID: "client",
      mode: "client",
      agent: "client",
      path: { cwd: Instance.directory, root: Instance.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    await Session.updateMessage(assistantMessage)

    // Create tool part (initially running)
    const partID = Identifier.ascending("part")
    const toolPart: MessageV2.ToolPart = {
      id: partID,
      sessionID,
      messageID,
      type: "tool",
      callID: callId,
      tool: toolName,
      state: {
        status: "running",
        input: args,
        time: { start: startTime },
      },
    }
    await Session.updatePart(toolPart)

    // Execute the tool
    const abortController = new AbortController()
    const ctx: Tool.Context = {
      sessionID,
      messageID,
      agent: "client",
      abort: abortController.signal,
      callID: callId,
      messages,
      metadata: () => {},
      ask: async () => {},
    }

    try {
      const result = await tool.execute(args, ctx)
      const endTime = Date.now()

      // Update tool part with result
      const completedPart: MessageV2.ToolPart = {
        ...toolPart,
        state: {
          status: "completed",
          input: args,
          output: result.output,
          title: result.title || toolName,
          metadata: result.metadata,
          time: { start: startTime, end: endTime },
        },
      }
      await Session.updatePart(completedPart)
      await Session.touch(sessionID)

      log.info("tool executed", { sessionID, toolName, callId })

      return { callId, result: result.output }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const endTime = Date.now()

      // Update tool part with error
      const errorPart: MessageV2.ToolPart = {
        ...toolPart,
        state: {
          status: "error",
          input: args,
          error: errorMessage,
          time: { start: startTime, end: endTime },
        },
      }
      await Session.updatePart(errorPart)
      await Session.touch(sessionID)

      log.error("tool execution failed", { sessionID, toolName, callId, error: errorMessage })

      return { callId, result: null, error: errorMessage }
    }
  })
}
