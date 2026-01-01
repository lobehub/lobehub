import { z } from 'zod';

import type { LobeAgentSettings } from '../../session';
import { UserGeneralConfig } from './general';
import { UserHotkeyConfig } from './hotkey';
import { UserImageConfig } from './image';
import { UserKeyVaults } from './keyVaults';
import { MarketAuthTokens } from './market';
import { UserMemorySettings } from './memory';
import { UserModelProviderConfig } from './modelProvider';
import { UserSystemAgentConfig } from './systemAgent';
import { UserToolConfig } from './tool';
import { UserTTSConfig } from './tts';

export type UserDefaultAgent = LobeAgentSettings;

export * from './filesConfig';
export * from './general';
export * from './hotkey';
export * from './image';
export * from './keyVaults';
export * from './market';
export * from './memory';
export * from './modelProvider';
export * from './sync';
export * from './systemAgent';
export * from './tool';
export * from './tts';

/**
 * 配置设置
 */
export interface UserSettings {
  defaultAgent: UserDefaultAgent;
  general: UserGeneralConfig;
  hotkey: UserHotkeyConfig;
  image: UserImageConfig;
  keyVaults: UserKeyVaults;
  languageModel: UserModelProviderConfig;
  market?: MarketAuthTokens;
  memory?: UserMemorySettings;
  systemAgent: UserSystemAgentConfig;
  tool: UserToolConfig;
  tts: UserTTSConfig;
}

/**
 * Zod schema for partial UserSettings updates
 * Uses passthrough to allow any nested settings fields
 */
export const UserSettingsSchema = z
  .object({
    defaultAgent: z.any().optional(),
    general: z.any().optional(),
    hotkey: z.any().optional(),
    image: z.any().optional(),
    keyVaults: z.any().optional(),
    languageModel: z.any().optional(),
    market: z.any().optional(),
    memory: z.any().optional(),
    systemAgent: z.any().optional(),
    tool: z.any().optional(),
    tts: z.any().optional(),
  })
  .passthrough()
  .partial();
