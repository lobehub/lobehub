'use client';

import { Icon, Tag } from '@lobehub/ui';
import dayjs from 'dayjs';
import { CloudIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SaveStatus } from '@/types/saveState';

interface AutoSaveHintProps {
  lastUpdatedTime?: string | Date | null;
  /** Called when the user clicks Retry on a failed save. */
  onRetry?: () => void;
  saveStatus: SaveStatus;
  style?: CSSProperties;
}

/**
 * AutoSaveHint - Unified save status indicator for editors
 *
 * Displays real-time save status for document/config changes. The `failed`
 * state (LOBE-11078 write-side) renders an error tag with an inline Retry so a
 * silent save failure can never masquerade as "Latest version loaded".
 */
const AutoSaveHint = memo<AutoSaveHintProps>(({ style, saveStatus, lastUpdatedTime, onRetry }) => {
  const { t } = useTranslation('editor');

  if (saveStatus === 'saving')
    return (
      <Tag icon={<Icon spin icon={Loader2Icon} />} style={style}>
        {t('autoSave.saving')}
      </Tag>
    );

  if (saveStatus === 'failed')
    return (
      <Tag
        color={'error'}
        icon={<Icon icon={TriangleAlertIcon} />}
        style={{ cursor: onRetry ? 'pointer' : undefined, ...style }}
        onClick={onRetry}
      >
        {t('autoSave.failed')}
        {onRetry ? ` · ${t('autoSave.retry')}` : ''}
      </Tag>
    );

  if (saveStatus === 'saved' && lastUpdatedTime)
    return (
      <Tag icon={<Icon icon={CloudIcon} />} style={style}>
        {t('autoSave.saved')} {dayjs(lastUpdatedTime).fromNow()}
      </Tag>
    );

  return (
    <Tag icon={<Icon icon={CloudIcon} />} style={style}>
      {t('autoSave.latest')}
    </Tag>
  );
});

export default AutoSaveHint;
