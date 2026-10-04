import useSWR from 'swr';

import { gatewayKeys } from '@/libs/swr/keys';
import { aiAgentService } from '@/services/aiAgent';
import { getLlmExecutorDeclarationFor } from '@/services/llmRelay';
import { useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';

/**
 * Pick up runs parked in `waiting_for_client` when this client comes online
 * (U4c): a schedule, a bot or a CLI run whose next LLM call needs a provider
 * only the user's device can reach, started while no LobeHub client was open.
 * Once on entry, after the provider list this client can run is known; runs
 * for providers it cannot reach are left for another device.
 *
 * The conversation's own waiting card covers a run that parks while the app is
 * already open.
 */
export const useClientLlmWaitResume = (): void => {
  const isReady = useUserStore((s) => s.isUserStateInit && !!s.isSignedIn);
  const relayEnabled = useServerConfigStore((s) => !!s.featureFlags.enableLlmRelay);
  const agentGatewayUrl = useServerConfigStore((s) => s.serverConfig.agentGatewayUrl);
  const providersReady = useAiInfraStore((s) => (s.enabledAiProviders?.length ?? 0) > 0);

  useSWR(
    isReady && relayEnabled && agentGatewayUrl && providersReady
      ? gatewayKeys.clientLlmWaits()
      : null,
    async () => {
      const waits = await aiAgentService.listClientLlmWaits();

      // One at a time: each pick-up subscribes to its run's stream first.
      for (const wait of waits) {
        if (!getLlmExecutorDeclarationFor(wait.provider)) continue;
        try {
          await useChatStore.getState().continueClientLlmWait(wait);
        } catch (error) {
          console.error('[useClientLlmWaitResume] Failed to continue %s:', wait.operationId, error);
        }
      }
      return waits.length;
    },
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
};
