import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.transcript", () => {
  test("adds user transcript", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        const response = await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            text: "Hello, this is a test transcript",
            metadata: { source: "test" },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { messageID: string; partID: string }
        expect(body.messageID).toBeDefined()
        expect(body.partID).toBeDefined()
        expect(body.messageID.startsWith("msg_")).toBe(true)
        expect(body.partID.startsWith("prt_")).toBe(true)

        // Verify the message was stored
        const messages = await Session.messages({ sessionID: session.id })
        expect(messages.length).toBeGreaterThan(0)

        const lastMessage = messages[messages.length - 1]
        expect(lastMessage.info.role).toBe("user")
        expect(lastMessage.info.id).toBe(body.messageID)

        // Verify the text part
        const textPart = lastMessage.parts.find((p) => p.type === "text")
        expect(textPart).toBeDefined()
        expect((textPart as { text: string }).text).toBe("Hello, this is a test transcript")
        expect((textPart as { metadata?: Record<string, unknown> }).metadata?.source).toBe("test")

        await Session.remove(session.id)
      },
    })
  })

  test("adds assistant transcript", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        // First add a user message
        await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            text: "User prompt",
          }),
        })

        // Then add assistant response
        const response = await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "assistant",
            text: "Assistant response",
            metadata: { source: "realtime" },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { messageID: string; partID: string }
        expect(body.messageID).toBeDefined()

        // Verify the message was stored
        const messages = await Session.messages({ sessionID: session.id })
        const assistantMessage = messages.find((m) => m.info.role === "assistant")

        expect(assistantMessage).toBeDefined()
        expect(assistantMessage!.info.id).toBe(body.messageID)

        // Verify the text part
        const textPart = assistantMessage!.parts.find((p) => p.type === "text")
        expect(textPart).toBeDefined()
        expect((textPart as { text: string }).text).toBe("Assistant response")

        await Session.remove(session.id)
      },
    })
  })

  test("returns 404 for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        const response = await app.request("/session/ses_nonexistent123/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            text: "Test",
          }),
        })

        expect(response.status).toBe(404)
      },
    })
  })

  test("returns 400 for invalid role", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        const response = await app.request(`/session/${session.id}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "invalid",
            text: "Test",
          }),
        })

        expect(response.status).toBe(400)

        await Session.remove(session.id)
      },
    })
  })
})
