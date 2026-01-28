import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { SessionTranscript } from "../../src/session/transcript"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("SessionTranscript", () => {
  describe("add", () => {
    test("should add user transcript", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          const result = await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [
              {
                type: "text",
                text: "Hello, this is a test transcript",
                metadata: { source: "test" },
              },
            ],
          })

          expect(result.info.id).toBeDefined()
          expect(result.info.id.startsWith("msg_")).toBe(true)
          expect(result.parts.length).toBe(1)
          expect(result.parts[0].id.startsWith("prt_")).toBe(true)

          // Verify the message was stored
          const messages = await Session.messages({ sessionID: session.id })
          const userMessage = messages.find((m) => m.info.id === result.info.id)

          expect(userMessage).toBeDefined()
          expect(userMessage!.info.role).toBe("user")

          // Verify the text part
          const textPart = userMessage!.parts.find((p) => p.type === "text")
          expect(textPart).toBeDefined()
          expect((textPart as MessageV2.TextPart).text).toBe("Hello, this is a test transcript")
          expect((textPart as MessageV2.TextPart).metadata?.source).toBe("test")

          await Session.remove(session.id)
        },
      })
    })

    test("should add assistant transcript with parentID", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          // First add a user message
          const userResult = await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [{ type: "text", text: "User prompt" }],
          })

          // Then add assistant response
          const assistantResult = await SessionTranscript.add({
            sessionID: session.id,
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "Assistant response",
                metadata: { source: "realtime" },
              },
            ],
          })

          expect(assistantResult.info.id).toBeDefined()

          // Verify the message was stored
          const messages = await Session.messages({ sessionID: session.id })
          const assistantMessage = messages.find((m) => m.info.id === assistantResult.info.id)

          expect(assistantMessage).toBeDefined()
          expect(assistantMessage!.info.role).toBe("assistant")

          // Verify parentID points to the user message
          const assistantInfo = assistantMessage!.info as MessageV2.Assistant
          expect(assistantInfo.parentID).toBe(userResult.info.id)

          // Verify the text part
          const textPart = assistantMessage!.parts.find((p) => p.type === "text")
          expect(textPart).toBeDefined()
          expect((textPart as MessageV2.TextPart).text).toBe("Assistant response")

          await Session.remove(session.id)
        },
      })
    })

    test("should use client-provided messageID for optimistic updates", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})
          const clientMessageID = Identifier.ascending("message")
          const clientPartID = Identifier.ascending("part")

          const result = await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            messageID: clientMessageID,
            parts: [
              {
                id: clientPartID,
                type: "text",
                text: "Test with client IDs",
              },
            ],
          })

          // Should use the client-provided IDs
          expect(result.info.id).toBe(clientMessageID)
          expect(result.parts[0].id).toBe(clientPartID)

          // Verify the message was stored with the correct ID
          const messages = await Session.messages({ sessionID: session.id })
          const message = messages.find((m) => m.info.id === clientMessageID)
          expect(message).toBeDefined()

          await Session.remove(session.id)
        },
      })
    })

    test("should throw error for non-existent session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          await expect(
            SessionTranscript.add({
              sessionID: "ses_nonexistent123",
              role: "user",
              parts: [{ type: "text", text: "Test" }],
            }),
          ).rejects.toThrow()
        },
      })
    })

    test("should emit message events", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})
          let messageUpdatedEvent: MessageV2.Info | undefined
          let partUpdatedEvent: MessageV2.Part | undefined

          const unsubMessage = Bus.subscribe(MessageV2.Event.Updated, (event) => {
            messageUpdatedEvent = event.properties.info
          })

          const unsubPart = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
            partUpdatedEvent = event.properties.part
          })

          const result = await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [{ type: "text", text: "Test event emission" }],
          })

          // Wait for events to propagate
          await new Promise((resolve) => setTimeout(resolve, 100))

          unsubMessage()
          unsubPart()

          expect(messageUpdatedEvent).toBeDefined()
          expect(messageUpdatedEvent?.id).toBe(result.info.id)

          expect(partUpdatedEvent).toBeDefined()
          expect(partUpdatedEvent?.id).toBe(result.parts[0].id)

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

          await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [{ type: "text", text: "Test timestamp update" }],
          })

          const updatedSession = await Session.get(session.id)
          expect(updatedSession.time.updated).toBeGreaterThan(initialUpdated)

          await Session.remove(session.id)
        },
      })
    })

    test("should support multiple parts", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          const result = await SessionTranscript.add({
            sessionID: session.id,
            role: "user",
            parts: [
              { type: "text", text: "First part" },
              { type: "text", text: "Second part" },
            ],
          })

          expect(result.parts.length).toBe(2)

          // Verify both parts were stored
          const messages = await Session.messages({ sessionID: session.id })
          const message = messages.find((m) => m.info.id === result.info.id)
          expect(message!.parts.length).toBe(2)

          await Session.remove(session.id)
        },
      })
    })
  })
})
