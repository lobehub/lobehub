'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { ActionIcon, Alert, Button, Center, Flexbox, Icon, Spin, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeftIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { describeError } from '@/features/EnvironmentManager/errorMessage';
import { formatSize } from '@/utils/format';

import { STORAGE_CATEGORIES } from './analysis';
import { CATEGORY_COLORS } from './categoryMeta';
import CategorySection from './CategorySection';
import { confirmStorageDelete } from './confirmDelete';
import { useCleanupSelection } from './useCleanupSelection';
import { useStorageAnalysis } from './useStorageAnalysis';

const styles = stylex.create({
  actionBar: {
    backgroundColor: cssVar.colorBgContainer,
    borderTopColor: cssVar.colorBorderSecondary,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    bottom: 0,
    paddingBlock: 12,
    position: 'sticky',
  },
  bar: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: 4,
    display: 'flex',
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  segment: (color: string, width: string) => ({ backgroundColor: color, height: '100%', width }),
});

interface StorageCleanupProps {
  drive: SandboxDrive;
  onBack: () => void;
}

/**
 * What a drive's space goes to, and a way to give it back.
 *
 * The analysis sorts the drive into categories — dependencies and caches,
 * which the next install or build recreates, and archives, media, git
 * history and everything else, which nothing recreates — with the largest
 * items of each to tick. Deleting is permanent, so it always ends in a
 * second confirmation that says so. None of this is held back by the quota:
 * a drive over its limit is precisely the one that needs it.
 */
const StorageCleanup = memo<StorageCleanupProps>(({ drive, onBack }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { analysis, error, remove, rescan, scanning } = useStorageAnalysis(drive);
  const result = analysis?.result;
  const selection = useCleanupSelection(result);
  const { chosen, selected, toggle } = selection;
  const chosenBytes = selection.bytes;

  const deleteChosen = () => {
    const items = chosen;
    // What was chosen belongs to this workspace's drive; a confirmation that
    // outlives a workspace switch must not delete in the next one.
    const workspace = getActiveWorkspaceId();
    confirmStorageDelete({
      bytes: chosenBytes,
      count: items.length,
      onConfirm: async () => {
        if (getActiveWorkspaceId() !== workspace) {
          toast.error(t('drive.cleanup.scopeChanged'));
          return;
        }
        try {
          const outcome = await remove(items);
          selection.clear();
          if (outcome.failed.length > 0 && outcome.pending.length > 0) {
            toast.warning(
              t('drive.cleanup.failedAndPending', {
                failed: outcome.failed.length,
                pending: outcome.pending.length,
              }),
            );
          } else if (outcome.failed.length > 0) {
            toast.warning(t('drive.cleanup.someFailed', { count: outcome.failed.length }));
          } else if (outcome.pending.length > 0) {
            toast.warning(t('drive.cleanup.partial', { count: outcome.pending.length }));
          } else {
            toast.success(t('drive.cleanup.freed', { size: formatSize(outcome.freedBytes) }));
          }
        } catch (caught) {
          toast.error(describeError(caught, t, t('drive.cleanup.deleteFailed')));
          throw caught;
        }
      },
      regenerable: selection.regenerable,
    });
  };

  const total = result?.totalBytes ?? 0;
  const categories = STORAGE_CATEGORIES.map((category) => {
    const summary = result?.categories.find((entry) => entry.category === category);
    return {
      bytes: summary?.bytes ?? 0,
      category,
      itemCount: summary?.items ?? 0,
      items: (result?.items ?? []).filter((item) => item.category === category),
    };
  }).filter((entry) => entry.bytes > 0);

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={8}>
        <ActionIcon icon={ArrowLeftIcon} title={t('drive.cleanup.back')} onClick={onBack} />
        <Flexbox flex={1} gap={2}>
          <Text as={'h2'} fontSize={16} style={{ margin: 0 }} weight={600}>
            {t('drive.cleanup.title')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {scanning
              ? t('drive.cleanup.scanning', { size: formatSize(analysis?.scannedBytes ?? 0) })
              : error && result
                ? t('drive.cleanup.incomplete', { size: formatSize(analysis?.scannedBytes ?? 0) })
                : result
                  ? t('drive.cleanup.summary', { size: formatSize(total) })
                  : t('drive.cleanup.description')}
          </Text>
        </Flexbox>
        <ActionIcon
          disabled={scanning}
          icon={RefreshCwIcon}
          loading={scanning}
          title={t('drive.cleanup.rescan')}
          onClick={() => void rescan()}
        />
      </Flexbox>

      {error && !result ? (
        <Center gap={12} style={{ minHeight: 240 }}>
          <Text type={'secondary'}>{describeError(error, t, t('drive.cleanup.failed'))}</Text>
          <Button onClick={() => void rescan()}>{t('retry', { ns: 'common' })}</Button>
        </Center>
      ) : !result ? (
        <Center gap={12} style={{ minHeight: 240 }}>
          <Spin />
          <Text type={'secondary'}>{t('drive.cleanup.scanningFirst')}</Text>
        </Center>
      ) : (
        <>
          <div {...stylex.props(styles.bar)} role={'presentation'}>
            {categories.map((entry) => (
              <span
                key={entry.category}
                title={t(`drive.cleanup.category.${entry.category}`)}
                {...stylex.props(
                  styles.segment(
                    CATEGORY_COLORS[entry.category],
                    `${total > 0 ? (entry.bytes / total) * 100 : 0}%`,
                  ),
                )}
              />
            ))}
          </div>
          {error && (
            <Alert
              showIcon
              title={describeError(error, t, t('drive.cleanup.failed'))}
              type={'warning'}
              action={
                <Button size={'small'} onClick={() => void rescan()}>
                  {t('retry', { ns: 'common' })}
                </Button>
              }
            />
          )}
          {result.stale && (
            <Text fontSize={12} type={'secondary'}>
              {t('drive.cleanup.stale')}
            </Text>
          )}
          {categories.length === 0 ? (
            <Center style={{ minHeight: 160 }}>
              <Text type={'secondary'}>{t('drive.cleanup.empty')}</Text>
            </Center>
          ) : (
            <Flexbox>
              {categories.map((entry) => (
                <CategorySection
                  bytes={entry.bytes}
                  category={entry.category}
                  itemCount={entry.itemCount}
                  items={entry.items}
                  key={entry.category}
                  selected={selected}
                  onToggle={toggle}
                />
              ))}
            </Flexbox>
          )}
          <Flexbox
            horizontal
            align={'center'}
            gap={12}
            justify={'space-between'}
            {...stylex.props(styles.actionBar)}
          >
            <Text type={'secondary'}>
              {chosen.length > 0
                ? t('drive.cleanup.selected', {
                    count: chosen.length,
                    size: formatSize(chosenBytes),
                  })
                : t('drive.cleanup.selectHint')}
            </Text>
            <Button
              danger
              disabled={chosen.length === 0}
              icon={<Icon icon={Trash2Icon} />}
              type={'primary'}
              onClick={deleteChosen}
            >
              {t('drive.cleanup.delete')}
            </Button>
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

StorageCleanup.displayName = 'StorageCleanup';

export default StorageCleanup;
