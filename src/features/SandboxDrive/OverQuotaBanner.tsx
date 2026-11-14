'use client';

import { Alert, Button } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { useDriveUsage } from './useDriveData';

/**
 * Said at the top of the drive while it is over a quota the plan does not
 * bill past: then every write, terminal commands included, is refused, and
 * the way out — the space analysis and cleanup — is one click away instead
 * of something to go looking for.
 */
const OverQuotaBanner = memo<{ onCleanup: () => void }>(({ onCleanup }) => {
  const { t } = useTranslation('setting');
  const { data } = useDriveUsage();
  if (!data || data.totalUsageBytes === null || data.overageAllowed) return null;
  if (data.totalUsageBytes <= data.quotaBytes) return null;

  return (
    <Alert
      showIcon
      description={t('drive.cleanup.overQuotaHint')}
      type={'error'}
      action={
        <Button size={'small'} type={'primary'} onClick={onCleanup}>
          {t('drive.cleanup.open')}
        </Button>
      }
      title={t('drive.cleanup.overQuota', {
        size: formatSize(data.totalUsageBytes - data.quotaBytes),
      })}
    />
  );
});

OverQuotaBanner.displayName = 'DriveOverQuotaBanner';

export default OverQuotaBanner;
