'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { useAicoBillingChatGate } from '@/features/AicoBilling';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import BaseErrorForm from './BaseErrorForm';

interface ManagedKeyErrorProps {
  onNavigate?: () => void;
}

const ManagedKeyError = memo<ManagedKeyErrorProps>(({ onNavigate }) => {
  const { t } = useTranslation('aico');
  const navigate = useWorkspaceAwareNavigate();
  const { blockReason, showTrialCta } = useAicoBillingChatGate();

  const goWallet = () => {
    navigate('/wallet');
    onNavigate?.();
  };

  const description =
    blockReason === 'PERSONAL_FUNDS_UNAVAILABLE' && showTrialCta
      ? t('billing.fundsBlocked.descWithTrial')
      : blockReason
        ? t(`errors.${blockReason}`)
        : t('errors.managedKey.description');

  return (
    <BaseErrorForm
      avatar={<ProductLogo size={40} type={'flat'} />}
      desc={description}
      title={t('errors.managedKey.title', { brandName: BRANDING_NAME })}
      action={
        <Flexbox horizontal gap={8} wrap="wrap">
          <Button type={'primary'} onClick={goWallet}>
            {t('billing.fundsBlocked.goWallet')}
          </Button>
          {showTrialCta ? (
            <Button onClick={goWallet}>{t('billing.fundsBlocked.startTrial')}</Button>
          ) : null}
        </Flexbox>
      }
    />
  );
});

ManagedKeyError.displayName = 'ManagedKeyError';

export default ManagedKeyError;
