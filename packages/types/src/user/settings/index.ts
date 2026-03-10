import { z } from 'zod';

import type { LobeAgentSettings } from '../../session';
import type { UserGeneralConfig } from './general';
import type { UserHotkeyConfig } from './hotkey';
import type { UserImageConfig } from './image';
import type { UserKeyVaults } from './keyVaults';
import type { MarketAuthTokens } from './market';
import type { UserMemorySettings } from './memory';
import type { UserModelProviderConfig } from './modelProvider';
import type { UserSystemAgentConfig } from './systemAgent';
import type { UserToolConfig } from './tool';
import type { UserTTSConfig } from './tts';

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
 * User configuration settings
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
