'use client';

import { Icon, Tag } from '@lobehub/ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { CloudIcon, Loader2Icon } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

dayjs.extend(relativeTime);

interface AutoSaveHintProps {
  lastUpdatedTime?: string | Date | null;
  saveStatus: 'idle' | 'saving' | 'saved';
  style?: CSSProperties;
}

/**
 * AutoSaveHint - Unified save status indicator for editors
 *
 * Displays real-time save status for document/config changes
 */
const AutoSaveHint = memo<AutoSaveHintProps>(({ style, saveStatus, lastUpdatedTime }) => {
  const { t } = useTranslation('editor');

  const isSaving = saveStatus === 'saving';

  if (isSaving)
    return (
      <Tag icon={<Icon spin icon={Loader2Icon} />} style={style}>
        {t('autoSave.saving')}
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
