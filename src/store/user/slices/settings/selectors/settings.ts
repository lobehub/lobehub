import {
  DEFAULT_AGENT,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_AGENT_META,
  DEFAULT_HOTKEY_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_SYSTEM_AGENT_CONFIG,
  DEFAULT_TTS_CONFIG,
} from '@lobechat/const';
import {
  type GlobalLLMProviderKey,
  type HotkeyId,
  type ProviderConfig,
  type UserModelProviderConfig,
  type UserSettings,
} from '@lobechat/types';

import { type UserStore } from '@/store/user';
import { merge } from '@/utils/merge';

export const currentSettings = (s: UserStore): UserSettings => merge(s.defaultSettings, s.settings);

export const currentLLMSettings = (s: UserStore): UserModelProviderConfig =>
  currentSettings(s).languageModel || {};

export const getProviderConfigById = (provider: string) => (s: UserStore) =>
  currentLLMSettings(s)[provider as GlobalLLMProviderKey] as ProviderConfig | undefined;

const currentImageSettings = (s: UserStore) => currentSettings(s).image;

const currentMemorySettings = (s: UserStore) =>
  merge(DEFAULT_MEMORY_SETTINGS, currentSettings(s).memory);

const memoryEnabled = (s: UserStore) => currentMemorySettings(s).enabled !== false;

const currentTTS = (s: UserStore) => merge(DEFAULT_TTS_CONFIG, currentSettings(s).tts);

const defaultAgent = (s: UserStore) => merge(DEFAULT_AGENT, currentSettings(s).defaultAgent);
const defaultAgentConfig = (s: UserStore) => merge(DEFAULT_AGENT_CONFIG, defaultAgent(s).config);

const defaultAgentMeta = (s: UserStore) => merge(DEFAULT_AGENT_META, defaultAgent(s).meta);

const exportSettings = currentSettings;

const currentSystemAgent = (s: UserStore) =>
  merge(DEFAULT_SYSTEM_AGENT_CONFIG, currentSettings(s).systemAgent);

const getHotkeyById = (id: HotkeyId) => (s: UserStore) =>
  merge(DEFAULT_HOTKEY_CONFIG, currentSettings(s).hotkey)[id];

export const settingsSelectors = {
  currentImageSettings,
  currentMemorySettings,
  currentSettings,
  currentSystemAgent,
  currentTTS,
  defaultAgent,
  defaultAgentConfig,
  defaultAgentMeta,
  exportSettings,
  getHotkeyById,
  memoryEnabled,
  providerConfig: getProviderConfigById,
};
