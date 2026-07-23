'use client';

import { useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand';

import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { type State, useChatInputStoreApiOptional } from '../store';

const EMPTY_SUBSCRIBE = () => () => {};

/**
 * Reads the bound `agentId` from the ChatInput store, reactively when a store
 * Provider exists and falling back to `undefined` otherwise. This hook is
 * reached from the shared <Action> component, which the image/video generation
 * prompt reuses outside any ChatInput store — reading the store directly there
 * would throw ("...used zustand provider as an ancestor.").
 */
const useChatInputAgentId = (): string | undefined => {
  const storeApi = useChatInputStoreApiOptional() as StoreApi<State> | undefined;
  return useSyncExternalStore(
    storeApi ? storeApi.subscribe : EMPTY_SUBSCRIBE,
    () => storeApi?.getState().agentId,
    () => undefined,
  );
};

/**
 * Per-resource General-access gating for the chat input: resolves which
 * workspace resource this input sends to (the bound agent, or the group when
 * the input reuses the supervisor's agentId as context — see useGroupContext)
 * and reports whether the member may use it. Home/new-conversation inputs (no
 * explicit agentId), the inbox agent, and private resources are never gated;
 * loading defaults permissive — the server remains the enforcement point.
 */
export const useChatInputResourceAccess = () => {
  const chatInputAgentId = useChatInputAgentId();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentVisibility = useAgentStore((s) =>
    chatInputAgentId ? s.agentMap[chatInputAgentId]?.visibility : undefined,
  );
  const activeGroup = useAgentGroupStore((s) =>
    s.activeGroupId ? agentGroupSelectors.getGroupById(s.activeGroupId)(s) : undefined,
  );
  const isGroupContext =
    !!chatInputAgentId && !!activeGroup && activeGroup.supervisorAgentId === chatInputAgentId;

  const gatedResourceId = isGroupContext
    ? activeGroup.visibility === 'private'
      ? undefined
      : activeGroup.id
    : chatInputAgentId && chatInputAgentId !== inboxAgentId && agentVisibility !== 'private'
      ? chatInputAgentId
      : undefined;

  const { allowed: canCreateContent } = usePermission('create_content');
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const {
    canEditResource,
    canUseResource: canUseResourceLevel,
    isAccessResolved,
    isLoading: isAccessLoading,
  } = useResourceAccess(isGroupContext ? 'agentGroup' : 'agent', gatedResourceId);

  return {
    canConfigureResource: isAccessResolved && canEditContent && canEditResource,
    /** Hide composer controls until access resolves, and for view-only callers. */
    canShowControls:
      !isAccessLoading && isAccessResolved && canCreateContent && canUseResourceLevel,
    canUseResource: canCreateContent && canUseResourceLevel,
    /**
     * Whether the General-access request has actually resolved. `canUseResource`
     * stays permissive on error/no-data, so positive messaging (e.g. the
     * use-only notice) must additionally require this flag.
     */
    isAccessResolved,
    isAccessLoading,
    isGroupContext,
    /**
     * Whether this input targets a workspace-shared resource whose General
     * access actually gates the member (home/inbox/private inputs are never
     * gated). Lets callers scope "use-only"/"view-only" messaging to shared
     * resources instead of surfacing it for every private agent.
     */
    isResourceGated: !!gatedResourceId,
  };
};
