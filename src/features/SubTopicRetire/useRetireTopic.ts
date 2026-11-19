'use client';

import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { retirableSubTopics } from '@/store/chat/slices/subTopic/action';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { askRetireSubTopics, type RetireAction } from './Dialog';
import { notifyMovedSubTopics } from './notifyMoved';

/**
 * Archive / trash that knows about sub-topics. Without any (or with the lab
 * off) it runs the ordinary `proceed`; otherwise it asks whether to take the
 * sub-topics along or move them to the top level, and says where moved
 * ones of other agents went.
 */
export const useRetireTopicWithSubTopics = () => {
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

      // What retiring it would touch: its sub-topics, task runs left to their task.
      const tree = await topicService.listChildTopics([params.topicId]).catch(() => undefined);
      const retirable = tree ? retirableSubTopics(params.topicId, tree) : [];
      if (retirable.length === 0) return params.proceed();
      const summary = {
        descendants: retirable.length,
        running: retirable.filter((row) => row.state === 'running').length,
      };

      const decision = await askRetireSubTopics({
        action: params.action,
        descendants: summary.descendants,
        running: summary.running,
        title: params.title,
      });
      if (!decision) return;

      try {
        const result = await retireTopicTree(params.topicId, params.action, decision.mode, {
          removeFiles: decision.removeFiles,
        });
        notifyMovedSubTopics(result.detached, (agentId) => navigate(`/agent/${agentId}`));
      } catch {
        toast.error(t('operationFailed'));
      }
    },
    [enabled, navigate, retireTopicTree, t],
  );
};
