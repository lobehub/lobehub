'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import AvatarGrid from './AvatarGrid';
import IdentityPanel from './IdentityPanel';
import { useChiefAgent } from './useChiefAgent';

const ChiefAgent = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const { avatar, handle, hire, hiring, name, setAvatar, setName } = useChiefAgent({ next });

  return (
    <StepCard
      hideBanner
      bodyStyle={{ padding: 12 }}
      continueLabel={t('flow.steps.chiefAgent.hire')}
      continueLoading={hiring}
      footerHint={`💡 ${t('flow.steps.chiefAgent.hint')}`}
      onContinue={hire}
    >
      <Flexbox gap={16}>
        <IdentityPanel
          avatar={avatar}
          handle={handle}
          name={name}
          onBack={hasPrevious ? back : undefined}
          onNameChange={setName}
        />
        <AvatarGrid value={avatar} onChange={setAvatar} />
      </Flexbox>
    </StepCard>
  );
});

ChiefAgent.displayName = 'ChiefAgent';

export default ChiefAgent;
