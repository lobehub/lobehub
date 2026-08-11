'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { useAicoBillingChatGate, useAicoBillingSources } from '@/features/AicoBilling';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import BaseErrorForm from './BaseErrorForm';
import {
  resolveManagedKeyErrorDescription,
  shouldShowManagedKeyTrialActions,
} from './resolveManagedKeyErrorDescription';

interface ManagedKeyErrorProps {
  onNavigate?: () => void;
  /**
   * `funds` — wallet / managed-key provisioning (default).
   * `wrongProvider` — agent is on a BYOK provider (openai/google/…) while Aico
   * is in managed OpenRouter mode.
   */
  reason?: 'funds' | 'wrongProvider';
  /** Aico error code from the failed chat response (e.g. MEMBER_BUDGET_UNFUNDED). */
  serverErrorCode?: string;
}

const ManagedKeyError = memo<ManagedKeyErrorProps>(
  ({ onNavigate, reason = 'funds', serverErrorCode }) => {
    const { t } = useTranslation('aico');
    const navigate = useWorkspaceAwareNavigate();
    const { blockReason, showTrialCta } = useAicoBillingChatGate();
    const { activeSource } = useAicoBillingSources();

    const goWallet = () => {
      navigate('/wallet');
      onNavigate?.();
    };

    if (reason === 'wrongProvider') {
      return (
        <BaseErrorForm
          avatar={<ProductLogo size={40} type={'flat'} />}
          desc={t('errors.managedKey.wrongProviderDescription', { brandName: BRANDING_NAME })}
          title={t('errors.managedKey.wrongProviderTitle', { brandName: BRANDING_NAME })}
          action={
            <Button type={'primary'} onClick={() => onNavigate?.()}>
              {t('errors.managedKey.wrongProviderAction')}
            </Button>
          }
        />
      );
    }

    const description = resolveManagedKeyErrorDescription({
      activeSource,
      blockReason,
      serverErrorCode,
      showTrialCta,
      t,
    });

    const showTrialActions = shouldShowManagedKeyTrialActions({
      activeSource,
      blockReason,
      serverErrorCode,
      showTrialCta,
    });

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
            {showTrialActions ? (
              <Button onClick={goWallet}>{t('billing.fundsBlocked.startTrial')}</Button>
            ) : null}
          </Flexbox>
        }
      />
    );
  },
);

ManagedKeyError.displayName = 'ManagedKeyError';

export default ManagedKeyError;
