'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Archive, Star, Trash2, X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { useTopicsViewStore } from './store';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    margin-block-end: 16px;
    padding-block: 10px;
    padding-inline: 16px;
    border-radius: 10px;

    color: ${cssVar.colorWhite};

    background: ${cssVar.colorText};
    box-shadow: 0 4px 12px rgb(0 0 0 / 8%);
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
    await Promise.all(
      selectedIds.map((id) => updateTopicStatus({ status: 'archived', topicId: id })),
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
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      <Text style={{ color: cssVar.colorWhite, fontWeight: 500 }}>
        {t('management.bulk.selectedCount', { count: selectedIds.length })}
      </Text>
      <Flexbox horizontal align={'center'} gap={6}>
        <Button
          icon={Star}
          size={'small'}
          style={{ color: cssVar.colorWhite }}
          variant={'text'}
          onClick={handleBatchFavorite}
        >
          {t('management.bulk.favorite')}
        </Button>
        <Button
          icon={Archive}
          size={'small'}
          style={{ color: cssVar.colorWhite }}
          variant={'text'}
          onClick={handleBatchArchive}
        >
          {t('management.bulk.archive')}
        </Button>
        <Button danger icon={Trash2} size={'small'} variant={'filled'} onClick={handleBatchDelete}>
          {t('management.bulk.delete')}
        </Button>
        <Button
          icon={X}
          size={'small'}
          style={{ color: cssVar.colorWhite }}
          variant={'text'}
          onClick={exitSelectMode}
        >
          {t('management.bulk.cancel')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

BulkActionBar.displayName = 'AgentTopicsBulkActionBar';

export default BulkActionBar;
