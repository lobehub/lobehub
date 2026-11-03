/**
 * Re-export MessageRuntimeService as the contract for platform-specific message services.
 * Each platform service (Discord, Telegram, Slack, etc.) implements this interface.
 * Unsupported operations should throw PlatformUnsupportedError.
 */
export type { MessageRuntimeService } from '@lobechat/builtin-tool-message/executionRuntime';
