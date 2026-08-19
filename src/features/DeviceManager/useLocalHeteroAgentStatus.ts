'use client';

import { isDesktop } from '@lobechat/const';
import type { BinaryStatus, ClaudeAuthStatus } from '@lobechat/electron-client-ipc';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { useCallback } from 'react';
import type { KeyedMutator, SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { binaryService } from '@/services/electron/binary';

export const LOCAL_HETERO_STATUS_SWR_KEY = 'device/localHeteroStatus';

/** SWR cache key for one agent type's local (Electron IPC) CLI detection. */
export const localHeteroStatusKey = (agentType: string, command: string) =>
  [LOCAL_HETERO_STATUS_SWR_KEY, agentType, command] as const;

export interface LocalHeteroAgentStatus {
  /** Claude Code auth state (null for other agent types / when not signed in). */
  auth: ClaudeAuthStatus | null;
  /** CLI detection result; `undefined` while the probe is in flight. */
  status: BinaryStatus | undefined;
}

export interface LocalHeteroAgentStatusResult extends SWRResponse<LocalHeteroAgentStatus> {
  auth: ClaudeAuthStatus | null;
  /** Whether the local detection is still in flight. */
  detecting: boolean;
  redetect: () => void;
  status: BinaryStatus | undefined;
}

/**
 * Detect a heterogeneous CLI on THIS machine through the Electron IPC binary
 * detector — the fast, gateway-independent probe (the gateway round-trip can
 * take seconds and requires the device connection to be up).
 *
 * The result is cached per (agentType, command), so every surface that inspects
 * the local CLI — the agent profile's status card, its device tab dots, the
 * conversation execution-target picker's current-device row — shares one
 * probe. `auth` is only fetched for Claude Code, and only when the CLI itself
 * was detected (mirrors the previous card-internal behaviour). On web there is
 * no local binary detector, so the hook stays inert (`detecting: false`).
 */
export const useLocalHeteroAgentStatus = (
  agentType: string | undefined,
  command: string | undefined,
): LocalHeteroAgentStatusResult => {
  const enabled = isDesktop && !!agentType && !!command;

  const { data, mutate, ...rest } = useClientDataSWR<LocalHeteroAgentStatus>(
    enabled ? localHeteroStatusKey(agentType as string, command as string) : null,
    async () => {
      const status = await binaryService.detectHeterogeneousAgentCommand({
        agentType: agentType as HeterogeneousAgentType,
        command: command as string,
      });

      let auth: ClaudeAuthStatus | null = null;
      if (status.available && agentType === 'claude-code') {
        try {
          auth = await binaryService.getClaudeAuthStatus(command as string);
        } catch (error) {
          console.warn('[useLocalHeteroAgentStatus] Failed to get Claude auth status:', error);
        }
      }
      return { auth, status };
    },
  );

  const { auth = null, status } = data ?? {};
  // `mutate` keeps a stable reference across renders (SWR), so the memoized
  // redetect stays stable for `useCallback` consumers.
  const redetect = useCallback(() => void mutate(), [mutate]);

  return {
    ...rest,
    auth,
    data,
    detecting: rest.isLoading,
    mutate: mutate as unknown as KeyedMutator<LocalHeteroAgentStatus>,
    redetect,
    status,
  };
};
