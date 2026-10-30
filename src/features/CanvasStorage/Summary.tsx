'use client';

import { formatSize } from '@lobechat/utils/format';
import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type CanvasStorageSummary as Summary,
  useCleanOrphanCanvasFiles,
} from './useCanvasStorage';

const styles = stylex.create({
  text: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
});

interface CanvasStorageSummaryProps {
  summary: Summary;
}

/**
 * How much file storage the caller's canvases hold, above the canvas cards.
 * Leftover files of canvases whose Work is gone have no card, so they are
 * named here with their own cleanup.
 */
const CanvasStorageSummary = memo<CanvasStorageSummaryProps>(({ summary }) => {
  const { t } = useTranslation('file');
  const cleanOrphans = useCleanOrphanCanvasFiles();

  if (summary.canvasCount === 0 && summary.orphans.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
      {summary.canvasCount > 0 && (
        <span {...stylex.props(styles.text)}>
          {t('canvasStorage.summary', {
            count: summary.canvasCount,
            size: formatSize(summary.canvasSize),
          })}
        </span>
      )}
      {summary.orphans.length > 0 && (
        <>
          {summary.canvasCount > 0 && <span {...stylex.props(styles.text)}>·</span>}
          <span {...stylex.props(styles.text)}>
            {t('canvasStorage.orphan.desc', { size: formatSize(summary.orphanSize) })}
          </span>
          <Button size={'small'} type={'link'} onClick={() => cleanOrphans(summary.orphans)}>
            {t('canvasStorage.orphan.clean')}
          </Button>
        </>
      )}
    </Flexbox>
  );
});

CanvasStorageSummary.displayName = 'CanvasStorageSummary';

export default CanvasStorageSummary;
