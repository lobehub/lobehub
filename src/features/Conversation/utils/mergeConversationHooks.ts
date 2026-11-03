import { type ConversationHooks } from '../types';

const BLOCKING_HOOK_KEYS = new Set([
  'onBeforeContinue',
  'onBeforeRegenerate',
  'onBeforeSendMessage',
]);

const collectHookNames = (hooks: ConversationHooks[]): Set<string> => {
  const names = new Set<string>();
  for (const h of hooks) {
    for (const key of Object.keys(h)) {
      if (typeof h[key] === 'function') names.add(key);
    }
  }
  return names;
};

export const mergeConversationHooks = (
  ...hooks: (ConversationHooks | undefined)[]
): ConversationHooks => {
  const defined = hooks.filter((h): h is ConversationHooks => !!h);
  if (defined.length === 0) return {};
  if (defined.length === 1) return defined[0];

  const merged: ConversationHooks = {};
  const names = collectHookNames(defined);

  for (const name of names) {
    if (BLOCKING_HOOK_KEYS.has(name)) {
      merged[name] = async (...args: unknown[]) => {
        for (const h of defined) {
          const fn = h[name];
          if (typeof fn !== 'function') continue;
          const result = await fn(...args);
          if (result === false) return false;
        }
        return undefined;
      };
    } else {
      merged[name] = async (...args: unknown[]) => {
        for (const h of defined) {
          const fn = h[name];
          if (typeof fn !== 'function') continue;
          await fn(...args);
        }
      };
    }
  }

  return merged;
};
