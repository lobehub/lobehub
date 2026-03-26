import type { MessageRuntimeService } from '@lobechat/builtin-tool-message/executionRuntime';

/**
 * Platform-specific adapter that implements all MessageRuntimeService operations.
 * Each adapter handles one platform (Discord, Telegram, Slack, etc.).
 * Unsupported operations should throw PlatformUnsupportedError.
 */
export type MessagePlatformAdapter = MessageRuntimeService;
