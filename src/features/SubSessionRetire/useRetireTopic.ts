'use client';

import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { subSessionService } from '@/services/subSession';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { askRetireSubSessions, type RetireAction } from './Dialog';
import { notifyMovedSubSessions } from './notifyMoved';

/**
 * Archive / trash that knows about sub-sessions. Without any (or with the lab
 * off) it runs the ordinary `proceed`; otherwise it asks whether to take the
 * sub-sessions along or move them to the top level, and says where moved
 * ones of other agents went.
 */
export const useRetireTopicWithSubSessions = () => {
  const { t } = useTranslation('common');
  const enabled = useUserStore(labPreferSelectors.enableBetterCodingExperience);
  const retireTopicTree = useChatStore((s) => s.retireTopicTree);
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(
    async (params: {
      action: RetireAction;
      proceed: () => Promise<void> | void;
      title: string;
      topicId: string;
    }) => {
      if (!enabled) return params.proceed();

      const summary = await subSessionService.describe(params.topicId).catch(() => undefined);
      if (!summary || summary.descendants === 0) return params.proceed();

      const choice = await askRetireSubSessions({
        action: params.action,
        descendants: summary.descendants,
        running: summary.running,
        title: params.title,
      });
      if (!choice) return;

      try {
        const result = await retireTopicTree(params.topicId, params.action, choice);
        notifyMovedSubSessions(result.detached, (agentId) => navigate(`/agent/${agentId}`));
      } catch {
        toast.error(t('operationFailed'));
      }
    },
    [enabled, navigate, retireTopicTree, t],
  );
};
