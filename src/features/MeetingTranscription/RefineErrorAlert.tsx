'use client';

import type { MeetingErrorCode } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

interface RefineErrorAlertProps {
  code: MeetingErrorCode;
  loading?: boolean;
  onRetry: () => void;
}

/** A failed refine pass: what went wrong, where to fix it, and a retry. */
const RefineErrorAlert = ({ code, loading, onRetry }: RefineErrorAlertProps) => {
  const { t } = useTranslation('meeting');
  const navigate = useWorkspaceAwareNavigate();
  const retryable = code !== 'audio_missing' && code !== 'audio_unsupported';
  // Minutes-stage codes never reach a refine failure; they read as the generic one.
  const description = t(`refine.error.${code}`, {
    defaultValue: t('refine.error.transcription_failed'),
  });

  return (
    <div data-testid="meeting-refine-error">
      <AsyncError
        description={description}
        justify={'start'}
        title={t('refine.error.title')}
        variant={'inline'}
        action={
          <Flexbox horizontal gap={8}>
            {(code === 'provider_not_configured' || code === 'quota_exceeded') && (
              <Button onClick={() => navigate('/settings/service-model')}>
                {t('live.openSettings')}
              </Button>
            )}
            {retryable && (
              <Button loading={loading} onClick={onRetry}>
                {t('refine.retry')}
              </Button>
            )}
          </Flexbox>
        }
      />
    </div>
  );
};

export default RefineErrorAlert;
