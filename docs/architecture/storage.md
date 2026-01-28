# Storage Module

The storage module provides a simple JSON file-based persistence layer for OpenCode.

## Location

Storage files are located at:
```
~/.local/share/opencode/storage/
```

## Key Structure

Storage uses a key array that maps to filesystem paths:

```typescript
Storage.read(["client_secret", "ses_abc123"])
// → ~/.local/share/opencode/storage/client_secret/ses_abc123.json

Storage.write(["session", projectID, sessionID], data)
// → ~/.local/share/opencode/storage/session/{projectID}/{sessionID}.json
```

## API

### `Storage.read<T>(key: string[]): Promise<T>`

Reads a JSON file and returns its parsed content.

**Throws `Storage.NotFoundError`** if the file doesn't exist.

```typescript
try {
  const data = await Storage.read<MyType>(["namespace", "id"])
} catch (err) {
  if (err instanceof Storage.NotFoundError) {
    // File doesn't exist
  }
  throw err
}
```

### `Storage.write<T>(key: string[], content: T): Promise<void>`

Writes content to a JSON file. Creates parent directories if needed.

```typescript
await Storage.write(["client_secret", sessionID], {
  value: "token...",
  expiresAt: Date.now() + 60000,
})
```

### `Storage.update<T>(key: string[], fn: (draft: T) => void): Promise<T>`

Reads a file, applies a mutation function, and writes it back atomically.

```typescript
await Storage.update<Session>(["session", projectID, sessionID], (draft) => {
  draft.title = "New Title"
})
```

### `Storage.remove(key: string[]): Promise<void>`

Deletes a file. Does not throw if file doesn't exist.

```typescript
await Storage.remove(["client_secret", sessionID])
```

### `Storage.list(prefix: string[]): Promise<string[][]>`

Lists all files under a prefix, returning their full keys.

```typescript
const sessions = await Storage.list(["session", projectID])
// Returns: [["session", projectID, "ses_1"], ["session", projectID, "ses_2"], ...]
```

## Locking

Storage operations use file-based locking to prevent race conditions:
- `read()` acquires a read lock
- `write()` and `update()` acquire a write lock

## Error Handling

### NotFoundError

`Storage.read()` and `Storage.update()` throw `Storage.NotFoundError` when the file doesn't exist:

```typescript
import { Storage } from "../storage/storage"

try {
  const data = await Storage.read(["key"])
} catch (err) {
  if (err instanceof Storage.NotFoundError) {
    // Handle missing file - return null, create default, etc.
    return null
  }
  throw err
}
```

**Important**: Always handle `NotFoundError` when reading optional data that may not exist yet.

## Common Patterns

### Optional Read (return null if missing)

```typescript
async function getOptional<T>(key: string[]): Promise<T | null> {
  try {
    return await Storage.read<T>(key)
  } catch (err) {
    if (err instanceof Storage.NotFoundError) {
      return null
    }
    throw err
  }
}
```

### Get or Create

```typescript
async function getOrCreate<T>(key: string[], defaultValue: T): Promise<T> {
  try {
    return await Storage.read<T>(key)
  } catch (err) {
    if (err instanceof Storage.NotFoundError) {
      await Storage.write(key, defaultValue)
      return defaultValue
    }
    throw err
  }
}
```

## Storage Layout

```
~/.local/share/opencode/storage/
├── migration                    # Current migration version
├── project/
│   └── {projectID}.json        # Project metadata
├── session/
│   └── {projectID}/
│       └── {sessionID}.json    # Session info
├── message/
│   └── {sessionID}/
│       └── {messageID}.json    # Message data
├── part/
│   └── {messageID}/
│       └── {partID}.json       # Message parts
├── session_diff/
│   └── {sessionID}.json        # Session file diffs
├── client_secret/
│   └── {sessionID}.json        # OpenAI realtime tokens (ephemeral)
└── share/
    └── {sessionID}.json        # Share info
```

## Migrations

The storage module supports migrations for schema changes. Migrations are run automatically on startup. The current migration version is stored in the `migration` file.
