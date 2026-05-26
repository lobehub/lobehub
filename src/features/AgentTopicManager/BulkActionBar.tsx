'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Archive, Star, Trash2, X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { useTopicsViewStore } from './store';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    pointer-events: auto;

    padding-block: 8px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  divider: css`
    width: 1px;
    height: 16px;
    margin-inline: 2px;
    background: ${cssVar.colorBorderSecondary};
  `,
  overlay: css`
    pointer-events: none;

    position: fixed;
    z-index: 1000;
    inset-block-end: 24px;
    inset-inline: 0;

    display: flex;
    justify-content: center;
  `,
}));

const BulkActionBar = memo(() => {
  const { t } = useTranslation('topic');
  const { modal } = App.useApp();

  const selectedIds = useTopicsViewStore((s) => s.selectedIds);
  const exitSelectMode = useTopicsViewStore((s) => s.exitSelectMode);

  const favoriteTopic = useChatStore((s) => s.favoriteTopic);
  const updateTopicStatus = useChatStore((s) => s.updateTopicStatus);
  const removeTopic = useChatStore((s) => s.removeTopic);

  const handleBatchFavorite = useCallback(async () => {
    await Promise.all(selectedIds.map((id) => favoriteTopic(id, true)));
    exitSelectMode();
  }, [selectedIds, favoriteTopic, exitSelectMode]);

  const handleBatchArchive = useCallback(async () => {
    // "Archive" in the UI is a friendlier name for marking topics as
    // completed — the dedicated `archived` status isn't surfaced to users.
    await Promise.all(
      selectedIds.map((id) => updateTopicStatus({ status: 'completed', topicId: id })),
    );
    exitSelectMode();
  }, [selectedIds, updateTopicStatus, exitSelectMode]);

  const handleBatchDelete = useCallback(() => {
    modal.confirm({
      content: t('management.bulk.deleteConfirm', { count: selectedIds.length }),
      okButtonProps: { danger: true },
      okText: t('management.bulk.delete'),
      onOk: async () => {
        // Serial removal so each call's optimistic update + refetch resolves
        // cleanly; parallel removeTopic causes cascading refetches.
        for (const id of selectedIds) {
          await removeTopic(id);
        }
        exitSelectMode();
      },
      title: t('management.bulk.deleteTitle'),
    });
  }, [selectedIds, modal, t, removeTopic, exitSelectMode]);

  if (selectedIds.length === 0) return null;

  return (
    <div className={styles.overlay}>
      <Flexbox horizontal align={'center'} className={styles.bar} gap={4}>
        <Text style={{ marginInlineEnd: 8 }} weight={500}>
          {t('management.bulk.selectedCount', { count: selectedIds.length })}
        </Text>
        <ActionIcon
          icon={Star}
          size={'small'}
          title={t('management.bulk.favorite')}
          onClick={handleBatchFavorite}
        />
        <ActionIcon
          icon={Archive}
          size={'small'}
          title={t('management.bulk.archive')}
          onClick={handleBatchArchive}
        />
        <ActionIcon
          icon={Trash2}
          size={'small'}
          style={{ color: cssVar.colorError }}
          title={t('management.bulk.delete')}
          onClick={handleBatchDelete}
        />
        <span className={styles.divider} />
        <ActionIcon
          icon={X}
          size={'small'}
          title={t('management.bulk.cancel')}
          onClick={exitSelectMode}
        />
      </Flexbox>
    </div>
  );
});

BulkActionBar.displayName = 'AgentTopicManagerBulkActionBar';

export default BulkActionBar;
