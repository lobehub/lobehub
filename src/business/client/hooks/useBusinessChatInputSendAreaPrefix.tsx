'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';
import { createElement, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BillingSourceSwitcher, useAicoBillingChatGate } from '@/features/AicoBilling';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const FundsBlockedAlert = memo(() => {
  const { t } = useTranslation('aico');
  const navigate = useWorkspaceAwareNavigate();
  const { blocked, blockReason, showTrialCta } = useAicoBillingChatGate();

  if (!blocked || !blockReason) return null;

  const message =
    blockReason === 'PERSONAL_FUNDS_UNAVAILABLE' && showTrialCta
      ? t('billing.fundsBlocked.descWithTrial')
      : t(`errors.${blockReason}`);

  return (
    <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
      <Alert
        showIcon
        closable={false}
        description={message}
        title={t('billing.fundsBlocked.title')}
        type="warning"
        action={
          <Flexbox horizontal gap={8} wrap="wrap">
            <Button size="small" type="primary" onClick={() => navigate('/wallet')}>
              {t('billing.fundsBlocked.goWallet')}
            </Button>
            {showTrialCta ? (
              <Button size="small" onClick={() => navigate('/wallet')}>
                {t('billing.fundsBlocked.startTrial')}
              </Button>
            ) : null}
          </Flexbox>
        }
      />
    </Flexbox>
  );
});

FundsBlockedAlert.displayName = 'FundsBlockedAlert';

export const useBusinessChatInputCostEstimateAlert = (): ReactNode => null;

export const useBusinessChatInputAlerts = (): ReactNode => createElement(FundsBlockedAlert);

export const useBusinessChatInputSendDisabled = (): boolean => {
  const { blocked } = useAicoBillingChatGate();
  return blocked;
};

export const getBusinessChatInputSendAreaPrefix = (sendAreaPrefix?: ReactNode): ReactNode => {
  const switcher = createElement(BillingSourceSwitcher);
  if (!sendAreaPrefix) return switcher;

  return createElement(
    Flexbox,
    { align: 'center', gap: 6, horizontal: true },
    switcher,
    sendAreaPrefix,
  );
};

export const useBusinessChatInputSendAreaPrefix = getBusinessChatInputSendAreaPrefix;
