# Tool Permissions System

This document explains how OpenCode's permission system works, how permissions are checked and approved, and how to configure permissions for different use cases.

## Overview

OpenCode implements a robust permission system that controls tool execution. The system supports:

- **Wildcard pattern matching** for flexible permission rules
- **Three-level rule precedence** (defaults → user config → agent-specific)
- **Interactive approval flow** for real-time user consent
- **Session-scoped caching** for "always allow" approvals

```
┌─────────────────────────────────────────────────────────────────┐
│                    Permission Check Flow                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tool calls ctx.ask()                                           │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────────┐                                            │
│  │ Evaluate Rules  │◄── Merged ruleset (agent + session + user) │
│  └────────┬────────┘                                            │
│           │                                                      │
│     ┌─────┴─────┐                                               │
│     │           │                                               │
│     ▼           ▼                                               │
│  "allow"     "deny"        "ask"                                │
│     │           │             │                                  │
│     ▼           ▼             ▼                                  │
│  Continue   DeniedError   ┌─────────────────┐                   │
│  execution  (halt)        │ Pending Request │                   │
│                           │ (await Promise) │                   │
│                           └────────┬────────┘                   │
│                                    │                             │
│                           Bus.publish(Event.Asked)              │
│                                    │                             │
│                           ┌────────▼────────┐                   │
│                           │  User Decision  │                   │
│                           │  (UI/CLI/API)   │                   │
│                           └────────┬────────┘                   │
│                                    │                             │
│                    ┌───────────────┼───────────────┐            │
│                    │               │               │             │
│                    ▼               ▼               ▼             │
│                 "once"         "always"        "reject"         │
│                    │               │               │             │
│                    ▼               ▼               ▼             │
│                 Resolve        Add to         Reject +          │
│                 Promise        approved       cascade to        │
│                                ruleset        session           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### Permission Actions

```typescript
type Action = "allow" | "deny" | "ask"
```

| Action  | Behavior                                       |
| ------- | ---------------------------------------------- |
| `allow` | Tool executes immediately, no user interaction |
| `deny`  | Throws `DeniedError`, halts tool execution     |
| `ask`   | Pauses execution, waits for user approval      |

### Permission Rules

A rule defines what action to take for a specific permission + pattern combination:

```typescript
interface Rule {
  permission: string // Tool name or permission type (e.g., "read", "bash", "edit")
  pattern: string // Glob pattern for the target (e.g., file path, command)
  action: Action // What to do when rule matches
}
```

### Rulesets

A ruleset is an ordered array of rules. Rules are evaluated in order, and the **last matching rule wins**.

```typescript
type Ruleset = Rule[]
```

---

## Permission Types

Different tools use different permission types:

| Permission           | Used By                               | Pattern Represents |
| -------------------- | ------------------------------------- | ------------------ |
| `read`               | `read` tool                           | File path          |
| `edit`               | `edit`, `write`, `apply_patch`        | File path          |
| `bash`               | `bash` tool                           | Command prefix     |
| `grep`               | `grep` tool                           | Search pattern (regex) |
| `glob`               | `glob` tool                           | Glob pattern       |
| `external_directory` | Any file access outside workspace     | Directory path     |
| `doom_loop`          | Session processor                     | `*` (system-wide)  |
| `question`           | `question` tool                       | `*`                |
| `plan_enter`         | `plan_enter` tool                     | `*`                |
| `plan_exit`          | `plan_exit` tool                      | `*`                |
| `todoread`           | `todoread` tool                       | `*`                |
| `todowrite`          | `todowrite` tool                      | `*`                |
| `{mcp_tool}`         | MCP tools                             | `*`                |

---

## Rule Evaluation

### Wildcard Matching

OpenCode uses glob-style wildcard matching:

- `*` matches any sequence of characters
- `?` matches any single character
- Patterns are matched against both permission names and target patterns

```typescript
// Examples
Wildcard.match("read", "read") // true
Wildcard.match("read", "*") // true
Wildcard.match("/home/user/.env", "*.env") // true
Wildcard.match("npm install", "npm *") // true
```

### Evaluation Order

Rules are evaluated by merging rulesets in order, then finding the **last matching rule**:

```typescript
function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  const merged = merge(...rulesets) // Flatten all rulesets
  const match = merged.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" } // Default: ask
}
```

### Ruleset Precedence

Rulesets are merged in this order (later rules override earlier ones):

1. **Agent defaults** - Built-in safe defaults
2. **Agent-specific permissions** - Per-agent overrides
3. **User configuration** - From `config.json`
4. **Session approvals** - Runtime "always" approvals

---

## Default Permissions

OpenCode defines sensible defaults in `agent/agent.ts`:

```typescript
const defaults = PermissionNext.fromConfig({
  "*": "allow", // Allow all tools by default
  doom_loop: "ask", // Ask when detecting repeated calls
  external_directory: {
    "*": "ask", // Ask for paths outside workspace
    [Truncate.DIR]: "allow", // Allow truncation temp directory
  },
  question: "deny", // Deny interactive questions by default
  plan_enter: "deny", // Deny plan mode by default
  plan_exit: "deny",
  read: {
    "*": "allow", // Allow reading most files
    "*.env": "ask", // Ask before reading .env files
    "*.env.*": "ask",
    "*.env.example": "allow", // Allow reading .env.example
  },
})
```

---

## Agent-Specific Permissions

Each agent can define its own permission overrides:

### `build` Agent (Primary)

```typescript
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    question: "allow", // Can ask questions
    plan_enter: "allow", // Can enter plan mode
  }),
  user,
)
```

### `explore` Agent (Subagent)

Restricted to read-only operations:

```typescript
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    "*": "deny", // Deny everything by default
    grep: "allow", // Allow search tools
    glob: "allow",
    bash: "allow", // Allow bash (for git, etc.)
    webfetch: "allow",
    websearch: "allow",
    codesearch: "allow",
    read: "allow", // Allow reading files
    external_directory: {
      [Truncate.DIR]: "allow",
    },
  }),
  user,
)
```

### `general` Agent (Subagent)

```typescript
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    todoread: "deny", // Deny todo access
    todowrite: "deny",
  }),
  user,
)
```

### `plan` Agent

Restricted editing to plan files only:

```typescript
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    question: "allow",
    plan_exit: "allow",
    edit: {
      "*": "deny", // Deny editing by default
      [".opencode/plans/*.md"]: "allow", // Allow plan files
    },
  }),
  user,
)
```

---

## User Configuration

Users can configure permissions in `.opencode/config.json`:

```json
{
  "permission": {
    "bash": "ask",
    "read": {
      "*": "allow",
      "~/.ssh/*": "deny",
      "~/.aws/*": "deny"
    },
    "edit": {
      "*": "ask",
      "src/**": "allow"
    },
    "external_directory": "deny"
  }
}
```

### Config Format

```typescript
// Simple: same action for all patterns
"bash": "ask"

// Pattern-specific: different actions per pattern
"read": {
  "*": "allow",           // Default for read
  "~/.ssh/*": "deny",     // Override for SSH directory
  "*.env": "ask"          // Override for .env files
}
```

### Path Expansion

Paths are expanded before matching:

- `~/` → User home directory
- `$HOME/` → User home directory
- `$HOME` → User home directory

---

## Permission Request Flow

### 1. Tool Requests Permission

Inside tool execution, call `ctx.ask()`:

```typescript
// Example from read.ts
await ctx.ask({
  permission: "read", // Permission type
  patterns: [filepath], // Patterns being accessed
  always: ["*"], // Patterns for "always" approval
  metadata: {}, // Optional context
})
```

### 2. Rules Are Evaluated

```typescript
// Inside PermissionNext.ask()
for (const pattern of request.patterns) {
  const rule = evaluate(request.permission, pattern, ruleset, approved)

  if (rule.action === "deny") {
    throw new DeniedError(ruleset)
  }

  if (rule.action === "ask") {
    // Create pending request and wait
    return new Promise((resolve, reject) => {
      pending[id] = { info: request, resolve, reject }
      Bus.publish(Event.Asked, request)
    })
  }

  // rule.action === "allow" → continue to next pattern
}
```

### 3. User Responds

The UI/CLI receives the `permission.asked` event and shows approval UI.

User can respond via API:

```
POST /permission/{requestID}/reply
{
  "reply": "once" | "always" | "reject",
  "message": "optional feedback"
}
```

### 4. Request Resolution

```typescript
// Inside PermissionNext.reply()
if (reply === "reject") {
  existing.reject(message ? new CorrectedError(message) : new RejectedError())
  // Also reject all other pending permissions for this session
  return
}

if (reply === "once") {
  existing.resolve() // Allow this one call
  return
}

if (reply === "always") {
  // Add patterns to approved ruleset
  for (const pattern of existing.info.always) {
    approved.push({
      permission: existing.info.permission,
      pattern,
      action: "allow",
    })
  }
  existing.resolve()

  // Auto-resolve other pending requests that now match
  for (const pending of Object.values(pendingRequests)) {
    if (allPatternsAllowed(pending)) {
      pending.resolve()
    }
  }
}
```

---

## API Endpoints

### List Pending Permissions

```
GET /permission/
```

Returns all pending permission requests across all sessions.

**Response:**

```typescript
Array<{
  id: string // Permission request ID
  sessionID: string // Session that triggered the request
  permission: string // Permission type (e.g., "read", "bash")
  patterns: string[] // Patterns being accessed
  metadata: object // Context information
  always: string[] // Patterns for "always" approval
  tool?: {
    messageID: string // Message containing tool call
    callID: string // Tool call ID
  }
}>
```

### Reply to Permission Request

```
POST /permission/{requestID}/reply
```

**Request Body:**

```typescript
{
  reply: "once" | "always" | "reject"
  message?: string        // Optional feedback (used with "reject")
}
```

**Response:**

```typescript
true // Success
```

### Reply Types

| Reply    | Behavior                                                       |
| -------- | -------------------------------------------------------------- |
| `once`   | Allow this specific call only                                  |
| `always` | Allow and remember for future calls matching `always` patterns |
| `reject` | Deny and cascade to all pending permissions in session         |

---

## Error Types

### `RejectedError`

User rejected without feedback. Halts execution.

```typescript
class RejectedError extends Error {
  message: "The user rejected permission to use this specific tool call."
}
```

### `CorrectedError`

User rejected with feedback. Agent receives guidance.

```typescript
class CorrectedError extends Error {
  message: "The user rejected permission to use this specific tool call with the following feedback: {message}"
}
```

### `DeniedError`

Automatically denied by config rule. Includes matching rules for context.

```typescript
class DeniedError extends Error {
  ruleset: Ruleset // Rules that caused denial
  message: "The user has specified a rule which prevents you from using this specific tool call..."
}
```

---

## Disabling Tools

Tools can be completely disabled (not shown to model) if they have a blanket deny rule:

```typescript
function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast((r) => Wildcard.match(permission, r.permission))

    // Only disable if rule matches ALL patterns ("*") with "deny"
    if (rule && rule.pattern === "*" && rule.action === "deny") {
      result.add(tool)
    }
  }
  return result
}
```

This means:

- `"bash": "deny"` → `bash` tool not available to model
- `"bash": { "rm *": "deny" }` → `bash` tool available, but `rm` commands denied

---

## External Agent Integration

### Current State: `/tool/call` Bypass

The current `/tool/call` endpoint bypasses the permission system:

```typescript
// server/routes/session.ts:1088-1096
const ctx: Tool.Context = {
  // ...
  ask: async () => {}, // No-op - permissions bypassed
}
```

### Recommended: Full Permission Integration

To properly integrate permissions for external agents:

```typescript
const ctx: Tool.Context = {
  sessionID,
  messageID,
  agent: "external",
  abort: abortController.signal,
  callID: callId,
  metadata: () => {},
  ask: async (req) => {
    // Use the session's permission ruleset
    const session = await Session.get(sessionID)
    await PermissionNext.ask({
      ...req,
      sessionID,
      tool: { messageID, callID: callId },
      ruleset: session.permission ?? [],
    })
  },
}
```

### Permission Handling Options

| Mode             | Behavior                                | Use Case                                 |
| ---------------- | --------------------------------------- | ---------------------------------------- |
| **Bypass**       | `ask: async () => {}`                   | Trusted external agents                  |
| **Strict**       | Full `PermissionNext.ask()`             | Untrusted agents, user approval required |
| **Pre-approved** | Session with pre-configured permissions | Automated pipelines                      |

---

## Bus Events

The permission system uses the event bus for coordination:

### `permission.asked`

Published when a permission request is created:

```typescript
BusEvent.define("permission.asked", {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: object
  always: string[]
  tool?: { messageID: string, callID: string }
})
```

### `permission.replied`

Published when a permission request is resolved:

```typescript
BusEvent.define("permission.replied", {
  sessionID: string
  requestID: string
  reply: "once" | "always" | "reject"
})
```

---

## Best Practices

### For Tool Implementers

1. **Request minimal permissions** - Only ask for what you need
2. **Use specific patterns** - Prefer `/path/to/file.ts` over `*`
3. **Provide meaningful `always` patterns** - Use prefixes like `npm *` for related commands
4. **Include metadata** - Help users understand what's being accessed

```typescript
await ctx.ask({
  permission: "bash",
  patterns: ["npm install lodash"],
  always: ["npm install*"], // User can approve all npm installs
  metadata: {
    reason: "Installing dependency",
    package: "lodash",
  },
})
```

### For Configuration

1. **Start restrictive** - Use `"*": "ask"` and allow specific patterns
2. **Deny sensitive paths** - Block `~/.ssh/*`, `~/.aws/*`, etc.
3. **Allow workspace edits** - `"edit": { "src/**": "allow" }`
4. **Review agent permissions** - Subagents should have minimal access

### For External Agents

1. **Create dedicated sessions** - Each external agent gets its own session
2. **Pre-configure permissions** - Set session-level rules for automation
3. **Handle rejections gracefully** - Catch `RejectedError` and `DeniedError`
4. **Implement approval UI** - Subscribe to `permission.asked` events

---

## Related Documentation

- [Tool Flow](./tool-flow.md) - How tool calling works
- [Tool Integration](./tool-integration.md) - External agent integration
- [Tool API Reference](./tool-api.md) - Detailed API documentation
