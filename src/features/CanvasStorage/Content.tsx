'use client';

import type { CanvasStorageItem } from '@lobechat/types';
import { formatSize } from '@lobechat/utils/format';
import {
  ActionIcon,
  Block,
  Button,
  Center,
  Empty,
  Flexbox,
  Icon,
  Skeleton,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelsTopLeftIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openCanvasModal } from '@/features/CanvasModal/loader';

import { useDeleteCanvas, useFetchCanvasStorage } from './useCanvasStorage';

const styles = stylex.create({
  list: {
    overflowY: 'auto',
    maxHeight: 'min(60vh, 480px)',
  },
  meta: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  row: {
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: '8px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
  size: {
    flex: 'none',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
  },
  title: {
    overflow: 'hidden',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  titleLink: {
    cursor: 'pointer',
    textDecoration: { 'default': null, ':hover': 'underline' },
  },
});

const CanvasStorageRow = memo<{ item: CanvasStorageItem }>(({ item }) => {
  const { t, i18n } = useTranslation(['file', 'common']);
  const deleteCanvas = useDeleteCanvas();
  const updatedAt = new Date(item.updatedAt);
  const date = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    year: updatedAt.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(updatedAt);

  return (
    <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.row)}>
      <Block
        align={'center'}
        flex={'none'}
        height={36}
        justify={'center'}
        variant={'outlined'}
        width={36}
      >
        <Icon color={cssVar.colorTextSecondary} icon={PanelsTopLeftIcon} size={18} />
      </Block>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        {item.workId ? (
          <span
            {...stylex.props(styles.title, styles.titleLink)}
            role={'button'}
            tabIndex={0}
            onClick={() => void openCanvasModal(item.canvasId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void openCanvasModal(item.canvasId);
            }}
          >
            {item.title || t('work.type.canvas')}
          </span>
        ) : (
          <span {...stylex.props(styles.title)}>{t('canvasStorage.item.untitled')}</span>
        )}
        <span {...stylex.props(styles.meta)}>
          {t('canvasStorage.item.meta', { count: item.fileCount, date })}
        </span>
      </Flexbox>
      <span {...stylex.props(styles.size)}>{formatSize(item.totalSize)}</span>
      <ActionIcon
        aria-label={t('delete', { ns: 'common' })}
        icon={Trash2Icon}
        size={'small'}
        title={t('delete', { ns: 'common' })}
        onClick={() => deleteCanvas(item)}
      />
    </Flexbox>
  );
});

CanvasStorageRow.displayName = 'CanvasStorageRow';

/** Every canvas holding file storage, largest first, each deletable as a whole. */
const CanvasStorageContent = memo(() => {
  const { t } = useTranslation(['file', 'common']);
  const { data, error, isLoading, mutate } = useFetchCanvasStorage();

  const renderBody = () => {
    if (!data && isLoading)
      return (
        <Flexbox gap={2}>
          {[0, 1, 2].map((index) => (
            <Flexbox horizontal align={'center'} gap={12} key={index} {...stylex.props(styles.row)}>
              <Skeleton.Avatar shape={'square'} size={36} />
              <Flexbox flex={1} gap={6}>
                <Skeleton height={14} width={'45%'} />
                <Skeleton height={12} width={'30%'} />
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      );

    if (!data && error)
      return (
        <Center gap={12} paddingBlock={24}>
          <Text type={'secondary'}>{t('canvasStorage.loadError')}</Text>
          <Button size={'small'} onClick={() => mutate()}>
            {t('retry', { ns: 'common' })}
          </Button>
        </Center>
      );

    if (!data?.length)
      return (
        <Center paddingBlock={24}>
          <Empty description={t('canvasStorage.empty')} icon={PanelsTopLeftIcon} />
        </Center>
      );

    return (
      <Flexbox gap={2} {...stylex.props(styles.list)}>
        {data.map((item) => (
          <CanvasStorageRow item={item} key={item.canvasId} />
        ))}
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={12}>
      <Text fontSize={13} type={'secondary'}>
        {t('canvasStorage.desc')}
      </Text>
      {renderBody()}
    </Flexbox>
  );
});

CanvasStorageContent.displayName = 'CanvasStorageContent';

export default CanvasStorageContent;
