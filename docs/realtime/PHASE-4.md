# Phase 4: Voice Tool Calling

**Status: IN PROGRESS - Phase 4e-4 complete, Phase 4e-5 (subagent response handling) pending**

## PRD

Enable the voice assistant to execute OpenCode tools. When OpenAI generates a function call, the client forwards it to the server for execution, then sends the result back to OpenAI. The voice agent should also use OpenCode's system prompt for consistent behavior.

---

## ⚠️ Critical Issue: Token Limits

### Problem

The current architecture loads tools and their outputs directly into the realtime session context. This hits OpenAI's token-per-minute (TPM) limits quickly:

- **gpt-4o-realtime Tier 1 limit**: 40,000 TPM
- **Current system prompt**: ~15,000 tokens per request
- **Tool outputs (file reads, etc.)**: Can easily add 10,000+ tokens

This makes the current approach **fundamentally unscalable** for any non-trivial tool use.

### Solution: Subagent Architecture

Adopt a pattern similar to the `chatSupervisor` example from OpenAI's realtime-agents repo:

1. **Realtime Agent (Junior)**: Lightweight, handles conversation, minimal token footprint
2. **Text Subagent (Supervisor)**: Handles heavy operations, runs on a different model

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VOICE MODE ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐                    ┌──────────────────┐       │
│  │  Realtime Agent  │                    │   OpenAI         │       │
│  │  (gpt-4o-realtime)│◄──── WebRTC ────►│   Realtime API   │       │
│  │                  │                    │                  │       │
│  │  Tools:          │                    └──────────────────┘       │
│  │  - glob (light)  │                                               │
│  │  - grep (light)  │                                               │
│  │  - subagent ─────┼────────────────┐                              │
│  └──────────────────┘                │                              │
│                                      ▼                              │
│                         ┌──────────────────┐                        │
│                         │  Text Subagent   │                        │
│                         │  (claude-haiku)  │                        │
│                         │                  │                        │
│                         │  Tools:          │                        │
│                         │  - read          │                        │
│                         │  - write         │                        │
│                         │  - edit          │                        │
│                         │  - bash          │                        │
│                         │  - webfetch      │                        │
│                         │  - websearch     │                        │
│                         │  - codesearch    │                        │
│                         └────────┬─────────┘                        │
│                                  │                                  │
│                                  ▼                                  │
│                         ┌──────────────────┐                        │
│                         │  OpenCode Server │                        │
│                         │  - Tool Registry │                        │
│                         │  - Execution     │                        │
│                         └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Works

| Aspect                      | Direct Tools (Current)          | Subagent Architecture               |
| --------------------------- | ------------------------------- | ----------------------------------- |
| **Token usage per request** | High (full outputs in context)  | Low (only summary returned)         |
| **File read output**        | Full file content (~10k tokens) | Summary from subagent (~100 tokens) |
| **Cost**                    | High (realtime pricing)         | Lower (subagent uses cheaper model) |
| **Latency**                 | Fast for small ops              | Slightly slower, but sustainable    |
| **Scalability**             | Hits TPM limits quickly         | Scales with subagent model limits   |

### Tool Distribution

**Realtime Agent Tools** (low token impact):

- `glob` - Returns file paths only (small output)
- `grep` - Returns matching lines only (bounded output)
- `subagent` - Delegates to text model, returns summary

**Subagent Tools** (high token impact, handled by text model):

- `read` - File contents can be large
- `write` - Confirmation message only
- `edit` - Diff output can be large
- `bash` - Command output varies
- `webfetch` - Web content can be huge
- `websearch` - Search results
- `codesearch` - Code search results

### Implementation Approach

OpenCode already has a `task` tool that spawns sub-agents. The issue is that voice mode currently uses `modelID: "client"` which doesn't work for sub-agents.

**Root Cause Analysis**:
The task tool (lines 102-105 in `tool/task.ts`) inherits the parent's model:

```typescript
const model = agent.model ?? {
  modelID: msg.info.modelID,
  providerID: msg.info.providerID,
}
```

In voice mode, the parent message has `modelID: "client"`, so subagents fail.

**Solution: Simplified Dual Model Architecture (Frontend-Only)**

The backend doesn't need to know about realtime models. Voice mode is a frontend overlay that uses a different inference path when active.

### Key Principles

1. **Model selector stays unchanged** - Remove GPT Realtime from picker, back to original (text models only)
2. **Voice mode enabled by provider** - If OpenAI provider is configured, show voice mode buttons
3. **Inference path based on call state**:
   - Call NOT active → send to regular text model (as before)
   - Call active → send to realtime model + store transcript
4. **Same session, seamless switching** - Both modes share the same session/conversation

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Session (single, shared)                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Model: "anthropic/claude-sonnet"  ← Selected in picker         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Voice Call: INACTIVE                                    │   │
│  │  [Start Call 🎤]                                         │   │
│  │                                                          │   │
│  │  User sends message → Regular model (claude-sonnet)      │   │
│  │  Task tool → Uses claude-sonnet for subagents ✓          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Voice Call: ACTIVE                                      │   │
│  │  [End Call 🔴]                                           │   │
│  │                                                          │   │
│  │  User sends message → Realtime model (gpt-4o-realtime)   │   │
│  │  Task tool → Uses claude-sonnet for subagents ✓          │   │
│  │  (realtime model only for direct conversation)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### User Stories to Test

**Story A: Text-first workflow**

1. User sends text message → regular model responds
2. User starts voice call
3. User sends message (text or voice) → realtime model responds
4. User ends call
5. User sends text message → regular model responds
6. ✓ All messages visible in same conversation, no data loss

**Story B: Voice-first workflow**

1. User starts voice call
2. User sends message via realtime → realtime model responds
3. User ends call
4. User sends text message → regular model responds
5. ✓ All messages visible in same conversation, no data loss

### Implementation Changes

1. **Remove GPT Realtime from model selector**
   - Revert model picker to original (text models only)
   - Voice mode availability based on OpenAI provider being configured

2. **Conditional inference path in chat input**
   - Check `isCallActive` state
   - If active: send to realtime via WebRTC
   - If not active: send to regular model via existing API

3. **History continuity**
   - On call start: inject existing conversation history to realtime
   - On call end: conversation continues with regular model
   - Both modes read/write to same session

4. **Voice mode button visibility**
   - Show "Start Call" button if OpenAI provider is available
   - No need to select realtime model explicitly

### Benefits

- No backend changes needed
- Model picker unchanged (cleaner UX)
- Task tool works automatically (uses session's text model)
- Seamless mode switching within same conversation
- Voice mode is an "enhancement", not a separate mode

Reference implementation: `/tmp/openai-realtime-agents/src/app/agentConfigs/chatSupervisor/`

- `supervisorAgent.ts` shows how to call a text model from a realtime tool
- Uses `fetch('/api/responses')` to call a text model and return results

---

## Architecture

```
┌─────────────────┐      WebRTC (audio)       ┌─────────────────┐
│   Web Client    │◄─────────────────────────►│  OpenAI Realtime│
│                 │                            │       API       │
│  Configure      │   ◄── function_call ───    │                 │
│  tools + prompt │   ─── function_result ──►  │                 │
└────────┬────────┘                            └─────────────────┘
         │
         │ GET /session/:id/tools (list)
         │ GET /session/:id/system_prompt (instructions)
         │ POST /session/:id/tool/call (execute)
         ▼
┌─────────────────┐
│  OpenCode Server│
│  - Tool Registry│
│  - System Prompt│
│  - Execution    │
└─────────────────┘
```

---

## Current State Analysis

### session/tool.ts (Completed in this branch)

The `SessionTool` module handles tool execution for client-side inference:

```typescript
SessionTool.call({
  sessionID,
  toolName: "read",
  callId: "call_123",
  arguments: { filePath: "/path/to/file" },
})
// Returns: { callId, result, error? }
```

**What it does:**

1. Validates session exists
2. Looks up tool from `ToolRegistry.tools()`
3. Creates assistant message to hold the tool call
4. Creates `ToolPart` with "running" status
5. Builds `Tool.Context` with session messages (for context-aware tools)
6. Executes tool via `tool.execute(args, ctx)`
7. Updates `ToolPart` with result/error and timestamps
8. Returns result to caller

**Key difference from traditional flow:**

- Tool is executed on-demand (client sends request) vs in a loop (server decides)
- Message/part storage is handled here vs in the agent loop
- No permission UI yet (ctx.ask is a no-op)

---

## Comparison: Server-Side vs Client-Side Tool Flow

| Aspect                | Server-Side (Traditional)        | Client-Side (Realtime)             |
| --------------------- | -------------------------------- | ---------------------------------- |
| **Who decides**       | Server (LLM in agent loop)       | Client (from OpenAI)               |
| **Who executes**      | Server (immediate)               | Server (via `/tool/call`)          |
| **Result handling**   | Append to context, continue loop | Return to client, relay to OpenAI  |
| **Message creation**  | In agent loop                    | In `SessionTool.call()`            |
| **Permission UX**     | SSE events, UI prompts           | Not implemented yet                |
| **System prompt**     | Built from config + instructions | Hardcoded in client                |
| **Tool registration** | Passed to `streamText()`         | Passed to `RealtimeSession` config |

### Traditional Agent Loop (session/prompt.ts)

```
┌───────────────────────────────────────┐
│ Server                                │
│                                       │
│  1. Build system prompt               │
│     - SystemPrompt.provider(model)    │
│     - InstructionPrompt.system()      │
│     - Agent.prompt                    │
│                                       │
│  2. Register tools                    │
│     - ToolRegistry.tools(model)       │
│     - Filter by agent permissions     │
│                                       │
│  3. streamText({ tools, messages })   │
│                                       │
│  4. For each tool_call:               │
│     - Check permissions               │
│     - Execute tool                    │
│     - Store ToolPart                  │
│     - Continue loop                   │
└───────────────────────────────────────┘
```

### Client-Side Flow (Current)

```
┌─────────────────┐               ┌─────────────────┐
│ Client          │               │ Server          │
│                 │               │                 │
│ 1. Connect with │               │                 │
│    hardcoded:   │               │                 │
│    - "You are   │               │                 │
│      helpful"   │               │                 │
│    - No tools   │               │                 │
│                 │               │                 │
│ 2. Receive      │ tool/call     │                 │
│    function_call│──────────────►│ 3. Execute tool │
│                 │               │    Store result │
│                 │◄──────────────│                 │
│ 4. Send result  │               │                 │
│    to OpenAI    │               │                 │
└─────────────────┘               └─────────────────┘
```

---

## What's Missing

### 1. Tool Definitions Endpoint

Need `GET /session/:id/tools` to return tools in OpenAI function format:

```typescript
// OpenAI expects this format
{
  type: "function",
  name: "read",
  description: "Read file contents",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Path to file" }
    },
    required: ["filePath"]
  }
}
```

**Challenge**: Our tools use Zod schemas. Need to convert to JSON Schema:

- Use `zod-to-json-schema` or similar
- Strip internal metadata
- Handle complex types (discriminated unions, etc.)

### 2. System Prompt for Voice Agent

Currently the RealtimeAgent uses:

```typescript
const agent = new RealtimeAgent({
  instructions: "You are a helpful assistant. Keep responses concise.",
})
```

Should use OpenCode's prompt infrastructure:

```typescript
// What server builds for traditional agents
const systemPrompt = [
  ...SystemPrompt.provider(model), // Model-specific prompt
  ...(await SystemPrompt.environment(model)), // Environment info
  ...(await InstructionPrompt.system()), // AGENTS.md, CLAUDE.md
  agent.prompt, // Agent-specific additions
].join("\n\n")
```

**Options:**

1. **New endpoint**: `GET /session/:id/system_prompt` returns assembled prompt
2. **Include in tools response**: Return `{ tools, instructions }` together
3. **Client-side assembly**: Client calls multiple endpoints and assembles

### 3. Frontend Tool Handler

In `useRealtimeConnection.ts`, need to:

```typescript
session.on("function_call_arguments.done", async (event) => {
  const { name, arguments: args, call_id } = event

  // Forward to server
  const result = await sdk.client.session.tool.call({
    sessionID,
    toolName: name,
    callId: call_id,
    arguments: JSON.parse(args),
  })

  // Send result back to OpenAI
  if (result.error) {
    session.sendFunctionCallOutput({
      callId: call_id,
      output: JSON.stringify({ error: result.error }),
    })
  } else {
    session.sendFunctionCallOutput({
      callId: call_id,
      output: result.data?.result ?? "",
    })
  }
})
```

### 4. Tool Configuration on Connect

When creating the RealtimeSession:

```typescript
// Fetch tools from server
const toolsResponse = await sdk.client.session.tools({ sessionID })
const tools = toolsResponse.data

// Fetch system prompt
const promptResponse = await sdk.client.session.systemPrompt({ sessionID })
const instructions = promptResponse.data

// Create agent with proper config
const agent = new RealtimeAgent({
  name: "OpenCode",
  instructions,
  tools, // OpenAI function format
})
```

---

## Implementation Plan

### Phase 4a: Tool Definitions

1. Create `session/tools.ts` module:

   ```typescript
   export namespace SessionTools {
     export const ListInput = z.object({
       sessionID: Identifier.schema("session"),
     })

     export const ListOutput = z.array(
       z.object({
         type: z.literal("function"),
         name: z.string(),
         description: z.string(),
         parameters: z.any(), // JSON Schema
       }),
     )

     export async function list(input: ListInput): Promise<ListOutput>
   }
   ```

2. Add route: `GET /session/:sessionID/tools`

3. Convert Zod schemas to JSON Schema (research best approach)

### Phase 4b: System Prompt Endpoint

1. Create `session/system_prompt.ts` module:

   ```typescript
   export namespace SessionSystemPrompt {
     export async function get(sessionID: string): Promise<string>
   }
   ```

2. Add route: `GET /session/:sessionID/system_prompt`

3. Reuse logic from `session/prompt.ts` system prompt building

### Phase 4c: Frontend Integration

1. Fetch tools and prompt on connect
2. Configure RealtimeAgent with fetched config
3. Handle `function_call_arguments.done` events
4. Forward to `/tool/call` endpoint
5. Send result back via `sendFunctionCallOutput()`

### Phase 4d: UI Feedback

1. Show tool execution indicator during calls
2. Display tool results in conversation (already handled by ToolPart storage)
3. Consider voice feedback ("Reading file...", "Done")

---

## Tasks

### Server (Current - Working but needs revision)

- [x] `POST /session/:id/tool/call` endpoint (Phase 2, extracted to module)
- [x] Create `session/tool.ts` module with `SessionTool.list()` and `SessionTool.call()`
- [x] `GET /session/:id/tools` - List available tools in OpenAI function format
- [x] Zod to JSON Schema conversion using Zod 4 native `z.toJSONSchema()`
- [x] `GET /session/:id/system_prompt` - Get assembled instructions (inline in routes)
- [x] Filter tools for voice mode (exclude task, question, batch, etc.)

### Client (Current - Working but hits token limits)

- [x] Fetch tools on connect via `sdk.client.session.tools.list()`
- [x] Fetch system prompt on connect via `sdk.client.session.systemPrompt.get()`
- [x] Configure RealtimeAgent with server-provided instructions
- [x] Create `toOpenAIAgentTools()` utility to convert server tools to executable SDK tools
- [x] Forward tool calls to server `/tool/call` endpoint
- [x] Handle tool results and errors
- [x] Client-side tool filtering (VOICE_SAFE_TOOLS)
- [ ] Tool execution UI indicator
- [ ] Error handling and retry logic

### ⚠️ BLOCKED: Token Limit Issue

The above implementation works but hits gpt-4o-realtime's 40k TPM limit quickly.
**Next step**: Implement Phase 4e (Subagent Architecture) to resolve this.

---

## Open Questions

1. **Which tools to enable?** ✅ RESOLVED → NEEDS REVISION
   - ~~Subset for voice: read, glob, grep, write, edit, bash, webfetch, websearch, codesearch~~
   - **New approach**: Only `glob`, `grep`, and `subagent` for realtime agent
   - Heavy tools delegated to subagent running on text model (Anthropic Haiku)

2. **Permission handling in voice mode?**
   - Currently `ctx.ask()` is a no-op
   - Options: Auto-allow (unsafe), voice confirmation, UI prompt
   - Need to decide on UX

3. **Tool timeout handling?**
   - OpenAI may timeout if tool takes too long
   - Need to handle partial results or cancellation
   - AbortSignal support in tools

4. **System prompt size?** ✅ RESOLVED
   - Full OpenCode prompt is too large (~15k tokens)
   - **Solution**: Use condensed voice-specific prompt for realtime agent
   - Full prompt goes to subagent instead

5. **Token limits?** ✅ IDENTIFIED - CRITICAL
   - gpt-4o-realtime has 40,000 TPM limit (Tier 1)
   - Current architecture hits this limit quickly with file reads
   - **Solution**: Subagent architecture (see above)

6. **Message history compaction?** 🔄 TODO (Future)
   - Voice mode now loads ALL messages to match regular agent behavior
   - Backend uses `MessageV2.filterCompacted()` to stop at compaction/summarization points
   - Voice mode should implement similar logic to avoid loading redundant summarized history
   - This ensures both modes have equivalent context handling

---

## Success Criteria

- [x] Tools fetched and configured on connect
- [x] System prompt loaded from server
- [x] Function calls received from OpenAI (logged)
- [x] Tool execution on server via `/tool/call`
- [x] Results sent back to OpenAI (via `tool()` execute callback)
- [ ] Conversation continues naturally after tool use
- [ ] Tool calls visible in session history (ToolPart)
- [ ] Works for read, glob, grep, bash (basic set)

---

## Security Considerations

1. **Tool authorization** - Validate which tools the session can access
2. **Argument validation** - Zod validation before execution
3. **Timeout handling** - Tool execution < 30s to avoid OpenAI timeout
4. **Audit logging** - Log all tool executions (already in SessionTool)
5. **Permission bypass** - Currently no permission checks in voice mode

---

## Phase 4e: Subagent Architecture (NEW)

### Goal

Refactor voice tool calling to use a subagent architecture that avoids token limits.

### Implementation Plan

#### Step 1: Create Voice-Specific Subagent Tool

Create a new tool specifically for voice mode that calls a text model:

```typescript
// packages/opencode/src/tool/voice-subagent.ts
export const VoiceSubagentTool: Tool.Info = {
  id: "subagent",
  init: async () => ({
    description:
      "Delegate complex tasks to a text-based assistant. Use for file operations, code analysis, web searches, and any task requiring detailed output.",
    parameters: z.object({
      task: z.string().describe("Description of what you want the assistant to do"),
      context: z.string().optional().describe("Any relevant context from the conversation"),
    }),
    execute: async (args, ctx) => {
      // Call a text model (Anthropic Haiku) with the full toolset
      // Return a concise summary to the realtime agent
    },
  }),
}
```

#### Step 2: Configure Subagent Model

The subagent should use a hardcoded model configuration:

```typescript
const VOICE_SUBAGENT_CONFIG = {
  providerID: "anthropic",
  modelID: "claude-haiku", // Fast and cheap
  // OR use existing task tool with model override
}
```

**Option A**: Modify existing `task` tool to accept model override
**Option B**: Create new `voice-subagent` tool with hardcoded model (simpler)

#### Step 3: Update Tool Filtering

Update client-side filter in `use-realtime-connection.ts`:

```typescript
// Only these tools for realtime agent
const VOICE_REALTIME_TOOLS = new Set([
  "glob", // Light - returns file paths only
  "grep", // Light - returns matching lines
  "subagent", // Delegates to text model
])
```

#### Step 4: Reduce System Prompt Size

Create a condensed voice-specific system prompt:

```typescript
// Instead of full OpenCode prompt (~15k tokens)
// Use a minimal prompt (~1k tokens) that:
// - Describes the agent's role
// - Explains available tools (glob, grep, subagent)
// - Instructs to delegate complex tasks to subagent
```

#### Step 5: Subagent Implementation Details

The subagent tool execute function should:

1. **Build context**: Include conversation history summary, relevant file paths
2. **Call text model**: Use `streamText()` or similar with full tool access
3. **Execute tools**: Let the text model use read/write/edit/bash as needed
4. **Summarize result**: Return a concise summary (not full output) to realtime agent

```typescript
execute: async (args, ctx) => {
  const { task, context } = args

  // Build messages for subagent
  const messages = [
    { role: "system", content: SUBAGENT_SYSTEM_PROMPT },
    { role: "user", content: `Task: ${task}\n\nContext: ${context || "None"}` },
  ]

  // Call text model with full toolset
  const result = await streamText({
    model: anthropic("claude-3-5-haiku-latest"),
    messages,
    tools: await ToolRegistry.tools({ providerID: "anthropic", modelID: "claude-haiku" }),
    maxSteps: 10, // Allow multiple tool calls
  })

  // Return concise summary (NOT full tool outputs)
  return {
    title: "Subagent completed task",
    output: result.text, // Just the final answer
  }
}
```

### Tasks

#### Phase 4e-1: Simplified Dual Model Refactor ✅ COMPLETED

**3 files modified, no new state:**

**File 1: `packages/app/src/context/local.tsx`** ✅

- [x] Removed `GPT_REALTIME_MODEL` constant entirely
- [x] Removed `CLIENT_SIDE_MODEL_ID` and `CLIENT_SIDE_PROVIDER_ID` constants
- [x] Removed `ClientSideModelProps` type
- [x] Removed `isOpenAIConnected` memo
- [x] Removed `findWithClientSide` wrapper - now uses `models.find()` directly
- [x] Simplified `listWithClientSide` to return `models.list()` directly
- Result: Model picker shows only text models (GPT Realtime no longer appears)

**File 2: `packages/app/src/context/voice-mode.tsx`** ✅

- [x] Deleted `isVoiceModel` (only used by auto-connect effects)
- [x] Deleted `onMount` auto-connect block
- [x] Deleted `createEffect` model-change watcher
- [x] Removed unused imports (`onMount`, `createEffect`, `on`, `useLocal`)
- Result: Voice mode no longer auto-connects; user must manually start call

**File 3: `packages/app/src/components/prompt-input.tsx`** ✅

- [x] Changed `isVoiceModel` to `isVoiceModeAvailable`:
  ```typescript
  const isVoiceModeAvailable = createMemo(() => providers.connected().some((p) => p.id === "openai"))
  ```
- [x] Simplified `send` function routing:
  ```typescript
  if (voiceMode.status() === "connected") {
    // Voice call active - store transcript and send to realtime
    await client.session.transcript.add({...})
    voiceMode.sendText(text)
  } else {
    // No voice call - send to regular model via server
    await client.session.prompt({...})
  }
  ```

**File 4: `packages/app/src/hooks/use-realtime-connection.ts`** ✅

- [x] Tools temporarily disabled for dual agent testing
- [x] Message history limit removed - now loads ALL messages to match regular agent

**Verification needed (may require changes):**

- [x] **History injection** (`use-realtime-connection.ts` lines 349-353):
  - When call starts, `loadConversationHistory()` fetches session messages
  - `session.updateHistory()` injects them into realtime context
  - Verify: realtime agent sees prior text conversation
  - ✅ Now loads ALL messages (no limit) to match regular agent behavior
  - **TODO (Future)**: Implement compaction awareness - stop at compaction markers like backend does
    - Backend uses `MessageV2.filterCompacted()` which stops at summarization points
    - Voice mode should respect these markers to avoid loading redundant history

- [x] **Transcript storage** (`voice-mode.tsx`):
  - During call, `storeTranscript()` calls `session.transcript.add()`
  - ✅ `addAssistantMessageToUI` and `addUserMessageToUI` now use current text model
  - ✅ Messages use same `modelID`/`providerID`/`agent` as regular agent
  - Result: Unified transcript - voice and text messages look identical

#### Phase 4e-1 Testing (Chrome plugin, text input OK)

**Test Story A: Text-first**

- [ ] Send text message → regular model responds ✓
- [ ] Start voice call
- [ ] Send text message → realtime model responds ✓
- [ ] End call
- [ ] Send text message → regular model responds ✓
- [ ] Verify: all messages in conversation, no data loss

**Test Story B: Voice-first**

- [ ] Start voice call
- [ ] Send text message → realtime model responds ✓
- [ ] End call
- [ ] Send text message → regular model responds ✓
- [ ] Verify: all messages in conversation, no data loss

**Edge case: Mid-response call start**

- [ ] Send text message, while streaming click "Start Call"
- [ ] Expected: text response continues displaying, realtime agent may miss in-flight response
- [ ] Acceptable for v1 - user initiated the switch, they can see the text response on screen
- [ ] Future: could disable "Start Call" while response streaming

---

#### Phase 4e-2: Align SessionTool.call with Regular Agent Flow ✅ COMPLETED

**Problem solved:** `SessionTool.call` was using hardcoded `"client"` values, causing task tool to fail.

**Changes made:**

**Backend: `packages/opencode/src/session/tool.ts`** ✅

- [x] Updated `CallInput` schema to include `model` and `agent` parameters
- [x] Assistant message now uses `input.model.modelID/providerID` instead of `"client"`
- [x] Mode changed from `"client"` to `"build"`
- [x] Tool context uses `input.agent` instead of `"client"`
- [x] `ToolRegistry.tools()` uses provided model for tool selection

**SDK regenerated** ✅

- [x] Ran `bun run build` in `packages/sdk/js` to regenerate types

**Frontend: `packages/app/src/util/openai-realtime-tool.ts`** ✅

- [x] Added `model` and `agent` to `CreateAgentToolsOptions` interface
- [x] Tool calls now pass `model` and `agent` to server

**Frontend: `packages/app/src/hooks/use-realtime-connection.ts`** ✅

- [x] Added `model` and `agent` to `RealtimeConnectionConfig` interface
- [x] Updated commented tool creation code to show usage

**Frontend: `packages/app/src/context/voice-mode.tsx`** ✅

- [x] Added `useLocal` import and `currentModel()`/`currentAgent()` memos
- [x] Pass `model` and `agent` to `useRealtimeConnection` hook
- [x] Updated `addAssistantMessageToUI` to use current text model (not hardcoded "gpt-realtime")
- [x] Updated `addUserMessageToUI` to use current text model (not hardcoded "gpt-realtime")
- Result: Voice transcripts use same model info as regular messages - unified transcript

**Tests: `packages/opencode/test/session/tool.test.ts`** ✅

- [x] Updated all `SessionTool.call` invocations with required `model` and `agent` parameters

**Solution:** Make `SessionTool.call` accept actual model/agent info, mirroring `SessionPrompt.prompt`:

**File: `packages/opencode/src/session/tool.ts`**

- [ ] **Update CallInput schema** (lines 117-122):

  ```typescript
  export const CallInput = z.object({
    sessionID: Identifier.schema("session"),
    toolName: z.string(),
    callId: z.string(),
    arguments: z.record(z.string(), z.any()),
    // NEW: Match SessionPrompt.prompt parameters
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    agent: z.string().optional().default("default"),
  })
  ```

- [ ] **Update assistant message creation** (lines 167-181):

  ```typescript
  const assistantMessage: MessageV2.Assistant = {
    id: messageID,
    role: "assistant",
    sessionID,
    time: { created: startTime },
    parentID,
    modelID: input.model.modelID, // ← From input
    providerID: input.model.providerID, // ← From input
    mode: "build", // ← Standard mode
    agent: input.agent, // ← From input
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  ```

- [ ] **Update Tool.Context** (lines 203-212):

  ```typescript
  const ctx: Tool.Context = {
    sessionID,
    messageID,
    agent: input.agent, // ← From input (was "client")
    abort: abortController.signal,
    callID: callId,
    messages,
    metadata: () => {},
    ask: async () => {},
  }
  ```

- [ ] **Update ToolRegistry lookup** (line 151):

  ```typescript
  // Before: hardcoded "openai/gpt-4"
  const allTools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4" })

  // After: use provided model
  const allTools = await ToolRegistry.tools(input.model)
  ```

**File: `packages/opencode/src/server/routes/session.ts`**

- [ ] **Update route schema** (around line 1090):
      Add `model` and `agent` to the request body validation

**File: `packages/app/src/util/openai-realtime-tool.ts`**

- [ ] **Pass model/agent in tool calls** (lines 75-80):
  ```typescript
  const response = await sdk.client.session.tool.call({
    sessionID,
    toolName: definition.name,
    callId,
    arguments: input as Record<string, unknown>,
    model: options.model, // NEW: Pass from connection config
    agent: options.agent, // NEW: Pass from connection config
  })
  ```

**File: `packages/app/src/hooks/use-realtime-connection.ts`**

- [ ] **Store and pass model/agent to tool calls**:
  - Get model from `local.model.current()` when connecting
  - Get agent from `local.agent.current()` when connecting
  - Pass to `toOpenAIAgentTools()` options

**Result:**

- Task tool inherits real model (e.g., `anthropic/claude-sonnet`)
- Subagent spawns with correct model
- Tool registry uses correct model for tool selection
- Messages look identical to regular agent flow

---

#### Phase 4e-3: Enable Task Tool for Voice ✅ COMPLETED

**File: `packages/opencode/src/session/tool.ts`**

- [x] **Add task to VOICE_MODE_TOOLS** (line 48-52):

  ```typescript
  const VOICE_MODE_TOOLS = new Set([
    "glob", // Lightweight - returns paths only
    "grep", // Lightweight - returns matching lines
    "task", // Subagent delegation - key for voice orchestrator pattern
  ])
  ```

- [x] **Updated comment** (lines 26-46) documenting the voice mode tools philosophy

---

#### Phase 4e-4: Voice System Prompt ✅ COMPLETED

**Goal:** Give voice agent a condensed prompt optimized for delegation

**File: `packages/opencode/src/session/system.ts`** ✅

- [x] **Added voice-specific prompt support**:

  ```typescript
  import PROMPT_VOICE from "./prompt/voice.txt"

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    // Voice/realtime mode uses a condensed prompt optimized for delegation
    if (model.api.id.includes("realtime")) return [PROMPT_VOICE]
    if (model.api.id.includes("gpt-") || ...) return [PROMPT_BEAST]
    ...
  }
  ```

**File: `packages/opencode/src/session/prompt/voice.txt`** ✅ (NEW)

Created condensed voice prompt that:

- Explains the orchestrator role (delegate complex work to task tool)
- Lists available tools (glob, grep, task)
- Provides clear examples of when to use task vs direct tools
- Encourages conversational, brief responses

**No changes needed to frontend** - existing code requests system prompt with `modelID: "gpt-realtime"`, which now returns the voice-specific prompt

---

#### Phase 4e-5: Subagent Response Handling ⚠️ PENDING

**Problem:** Voice mode doesn't handle subagent progress/completion properly.

**Current Flow (broken for task tool):**

```
1. OpenAI Realtime sends function_call → client
2. Client HTTP POSTs to /session/:id/tool/call (blocking)
3. Server calls tool.execute(args, ctx) in SessionTool.call (line 234)
4. For task tool: subagent spawns, runs for 10-60s
   - Subagent progress sent via SSE (Bus.publish MessageV2.Event.PartUpdated)
   - Client NOT subscribed to these SSE events during voice mode
5. HTTP response returns when subagent completes
6. Client sends function_call_output back to OpenAI Realtime
7. OpenAI generates spoken response
```

**Issues:**

1. **No intermediate feedback**: User hears nothing while subagent runs (10-60s silence)
2. **No UI progress**: Regular text mode shows subagent tool calls in real-time via SSE; voice mode shows nothing
3. **HTTP timeout risk**: Long-running subagent may exceed HTTP timeout
4. **Voice agent doesn't speak result**: After tool completes, the realtime agent needs to generate a spoken response from the tool output — need to verify this works end-to-end

**What regular text mode does differently:**

- Frontend subscribes to SSE stream (`/session/:id/events`)
- SSE delivers `MessageV2.Event.PartUpdated` events in real-time
- UI renders each tool call, partial results, text chunks as they arrive
- The agent loop is server-side, so results flow directly back into the LLM context

**Possible Solutions:**

**Option A: Accept synchronous blocking (v1 - simplest)**

- Keep current HTTP POST blocking approach
- Voice prompt instructs agent to say filler phrase ("Let me look into that")
- Client shows a spinner/indicator while waiting
- Increase HTTP timeout for task tool calls
- Risk: Very long tasks may still timeout

**Option B: SSE subscription during tool calls**

- Client subscribes to SSE for the subagent's session
- Shows progress in UI while waiting for HTTP response
- Still blocks on HTTP for the final result
- More complex but better UX

**Option C: Async tool execution with polling**

- `POST /tool/call` returns immediately with a `taskID`
- Client polls or subscribes to SSE for completion
- When done, client sends `function_call_output` to OpenAI
- Most complex but most robust

**Recommended: Option A for v1, then Option B for v2.**

---

#### Phase 4e-6: Testing & Validation

**Test 1: Model Inheritance**

- [ ] Call `/session/:id/tool/call` with model `anthropic/claude-sonnet`
- [ ] Verify assistant message has correct modelID/providerID
- [ ] Trigger task tool, verify subagent uses same model

**Test 2: Voice → Task Flow**

- [ ] Start voice call
- [ ] Ask "What files are in the src folder?"
- [ ] Verify: Voice agent uses task tool (not glob directly per prompt guidance)
- [ ] Verify: Subagent runs on text model
- [ ] Verify: Voice speaks summary of task result

**Test 3: Handoff Voice → Text**

- [ ] Start voice call, invoke task
- [ ] End voice call
- [ ] Send text message
- [ ] Verify: Regular agent sees voice transcripts + subagent results

**Test 4: Handoff Text → Voice**

- [ ] Send text message with tool calls
- [ ] Start voice call
- [ ] Verify: Voice agent loads history including tool results
- [ ] Invoke task, verify same model used

**Test 5: Long-Running Task**

- [ ] Start voice call
- [ ] Request complex multi-file analysis
- [ ] Verify: Voice says filler phrase, waits for completion
- [ ] Verify: Voice speaks result summary when done
- [ ] Measure: Time to completion, token usage

---

### Success Criteria

- [x] SessionTool.call creates messages with real model/agent (not "client")
- [x] Task tool inherits correct model, subagent spawns successfully
- [x] Voice agent uses only glob, grep, task tools
- [x] Voice system prompt uses condensed prompt optimized for delegation
- [ ] Voice agent speaks subagent result after task completes
- [ ] Token usage stays under 40k TPM with subagent delegation
- [ ] Seamless handoffs between voice ↔ text modes
- [ ] Same UX for subagent in voice as in regular mode

### Risks & Mitigations

| Risk                             | Mitigation                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- |
| Latency from subagent call       | Task tool blocks synchronously; use fast model for subagent                |
| HTTP timeout during long tasks   | Increase timeout for tool/call; voice prompt says filler phrase            |
| No progress feedback during task | v1: filler phrase + spinner; v2: SSE subscription for subagent session     |
| Token limits with full env files | Monitor usage; truncate AGENTS.md if needed                                |
| Subagent errors not surfaced     | Return clear error messages; voice speaks error summary                    |
| Model mismatch in handoffs       | Always pass explicit model; never rely on "client"                         |
| Voice agent doesn't speak result | Verify OpenAI Realtime generates spoken response from function_call_output |

---

## ChatSupervisor Pattern Reference

The OpenAI `chatSupervisor` example (`tmp/openai-realtime-agents/src/app/agentConfigs/chatSupervisor/`) demonstrates:

**Junior Agent (Realtime):**

- Minimal capabilities, delegates everything to supervisor
- Says filler phrase before calling supervisor ("Just a second")
- Reads supervisor response verbatim

**Supervisor Agent (Text):**

- Full tool access
- Gets conversation history + context
- Returns formatted message

**Key Differences from Our Approach:**
| Aspect | chatSupervisor | OpenCode Voice |
|--------|----------------|----------------|
| Delegation | Always delegate | Delegate for complex, handle simple directly |
| Tools | Custom supervisor tool | Existing task tool |
| Model selection | Hardcoded gpt-4.1 | Session's selected text model |
| Response | Read verbatim | Summarize naturally |

**Async Tasks:** chatSupervisor is synchronous (blocks). For v1, we follow the same pattern. Future: could implement background tasks with polling.

---

## References

- [Tool Flow Documentation](../architecture/tool-flow.md)
- [Tool Integration for Realtime](./tool-integration.md)
- [OpenAI Realtime API](./openai-api.md)
- [OpenAI Realtime Agents - chatSupervisor Example](https://github.com/openai/openai-realtime-agents)
