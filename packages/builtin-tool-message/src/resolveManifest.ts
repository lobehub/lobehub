import type { BuiltinManifestResolver } from '@lobechat/types';

import { MessageManifest } from './manifest';

/**
 * Context-aware manifest for the `lobe-message` tool.
 *
 * Some IM platforms only implement a subset of the message API surface — WeChat,
 * for instance, supports `sendMessage` but throws `PlatformUnsupportedError` for
 * `readMessages`, `searchMessages`, reactions, threads, etc. The static manifest
 * lists every API, so on those platforms the model dutifully calls an operation
 * that can only fail at runtime (the WeChat "我们刚刚聊了啥" case: the model calls
 * `readMessages`, gets an unsupported error, and apologizes).
 *
 * When the resolve context carries `botPlatform.unsupportedMessageApis`, this
 * trims those APIs from the tool list AND appends a capability note to the
 * systemRole — mirroring `resolveLobeAgentManifest`, which rewrites both halves
 * so the prompt never instructs the model to call a tool it no longer has.
 */
export const resolveMessageManifest: BuiltinManifestResolver = (context) => {
  const unsupported = context.botPlatform?.unsupportedMessageApis;
  if (!unsupported || unsupported.length === 0) return MessageManifest;

  const unsupportedSet = new Set(unsupported);
  const trimmedApi = MessageManifest.api.filter((api) => !unsupportedSet.has(api.name));

  // Nothing actually matched (e.g. the platform only lists bot-management APIs
  // that aren't in this manifest) — keep the static manifest to avoid churn.
  if (trimmedApi.length === MessageManifest.api.length) return MessageManifest;

  const platformLabel = context.botPlatform?.id ?? 'this platform';

  return {
    ...MessageManifest,
    api: trimmedApi,
    systemRole: [
      MessageManifest.systemRole,
      '',
      `<platform_unavailable_apis platform="${platformLabel}">`,
      `On ${platformLabel} the following message operations are NOT available and have been removed from your tools: ${unsupported.join(', ')}.`,
      'Do NOT ask the user to enable them or claim a configuration issue — they are platform limitations.',
      'If you need earlier conversation context, rely on any pre-injected recent history in the system prompt instead of trying to read messages.',
      '</platform_unavailable_apis>',
    ].join('\n'),
  };
};
