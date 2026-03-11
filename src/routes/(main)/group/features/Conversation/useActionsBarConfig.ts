'use client';

import { App } from 'antd';
import { Split } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ActionsBarConfig,
  type MessageActionFactory,
  type MessageActionItem,
} from '@/features/Conversation/types';
import { useChatStore } from '@/store/chat';

/**
 * Hook to create a branching action factory function.
 * The factory function takes a message id and returns the branching action
 * with proper ChatStore integration.
 */
export const useBranchingActionFactory = (): MessageActionFactory => {
  const { t } = useTranslation('common');
  const { message } = App.useApp();

  const [topic, openThreadCreator] = useChatStore((s) => [s.activeTopicId, s.openThreadCreator]);

  return useCallback(
    (id: string): MessageActionItem | null => {
      return {
        handleClick: () => {
          if (!topic) {
            message.warning(t('branchingRequiresSavedTopic'));
            return;
          }
          openThreadCreator(id);
        },
        icon: Split,
        key: 'branching',
        label: t('branching'),
      };
    },
    [topic, openThreadCreator],
  );
};

/**
 * Hook to generate actionsBar configuration with branching support.
 * This creates the complete actionsBar config to be passed to ChatList.
 */
export const useActionsBarConfig = (): ActionsBarConfig => {
  const branchingFactory = useBranchingActionFactory();

  return useMemo(
    () => ({
      assistant: {
        // extraBarActions: [branchingFactory],
      },
      user: {
        // extraBarActions: [branchingFactory],
      },
    }),
    [branchingFactory],
  );
};
