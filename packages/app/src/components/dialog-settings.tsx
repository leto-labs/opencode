import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Dialog size="x-large" transition>
      <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog max-h-[90vh] sm:max-h-none">
        <Tabs.List class="settings-tabs-list">
          {/* Mobile: Simple flat list | Desktop: Grouped sections */}
          <div class="flex flex-col sm:flex-col justify-between h-full w-full">
            <div class="flex flex-row sm:flex-col gap-1.5 sm:gap-3 w-full pt-2 sm:pt-3 overflow-x-auto sm:overflow-x-visible">
              {/* Desktop only: Section titles and grouping */}
              <div class="hidden sm:flex sm:flex-col sm:gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      <span>{language.t("settings.tab.general")}</span>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      <span>{language.t("settings.tab.shortcuts")}</span>
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      <span>{language.t("settings.providers.title")}</span>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      <span>{language.t("settings.models.title")}</span>
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>

              {/* Mobile only: Full-width evenly distributed tabs */}
              <div class="flex sm:hidden flex-row gap-2 w-full px-3 py-2">
                <Tabs.Trigger value="general" class="flex-1">
                  <Icon name="sliders" />
                </Tabs.Trigger>
                <Tabs.Trigger value="shortcuts" class="flex-1">
                  <Icon name="keyboard" />
                </Tabs.Trigger>
                <Tabs.Trigger value="providers" class="flex-1">
                  <Icon name="providers" />
                </Tabs.Trigger>
                <Tabs.Trigger value="models" class="flex-1">
                  <Icon name="models" />
                </Tabs.Trigger>
              </div>
            </div>
            <div class="hidden sm:flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders />
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content>
        {/* <Tabs.Content value="agents" class="no-scrollbar"> */}
        {/*   <SettingsAgents /> */}
        {/* </Tabs.Content> */}
        {/* <Tabs.Content value="commands" class="no-scrollbar"> */}
        {/*   <SettingsCommands /> */}
        {/* </Tabs.Content> */}
        {/* <Tabs.Content value="mcp" class="no-scrollbar"> */}
        {/*   <SettingsMcp /> */}
        {/* </Tabs.Content> */}
      </Tabs>
    </Dialog>
  )
}
