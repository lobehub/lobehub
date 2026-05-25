'use client';

import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { App } from 'antd';
import { Archive, MoreHorizontal, Sparkles } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

const ToolbarActions = memo(() => {
  const { t } = useTranslation('topic');
  const { modal, message } = App.useApp();

  // Operate on the management page's own bucket — not the sidebar's — since
  // the management view is the one the user is acting on here.
  const topics = useChatStore(topicSelectors.agentTopicsViewTopics);
  const updateTopicStatus = useChatStore((s) => s.updateTopicStatus);

  const handleArchiveStale = useCallback(() => {
    const cutoff = Date.now() - THREE_MONTHS_MS;
    const stale = (topics ?? []).filter((t) => {
      if (t.status === 'completed') return false;
      const updated =
        typeof t.updatedAt === 'number' ? t.updatedAt : new Date(t.updatedAt).getTime();
      return updated < cutoff;
    });

    if (stale.length === 0) {
      message.info(t('management.actionsMenu.archiveStale.noneFound'));
      return;
    }

    modal.confirm({
      content: t('management.actionsMenu.archiveStale.confirm', { count: stale.length }),
      okText: t('management.actionsMenu.archiveStale.confirmOk'),
      onOk: async () => {
        for (const topic of stale) {
          // 'archived' isn't surfaced in the UI, so we mark stale topics as
          // 'completed' — matches what the user means by "archive" here.
          await updateTopicStatus({ status: 'completed', topicId: topic.id });
        }
        message.success(t('management.actionsMenu.archiveStale.done', { count: stale.length }));
      },
      title: t('management.actionsMenu.archiveStale.title'),
    });
  }, [topics, updateTopicStatus, modal, message, t]);

  const handleAutoSummarize = useCallback(() => {
    // TODO: hook up to a topic-summary generation endpoint once we expose one;
    // for now keep the menu item visible so the surface is consistent.
    message.info(t('management.actionsMenu.autoSummarize.comingSoon'));
  }, [message, t]);

  const items: DropdownItem[] = useMemo(
    () => [
      {
        icon: <Archive size={14} />,
        key: 'archive-stale',
        label: t('management.actionsMenu.archiveStale.label'),
        onClick: handleArchiveStale,
      },
      {
        icon: <Sparkles size={14} />,
        key: 'auto-summarize',
        label: t('management.actionsMenu.autoSummarize.label'),
        onClick: handleAutoSummarize,
      },
    ],
    [t, handleArchiveStale, handleAutoSummarize],
  );

  return (
    <DropdownMenu items={items}>
      <ActionIcon icon={MoreHorizontal} title={t('management.actionsMenu.title')} />
    </DropdownMenu>
  );
});

ToolbarActions.displayName = 'AgentTopicManagerToolbarActions';

export default ToolbarActions;
