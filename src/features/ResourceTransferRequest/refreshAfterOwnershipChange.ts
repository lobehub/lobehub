import { revalidateReplica } from '@/libs/replica';
import { getAgentStoreState } from '@/store/agent';
import { agentGroupDetailResource } from '@/store/agentGroup/projection';
import { useHomeStore } from '@/store/home';

/**
 * An accepted handover flips ownership — the sidebar list, the agent map and
 * every owner-gated menu read from caches that must not wait for a manual page
 * reload. The accepted resource's detail page may be mounted right now, so its
 * config/detail cache refreshes too, or it keeps rendering the previous owner
 * and owner-gated controls until a focus revalidation.
 *
 * The agent and group caches now live behind their stores' replica resources,
 * so they are revalidated through `revalidateReplica` rather than the global
 * SWR mutator — the replica sync query key is derived from the resource
 * (name + version + scope), not from the old `group:*` / `agent:*` keys.
 */
export const refreshCachesAfterOwnershipChange = async (
  resourceType: string,
  resourceId: string,
): Promise<void> => {
  await Promise.all([
    resourceType === 'agent'
      ? getAgentStoreState().internal_refreshAgentConfig(resourceId)
      : revalidateReplica(agentGroupDetailResource, resourceId),
    useHomeStore.getState().refreshAgentList(),
  ]);
};
