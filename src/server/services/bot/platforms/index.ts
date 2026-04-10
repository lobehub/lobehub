// --------------- Core types & utilities ---------------
// --------------- Registry singleton ---------------
import { discord } from './discord/definition';
import { feishu } from './feishu/definitions/feishu';
import { lark } from './feishu/definitions/lark';
import { qq } from './qq/definition';
import { PlatformRegistry } from './registry';
import { slack } from './slack/definition';
import { telegram } from './telegram/definition';
import { wechat } from './wechat/definition';

export { PlatformRegistry } from './registry';
export type {
  BotPlatformRedisClient,
  BotPlatformRuntimeContext,
  BotProviderConfig,
  ConnectionMode,
  FieldSchema,
  PlatformClient,
  PlatformDefinition,
  PlatformDocumentation,
  PlatformMessenger,
  SerializedPlatformDefinition,
  UsageStats,
  ValidationResult,
} from './types';
export { ClientFactory } from './types';
export {
  buildRuntimeKey,
  extractDefaults,
  formatDuration,
  formatTokens,
  formatUsageStats,
  getEffectiveConnectionMode,
  mergeWithDefaults,
  parseRuntimeKey,
} from './utils';

// --------------- Platform definitions ---------------
export { discord } from './discord/definition';
export { feishu } from './feishu/definitions/feishu';
export { lark } from './feishu/definitions/lark';
export { qq } from './qq/definition';
export { slack } from './slack/definition';
export { telegram } from './telegram/definition';
export { wechat } from './wechat/definition';

export const platformRegistry = new PlatformRegistry();

platformRegistry.register(discord);
platformRegistry.register(telegram);
platformRegistry.register(slack);
platformRegistry.register(feishu);
platformRegistry.register(lark);
platformRegistry.register(qq);
platformRegistry.register(wechat);
