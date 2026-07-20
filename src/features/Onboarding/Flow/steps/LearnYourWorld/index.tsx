'use client';

import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { CheckIcon, CircleIcon, Loader2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { bannerImages } from '../../bannerImages';
import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import { styles } from './style';
import { useLearnYourWorldAnalysis } from './useLearnYourWorldAnalysis';

const PROGRESS_ICONS = {
  done: CheckIcon,
  pending: CircleIcon,
  running: Loader2Icon,
} as const;

const LearnYourWorld = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const { buttonLabel, facts, progressItems, skeletonCount } = useLearnYourWorldAnalysis();

  return (
    <StepCard
      bannerSrc={bannerImages.learnYourWorld}
      description={t('flow.steps.learnYourWorld.description')}
      title={t('flow.steps.learnYourWorld.title')}
      continueLabel={
        buttonLabel === 'continue'
          ? t('flow.footer.continue')
          : t('flow.steps.learnYourWorld.skipAhead')
      }
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    >
      <Flexbox gap={20}>
        <Flexbox gap={8}>
          {facts.map((fact) => (
            <Text className={styles.fact} key={fact.id}>
              {fact.label}
            </Text>
          ))}
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <Skeleton.Button active className={styles.factSkeleton} key={index} />
          ))}
        </Flexbox>
        <Text className={styles.sectionHint}>{t('flow.steps.learnYourWorld.sectionHint')}</Text>
        <Flexbox gap={12}>
          {progressItems.map((item) => (
            <Flexbox horizontal align={'center'} gap={8} key={item.id}>
              <Icon
                className={item.status === 'done' ? styles.progressIconDone : styles.progressIcon}
                icon={PROGRESS_ICONS[item.status]}
                size={16}
                spin={item.status === 'running'}
              />
              <Text className={styles.progressLabel}>
                {t(`flow.steps.learnYourWorld.progress.${item.id}` as const)}
              </Text>
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    </StepCard>
  );
});

LearnYourWorld.displayName = 'LearnYourWorld';

export default LearnYourWorld;
