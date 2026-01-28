# Phase 4: Voice Tool Calling

**Status: IN PROGRESS - ARCHITECTURE REVISION NEEDED**

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

| Aspect | Direct Tools (Current) | Subagent Architecture |
|--------|------------------------|----------------------|
| **Token usage per request** | High (full outputs in context) | Low (only summary returned) |
| **File read output** | Full file content (~10k tokens) | Summary from subagent (~100 tokens) |
| **Cost** | High (realtime pricing) | Lower (subagent uses cheaper model) |
| **Latency** | Fast for small ops | Slightly slower, but sustainable |
| **Scalability** | Hits TPM limits quickly | Scales with subagent model limits |

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
  arguments: { filePath: "/path/to/file" }
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

| Aspect | Server-Side (Traditional) | Client-Side (Realtime) |
|--------|---------------------------|------------------------|
| **Who decides** | Server (LLM in agent loop) | Client (from OpenAI) |
| **Who executes** | Server (immediate) | Server (via `/tool/call`) |
| **Result handling** | Append to context, continue loop | Return to client, relay to OpenAI |
| **Message creation** | In agent loop | In `SessionTool.call()` |
| **Permission UX** | SSE events, UI prompts | Not implemented yet |
| **System prompt** | Built from config + instructions | Hardcoded in client |
| **Tool registration** | Passed to `streamText()` | Passed to `RealtimeSession` config |

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
  instructions: "You are a helpful assistant. Keep responses concise."
})
```

Should use OpenCode's prompt infrastructure:
```typescript
// What server builds for traditional agents
const systemPrompt = [
  ...SystemPrompt.provider(model),     // Model-specific prompt
  ...await SystemPrompt.environment(model), // Environment info
  ...await InstructionPrompt.system(), // AGENTS.md, CLAUDE.md
  agent.prompt,                        // Agent-specific additions
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
      output: JSON.stringify({ error: result.error })
    })
  } else {
    session.sendFunctionCallOutput({
      callId: call_id,
      output: result.data?.result ?? ""
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
  tools,  // OpenAI function format
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

     export const ListOutput = z.array(z.object({
       type: z.literal("function"),
       name: z.string(),
       description: z.string(),
       parameters: z.any(), // JSON Schema
     }))

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
    description: "Delegate complex tasks to a text-based assistant. Use for file operations, code analysis, web searches, and any task requiring detailed output.",
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
  "glob",      // Light - returns file paths only
  "grep",      // Light - returns matching lines
  "subagent",  // Delegates to text model
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

#### Phase 4e-1: Simplified Dual Model Refactor

**3 files to modify, no new state:**

**File 1: `packages/app/src/context/local.tsx`**
- [ ] Lines 147-152: Remove `GPT_REALTIME_MODEL` from `listWithClientSide` array
  ```typescript
  // Before: return [...baseList, GPT_REALTIME_MODEL as ...]
  // After:  return baseList
  ```
- Result: Model picker shows only text models (GPT Realtime no longer appears)

**File 2: `packages/app/src/context/voice-mode.tsx`**
- [ ] Line 35: DELETE `isVoiceModel` (only used by auto-connect effects we're removing)
- [ ] Lines 263-268: DELETE `onMount` auto-connect block
- [ ] Lines 271-288: DELETE `createEffect` model-change watcher
- Result: Voice mode no longer auto-connects; user must manually start call

**File 3: `packages/app/src/components/prompt-input.tsx`**
- [ ] Line 237: Change `isVoiceModel` condition
  ```typescript
  // Before: local.model.current()?.voice === true
  // After:  providers.connected().some(p => p.id === "openai")
  ```
- [ ] Lines 1615-1646: Simplify `send` function routing
  ```typescript
  // Before: if (currentModel?.clientSide) { ... if (currentModel?.voice) ... }
  // After:  if (voiceMode.status() === "connected") { ... }
  ```
  - Uses existing `voiceMode.status()` state (already used at line 2101)
  - If connected: store transcript + send via `voiceMode.sendText()`
  - If not connected: send via `client.session.prompt()` (regular API)

**Verification needed (may require changes):**

- [ ] **History injection** (`use-realtime-connection.ts` lines 349-353):
  - When call starts, `loadConversationHistory()` fetches session messages
  - `session.updateHistory()` injects them into realtime context
  - Verify: realtime agent sees prior text conversation
  - May need changes if history format doesn't match realtime expectations

- [ ] **Transcript storage** (`voice-mode.tsx` lines 44-75, 178-201):
  - During call, `storeTranscript()` calls `session.transcript.add()`
  - Critical: Does this properly integrate with session message history?
  - When call ends, regular model must see voice conversation
  - May need changes if transcript isn't visible to regular model

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

#### Phase 4e-2: Tool Filtering for Token Limits (After 4e-1)

- [ ] `packages/app/src/hooks/use-realtime-connection.ts`
  - Update `VOICE_SAFE_TOOLS` to only: `glob`, `grep`, `task`
  - Remove: `read`, `write`, `edit`, `bash`, `webfetch`, `websearch`, `codesearch`

- [ ] Create condensed voice system prompt
  - Shorter than full OpenCode prompt
  - Instructs agent to use `task` tool for complex operations

- [ ] Test: voice → task tool → subagent uses session's text model

---

#### Phase 4e-3: Polish (After 4e-2)

- [ ] Handle subagent errors gracefully in voice mode
- [ ] Test end-to-end: voice → task tool → subagent (text model) → result
- [ ] Consider UX improvements (loading indicators, error messages)

### Success Criteria

- [ ] Realtime agent only uses glob, grep, subagent tools
- [ ] Subagent executes on Anthropic Haiku (not client/realtime)
- [ ] Token usage stays well under 40k TPM
- [ ] File reads work via subagent delegation
- [ ] Response quality maintained despite indirection

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Latency increase from subagent call | Use fast model (Haiku), optimize prompts |
| Loss of context between realtime ↔ subagent | Pass conversation summary to subagent |
| Subagent errors not surfaced well | Return clear error messages to realtime |
| Cost of running two models | Haiku is cheap, saves on realtime TPM |

---

## References

- [Tool Flow Documentation](../architecture/tool-flow.md)
- [Tool Integration for Realtime](./tool-integration.md)
- [OpenAI Realtime API](./openai-api.md)
- [OpenAI Realtime Agents - chatSupervisor Example](https://github.com/openai/openai-realtime-agents)
