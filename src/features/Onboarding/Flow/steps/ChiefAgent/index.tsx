'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import AvatarGrid from './AvatarGrid';
import IdentityPanel from './IdentityPanel';
import { styles } from './style';
import { useChiefAgent } from './useChiefAgent';

const ChiefAgent = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const { avatar, handle, hire, hiring, name, setAvatar, setName } = useChiefAgent({ next });

  return (
    <StepCard
      continueLabel={t('flow.steps.chiefAgent.hire')}
      continueLoading={hiring}
      title={t('flow.steps.chiefAgent.title')}
      onBack={hasPrevious ? back : undefined}
      onContinue={hire}
    >
      <Flexbox gap={16}>
        <IdentityPanel avatar={avatar} handle={handle} name={name} onNameChange={setName} />
        <Flexbox gap={8}>
          <Text className={styles.gridLabel}>{t('flow.steps.chiefAgent.hint')}</Text>
          <AvatarGrid value={avatar} onChange={setAvatar} />
        </Flexbox>
      </Flexbox>
    </StepCard>
  );
});

ChiefAgent.displayName = 'ChiefAgent';

export default ChiefAgent;
