import { useRef } from 'react';
import useSWR from 'swr';

import { gatewayKeys } from '@/libs/swr/keys';
import { aiAgentService } from '@/services/aiAgent';
import { buildLlmExecutorDeclaration, getLlmExecutorDeclarationFor } from '@/services/llmRelay';
import { useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';

/**
 * Pick up runs parked in `waiting_for_client` when this client comes online
 * (U4c): a schedule, a bot or a CLI run whose next LLM call needs a provider
 * only the user's device can reach, started while no LobeHub client was open.
 * Checked on entry, after the provider list this client can run is known, then
 * polled while the app stays open — a run can park long after this client
 * started. The poll backs off while nothing is waiting (30 s up to 2 min, well
 * inside the 10 min wait window) and resets once a wait shows up. Runs for
 * providers this client cannot reach are left for another device.
 */
export const CLIENT_LLM_WAIT_POLL_MIN_MS = 30_000;
export const CLIENT_LLM_WAIT_POLL_MAX_MS = 120_000;

/** Next poll delay after `idlePolls` consecutive polls that found nothing. */
export const clientLlmWaitPollInterval = (idlePolls: number) =>
  Math.min(CLIENT_LLM_WAIT_POLL_MIN_MS * 2 ** Math.max(idlePolls, 0), CLIENT_LLM_WAIT_POLL_MAX_MS);

export const useClientLlmWaitResume = (): void => {
  const idlePollsRef = useRef(0);
  const isReady = useUserStore((s) => s.isUserStateInit && !!s.isSignedIn);
  const relayEnabled = useServerConfigStore((s) => !!s.featureFlags.enableLlmRelay);
  const agentGatewayUrl = useServerConfigStore((s) => s.serverConfig.agentGatewayUrl);
  const providersReady = useAiInfraStore((s) => (s.enabledAiProviders?.length ?? 0) > 0);

  useSWR(
    isReady && relayEnabled && agentGatewayUrl && providersReady
      ? gatewayKeys.clientLlmWaits()
      : null,
    async () => {
      const providers = buildLlmExecutorDeclaration()?.providers ?? [];
      let listed: Awaited<ReturnType<typeof aiAgentService.listClientLlmWaits>>;
      try {
        listed = await aiAgentService.listClientLlmWaits(providers);
      } catch (error) {
        // Never surface it to SWR: an errored key stops its interval, and with
        // retries off nothing would poll again. Count it as an idle poll.
        console.error('[useClientLlmWaitResume] Failed to list waiting runs:', error);
        idlePollsRef.current += 1;
        return 0;
      }
      const waits = listed.filter((wait) => !!getLlmExecutorDeclarationFor(wait.provider));

      // One at a time: each pick-up subscribes to its run's stream first.
      for (const wait of waits) {
        try {
          await useChatStore.getState().continueClientLlmWait(wait);
        } catch (error) {
          console.error('[useClientLlmWaitResume] Failed to continue %s:', wait.operationId, error);
        }
      }
      idlePollsRef.current = waits.length > 0 ? 0 : idlePollsRef.current + 1;
      return waits.length;
    },
    {
      refreshInterval: () => clientLlmWaitPollInterval(idlePollsRef.current - 1),
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    },
  );
};
