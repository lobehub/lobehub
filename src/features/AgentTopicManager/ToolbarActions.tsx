'use client';

import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { Archive, MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

const ToolbarActions = memo(() => {
  const { t } = useTranslation('topic');
  const { message } = App.useApp();

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

    confirmModal({
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
  }, [topics, updateTopicStatus, message, t]);

  const items: DropdownItem[] = useMemo(
    () => [
      {
        icon: <Archive size={14} />,
        key: 'archive-stale',
        label: t('management.actionsMenu.archiveStale.label'),
        onClick: handleArchiveStale,
      },
    ],
    [t, handleArchiveStale],
  );

  return (
    <DropdownMenu items={items}>
      <ActionIcon icon={MoreHorizontal} title={t('management.actionsMenu.title')} />
    </DropdownMenu>
  );
});

ToolbarActions.displayName = 'AgentTopicManagerToolbarActions';

export default ToolbarActions;
