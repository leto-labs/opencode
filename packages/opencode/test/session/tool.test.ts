import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { SessionTool } from "../../src/session/tool"
import { SessionTranscript } from "../../src/session/transcript"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("SessionTool", () => {
  describe("list", () => {
    test("should return tools in OpenAI function format", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          const tools = await SessionTool.list({ sessionID: session.id })

          // Should return an array of tools
          expect(Array.isArray(tools)).toBe(true)
          expect(tools.length).toBeGreaterThan(0)

          // Each tool should have the expected format
          const readTool = tools.find((t) => t.name === "read")
          expect(readTool).toBeDefined()
          expect(readTool!.type).toBe("function")
          expect(readTool!.description).toBeDefined()
          expect(readTool!.parameters).toBeDefined()

          // Parameters should be a JSON Schema (either directly or wrapped)
          // zod-to-json-schema may return different structures
          expect(typeof readTool!.parameters).toBe("object")

          await Session.remove(session.id)
        },
      })
    })

    test("should throw error for non-existent session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          await expect(SessionTool.list({ sessionID: "ses_nonexistent123" })).rejects.toThrow()
        },
      })
    })

    test("should include common tools", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          const tools = await SessionTool.list({ sessionID: session.id })
          const toolNames = tools.map((t) => t.name)

          // Check for some common tools
          expect(toolNames).toContain("read")
          expect(toolNames).toContain("glob")
          expect(toolNames).toContain("grep")
          expect(toolNames).toContain("bash")

          await Session.remove(session.id)
        },
      })
    })
  })

  describe("call", () => {
    test("should return error for non-existent tool", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          const result = await SessionTool.call({
            sessionID: session.id,
            toolName: "nonexistent_tool",
            callId: "call_123",
            arguments: {},
          })

          expect(result.callId).toBe("call_123")
          expect(result.error).toContain("Tool not found")
          expect(result.result).toBeNull()

          await Session.remove(session.id)
        },
      })
    })

    test("should throw error for non-existent session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          await expect(
            SessionTool.call({
              sessionID: "ses_nonexistent123",
              toolName: "read",
              callId: "call_123",
              arguments: { filePath: "/tmp/test.txt" },
            }),
          ).rejects.toThrow()
        },
      })
    })

    test("should execute read tool and store tool part", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          // First add a user message so the tool call has a parent
          await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [{ type: "text", text: "Read a file" }],
          })

          // Execute a real tool (read tool should be available)
          const result = await SessionTool.call({
            sessionID: session.id,
            toolName: "read",
            callId: "call_456",
            arguments: { filePath: path.join(projectRoot, "package.json") },
          })

          expect(result.callId).toBe("call_456")
          expect(result.error).toBeUndefined()
          expect(result.result).toBeDefined()

          // Verify the tool part was stored
          const messages = await Session.messages({ sessionID: session.id })
          const assistantMessage = messages.find((m) => m.info.role === "assistant")

          expect(assistantMessage).toBeDefined()

          const toolPart = assistantMessage!.parts.find((p) => p.type === "tool") as MessageV2.ToolPart
          expect(toolPart).toBeDefined()
          expect(toolPart.tool).toBe("read")
          expect(toolPart.callID).toBe("call_456")
          expect(toolPart.state.status).toBe("completed")

          await Session.remove(session.id)
        },
      })
    })

    test("should create assistant message with parentID", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          // Add a user message first
          const userResult = await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [{ type: "text", text: "Please read a file" }],
          })

          // Execute tool call
          await SessionTool.call({
            sessionID: session.id,
            toolName: "read",
            callId: "call_789",
            arguments: { filePath: path.join(projectRoot, "package.json") },
          })

          // Verify the assistant message has the correct parentID
          const messages = await Session.messages({ sessionID: session.id })
          const assistantMessage = messages.find((m) => m.info.role === "assistant")

          expect(assistantMessage).toBeDefined()
          const assistantInfo = assistantMessage!.info as MessageV2.Assistant
          expect(assistantInfo.parentID).toBe(userResult.info.id)

          await Session.remove(session.id)
        },
      })
    })

    test("should handle tool execution errors", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          // Try to read a non-existent file
          const result = await SessionTool.call({
            sessionID: session.id,
            toolName: "read",
            callId: "call_error",
            arguments: { filePath: "/nonexistent/path/to/file.txt" },
          })

          expect(result.callId).toBe("call_error")
          expect(result.error).toBeDefined()
          expect(result.result).toBeNull()

          // Verify the tool part was stored with error status
          const messages = await Session.messages({ sessionID: session.id })
          const assistantMessage = messages.find((m) => m.info.role === "assistant")
          const toolPart = assistantMessage!.parts.find((p) => p.type === "tool") as MessageV2.ToolPart

          expect(toolPart.state.status).toBe("error")
          if (toolPart.state.status === "error") {
            expect(toolPart.state.error).toBeDefined()
          }

          await Session.remove(session.id)
        },
      })
    })

    test("should touch session timestamp", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})
          const initialUpdated = session.time.updated

          // Wait a bit to ensure timestamp difference
          await new Promise((resolve) => setTimeout(resolve, 10))

          await SessionTool.call({
            sessionID: session.id,
            toolName: "read",
            callId: "call_timestamp",
            arguments: { filePath: path.join(projectRoot, "package.json") },
          })

          const updatedSession = await Session.get(session.id)
          expect(updatedSession.time.updated).toBeGreaterThan(initialUpdated)

          await Session.remove(session.id)
        },
      })
    })

    test("should support complete client-side inference workflow", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          // 1. Create session
          const session = await Session.create({})
          expect(session.id).toBeDefined()

          // 2. Add user transcript
          const userResult = await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [
              {
                type: "text",
                text: "Please read the package.json file",
                metadata: { source: "voice", itemId: "item_001" },
              },
            ],
          })
          expect(userResult.info.id).toBeDefined()

          // 3. Add assistant transcript (before tool call)
          const assistantResult1 = await SessionTranscript.add({
            sessionID: session.id,
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "I'll read that file for you.",
                metadata: { source: "voice", itemId: "item_002" },
              },
            ],
          })
          expect(assistantResult1.info.id).toBeDefined()

          // 4. Execute tool call
          const toolResult = await SessionTool.call({
            sessionID: session.id,
            toolName: "read",
            callId: "call_workflow",
            arguments: { filePath: path.join(projectRoot, "package.json") },
          })
          expect(toolResult.result).toBeDefined()
          expect(toolResult.error).toBeUndefined()

          // 5. Add final assistant transcript
          const assistantResult2 = await SessionTranscript.add({
            sessionID: session.id,
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "The package.json file contains the project configuration.",
                metadata: { source: "voice", itemId: "item_003" },
              },
            ],
          })
          expect(assistantResult2.info.id).toBeDefined()

          // 6. Retrieve all messages and verify
          const messages = await Session.messages({ sessionID: session.id })

          // Should have messages
          expect(messages.length).toBeGreaterThan(0)

          // Verify user message exists
          const userMessage = messages.find((m) => m.info.role === "user")
          expect(userMessage).toBeDefined()

          // Verify assistant messages exist
          const assistantMessages = messages.filter((m) => m.info.role === "assistant")
          expect(assistantMessages.length).toBeGreaterThan(0)

          // Verify there's at least one text part
          const allTextParts = messages.flatMap((m) => m.parts.filter((p) => p.type === "text"))
          expect(allTextParts.length).toBeGreaterThan(0)

          // Verify tool part exists
          const allToolParts = messages.flatMap((m) => m.parts.filter((p) => p.type === "tool"))
          expect(allToolParts.length).toBeGreaterThan(0)

          await Session.remove(session.id)
        },
      })
    })
  })
})
