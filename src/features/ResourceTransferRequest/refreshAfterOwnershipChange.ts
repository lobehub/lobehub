import { mutate } from '@/libs/swr';
import { agentConfigKeys, groupKeys } from '@/libs/swr/keys';
import { useHomeStore } from '@/store/home';

/**
 * An accepted handover flips ownership — the sidebar list, the agent map and
 * every owner-gated menu read from caches that must not wait for a manual page
 * reload. The accepted resource's detail page may be mounted right now, so its
 * config/detail cache refreshes too, or it keeps rendering the previous owner
 * and owner-gated controls until a focus revalidation.
 *
 * Deliberately uses the GLOBAL SWR mutator: these caches live under other SWR
 * keys, which a hook-bound `mutate` cannot reach — it would instead REPLACE
 * its own cache's data with the key array.
 */
export const refreshCachesAfterOwnershipChange = async (
  resourceType: string,
  resourceId: string,
): Promise<void> => {
  await Promise.all([
    resourceType === 'agent'
      ? mutate(agentConfigKeys.config(resourceId))
      : mutate(groupKeys.detail(resourceId)),
    useHomeStore.getState().refreshAgentList(),
  ]);
};
