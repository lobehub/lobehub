'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import type { OnboardingPhase } from '@/types/user';

interface WrapUpHintProps {
  discoveryUserMessageCount?: number;
  onAfterFinish?: () => Promise<unknown> | void;
  phase?: OnboardingPhase;
}

const MIN_DISCOVERY_MESSAGES_FOR_WRAP_UP = 3;

const isEligible = (phase: OnboardingPhase, discoveryUserMessageCount?: number) => {
  if (phase === 'summary') return true;
  if (phase === 'discovery') {
    return (discoveryUserMessageCount ?? 0) >= MIN_DISCOVERY_MESSAGES_FOR_WRAP_UP;
  }
  return false;
};

const WrapUpHint = memo<WrapUpHintProps>(({ phase, discoveryUserMessageCount, onAfterFinish }) => {
  const { t } = useTranslation('onboarding');
  const refreshUserState = useUserStore((s) => s.refreshUserState);
  const [loading, setLoading] = useState(false);

  if (!phase || !isEligible(phase, discoveryUserMessageCount)) return null;

  const handleWrapUp = () => {
    confirmModal({
      cancelText: t('agent.wrapUp.confirm.cancel'),
      content: t('agent.wrapUp.confirm.content'),
      okText: t('agent.wrapUp.confirm.ok'),
      onOk: async () => {
        setLoading(true);
        try {
          await userService.finishOnboarding();
          await refreshUserState();
          await onAfterFinish?.();
        } finally {
          setLoading(false);
        }
      },
      title: t('agent.wrapUp.confirm.title'),
    });
  };

  return (
    <Flexbox horizontal align={'center'} justify={'center'} paddingBlock={8}>
      <Button loading={loading} size={'small'} type={'text'} onClick={handleWrapUp}>
        {t('agent.wrapUp.action')}
      </Button>
    </Flexbox>
  );
});

WrapUpHint.displayName = 'OnboardingWrapUpHint';

export default WrapUpHint;
