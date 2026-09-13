'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const ArchivedBanner = memo(() => {
  const { t } = useTranslation('verify');
  return (
    <Alert
      showIcon={false}
      style={{ fontSize: 12, marginBlock: 4, marginInline: 4 }}
      title={t('acceptance.workspace.archive.banner')}
      type={'warning'}
      variant={'soft'}
    />
  );
});

ArchivedBanner.displayName = 'ArchivedBanner';

export default ArchivedBanner;
