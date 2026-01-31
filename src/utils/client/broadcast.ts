export const AI_PROVIDER_RUNTIME_BROADCAST_CHANNEL = 'lobe:ai-provider-runtime';

const BROADCAST_SOURCE_ID_KEY = '__lobe_broadcast_source_id__';

export const getBroadcastSourceId = () => {
  if (typeof window === 'undefined') return undefined;

  const globalScope = globalThis as typeof globalThis & {
    [BROADCAST_SOURCE_ID_KEY]?: string;
  };

  if (!globalScope[BROADCAST_SOURCE_ID_KEY]) {
    globalScope[BROADCAST_SOURCE_ID_KEY] =
      globalScope.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  return globalScope[BROADCAST_SOURCE_ID_KEY];
};
