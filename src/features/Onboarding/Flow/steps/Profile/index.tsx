'use client';

import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import { styles } from './style';
import { createSupplementModal } from './SupplementModal';
import { useProfile } from './useProfile';

const Profile = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const { isLoading, profile } = useProfile();

  return (
    <StepCard
      description={profile?.subtitle}
      title={profile?.name ?? t('flow.steps.profile.title')}
      titleExtra={
        <Button
          className={styles.tellUsMore}
          shape={'round'}
          size={'small'}
          onClick={() => createSupplementModal()}
        >
          {t('flow.steps.profile.tellUsMore')}
        </Button>
      }
      onBack={hasPrevious ? back : undefined}
      onContinue={next}
    >
      <Flexbox className={styles.scrollArea} gap={20}>
        {isLoading ? (
          <Flexbox gap={8}>
            <Skeleton.Button active className={styles.sectionSkeleton} />
            <Skeleton.Button active className={styles.sectionSkeleton} />
            <Skeleton.Button active className={styles.sectionSkeleton} />
          </Flexbox>
        ) : !profile ? (
          <Text className={styles.emptyState}>{t('flow.steps.profile.empty')}</Text>
        ) : (
          <>
            <Flexbox gap={8}>
              <Text className={styles.sectionTitle}>{t('flow.steps.profile.tagline')}</Text>
              <Text className={styles.paragraph}>{profile.tagline}</Text>
            </Flexbox>
            <Flexbox gap={8}>
              <Text className={styles.sectionTitle}>{t('flow.steps.profile.identity')}</Text>
              {profile.identity.map((paragraph, index) => (
                <Text className={styles.paragraph} key={index}>
                  {paragraph}
                </Text>
              ))}
            </Flexbox>
          </>
        )}
      </Flexbox>
    </StepCard>
  );
});

Profile.displayName = 'Profile';

export default Profile;
