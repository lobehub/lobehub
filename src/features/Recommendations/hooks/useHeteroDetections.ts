import { isDesktop } from '@lobechat/const';
import type { BinaryStatus } from '@lobechat/electron-client-ipc';
import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';
import useSWR from 'swr';

import { recommendationsKeys } from '@/libs/swr/keys';
import { binaryService } from '@/services/electron/binary';

import type { HeteroDetectionMap } from '../actions/types';

/**
 * Probe local heterogeneous agent CLIs in parallel and cache the result.
 *
 * Returns an empty map on non-desktop runtimes so callers can skip without a
 * branch on every read. The probes run as one passive scan: the desktop
 * refreshes PATH once for all of them, and never boots a stopped WSL distro to
 * fill in a suggestion. SWR dedupes the scan across components.
 */
export const useHeteroDetections = (): HeteroDetectionMap => {
  const { data } = useSWR(
    isDesktop ? recommendationsKeys.heteroDetections() : null,
    async () => {
      const scan = { id: crypto.randomUUID() };
      const entries = await Promise.all(
        HETEROGENEOUS_AGENT_CLIENT_CONFIGS.map(async (config) => {
          try {
            const status = await binaryService.detectHeterogeneousAgentCommand({
              agentType: config.type,
              command: config.defaultCommand,
              scan,
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
