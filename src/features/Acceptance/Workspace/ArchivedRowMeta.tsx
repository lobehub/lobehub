'use client';

import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { useAcceptancePurgePreview } from '../hooks';
import { ACCEPTANCE_ARCHIVE_WARNING_DAYS, archiveDaysLeft } from './acceptanceArchive';

const ArchivedRowMeta = memo<{ acceptanceId: string; archivedAt: Date | string }>(
  ({ acceptanceId, archivedAt }) => {
    const { t } = useTranslation('verify');
    const { data: preview } = useAcceptancePurgePreview(acceptanceId);
    const days = archiveDaysLeft(archivedAt);
    if (!preview) return null;

    return (
      <span
        style={{
          color: cssVar.colorTextTertiary,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {`${t('acceptance.workspace.archive.rounds', { count: preview.rounds })} · ${formatSize(preview.bytes)} · `}
        <span
          style={
            days <= ACCEPTANCE_ARCHIVE_WARNING_DAYS ? { color: cssVar.colorWarning } : undefined
          }
        >
          {t('acceptance.workspace.archive.daysLeft', { count: days })}
        </span>
      </span>
    );
  },
);

ArchivedRowMeta.displayName = 'ArchivedRowMeta';

export default ArchivedRowMeta;
