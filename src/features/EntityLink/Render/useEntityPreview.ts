import { cacheScope } from '@/libs/replica';
import { useAgentStore } from '@/store/agent';
import { useDocumentStore } from '@/store/document';
import {
  entityPreviewActions,
  type EntityPreviewParams,
  entityPreviewSelectors,
  useEntityPreviewStore,
} from '@/store/entityPreview';
import { useGoalStore } from '@/store/goal';
import { useTaskStore } from '@/store/task';
import { useVerifyStore } from '@/store/verify';

import type { InternalLinkReference } from '../internalLink';

export const toEntityPreviewParams = (
  reference: InternalLinkReference,
): EntityPreviewParams | null => {
  switch (reference.type) {
    case 'acceptance': {
      return { id: reference.acceptanceId, type: 'acceptance' };
    }
    case 'agent': {
      return { id: reference.agentId, type: 'agent' };
    }
    case 'document': {
      return { id: reference.documentId, type: 'document' };
    }
    case 'goal': {
      return { id: reference.goalId, type: 'goal' };
    }
    case 'task': {
      return { id: reference.taskId, type: 'task' };
    }
    case 'verify': {
      return { id: reference.runId, type: 'verify' };
    }
    case 'route': {
      return null;
    }
  }
};

/**
 * The entity's title from a detail replica another surface already loaded
 * (the task / goal / document open beside the chat, the agent list), so the
 * link can be titled before its own preview arrives.
 */
const useLoadedDetailTitle = (params: EntityPreviewParams | null): string | undefined => {
  const id = params?.id ?? '';
  const type = params?.type;

  const agentTitle = useAgentStore((s) =>
    type === 'agent' ? s.agentMap[id]?.title || undefined : undefined,
  );
  const documentTitle = useDocumentStore((s) => {
    if (type !== 'document') return;
    const document = s.documentDetailMap[id]?.document;
    return document?.title || document?.filename || undefined;
  });
  const goalTitle = useGoalStore((s) =>
    type === 'goal' ? s.goalGraphById[id]?.goal.title || undefined : undefined,
  );
  const taskTitle = useTaskStore((s) => {
    if (type !== 'task') return;
    const task = s.taskDetailMap[s.taskRefIndex[id] ?? id];
    return task?.name || task?.identifier || undefined;
  });
  const verifyTitle = useVerifyStore((s) => {
    if (type === 'acceptance') {
      const subject = s.acceptanceBundleMap[id]?.subject;
      return subject?.title || subject?.id || undefined;
    }
    if (type === 'verify') return s.verifyReportBundleMap[id]?.value?.run.title || undefined;
  });

  return agentTitle ?? documentTitle ?? goalTitle ?? taskTitle ?? verifyTitle;
};

/**
 * The preview of the entity a link points at, from its replica: a reload
 * paints the last-seen preview at once and the network then confirms it.
 */
export const useEntityPreview = (reference: InternalLinkReference, enabled: boolean) => {
  const params = toEntityPreviewParams(reference);
  const sync = entityPreviewActions.useFetchEntityPreview(params, { enabled });
  const preview = useEntityPreviewStore(entityPreviewSelectors.getPreview(params));
  const isConfirmed = useEntityPreviewStore(entityPreviewSelectors.isPreviewConfirmed(params));
  const isMissing = useEntityPreviewStore(
    entityPreviewSelectors.isPreviewMissing(params, cacheScope.use()),
  );
  const loadedTitle = useLoadedDetailTitle(enabled ? params : null);

  return {
    ...sync,
    isConfirmed,
    preview,
    // A preview the server answered this session is the freshest title; a
    // restored one yields to a detail another surface already loaded. Once the
    // server said the entity is gone, no remembered title stands in for it.
    title: isMissing
      ? undefined
      : (isConfirmed ? preview?.title : undefined) || loadedTitle || preview?.title || undefined,
  };
};
