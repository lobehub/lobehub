import { useCallback, useRef } from 'react';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import type { AgentShareConfigPatchInput } from '@/services/agentShare';
import { agentShareService } from '@/services/agentShare';

export type AgentShareInfo = Awaited<ReturnType<typeof agentShareService.getShareStatus>>;
/** Server-normalized share config (every optional field already defaulted). */
export type AgentShareConfigState = NonNullable<AgentShareInfo>['shareConfig'];

/**
 * Creator-side share state for one agent.
 *
 * Unlike a topic share, sharing an agent lets link holders RUN it on the
 * creator's account, so nothing is created until the owner explicitly turns
 * sharing on. `enable` mints the row with `link` visibility; `disable` deletes
 * it, which is what makes the handed-out link stop resolving — re-enabling
 * mints a new share id, i.e. a NEW url (see `AgentShareModel.create`).
 */
export const useAgentShare = (agentId: string) => {
  const {
    data: share,
    isLoading,
    mutate,
  } = useSWR(shareKeys.agentShareStatus(agentId), () => agentShareService.getShareStatus(agentId), {
    revalidateOnFocus: false,
  });

  /**
   * Every mutation replaces the whole row in the SWR cache, so two writes that
   * resolve out of order would let the older response win. Chain them instead:
   * the settings surface fires one write per control, and the server merges
   * each config patch atomically anyway.
   */
  const queueRef = useRef<Promise<unknown> | null>(null);
  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const tail = queueRef.current ?? Promise.resolve();
    // Both handlers run `task`: a failed write must reject its own caller
    // without stalling the writes queued behind it.
    const result = tail.then(task, task);
    queueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const enable = useCallback(
    () =>
      enqueue(async () => {
        // `create` returns any pre-existing row untouched, so a legacy
        // `private` row still needs the explicit flip to `link`.
        const created = await agentShareService.enableShare(agentId, 'link');
        const updated =
          created.visibility === 'link'
            ? created
            : await agentShareService.updateVisibility(agentId, 'link');
        await mutate(updated, { revalidate: false });
      }),
    [agentId, enqueue, mutate],
  );

  const disable = useCallback(
    () =>
      enqueue(async () => {
        await agentShareService.disableShare(agentId);
        await mutate(null, { revalidate: false });
      }),
    [agentId, enqueue, mutate],
  );

  const updateConfig = useCallback(
    (config: AgentShareConfigPatchInput) =>
      enqueue(async () => {
        const updated = await agentShareService.updateShareConfig(agentId, config);
        await mutate(updated, { revalidate: false });
      }),
    [agentId, enqueue, mutate],
  );

  const updateSlug = useCallback(
    (slug: string | null) =>
      enqueue(async () => {
        const updated = await agentShareService.updateSlug(agentId, slug);
        await mutate(updated, { revalidate: false });
      }),
    [agentId, enqueue, mutate],
  );

  return { disable, enable, isLoading, share, updateConfig, updateSlug };
};
