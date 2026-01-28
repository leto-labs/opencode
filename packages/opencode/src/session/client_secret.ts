import z from "zod"
import { Identifier } from "../id/id"
import { Session } from "."
import { Log } from "../util/log"
import { fn } from "@/util/fn"
import { Storage } from "../storage/storage"
import { Provider } from "../provider/provider"
import type { RealtimeSessionConfig } from "@openai/agents/realtime"

/**
 * SessionClientSecret handles OpenAI Realtime API ephemeral tokens.
 *
 * This module manages client secrets (ephemeral tokens) for WebRTC-based
 * realtime sessions. Tokens are scoped to a session and can be cached
 * to reduce connection latency.
 */
export namespace SessionClientSecret {
  const log = Log.create({ service: "session.client_secret" })

  /**
   * Client secret info stored per session.
   */
  export const Info = z
    .object({
      value: z.string(),
      expiresAt: z.number(),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({
      ref: "SessionClientSecret",
    })
  export type Info = z.infer<typeof Info>

  /**
   * Input schema for creating a client secret.
   */
  export const CreateInput = z.object({
    sessionID: Identifier.schema("session"),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  /**
   * Output schema for create/get operations.
   */
  export const Output = z.object({
    value: z.string(),
    expiresAt: z.number(),
  })
  export type Output = z.infer<typeof Output>

  /**
   * Create a new client secret (ephemeral token) for a session.
   *
   * Fetches a new ephemeral token from OpenAI and saves it to the session.
   * Requires the session to exist and OpenAI provider to be configured.
   */
  export const create = fn(CreateInput, async (input): Promise<Output> => {
    const { sessionID } = input

    // Verify session exists
    const session = await Session.get(sessionID)
    if (!session) {
      throw new Error(`Session not found: ${sessionID}`)
    }

    // Get OpenAI provider config
    const provider = await Provider.getProvider("openai")
    if (!provider?.key) {
      throw new Error("OpenAI provider not configured")
    }

    // Fetch ephemeral token from OpenAI
    /*
    //TODO: Explore later. Can we pass config at token creation
    const config: RealtimeSessionConfig = {
      type: "realtime",
      model: "gpt-realtime",
      instructions: "You are a helpful assistant.",
      toolChoice: "auto",
      tools: [],
      outputModalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turnDetection: { type: 'semantic_vad' },
          noiseReduction: null,
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          speed: 1,
        },
      },
    }
    */

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      log.error("OpenAI realtime client_secret error", { status: response.status, error })
      throw new Error("Failed to create realtime client secret")
    }

    const data = await response.json()
    const now = Date.now()

    // TODO: Decode JWT to get actual expiry instead of hardcoding
    // OpenAI ephemeral tokens expire in 1 hour
    // We store with 55 minute TTL to be safe
    const info: Info = {
      value: data.value,
      expiresAt: now + 55 * 60 * 1000, // 55 minutes
      time: {
        created: now,
      },
    }

    // Save to storage (separate key rather than session metadata to avoid
    // polluting Session.Info schema with ephemeral data)
    await Storage.write(["client_secret", sessionID], info)

    log.info("created client_secret", { sessionID })

    return {
      value: info.value,
      expiresAt: info.expiresAt,
    }
  })

  /**
   * Get the client secret for a session.
   *
   * Returns the saved client secret if it exists and is not expired.
   * Returns null if no secret exists or it has expired.
   */
  export const get = fn(Identifier.schema("session"), async (sessionID): Promise<Output | null> => {
    // Verify session exists
    const session = await Session.get(sessionID)
    if (!session) {
      throw new Error(`Session not found: ${sessionID}`)
    }

    try {
      const info = await Storage.read<Info>(["client_secret", sessionID])
      if (!info) {
        return null
      }

      // Check if expired (with 30 second buffer)
      if (info.expiresAt <= Date.now() + 30_000) {
        log.info("client_secret expired", { sessionID })
        return null
      }

      return {
        value: info.value,
        expiresAt: info.expiresAt,
      }
    } catch (err) {
      // Storage.read throws NotFoundError when file doesn't exist
      if (err instanceof Storage.NotFoundError) {
        return null
      }
      throw err
    }
  })
}
