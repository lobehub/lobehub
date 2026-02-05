import { DEFAULT_LLM_CONFIG } from '@lobechat/business-config';
import {
  DEFAULT_AGENT,
  DEFAULT_COMMON_SETTINGS,
  DEFAULT_HOTKEY_CONFIG,
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_SYSTEM_AGENT_CONFIG,
  DEFAULT_TOOL_CONFIG,
  DEFAULT_TTS_CONFIG,
} from '@lobechat/const';
import type { UserSettings } from '@lobechat/types';

export const DEFAULT_SETTINGS: UserSettings = {
  defaultAgent: DEFAULT_AGENT,
  general: DEFAULT_COMMON_SETTINGS,
  hotkey: DEFAULT_HOTKEY_CONFIG,
  image: DEFAULT_IMAGE_CONFIG,
  keyVaults: {},
  languageModel: DEFAULT_LLM_CONFIG,
  memory: DEFAULT_MEMORY_SETTINGS,
  systemAgent: DEFAULT_SYSTEM_AGENT_CONFIG,
  tool: DEFAULT_TOOL_CONFIG,
  tts: DEFAULT_TTS_CONFIG,
};
