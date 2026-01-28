# Tool API Reference

Detailed API documentation for OpenCode tools, including parameters, response formats, and usage examples.

## API Endpoints

### Execute Tool (Session-Based)

```
POST /session/{sessionID}/tool/call
```

Execute a tool within the context of an existing session.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```typescript
{
  toolName: string              // Tool identifier
  callId: string                // Unique call ID for correlation
  arguments: Record<string, any> // Tool-specific parameters
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

**Parameters:**
```typescript
{
  filePath: string              // Absolute or relative path
  content: string               // File content
}
```

**Response:**
```typescript
{
  title: string                 // Relative path
  output: string                // Success message
  metadata: {
    path: string                // Absolute path
    created: boolean            // Whether file was created (vs overwritten)
  }
}
```

**Behavior:**
- Creates parent directories if needed
- Overwrites existing files without warning
- Preserves file permissions

---

### edit

Edit a file using search/replace.

**Parameters:**
```typescript
{
  filePath: string              // File to edit
  old_string: string            // Text to find
  new_string: string            // Replacement text
}
```

**Response:**
```typescript
{
  title: string                 // Relative path
  output: string                // Success/failure message
  metadata: {
    applied: boolean            // Whether edit was applied
    occurrences: number         // Number of replacements
  }
}
```

**Behavior:**
- Exact string matching (no regex)
- Single occurrence replaced per call
- Error if `old_string` not found
- Error if multiple occurrences found (must be unique)

---

### bash

Execute a shell command.

**Parameters:**
```typescript
{
  command: string               // Command to execute
  timeout?: number              // Timeout in ms, default: 30000
}
```

**Response:**
```typescript
{
  title: string                 // Truncated command
  output: string                // stdout + stderr combined
  metadata: {
    exitCode: number            // Process exit code
    signal?: string             // Signal if killed
    timedOut: boolean           // Whether timeout was hit
  }
}
```

**Behavior:**
- Runs in project working directory
- Inherits environment variables
- Kills process on timeout
- stderr merged into stdout

**Limits:**
- Default timeout: 30 seconds
- Output truncated per standard limits

---

### glob

Find files matching a pattern.

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
  title: string                 // Pattern searched
  output: string                // Matched file paths, one per line
  metadata: {
    count: number               // Number of matches
    truncated: boolean          // Whether results truncated
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
  title: string                 // Search summary
  output: string                // Matching lines with context
  metadata: {
    matchCount: number          // Number of matches
    fileCount: number           // Files with matches
    truncated: boolean
  }
}
```

**Output Format:**
```
path/to/file.ts:42: matching line content
path/to/file.ts:43: context line
```

**Behavior:**
- Uses ripgrep for performance
- Respects .gitignore
- Case-insensitive by default

---

### webfetch

Fetch and process web content.

**Parameters:**
```typescript
{
  url: string                   // URL to fetch
  prompt?: string               // Processing instruction
}
```

**Response:**
```typescript
{
  title: string                 // URL fetched
  output: string                // Processed content
  metadata: {
    statusCode: number
    contentType: string
    contentLength: number
  }
}
```

**Behavior:**
- Converts HTML to markdown
- Follows redirects
- Respects robots.txt
- Timeout: 30 seconds

---

### websearch

Search the web.

**Parameters:**
```typescript
{
  query: string                 // Search query
}
```

**Response:**
```typescript
{
  title: string                 // Query
  output: string                // Search results as markdown
  metadata: {
    resultCount: number
    provider: string            // "opencode" | "exa"
  }
}
```

**Availability:**
- Requires `opencode` provider OR `OPENCODE_ENABLE_EXA` flag

---

### apply_patch

Apply a unified diff patch (used for GPT models).

**Parameters:**
```typescript
{
  patch: string                 // Unified diff format
}
```

**Response:**
```typescript
{
  title: string
  output: string                // Success/failure details
  metadata: {
    filesModified: string[]
    hunksApplied: number
  }
}
```

**Note:** Only used when model is GPT-based (not gpt-4 or OSS variants).

---

## Extended Tools

### question

Ask the user a question (interactive).

**Parameters:**
```typescript
{
  question: string              // Question text
  options?: string[]            // Optional choices
}
```

**Response:**
```typescript
{
  title: string
  output: string                // User's answer
  metadata: {
    selectedOption?: number     // Index if options provided
  }
}
```

**Availability:** CLI, app, and desktop clients only.

---

### task

Create a subtask for parallel execution.

**Parameters:**
```typescript
{
  description: string           // Task description
  prompt: string                // Task prompt
}
```

**Response:**
```typescript
{
  title: string
  output: string                // Task result
  metadata: {
    taskId: string
    status: "completed" | "failed"
  }
}
```

---

### todoread

Read the todo list.

**Parameters:** None

**Response:**
```typescript
{
  title: "Todo List"
  output: string                // Todo items as markdown
  metadata: {
    itemCount: number
  }
}
```

---

### todowrite

Write/update the todo list.

**Parameters:**
```typescript
{
  content: string               // New todo content (markdown)
}
```

**Response:**
```typescript
{
  title: "Todo Updated"
  output: string                // Confirmation
  metadata: {
    itemCount: number
  }
}
```

---

### skill

Load and execute a skill workflow.

**Parameters:**
```typescript
{
  skill: string                 // Skill name/path
  args?: Record<string, any>    // Skill arguments
}
```

**Response:**
```typescript
{
  title: string                 // Skill name
  output: string                // Skill output
  metadata: {
    skillPath: string
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
  mime: string                  // MIME type (e.g., "image/png")
  url: string                   // data:mime;base64,... or file:// URL
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
