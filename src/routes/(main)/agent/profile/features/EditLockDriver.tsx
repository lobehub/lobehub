'use client';

import { memo, useEffect, useRef } from 'react';

import { type EditLockClient, useEditLock } from '@/features/EditLock';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';

import { useProfileStore } from './store';

// Stable lock RPC binding for the agent resource.
const agentLockClient: EditLockClient = {
  acquire: (id) => lambdaClient.agent.acquireAgentLock.mutate({ agentId: id }),
  peek: (id) => lambdaClient.agent.getAgentLock.query({ agentId: id }),
  release: async (id) => {
    await lambdaClient.agent.releaseAgentLock.mutate({ agentId: id });
  },
};

/**
 * Drives the collaborative edit lock for workspace agent profiles.
 *
 * Mounted high in the profile tree (not inside the loading-gated editor) so the
 * lock is *peeked on open* before the editor renders — an agent another member
 * is already editing is read-only from the first frame, mirroring the page lock.
 * The resolved state is published to the profile store; the editor reads it.
 */
const EditLockDriver = memo(() => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId);
  // Only workspace agents lock — personal (non-workspace) agents stay fully
  // editable with no peek/pending, matching the server's workspace gating.
  const agentWorkspaceId = useAgentStore((s) =>
    s.activeAgentId ? s.agentMap[s.activeAgentId]?.workspaceId : undefined,
  );
  const hasEdited = useProfileStore((s) => s.hasEdited);
  const setLockState = useProfileStore((s) => s.setLockState);
  const setHasEdited = useProfileStore((s) => s.setHasEdited);

  // Reset edit-intent whenever the open agent changes, so a new agent never
  // inherits the previous one's edit-intent (and the heartbeat doesn't engage).
  const agentIdRef = useRef(agentId);
  useEffect(() => {
    if (agentIdRef.current !== agentId) {
      agentIdRef.current = agentId;
      setHasEdited(false);
    }
  }, [agentId, setHasEdited]);

  const lock = useEditLock({
    client: agentLockClient,
    enabled: Boolean(agentId && canEdit && agentWorkspaceId),
    isDirty: Boolean(hasEdited),
    resourceId: agentId ?? undefined,
  });

  useEffect(() => {
    setLockState({
      holderId: lock.holderId,
      lockedByOther: lock.lockedByOther,
      pending: lock.pending,
    });
  }, [lock.holderId, lock.lockedByOther, lock.pending, setLockState]);

  return null;
});

export default EditLockDriver;
