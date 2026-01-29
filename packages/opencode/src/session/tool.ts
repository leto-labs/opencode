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
   * Tools safe for voice/realtime mode.
   *
   * Voice agent acts as orchestrator with minimal tools.
   * Heavy operations are delegated via task tool to a text subagent.
   *
   * Included:
   * - glob: Find files by pattern, returns paths only
   * - grep: Search file contents, returns matching lines
   * - task: Delegate complex work to text subagent (uses session's selected model)
   *
   * Excluded (delegated via task tool instead):
   * - read, write, edit: Large outputs, can pollute context
   * - bash: Unbounded output
   * - webfetch, websearch, codesearch: Complex, large outputs
   *
   * Also excluded:
   * - question: requires interactive UI
   * - batch: spawns multiple operations
   * - plan_enter, plan_exit: plan mode requires UI
   * - skill, todo_write, todo_read: noisy for voice
   * - apply_patch, lsp: complex
   */
  const VOICE_MODE_TOOLS = new Set(["glob", "grep", "task"])

  /**
   * OpenAI function tool definition format.
   */
  export const ToolDefinition = z.object({
    type: z.literal("function"),
    name: z.string(),
    description: z.string(),
    parameters: z.any(), // JSON Schema
    strict: z.boolean(),
  })
  export type ToolDefinition = z.infer<typeof ToolDefinition>

  /**
   * Input schema for listing tools.
   */
  export const ListInput = z.object({
    sessionID: Identifier.schema("session"),
  })
  export type ListInput = z.infer<typeof ListInput>

  /**
   * Output schema for tool list.
   */
  export const ListOutput = z.array(ToolDefinition)
  export type ListOutput = z.infer<typeof ListOutput>

  /**
   * List available tools for a session in OpenAI function format.
   *
   * Returns tools from ToolRegistry converted to OpenAI's function calling format.
   * Used by client-side inference (e.g., voice/realtime) to configure the provider.
   *
   * Filters tools to only include those safe for voice/realtime mode.
   */
  export const list = fn(ListInput, async (input): Promise<ListOutput> => {
    const { sessionID } = input

    // Verify session exists
    const session = await Session.get(sessionID)
    if (!session) {
      throw new Error(`Session not found: ${sessionID}`)
    }

    // Get tools from registry (using openai/gpt-4 as reference for tool selection)
    const allTools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4" })

    // Filter to only voice-mode safe tools
    const tools = allTools.filter((t) => VOICE_MODE_TOOLS.has(t.id))

    // Convert to OpenAI function format
    const definitions: ToolDefinition[] = tools.map((tool) => ({
      type: "function" as const,
      name: tool.id,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters),
      strict: true,
    }))

    log.info("listed tools", { sessionID, count: definitions.length, filtered: allTools.length - tools.length })

    return definitions
  })

  /**
   * Input schema for calling a tool.
   *
   * Accepts model and agent to align with regular SessionPrompt.prompt flow.
   * This ensures task tool inheritance works correctly (subagent uses real model).
   */
  export const CallInput = z.object({
    sessionID: Identifier.schema("session"),
    toolName: z.string(),
    callId: z.string(),
    arguments: z.record(z.string(), z.any()),
    /** Model to use for tool execution and inheritance (e.g., task tool subagents) */
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    /** Agent name for tool context */
    agent: z.string().optional().default("default"),
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
   *
   * Aligned with regular SessionPrompt.prompt flow:
   * - Uses provided model/agent (not hardcoded "client")
   * - Task tool will inherit these values for subagent spawning
   */
  export const call = fn(CallInput, async (input): Promise<CallOutput> => {
    const { sessionID, toolName, callId, arguments: args, model, agent } = input

    // Verify session exists
    const session = await Session.get(sessionID)
    if (!session) {
      throw new Error(`Session not found: ${sessionID}`)
    }

    // Find the tool using provided model for proper tool selection
    const allTools = await ToolRegistry.tools(model)
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
    // Uses provided model/agent to align with regular agent flow
    // This ensures task tool inherits correct model for subagent spawning
    const assistantMessage: MessageV2.Assistant = {
      id: messageID,
      role: "assistant",
      sessionID,
      time: { created: startTime },
      parentID,
      modelID: model.modelID,
      providerID: model.providerID,
      mode: "build",
      agent,
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

    // Execute the tool with proper agent context
    const abortController = new AbortController()
    const ctx: Tool.Context = {
      sessionID,
      messageID,
      agent,
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
