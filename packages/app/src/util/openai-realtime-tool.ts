import { tool } from "@openai/agents/realtime"
import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

/** Type for the SDK client returned by createOpencodeClient */
type OpencodeClient = ReturnType<typeof createOpencodeClient>

/**
 * Server tool definition in OpenAI function format.
 * This is what we receive from the /session/:id/tools endpoint.
 */
export interface ServerToolDefinition {
  type: "function"
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
    [key: string]: unknown
  }
  strict?: boolean
}

/**
 * Options for creating OpenAI Agent tool wrappers.
 */
export interface CreateAgentToolsOptions {
  /** Session ID for tool execution */
  sessionID: string
  /** SDK client for calling server endpoints */
  sdk: { client: OpencodeClient }
  /** Callback when tool execution starts (for UI feedback) */
  onExecute?: (toolName: string, args: unknown) => void
  /** Callback when tool execution completes */
  onComplete?: (toolName: string, result: unknown, error?: string) => void
}

/**
 * Convert a server tool definition to an OpenAI Realtime Agent SDK tool.
 *
 * This creates an executable `tool()` object that can be passed to RealtimeAgent.
 * The execute function calls the server's /tool/call endpoint.
 *
 * @param definition - Tool definition from server (JSON Schema format)
 * @param options - Session ID, SDK client, and optional callbacks
 * @returns An executable tool compatible with @openai/agents/realtime
 */
export function toOpenAIAgentTool(definition: ServerToolDefinition, options: CreateAgentToolsOptions) {
  const { sessionID, sdk, onExecute, onComplete } = options

  // Clean up parameters - remove $schema property that Zod adds
  // OpenAI SDK doesn't expect this property
  const { $schema, ...cleanParameters } = definition.parameters as any

  console.log(`[toOpenAIAgentTool] creating tool: ${definition.name}`, {
    parameters: cleanParameters,
  })

  return tool({
    name: definition.name,
    description: definition.description,
    parameters: cleanParameters,
    execute: async (input, _details) => {
      const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      console.log(`[tool:${definition.name}] executing`, { callId, input })

      // Notify UI that execution is starting
      onExecute?.(definition.name, input)

      try {
        // Call server to execute the tool
        // Note: SDK is configured with throwOnError: true, so errors throw
        const response = await sdk.client.session.tool.call({
          sessionID,
          toolName: definition.name,
          callId,
          arguments: input as Record<string, unknown>,
        })

        const result = response.data?.result
        const error = response.data?.error

        if (error) {
          console.error(`[tool:${definition.name}] tool error:`, error)
          onComplete?.(definition.name, null, error)
          // Return error object - matching SDK example pattern
          return { error }
        }

        console.log(`[tool:${definition.name}] completed`, { callId, result })
        onComplete?.(definition.name, result)

        // Return result object - matching SDK example pattern
        // The SDK handles serialization internally
        return { result }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`[tool:${definition.name}] exception:`, errorMsg)
        onComplete?.(definition.name, null, errorMsg)
        return { error: errorMsg }
      }
    },
  })
}

/**
 * Convert multiple server tool definitions to OpenAI Agent SDK tools.
 *
 * @param definitions - Array of tool definitions from server
 * @param options - Session ID, SDK client, and optional callbacks (shared across all tools)
 * @returns Array of executable tools compatible with @openai/agents/realtime
 */
export function toOpenAIAgentTools(definitions: ServerToolDefinition[], options: CreateAgentToolsOptions) {
  return definitions.map((def) => toOpenAIAgentTool(def, options))
}
