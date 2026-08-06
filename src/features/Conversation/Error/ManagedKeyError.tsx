'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import BaseErrorForm from './BaseErrorForm';

interface ManagedKeyErrorProps {
  /** Called after navigating away (e.g. delete the error message). */
  onNavigate?: () => void;
}

/**
 * Replaces the BYOK "enter custom API key" unlock card for Aico managed mode.
 * Chat uses server-provisioned OpenRouter keys from wallet top-up / org allocate.
 */
const ManagedKeyError = memo<ManagedKeyErrorProps>(({ onNavigate }) => {
  const { t } = useTranslation('aico');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <BaseErrorForm
      avatar={<ProductLogo size={40} type={'flat'} />}
      desc={t('errors.managedKey.description')}
      title={t('errors.managedKey.title', { brandName: BRANDING_NAME })}
      action={
        <Button
          type={'primary'}
          onClick={() => {
            navigate('/wallet');
            onNavigate?.();
          }}
        >
          {t('nav.wallet')}
        </Button>
      }
    />
  );
});

ManagedKeyError.displayName = 'ManagedKeyError';

export default ManagedKeyError;
