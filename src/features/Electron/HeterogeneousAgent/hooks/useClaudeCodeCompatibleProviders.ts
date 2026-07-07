import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useAiInfraStore } from '@/store/aiInfra';

/** Provider sdkTypes whose API can be driven by Claude Code's env-var knobs. */
const CC_COMPATIBLE_SDK_TYPES = new Set(['anthropic']);

export interface CCCompatibleProvider {
  id: string;
  logo?: string;
  name?: string;
}

export interface CCCompatibleModel {
  abilities?: Record<string, unknown>;
  displayName?: string;
  id: string;
  providerId: string;
}

export interface CCCompatibleProvidersResult {
  modelsByProvider: Record<string, CCCompatibleModel[]>;
  providers: CCCompatibleProvider[];
}

/**
 * Enumerate LobeHub providers whose `sdkType` can be wired into Claude Code
 * via `ANTHROPIC_*` env vars, plus the chat models each exposes. Used by the
 * API-mode picker on the agent profile and the inline model toggle in chat.
 */
export const useClaudeCodeCompatibleProviders = (): CCCompatibleProvidersResult => {
  // `enabledAiProviders` is hydrated by `initAiProviderRuntimeState` (runs on app
  // boot / chat layer), unlike `aiProviderList` which is only fetched lazily on the
  // provider-settings page. The agent profile must work without that heavier fetch,
  // so read the always-available list here.
  const providerList = useAiInfraStore((s) => s.enabledAiProviders ?? [], isEqual);
  const runtimeConfig = useAiInfraStore((s) => s.aiProviderRuntimeConfig, isEqual);
  const enabledModels = useAiInfraStore((s) => s.enabledAiModels, isEqual);

  return useMemo(() => {
    const providers: CCCompatibleProvider[] = providerList
      .filter((p) => {
        const sdkType = runtimeConfig[p.id]?.settings?.sdkType;
        return sdkType ? CC_COMPATIBLE_SDK_TYPES.has(sdkType) : false;
      })
      .map((p) => ({ id: p.id, name: p.name }));

    const compatibleIds = new Set(providers.map((p) => p.id));
    const modelsByProvider: Record<string, CCCompatibleModel[]> = {};

    for (const model of enabledModels ?? []) {
      if (model.type !== 'chat') continue;
      if (!compatibleIds.has(model.providerId)) continue;

      if (!modelsByProvider[model.providerId]) modelsByProvider[model.providerId] = [];
      modelsByProvider[model.providerId].push({
        abilities: model.abilities as Record<string, unknown> | undefined,
        displayName: model.displayName,
        id: model.id,
        providerId: model.providerId,
      });
    }

    return { modelsByProvider, providers };
  }, [providerList, runtimeConfig, enabledModels]);
};
