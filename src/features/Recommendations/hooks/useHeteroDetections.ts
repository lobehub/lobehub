import { isDesktop } from '@lobechat/const';
import type { BinaryStatus } from '@lobechat/electron-client-ipc';
import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';
import useSWR from 'swr';

import { isHeterogeneousAgentTypeEnabled } from '@/helpers/experimentalHeterogeneousAgents';
import { recommendationsKeys } from '@/libs/swr/keys';
import { binaryService } from '@/services/electron/binary';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import type { HeteroDetectionMap } from '../actions/types';

/**
 * Probe local heterogeneous agent CLIs in parallel and cache the result.
 *
 * Returns an empty map on non-desktop runtimes so callers can skip without a
 * branch on every read. The Electron tool detector caches its own results, so
 * subsequent calls are cheap; we still wrap in SWR to dedupe across components.
 */
export const useHeteroDetections = (): HeteroDetectionMap => {
  const enableMinimaxCode = useUserStore(labPreferSelectors.enableMinimaxCode);
  const { data } = useSWR(
    isDesktop ? recommendationsKeys.heteroDetections(enableMinimaxCode) : null,
    async () => {
      const enabled = labPreferSelectors.enableMinimaxCode(useUserStore.getState());
      const entries = await Promise.all(
        HETEROGENEOUS_AGENT_CLIENT_CONFIGS.filter((config) =>
          isHeterogeneousAgentTypeEnabled(config.type, { enableMinimaxCode: enabled }),
        ).map(async (config) => {
          try {
            const status = await binaryService.detectHeterogeneousAgentCommand({
              agentType: config.type,
              command: config.defaultCommand,
            });
            return [config.type, status] as const;
          } catch (error) {
            console.error(`[recommendations] hetero detection failed for ${config.type}:`, error);
            const fallback: BinaryStatus = { available: false, error: String(error) };
            return [config.type, fallback] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as HeteroDetectionMap;
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  return data ?? {};
};
