'use client';

import { Alert, Button } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ApiAuthLocalOnlyNoticeProps {
  /** Switches the agent back to subscription auth; omitted for read-only callers. */
  onUseSubscription?: () => void;
}

/**
 * API-mode auth runs only on this desktop. Shown beside a non-local
 * environment, where dispatch would reject the run, with the way back to the
 * subscription login that environment can use.
 */
export const ApiAuthLocalOnlyNotice = memo<ApiAuthLocalOnlyNoticeProps>(({ onUseSubscription }) => {
  const { t } = useTranslation(['setting', 'chat']);

  return (
    <Alert
      showIcon
      description={t('chat:heteroAgent.apiMode.localOnly.desc')}
      title={t('chat:heteroAgent.apiMode.localOnly.title')}
      type={'warning'}
      action={
        onUseSubscription ? (
          <Button size="small" onClick={onUseSubscription}>
            {t('heterogeneousStatus.apiMode.useSubscription')}
          </Button>
        ) : undefined
      }
    />
  );
});

ApiAuthLocalOnlyNotice.displayName = 'ApiAuthLocalOnlyNotice';
