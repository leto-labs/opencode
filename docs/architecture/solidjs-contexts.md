# SolidJS Contexts and Stores

This document explains the context and state management patterns used in the OpenCode frontend, designed for developers familiar with React transitioning to SolidJS.

## Table of Contents

- [SolidJS vs React: Key Differences](#solidjs-vs-react-key-differences)
- [Context Pattern: `createSimpleContext`](#context-pattern-createsimplecontext)
- [Provider Hierarchy](#provider-hierarchy)
- [Context Categories](#context-categories)
- [Choosing the Right Pattern](#choosing-the-right-pattern)
- [Common Patterns](#common-patterns)
- [VoiceMode Refactoring Decision](#voicemode-refactoring-decision)
- [Summary](#summary)

## SolidJS vs React: Key Differences

### Reactivity Model

| Aspect       | React                             | SolidJS                                         |
| ------------ | --------------------------------- | ----------------------------------------------- |
| Re-renders   | Entire component re-renders       | Only affected DOM nodes update                  |
| State access | `useState` returns value directly | `createSignal` returns getter function          |
| Effects      | Run after render, with deps array | Run immediately, auto-track dependencies        |
| Props        | Destructure freely                | Must access via `props.x` (or use `splitProps`) |

```typescript
// React
const [count, setCount] = useState(0)
console.log(count) // Direct value: 0

// SolidJS
const [count, setCount] = createSignal(0)
console.log(count()) // Must call getter: 0
```

### Component Lifecycle

```typescript
// React: useEffect runs after render, re-runs when deps change
useEffect(() => {
  console.log("mounted or count changed")
  return () => console.log("cleanup")
}, [count])

// SolidJS: createEffect auto-tracks, onMount/onCleanup for lifecycle
onMount(() => console.log("mounted once"))
createEffect(() => {
  console.log("count changed:", count()) // Auto-tracks count()
})
onCleanup(() => console.log("cleanup"))
```

### Stores vs useState

SolidJS stores are like Immer-wrapped objects with fine-grained reactivity:

```typescript
// React: Need to spread/copy for immutability
const [state, setState] = useState({ user: { name: "Leo" } })
setState((prev) => ({ ...prev, user: { ...prev.user, name: "New" } }))

// SolidJS: Direct path updates, fine-grained reactivity
const [store, setStore] = createStore({ user: { name: "Leo" } })
setStore("user", "name", "New") // Only subscribers to user.name update
```

---

## Context Pattern: `createSimpleContext`

All contexts use a factory helper that standardizes creation. This is the core abstraction for building contexts in the OpenCode frontend.

### Implementation

```typescript
// packages/ui/src/context/helper.tsx
import { createContext, createMemo, Show, useContext, type ParentProps, type Accessor } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
  gate?: boolean
}) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return <ctx.Provider value={init}>{props.children}</ctx.Provider>
      }

      // Access init.ready inside the memo to make it reactive for getter properties
      const isReady = createMemo(() => {
        const ready = init.ready as Accessor<boolean> | boolean | undefined
        return ready === undefined || (typeof ready === "function" ? ready() : ready)
      })

      return (
        <Show when={isReady()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use() {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
  }
}
```

### Parameters

| Parameter | Type                  | Default  | Description                                           |
| --------- | --------------------- | -------- | ----------------------------------------------------- |
| `name`    | `string`              | required | Context name for error messages                       |
| `init`    | `(props: Props) => T` | required | Factory function that creates the context value       |
| `gate`    | `boolean`             | `true`   | Whether to wait for `ready` before rendering children |

### Return Value

The helper returns an object with two properties:

```typescript
{
  provider: Component<ParentProps<Props>>,  // The Provider component
  use: () => T                               // Hook to consume the context
}
```

### How `gate` and `ready` Work

The `gate` mechanism provides a way to delay rendering children until the context is ready (e.g., data is loaded from storage or an async operation completes).

**When `gate: true` (default):**

1. The `init` function is called immediately
2. The helper looks for a `ready` property on the returned value
3. Children are only rendered when `ready` is truthy (or undefined)

**The `ready` property can be:**

- `undefined` → Children render immediately
- `boolean` → Children render when `true`
- `Accessor<boolean>` (signal getter) → Children render when signal returns `true`

```typescript
// Example: Context with async initialization
export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  gate: true, // Wait for ready
  init: () => {
    const [data, setData] = createSignal(null)
    const [ready, setReady] = createSignal(false)

    // Async load
    onMount(async () => {
      const result = await fetchData()
      setData(result)
      setReady(true) // Now children will render
    })

    return { data, ready } // ready is a signal getter
  },
})
```

**When `gate: false`:**

- Children render immediately
- The `ready` property is ignored
- Useful for contexts that don't need async initialization

```typescript
export const { use: useVoiceMode, provider: VoiceModeProvider } = createSimpleContext({
  name: "VoiceMode",
  gate: false, // Don't block rendering
  init: (props: { sessionID?: string }) => {
    // Context value available immediately, connection happens async
    return { status, connect, disconnect }
  },
})
```

### TypeScript Generics

The helper uses two type parameters:

- `T`: The type of the context value returned by `init`
- `Props`: The type of props passed to the provider (extends `Record<string, any>`)

```typescript
// Type inference example
interface MyContextValue {
  count: Accessor<number>
  increment: () => void
}

interface MyProviderProps {
  initialCount: number
}

const { use, provider } = createSimpleContext<MyContextValue, MyProviderProps>({
  name: "Counter",
  init: (props) => {
    // props is typed as MyProviderProps
    const [count, setCount] = createSignal(props.initialCount)
    return {
      count,
      increment: () => setCount((c) => c + 1),
    }
  },
})

// Usage:
// <provider initialCount={5}>...</provider>
// const { count, increment } = use()
```

### Error Handling

The `use()` function throws a descriptive error if called outside the provider:

```typescript
// This will throw: "Counter context must be used within a context provider"
const value = useCounter() // Called without <CounterProvider> ancestor
```

### Key Features Summary

1. **`gate` option**: When `true` (default), waits for `init().ready` before rendering children
2. **Props support**: The `init` function receives provider props for configuration
3. **Type inference**: Full TypeScript support for the returned API
4. **Reactive ready check**: Uses `createMemo` to reactively track the `ready` signal
5. **Safe consumption**: `use()` throws helpful error if context is missing

---

## Provider Hierarchy

```
AppBaseProviders (Theme, Language, Dialogs, Markdown)
│
└── AppInterface
    │
    ├── ServerProvider (server URL)
    │   └── GlobalSDKProvider (SDK client, SSE events)
    │       └── GlobalSyncProvider (global state: projects, providers)
    │           └── Router
    │               │
    │               ├── SettingsProvider
    │               ├── PermissionProvider
    │               ├── LayoutProvider
    │               ├── NotificationProvider
    │               └── CommandProvider
    │
    └── DirectoryLayout (per-project)
        │
        ├── SDKProvider (directory-scoped SDK client)
        │   └── SyncProvider (directory-scoped state)
        │       └── LocalProvider (model selection, file state)
        │
        └── Session Route (/session/:id?)
            │
            ├── TerminalProvider
            ├── FileProvider
            ├── PromptProvider
            ├── CommentsProvider
            └── VoiceModeProvider (currently global, should be here)
```

---

## Context Categories

### 1. Global Singletons

**Scope**: Entire application
**Mount**: Once at app startup
**Examples**: `GlobalSDKProvider`, `GlobalSyncProvider`

```typescript
// GlobalSDKProvider - Single SDK instance for the whole app
export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const server = useServer()
    const abort = new AbortController()

    // Single SSE connection for all events
    void (async () => {
      const events = await eventSdk.global.event()
      for await (const event of events.stream) {
        emitter.emit(event.directory, event.payload)
      }
    })()

    onCleanup(() => abort.abort())

    return { url: server.url, client: sdk, event: emitter }
  },
})
```

**Why global?**

- Single SSE connection for all events (efficient)
- Shared authentication/configuration
- Routes events to appropriate directory handlers

### 2. Multi-Instance Managers

**Scope**: Global provider, but manages per-directory/session instances internally
**Mount**: Once at app startup
**Examples**: `GlobalSyncProvider`

```typescript
// GlobalSyncProvider manages child stores per directory
function createGlobalSync() {
  const children: Record<string, [Store<State>, SetStoreFunction<State>]> = {}

  // Lazy-create stores per directory
  function child(directory: string) {
    if (!children[directory]) {
      children[directory] = createStore<State>({ ... })
    }
    return children[directory]
  }

  // Single SSE listener routes to appropriate child
  globalSDK.event.listen((e) => {
    const [store, setStore] = children[e.directory]
    // Update appropriate store based on event
  })

  return { child, data: globalStore }
}
```

**Why this pattern?**

- Single SSE connection, multiple data stores
- Sidebar needs data from ALL directories (session lists)
- Efficient: shares infrastructure, lazy-creates stores

### 3. Directory-Scoped

**Scope**: One project/directory
**Mount**: When entering a directory route (`/:dir/*`)
**Examples**: `SDKProvider`, `SyncProvider`, `LocalProvider`

```typescript
// SDKProvider - Directory-specific SDK client
export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: string }) => {
    const globalSDK = useGlobalSDK()

    // SDK client scoped to this directory
    const client = createMemo(() =>
      createOpencodeClient({
        baseUrl: globalSDK.url,
        directory: props.directory, // All requests include this header
      }),
    )

    return { directory: props.directory, client: client() }
  },
})
```

**Why directory-scoped?**

- API calls need directory context (header)
- State is isolated per project
- Cleanup when leaving directory

### 4. Session-Scoped with Internal Caching

**Scope**: Session Route, but caches state across session switches
**Mount**: Inside session route (`/session/:id?`)
**Examples**: `TerminalProvider`, `FileProvider`, `PromptProvider`

```typescript
// PromptProvider - Session-scoped with LRU cache
export const { use: usePrompt, provider: PromptProvider } = createSimpleContext({
  name: "Prompt",
  gate: false, // Don't wait for ready (cache handles it)
  init: () => {
    const params = useParams()
    const cache = new Map<string, PromptCacheEntry>()
    const MAX_SESSIONS = 20

    // Lazy-load session data with LRU caching
    const load = (dir: string, id: string | undefined) => {
      const key = `${dir}:${id ?? "__workspace__"}`
      const existing = cache.get(key)
      if (existing) {
        // Move to end (LRU)
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      // Create new session with disposal
      const entry = createRoot((dispose) => ({
        value: createPromptSession(dir, id),
        dispose,
      }))
      cache.set(key, entry)

      // Prune old sessions
      while (cache.size > MAX_SESSIONS) {
        const first = cache.keys().next().value
        cache.get(first)?.dispose()
        cache.delete(first)
      }

      return entry.value
    }

    // Reactive: switches when params.id changes
    const session = createMemo(() => load(params.dir!, params.id))

    onCleanup(() => {
      for (const entry of cache.values()) entry.dispose()
    })

    // Proxy to current session
    return {
      current: () => session().current(),
      set: (prompt) => session().set(prompt),
      reset: () => session().reset(),
    }
  },
})
```

**Why session-scoped with caching?**

- Prompt state persists when switching sessions
- LRU eviction prevents memory bloat
- `createRoot` allows disposing reactive contexts
- Proxy pattern keeps API simple

### 5. Pure Session-Scoped (Mount/Unmount Lifecycle)

**Scope**: Single session only
**Mount**: When entering session, unmount when leaving
**Examples**: `VoiceModeProvider` (proposed)

```typescript
// VoiceModeProvider - Pure session-scoped (proposed refactor)
export const { use: useVoiceMode, provider: VoiceModeProvider } = createSimpleContext({
  name: "VoiceMode",
  init: (props: { sessionID?: string }) => {
    const sdk = useSDK()
    const local = useLocal()

    const [status, setStatus] = createSignal<VoiceStatus>("disconnected")
    let session: RealtimeSession | null = null

    // Auto-connect on mount if client-side model selected
    onMount(() => {
      if (local.model.current()?.clientSide && props.sessionID) {
        connect()
      }
    })

    // Auto-disconnect on unmount (component cleanup)
    onCleanup(() => {
      if (session) {
        session.close()
        session = null
      }
    })

    const connect = async () => {
      /* ... */
    }
    const disconnect = () => {
      /* ... */
    }

    return { status, connect, disconnect }
  },
})
```

**Why pure session-scoped?**

- WebRTC connections are expensive (audio streams, network)
- No need to keep multiple sessions "warm"
- Component lifecycle handles connect/disconnect automatically
- Simpler code: no session tracking logic needed

---

## Choosing the Right Pattern

| Need                                   | Pattern                | Example              |
| -------------------------------------- | ---------------------- | -------------------- |
| Shared infrastructure (SSE, auth)      | Global Singleton       | `GlobalSDKProvider`  |
| Multi-project visibility (sidebar)     | Multi-Instance Manager | `GlobalSyncProvider` |
| Project-specific API calls             | Directory-Scoped       | `SDKProvider`        |
| State persists across session switches | Session + Cache        | `PromptProvider`     |
| Expensive resources per session        | Pure Session-Scoped    | `VoiceModeProvider`  |

### Decision Tree

```
1. Does the entire app need ONE instance?
   └── Yes → Global Singleton
   └── No → Continue...

2. Does the sidebar/other routes need this data?
   └── Yes → Multi-Instance Manager (global with child stores)
   └── No → Continue...

3. Is the state project-specific?
   └── Yes → Directory-Scoped
   └── No → Continue...

4. Should state persist when switching sessions?
   └── Yes → Session + Cache pattern
   └── No → Pure Session-Scoped
```

---

## Common Patterns

### Persisted State

Use `persisted()` helper for localStorage-backed stores:

```typescript
const [store, setStore, _, ready] = persisted(
  Persist.scoped(directory, sessionID, "prompt", [legacyKey]),
  createStore<State>({ prompt: DEFAULT_PROMPT }),
)

// Wait for storage to hydrate
createEffect(() => {
  if (!ready()) return
  // Storage is loaded, safe to use store
})
```

### Reactive Memos for Derived State

```typescript
const current = createMemo(() => {
  const model = local.model.current()
  return model?.clientSide === true
})

// Auto-updates when model changes
createEffect(() => {
  if (current()) {
    voiceMode.connect()
  }
})
```

### Event Subscriptions with Cleanup

```typescript
onMount(() => {
  const unsub = sdk.event.on("file.updated", (event) => {
    // Handle event
  })
  onCleanup(unsub)
})
```

### CreateRoot for Manual Reactive Scopes

```typescript
// Create isolated reactive scope with manual disposal
const entry = createRoot((dispose) => ({
  value: createSession(id),
  dispose, // Call this to cleanup all effects inside
}))

// Later: cleanup
entry.dispose()
```

---

## VoiceMode Refactoring Decision

Based on this analysis, `VoiceModeProvider` should be **Pure Session-Scoped**:

| Factor                             | Assessment                         |
| ---------------------------------- | ---------------------------------- |
| Resource cost                      | High (WebRTC, audio)               |
| Multi-session visibility needed?   | No                                 |
| State persistence across switches? | No (fresh connection per session)  |
| Reconnection acceptable?           | Yes (1-2s delay is fine for voice) |

**Recommended placement**: Inside Session Route, as a sibling to `PromptProvider`

```typescript
<Route path="/session/:id?" component={(p) => (
  <Show when={p.params.id ?? "new"}>
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>
            <VoiceModeProvider sessionID={p.params.id}>
              <Session />
            </VoiceModeProvider>
          </CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  </Show>
)} />
```

This eliminates all the complex session-tracking logic (`connectedSessionID`, `lastConnectingSession`, effects for session switching) because:

- Mount → Connect (if client-side model)
- Unmount → Disconnect
- New session = new provider instance = clean slate

---

## Summary

| Pattern                | Lifecycle       | Internal State      | Use Case              |
| ---------------------- | --------------- | ------------------- | --------------------- |
| Global Singleton       | App lifetime    | Single store        | Shared infrastructure |
| Multi-Instance Manager | App lifetime    | Map of stores       | Sidebar visibility    |
| Directory-Scoped       | Directory route | Single store        | Project-specific API  |
| Session + Cache        | Session route   | LRU cache of stores | Persisted UI state    |
| Pure Session-Scoped    | Session route   | Single instance     | Expensive resources   |
