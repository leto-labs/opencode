import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.tool.call", () => {
  test("returns error for non-existent tool", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        const response = await app.request(`/session/${session.id}/tool/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolName: "nonexistent_tool",
            callId: "call_123",
            arguments: {},
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { callId: string; result: unknown; error?: string }
        expect(body.callId).toBe("call_123")
        expect(body.error).toContain("Tool not found")

        await Session.remove(session.id)
      },
    })
  })

  test("returns 404 for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        const response = await app.request("/session/ses_nonexistent123/tool/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolName: "read",
            callId: "call_123",
            arguments: { filePath: "/tmp/test.txt" },
          }),
        })

        expect(response.status).toBe(404)
      },
    })
  })

  test("executes read tool and stores tool part", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        // First add a user message so the tool call has a parent
        await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            text: "Read a file",
          }),
        })

        // Execute a real tool (read tool should be available)
        const response = await app.request(`/session/${session.id}/tool/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolName: "read",
            callId: "call_456",
            arguments: { filePath: path.join(projectRoot, "package.json") },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { callId: string; result: unknown; error?: string }
        expect(body.callId).toBe("call_456")
        expect(body.error).toBeUndefined()
        expect(body.result).toBeDefined()

        // Verify the tool part was stored
        const messages = await Session.messages({ sessionID: session.id })
        const assistantMessage = messages.find((m) => m.info.role === "assistant")

        expect(assistantMessage).toBeDefined()

        const toolPart = assistantMessage!.parts.find((p) => p.type === "tool")
        expect(toolPart).toBeDefined()
        expect((toolPart as { tool: string }).tool).toBe("read")
        expect((toolPart as { callID: string }).callID).toBe("call_456")
        expect((toolPart as { state: { status: string } }).state.status).toBe("completed")

        await Session.remove(session.id)
      },
    })
  })

  test("supports complete client-side inference workflow", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        // 1. Create session
        const session = await Session.create({})
        expect(session.id).toBeDefined()

        // 2. Add user transcript
        const userResponse = await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            text: "Please read the package.json file",
            metadata: { source: "voice", itemId: "item_001" },
          }),
        })
        expect(userResponse.status).toBe(200)

        // 3. Add assistant transcript (before tool call)
        const assistantResponse1 = await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "assistant",
            text: "I'll read that file for you.",
            metadata: { source: "voice", itemId: "item_002" },
          }),
        })
        expect(assistantResponse1.status).toBe(200)

        // 4. Execute tool call
        const toolResponse = await app.request(`/session/${session.id}/tool/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolName: "read",
            callId: "call_789",
            arguments: { filePath: path.join(projectRoot, "package.json") },
          }),
        })
        expect(toolResponse.status).toBe(200)
        const toolBody = (await toolResponse.json()) as { callId: string; result: unknown }
        expect(toolBody.result).toBeDefined()

        // 5. Add final assistant transcript
        const assistantResponse2 = await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "assistant",
            text: "The package.json file contains the project configuration.",
            metadata: { source: "voice", itemId: "item_003" },
          }),
        })
        expect(assistantResponse2.status).toBe(200)

        // 6. Retrieve all messages and verify
        const messagesResponse = await app.request(`/session/${session.id}/message`)
        expect(messagesResponse.status).toBe(200)
        const messages = (await messagesResponse.json()) as Array<{
          info: { role: string }
          parts: Array<{ type: string }>
        }>

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
