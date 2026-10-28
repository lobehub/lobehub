'use client';

import { formatSize } from '@lobechat/utils/format';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelsTopLeftIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openCanvasStorageModal } from './openModal';
import { summarizeCanvasStorage, useFetchCanvasStorage } from './useCanvasStorage';

const styles = stylex.create({
  entry: {
    flex: 'none',
    marginBlockStart: '4px',
    marginBlockEnd: '8px',
    marginInline: '16px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    fontSize: '13px',
    color: cssVar.colorTextSecondary,
  },
});

/**
 * The Drive's way to the storage canvases hold. Canvas files count toward file
 * usage but are never listed as files, so without this a full quota has no
 * visible cause. Renders only while canvases hold storage.
 */
const CanvasStorageEntry = memo(() => {
  const { t } = useTranslation('file');
  const { data } = useFetchCanvasStorage();

  const summary = summarizeCanvasStorage(data);
  if (!summary) return null;

  return (
    <Flexbox horizontal align={'center'} gap={10} {...stylex.props(styles.entry)}>
      <Icon color={cssVar.colorTextTertiary} icon={PanelsTopLeftIcon} size={16} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        {t('canvasStorage.entry.desc', {
          count: summary.count,
          size: formatSize(summary.totalSize),
        })}
      </Flexbox>
      <Button size={'small'} onClick={() => openCanvasStorageModal()}>
        {t('canvasStorage.entry.manage')}
      </Button>
    </Flexbox>
  );
});

CanvasStorageEntry.displayName = 'CanvasStorageEntry';

export default CanvasStorageEntry;
