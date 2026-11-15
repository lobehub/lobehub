'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import type { RecorderSnapshot } from '../engine/controller';

interface LiveStatusAlertProps {
  live: RecorderSnapshot['live'];
  onRetry: () => void;
}

/**
 * Why the live transcript is behind, and what brings it back. Recording is
 * never affected, so every message says so and the catch-up is automatic.
 */
const LiveStatusAlert = ({ live, onRetry }: LiveStatusAlertProps) => {
  const { t } = useTranslation('meeting');
  const navigate = useWorkspaceAwareNavigate();

  if (live.state === 'live' || !live.errorCode) return null;

  const code = live.errorCode;
  const blocked = live.state === 'blocked';

  return (
    <Alert
      data-testid="meeting-live-alert"
      description={t(`live.error.${code}.desc`)}
      title={t(`live.error.${code}.title`)}
      type={blocked ? 'error' : 'warning'}
      action={
        <Flexbox horizontal gap={8}>
          {code === 'provider_not_configured' && (
            <Button size={'small'} onClick={() => navigate('/settings/service-model')}>
              {t('live.openSettings')}
            </Button>
          )}
          <Button size={'small'} type={blocked ? 'primary' : 'default'} onClick={onRetry}>
            {t('live.retryNow')}
          </Button>
        </Flexbox>
      }
    />
  );
};

export default LiveStatusAlert;
