import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import type { AgentShareConfigInput } from '@/server/routers/lambda/agentShare';
import { agentShareService } from '@/services/agentShare';

export type AgentShareVisibility = 'link' | 'private';
export type AgentShareConfigPatch =
  | Partial<AgentShareConfigInput>
  | ((current: AgentShareConfigInput) => Partial<AgentShareConfigInput>);

interface ConfigQueueState {
  config: AgentShareConfigInput;
  deferredConfig?: AgentShareConfigInput;
  pending: number;
  queue: Promise<unknown>;
  shareId: string;
}

/** One queue per share record, shared across popover/settings remounts. */
const configQueueByAgent = new Map<string, ConfigQueueState>();

/**
 * Creator-side share state for one agent. Mirrors the topic SharePopover data
 * flow: fetch the share row, and auto-create a `private` record the first time
 * the UI opens — a private row is inert (visitors are refused), so creation has
 * no exposure side effect and lets every control below assume the row exists.
 */
export const useAgentShare = (agentId: string | undefined, enabled: boolean) => {
  const [createError, setCreateError] = useState<unknown>();
  const [isCreating, setIsCreating] = useState(false);
  const activeAgentRef = useRef<string>();
  const creatingAgentRef = useRef<string>();
  activeAgentRef.current = enabled ? agentId : undefined;
  const {
    data: shareInfo,
    isLoading,
    mutate,
  } = useSWR(
    enabled && agentId ? shareKeys.agentShareStatus(agentId) : null,
    () => agentShareService.getShareStatus(agentId!),
    { revalidateOnFocus: false },
  );

  const createShare = useCallback(async () => {
    if (!enabled || !agentId || creatingAgentRef.current === agentId) return;

    creatingAgentRef.current = agentId;
    setIsCreating(true);
    setCreateError(undefined);
    try {
      const created = await agentShareService.enableShare(agentId);
      await mutate(created, { revalidate: false });
    } catch (error) {
      if (activeAgentRef.current === agentId) setCreateError(error);
    } finally {
      // A quick agent switch may already have started another creation. Do
      // not let the older request clear the newer request's loading guard.
      if (creatingAgentRef.current === agentId) {
        creatingAgentRef.current = undefined;
        setIsCreating(false);
      }
    }
  }, [agentId, enabled, mutate]);

  useEffect(() => {
    setCreateError(undefined);
  }, [agentId, enabled]);

  useEffect(() => {
    if (enabled && !isLoading && !shareInfo && !createError && agentId) {
      void createShare();
    }
  }, [agentId, createError, createShare, enabled, isLoading, shareInfo]);

  useEffect(() => {
    if (!agentId || !shareInfo?.shareConfig) return;

    const state = configQueueByAgent.get(agentId);
    if (!state || state.shareId !== shareInfo.id) {
      configQueueByAgent.set(agentId, {
        config: shareInfo.shareConfig,
        pending: 0,
        queue: Promise.resolve(),
        shareId: shareInfo.id,
      });
      return;
    }
    // Same-share SWR revalidation may carry another tab's committed patch.
    // Reconcile only while idle so an in-flight local queue keeps its own
    // ordered functional-update base until the server response replaces it.
    if (state.pending === 0) {
      state.config = shareInfo.shareConfig;
      state.deferredConfig = undefined;
    } else {
      state.deferredConfig = shareInfo.shareConfig;
    }
  }, [agentId, shareInfo?.id, shareInfo?.shareConfig]);

  const retryCreate = useCallback(() => createShare(), [createShare]);

  const updateVisibility = useCallback(
    async (visibility: AgentShareVisibility) => {
      if (!agentId) return;
      const updated = await agentShareService.updateVisibility(agentId, visibility);
      await mutate(updated, { revalidate: false });
    },
    [agentId, mutate],
  );

  /** Serialize same-context writes while the server atomically merges each patch. */
  const updateConfig = useCallback(
    async (patch: AgentShareConfigPatch) => {
      if (!agentId) return;

      const state = configQueueByAgent.get(agentId);
      if (!state) return;

      state.pending += 1;
      let committed = false;
      const request = state.queue.then(async () => {
        const resolvedPatch = typeof patch === 'function' ? patch(state.config) : patch;
        const updated = await agentShareService.updateShareConfig(agentId, resolvedPatch);
        committed = true;
        state.config = updated.shareConfig;
        state.deferredConfig = undefined;
        await mutate(updated, { revalidate: false });
      });

      // A failed write must reject its own caller, but must not poison later
      // queued edits. If the server write failed, restore the newest SWR
      // snapshot skipped while the queue was busy before the next functional
      // patch resolves; otherwise that patch could overwrite another tab.
      const trackedRequest = request
        .catch((error) => {
          if (!committed && state.deferredConfig) {
            state.config = state.deferredConfig;
            state.deferredConfig = undefined;
          }
          throw error;
        })
        .finally(() => {
          state.pending -= 1;
        });
      state.queue = trackedRequest.catch(() => undefined);
      return trackedRequest;
    },
    [agentId, mutate],
  );

  return {
    createError,
    isCreating,
    isLoading,
    mutate,
    retryCreate,
    shareInfo,
    updateConfig,
    updateVisibility,
  };
};
