import { createStore } from "solid-js/store"
import { batch, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { useModels } from "@/context/models"

export type ModelKey = { providerID: string; modelID: string }

const GPT_REALTIME_MODEL = {
  id: "gpt-realtime",
  providerID: "openai-realtime",
  name: "GPT Realtime",
  family: "gpt-realtime",
  api: {
    id: "openai-realtime",
    url: "https://api.openai.com/v1/realtime",
    npm: "@openai/agents",
  },
  capabilities: {
    temperature: false,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { audio: true, text: true, image: false, video: false, pdf: false },
    output: { audio: true, text: true, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: { context: 128000, output: 4096 },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  status: "beta" as const,
  options: {},
  headers: {},
  release_date: "2024-10-01",
  provider: {
    id: "openai",
    name: "OpenAI",
    source: "config" as const,
    env: [],
    options: {},
    models: {},
  },
  clientSide: true,
  latest: false,
  variants: undefined,
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()

    // Client-side model ID for GPT Realtime
    const CLIENT_SIDE_MODEL_ID = "gpt-realtime"
    const CLIENT_SIDE_PROVIDER_ID = "openai"

    function isModelValid(model: ModelKey) {
      // Client-side models are valid when OpenAI is connected (shares API key)
      if (model.providerID === CLIENT_SIDE_PROVIDER_ID && model.modelID === CLIENT_SIDE_MODEL_ID) {
        return providers.connected().some((p) => p.id === "openai")
      }

      const provider = providers.all().find((x) => x.id === model.providerID)
      return (
        !!provider?.models[model.modelID] &&
        providers
          .connected()
          .map((p) => p.id)
          .includes(model.providerID)
      )
    }

    function getFirstValidModel(...modelFns: (() => ModelKey | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    const agent = (() => {
      const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const [store, setStore] = createStore<{
        current?: string
      }>({
        current: list()[0]?.name,
      })
      return {
        list,
        current() {
          const available = list()
          if (available.length === 0) return undefined
          return available.find((x) => x.name === store.current) ?? available[0]
        },
        set(name: string | undefined) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          if (name && available.some((x) => x.name === name)) {
            setStore("current", name)
            return
          }
          setStore("current", available[0].name)
        },
        move(direction: 1 | -1) {
          const available = list()
          if (available.length === 0) {
            setStore("current", undefined)
            return
          }
          let next = available.findIndex((x) => x.name === store.current) + direction
          if (next < 0) next = available.length - 1
          if (next >= available.length) next = 0
          const value = available[next]
          if (!value) return
          setStore("current", value.name)
          if (value.model)
            model.set({
              providerID: value.model.providerID,
              modelID: value.model.modelID,
            })
        },
      }
    })()

    const model = (() => {
      const models = useModels()

      // Check if OpenAI is connected (needed for client-side realtime model)
      const isOpenAIConnected = createMemo(() => providers.connected().some((p) => p.id === "openai"))

      // Wrap models.list to include client-side models
      const listWithClientSide = createMemo(() => {
        const baseList = models.list()
        if (!isOpenAIConnected()) return baseList
        // Add GPT Realtime model when OpenAI is connected
        return [...baseList, GPT_REALTIME_MODEL]
      })

      // Wrap models.find to handle client-side models
      const findWithClientSide = (key: ModelKey) => {
        if (key.providerID === CLIENT_SIDE_PROVIDER_ID && key.modelID === CLIENT_SIDE_MODEL_ID) {
          return isOpenAIConnected() ? GPT_REALTIME_MODEL : undefined
        }
        return models.find(key)
      }

      const [ephemeral, setEphemeral] = createStore<{
        model: Record<string, ModelKey | undefined>
      }>({
        model: {},
      })

      const fallbackModel = createMemo<ModelKey | undefined>(() => {
        if (sync.data.config.model) {
          const [providerID, modelID] = sync.data.config.model.split("/")
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of models.recent.list()) {
          if (isModelValid(item)) {
            return item
          }
        }

        const defaults = providers.default()
        for (const p of providers.connected()) {
          const configured = defaults[p.id]
          if (configured) {
            const key = { providerID: p.id, modelID: configured }
            if (isModelValid(key)) return key
          }

          const first = Object.values(p.models)[0]
          if (!first) continue
          const key = { providerID: p.id, modelID: first.id }
          if (isModelValid(key)) return key
        }

        return undefined
      })

      const current = createMemo(() => {
        const a = agent.current()
        if (!a) return undefined
        const key = getFirstValidModel(
          () => ephemeral.model[a.name],
          () => a.model,
          fallbackModel,
        )
        if (!key) return undefined
        return findWithClientSide(key)
      })

      const recent = createMemo(() => models.recent.list().map(findWithClientSide).filter(Boolean))

      const cycle = (direction: 1 | -1) => {
        const recentList = recent()
        const currentModel = current()
        if (!currentModel) return

        const index = recentList.findIndex(
          (x) => x?.provider.id === currentModel.provider.id && x?.id === currentModel.id,
        )
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = recentList.length - 1
        if (next >= recentList.length) next = 0

        const val = recentList[next]
        if (!val) return

        model.set({
          providerID: val.provider.id,
          modelID: val.id,
        })
      }

      return {
        ready: models.ready,
        current,
        recent,
        list: listWithClientSide,
        cycle,
        set(model: ModelKey | undefined, options?: { recent?: boolean }) {
          batch(() => {
            const currentAgent = agent.current()
            const next = model ?? fallbackModel()
            if (currentAgent) setEphemeral("model", currentAgent.name, next)
            if (model) models.setVisibility(model, true)
            if (options?.recent && model) models.recent.push(model)
          })
        },
        visible(model: ModelKey) {
          return models.visible(model)
        },
        setVisibility(model: ModelKey, visible: boolean) {
          models.setVisibility(model, visible)
        },
        variant: {
          current() {
            const m = current()
            if (!m) return undefined
            return models.variant.get({ providerID: m.provider.id, modelID: m.id })
          },
          list() {
            const m = current()
            if (!m) return []
            if (!m.variants) return []
            return Object.keys(m.variants)
          },
          set(value: string | undefined) {
            const m = current()
            if (!m) return
            models.variant.set({ providerID: m.provider.id, modelID: m.id }, value)
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            const currentVariant = this.current()
            if (!currentVariant) {
              this.set(variants[0])
              return
            }
            const index = variants.indexOf(currentVariant)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return
            }
            this.set(variants[index + 1])
          },
        },
      }
    })()

    const result = {
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
    }
    return result
  },
})
