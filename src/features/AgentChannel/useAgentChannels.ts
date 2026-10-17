import { useEffect, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { type ChannelPlatformDefinition, COMING_SOON_PLATFORMS } from './const';

/**
 * Channel platforms and an agent's bot providers, shared by every surface that
 * lists an agent's channels: the platform catalog (server platforms merged with
 * the frontend-only coming-soon entries), the agent's providers and their live
 * runtime statuses, plus the loading / error state of both fetches.
 */
export const useAgentChannels = (agentId: string | undefined, canEdit: boolean) => {
  const {
    isLoading: platformsLoading,
    error: platformsError,
    mutate: mutatePlatforms,
  } = useAgentStore((s) => s.useFetchPlatformDefinitions());
  const {
    isLoading: providersLoading,
    error: providersError,
    mutate: mutateProviders,
  } = useAgentStore((s) => s.useFetchBotProviders(agentId));
  // The data lives in the replica views; the hooks above only orchestrate the
  // fetch (hydrate the persisted copy, then revalidate in the background).
  const platforms = useAgentStore((s) => s.botPlatformDefinitions);
  const providers = useAgentStore((s) => (agentId ? s.botProvidersMap[agentId] : undefined));
  const triggerRefreshAllBotStatuses = useAgentStore((s) => s.triggerRefreshAllBotStatuses);
  const enableImessage = useUserStore(labPreferSelectors.enableImessage);

  // Fire-and-forget a live gateway status refresh on entry. The list renders
  // from cached statuses immediately; SWR revalidates once Redis is updated.
  useEffect(() => {
    if (!agentId) return;
    if (!canEdit) return;
    triggerRefreshAllBotStatuses(agentId);
  }, [agentId, canEdit, triggerRefreshAllBotStatuses]);

  const isLoading = platformsLoading || providersLoading;
  const error = platformsError ?? providersError;

  // A *failed* or still-empty platform fetch leaves `platforms` undefined, so
  // `allPlatforms` collapses to just the frontend-only `COMING_SOON_PLATFORMS`
  // — and the surface would render a plausible coming-soon-only catalog (every
  // real / connected channel silently dropped). So "has data" is *not* the merged
  // length: it's whether the real fetch actually yielded platforms. Gate on the
  // raw synced `platforms` (never the static merge).
  //
  // The providers fetch, though, is a replica: a *background* revalidate that
  // fails must not blank a hydrated first frame. Once the providers have a
  // settled value (local copy or network), a providers error is not fatal — the
  // grid renders from that value and reconciles behind it. It only falls through
  // to the error state when there is nothing settled for this agent either.
  const providersSettled = providers !== undefined;
  const hasData = (platforms?.length ?? 0) > 0 && (!providersError || providersSettled);

  // Merge server-side platforms with frontend-only coming-soon entries.
  // Coming-soon entries shadow a server-registered platform of the same id, so a
  // platform can be registered server-side first and stay a placeholder until
  // the frontend reveals it. iMessage additionally honors the Labs
  // `enableImessage` preference: off keeps the placeholder, on drops it so the
  // real platform shows.
  const allPlatforms = useMemo<ChannelPlatformDefinition[]>(() => {
    const comingSoon = enableImessage
      ? COMING_SOON_PLATFORMS.filter((p) => p.id !== 'imessage')
      : COMING_SOON_PLATFORMS;
    const comingSoonIds = new Set(comingSoon.map((p) => p.id));
    return [...(platforms ?? []).filter((p) => !comingSoonIds.has(p.id)), ...comingSoon];
  }, [platforms, enableImessage]);

  const platformRuntimeStatuses = useMemo(
    () =>
      new Map<string, BotRuntimeStatus>(
        (providers ?? [])
          .filter((provider) => provider.enabled)
          .map((provider) => [
            provider.platform,
            ((provider as any).runtimeStatus as BotRuntimeStatus) ??
              BOT_RUNTIME_STATUSES.disconnected,
          ]),
      ),
    [providers],
  );

  return {
    allPlatforms,
    error,
    hasData,
    isLoading,
    platformRuntimeStatuses,
    platforms,
    platformsLoading,
    providers,
    retry: () => {
      mutatePlatforms();
      mutateProviders();
    },
  };
};
