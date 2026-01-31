# Tool API Reference

Detailed API documentation for OpenCode tools, including parameters, response formats, and usage examples.

## Table of Contents

- [API Endpoints](#api-endpoints)
- [Core Tools](#core-tools)
- [Extended Tools](#extended-tools)
- [Error Handling](#error-handling)
- [Output Truncation](#output-truncation)
- [File Attachments](#file-attachments)
- [Tool Context Reference](#tool-context-reference)
- [See Also](#see-also)

## API Endpoints

### Execute Tool (Session-Based)

```
POST /session/{sessionID}/tool/call
```

Execute a tool within the context of an existing session.

Implementation:

- Route: [`packages/opencode/src/server/routes/session.ts`](../../packages/opencode/src/server/routes/session.ts)
- Handler: [`packages/opencode/src/session/tool.ts`](../../packages/opencode/src/session/tool.ts)

**Request Headers:**

```
Content-Type: application/json
x-opencode-directory: /absolute/path/to/project
```

**Request Body:**

```typescript
{
  toolName: string // Tool identifier
  callId: string // Unique call ID for correlation
  arguments: Record<string, any> // Tool-specific parameters
  model: { providerID: string; modelID: string } // Required (used for tool selection + task subagent inheritance)
  agent?: string // Optional label for tool context
}
```

**Response:**

```typescript
{
  callId: string                // Echoed back for correlation
  result: string | null         // Tool output (null if error)
  error?: string                // Error message if failed
}
```

**Status Codes:**

- `200` - Tool executed (check `error` field for failures)
- `404` - Session not found

---

## Core Tools

### read

Read file contents with optional line range.

Implementation: [`packages/opencode/src/tool/read.ts`](../../packages/opencode/src/tool/read.ts)

**Parameters:**

```typescript
{
  filePath: string              // Absolute or relative path
  offset?: number               // Starting line (0-based), default: 0
  limit?: number                // Number of lines, default: 2000
}
```

**Response:**

```typescript
{
  title: string                 // Relative path from worktree
  output: string                // File contents with line numbers
  metadata: {
    preview: string             // First 20 lines
    truncated: boolean          // Whether output was truncated
    outputPath?: string         // Path to full output if truncated
  }
  attachments?: FilePart[]      // For images/PDFs
}
```

**Output Format:**

```
<file>
00001| first line
00002| second line
...
(File has more lines. Use 'offset' parameter to read beyond line 2000)
</file>
```

**Limits:**

- Max 2000 lines per call
- Max 50KB per call
- Lines truncated at 2000 characters

**Binary Handling:**

- Images (PNG, JPG, etc.): Returned as base64 attachment
- PDFs: Returned as base64 attachment
- Binary files: Error thrown

---

### write

Create or overwrite a file.

Implementation: [`packages/opencode/src/tool/write.ts`](../../packages/opencode/src/tool/write.ts)

**Parameters:**

```typescript
{
  filePath: string // Absolute or relative path
  content: string // File content
}
```

**Response:**

```typescript
{
  title: string // Relative path
  output: string // Success message (+ optional LSP diagnostics block)
  metadata: {
    filepath: string // Absolute path
    exists: boolean // Whether the file existed before the write
    diagnostics: Record<string, unknown> // LSP diagnostics map (normalized path -> issues)
  }
}
```

**Behavior:**

- Overwrites existing files (or creates it if missing)
- Does not create parent directories (the directory must exist)
- Runs LSP diagnostics after writing and includes errors in the output when available

---

### edit

Edit a file using search/replace.

Implementation: [`packages/opencode/src/tool/edit.ts`](../../packages/opencode/src/tool/edit.ts)

**Parameters:**

```typescript
{
  filePath: string // File to edit (absolute or relative)
  oldString: string // Text to replace (can be "" to create/overwrite file)
  newString: string // Replacement text (must differ from oldString)
  replaceAll?: boolean // Replace all occurrences (default false)
}
```

**Response:**

```typescript
{
  title: string // Relative path
  output: string // Success message (+ optional LSP diagnostics block)
  metadata: {
    diff: string // Unified diff
    filediff: { additions: number; deletions: number; file: string; before: string; after: string }
    diagnostics: Record<string, unknown> // LSP diagnostics map
  }
}
```

**Behavior:**

- Uses a best-effort matcher (exact + trimmed + block anchors, etc.) to find a unique replacement location
- By default requires a unique match; set `replaceAll: true` to replace all occurrences
- Publishes file update events and runs LSP diagnostics after applying

---

### bash

Execute a shell command.

Implementation: [`packages/opencode/src/tool/bash.ts`](../../packages/opencode/src/tool/bash.ts)

**Parameters:**

```typescript
{
  command: string               // Command to execute
  description: string           // Clear 5–10 word description (used as the tool title)
  workdir?: string              // Working directory (preferred over `cd`)
  timeout?: number              // Timeout in ms (default is ~2 minutes, configurable)
}
```

**Response:**

```typescript
{
  title: string                 // The provided description
  output: string                // stdout + stderr combined
  metadata: {
    exit: number | null         // Process exit code (if available)
    description: string
    output: string              // Truncated copy for UI metadata
  }
}
```

**Behavior:**

- Runs in project working directory
- Inherits environment variables
- Kills process on timeout
- stderr merged into stdout

**Limits:**

- Default timeout: ~2 minutes (unless overridden via flags/config)
- Output truncated per standard limits

---

### glob

Find files matching a pattern.

Implementation: [`packages/opencode/src/tool/glob.ts`](../../packages/opencode/src/tool/glob.ts)

**Parameters:**

```typescript
{
  pattern: string               // Glob pattern (e.g., "**/*.ts")
  path?: string                 // Search root, default: cwd
}
```

**Response:**

```typescript
{
  title: string // Search root (relative to worktree)
  output: string // Matched file paths, one per line
  metadata: {
    count: number // Number of matches
    truncated: boolean // Whether results truncated
  }
}
```

**Pattern Examples:**

- `*.ts` - TypeScript files in current dir
- `**/*.ts` - TypeScript files recursively
- `src/**/*.{ts,tsx}` - TS/TSX files in src
- `!node_modules/**` - Exclude node_modules

---

### grep

Search file contents.

Implementation: [`packages/opencode/src/tool/grep.ts`](../../packages/opencode/src/tool/grep.ts)

**Parameters:**

```typescript
{
  pattern: string               // Regex pattern
  path?: string                 // Search root, default: cwd
  include?: string              // File pattern filter (e.g., "*.ts")
}
```

**Response:**

```typescript
{
  title: string // Search summary
  output: string // Matches grouped by file (bounded)
  metadata: {
    matches: number // Number of matches returned
    truncated: boolean
  }
}
```

**Output Format:**

```
Found 12 matches
/abs/path/to/file.ts:
  Line 42: matching line content
```

**Behavior:**

- Uses ripgrep for performance
- Respects .gitignore
- Includes hidden files and follows symlinks (but skips some inaccessible paths)
- Default is case-sensitive (pass a case-insensitive pattern if needed)

---

### webfetch

Fetch and process web content.

Implementation: [`packages/opencode/src/tool/webfetch.ts`](../../packages/opencode/src/tool/webfetch.ts)

**Parameters:**

```typescript
{
  url: string                   // URL to fetch
  format?: "text" | "markdown" | "html" // Defaults to "markdown"
  timeout?: number              // Optional timeout in seconds (max 120)
}
```

**Response:**

```typescript
{
  title: string // URL fetched
  output: string // Returned content (converted when requested)
  metadata: Record<string, never>
}
```

**Behavior:**

- Supports `text`, `markdown`, and `html` return formats
- Converts HTML → Markdown when `format: "markdown"`
- Applies a 5MB response size limit
- Default timeout ~30s (max 120s)

---

### websearch

Search the web.

Implementation: [`packages/opencode/src/tool/websearch.ts`](../../packages/opencode/src/tool/websearch.ts)

**Parameters:**

```typescript
{
  query: string // Search query
  numResults?: number
  livecrawl?: "fallback" | "preferred"
  type?: "auto" | "fast" | "deep"
  contextMaxCharacters?: number
}
```

**Response:**

```typescript
{
  title: string // Query
  output: string // Search results (LLM-ready text)
  metadata: Record<string, never>
}
```

**Availability:**

- Included when `OPENCODE_ENABLE_EXA` is set (or when using the `opencode` provider).

---

### codesearch

Search for API/library context via Exa (MCP). Good for “how do I use X” queries.

Implementation: [`packages/opencode/src/tool/codesearch.ts`](../../packages/opencode/src/tool/codesearch.ts)

**Parameters:**

```typescript
{
  query: string
  tokensNum?: number // Default 5000, min 1000, max 50000
}
```

**Response:**

```typescript
{
  title: string
  output: string
  metadata: Record<string, never>
}
```

---

### apply_patch

Apply a unified diff patch (used for GPT models).

Implementation: [`packages/opencode/src/tool/apply_patch.ts`](../../packages/opencode/src/tool/apply_patch.ts)

**Parameters:**

```typescript
{
  patchText: string // Patch text (OpenCode patch format)
}
```

**Response:**

```typescript
{
  title: string
  output: string                // Success/failure details
  metadata: {
    diff: string
    files: Array<{ filePath: string; relativePath: string; type: string; diff: string; additions: number; deletions: number }>
    diagnostics: Record<string, unknown>
  }
}
```

**Note:** Only used when model is GPT-based (not gpt-4 or OSS variants).

---

## Extended Tools

### question

Ask the user a question (interactive).

Implementation: [`packages/opencode/src/tool/question.ts`](../../packages/opencode/src/tool/question.ts)

**Parameters:**

```typescript
{
  questions: Array<{
    question: string
    // options / type fields depend on Question.Info schema
  }>
}
```

**Response:**

```typescript
{
  title: string                 // e.g. "Asked 2 questions"
  output: string                // Summary string including user answers
  metadata: {
    answers: unknown            // Raw answers array (see Question.Answer)
  }
}
```

**Availability:** CLI, app, and desktop clients only.

---

### task

Create a subtask for parallel execution.

Implementation: [`packages/opencode/src/tool/task.ts`](../../packages/opencode/src/tool/task.ts)

**Parameters:**

```typescript
{
  description: string    // Short 3–5 word description
  prompt: string         // The task for the subagent to perform
  subagent_type: string  // Which subagent to run (e.g. "explore", "general")
  session_id?: string    // Continue an existing task session
  command?: string       // Optional: triggering command
}
```

**Response:**

```typescript
{
  title: string
  output: string // Final subagent text + <task_metadata> block
  metadata: {
    sessionId: string
    model: { providerID: string; modelID: string }
    summary: Array<{ id: string; tool: string; state: { status: string; title?: string } }>
  }
}
```

---

### todoread

Read the todo list.

Implementation: [`packages/opencode/src/tool/todoread.ts`](../../packages/opencode/src/tool/todoread.ts)

**Parameters:** None

**Response:**

```typescript
{
  title: string
  output: string // JSON (array of todos)
  metadata: {
    todos: unknown
  }
}
```

---

### todowrite

Write/update the todo list.

Implementation: [`packages/opencode/src/tool/todowrite.ts`](../../packages/opencode/src/tool/todowrite.ts)

**Parameters:**

```typescript
{
  todos: unknown[] // Array of Todo.Info objects
}
```

**Response:**

```typescript
{
  title: string
  output: string // JSON (array of todos)
  metadata: {
    todos: unknown
  }
}
```

---

### skill

Load and execute a skill workflow.

Implementation: [`packages/opencode/src/tool/skill.ts`](../../packages/opencode/src/tool/skill.ts)

**Parameters:**

```typescript
{
  name: string // Skill name from <available_skills>
}
```

**Response:**

```typescript
{
  title: string // Skill name
  output: string // Skill output
  metadata: {
    name: string
    dir: string
  }
}
```

---

## Error Handling

### Validation Errors

When tool arguments fail Zod validation:

```typescript
{
  error: "The read tool was called with invalid arguments: [ZodError details]. Please rewrite the input so it satisfies the expected schema."
}
```

### Permission Errors

When permission is denied:

```typescript
{
  error: "The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [rules]"
}
```

### Execution Errors

When tool execution fails:

```typescript
{
  error: "[Error message from tool]"
}
```

---

## Output Truncation

All tools apply automatic output truncation via `Truncate.output()`:

**Limits:**

- Max lines: 2000
- Max bytes: 50KB (51,200 bytes)

**Behavior:**

1. Count lines and bytes
2. Stop at first limit hit
3. Save full output to temp file
4. Return truncated output with message

**Truncation Message:**

```
(Output truncated at 50KB. Full output saved to [path]. Use grep/read with offset to view more.)
```

---

## File Attachments

Some tools return file attachments for non-text content:

```typescript
interface FilePart {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string // MIME type (e.g., "image/png")
  url: string // data:mime;base64,... or file:// URL
}
```

**Supported by:**

- `read` tool (images, PDFs)

---

## Tool Context Reference

Tools receive a context object:

```typescript
interface Tool.Context {
  sessionID: string             // Current session
  messageID: string             // Parent message ID
  agent: string                 // Agent name
  abort: AbortSignal            // Cancellation signal
  callID?: string               // Provider's call ID

  // Update tool part metadata during execution
  metadata(input: {
    title?: string
    metadata?: Record<string, any>
  }): void

  // Request user permission
  ask(request: {
    permission: string          // Permission type (e.g., "read", "bash")
    patterns: string[]          // Patterns being accessed
    always: string[]            // Auto-allow patterns for "always" approval
    metadata: Record<string, any>
  }): Promise<void>

  // Extra context from caller
  extra?: {
    bypassCwdCheck?: boolean    // Skip working directory check
    [key: string]: any
  }
}
```

---

## See Also

- [Tool Flow](./tool-flow.md) - How tool calling works
- [Tool Permissions](./tool-permissions.md) - Permission system deep-dive
- [Tool Integration](./tool-integration.md) - External agent integration
