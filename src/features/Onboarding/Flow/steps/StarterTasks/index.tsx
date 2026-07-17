'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { PlayIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import QuoteBanner from '../../QuoteBanner';
import StepCard from '../../StepCard';
import type { OnboardingFlowController } from '../../useOnboardingFlow';
import { styles } from './style';
import TaskRow, { TaskRowSkeleton } from './TaskRow';
import { useStarterTasks } from './useStarterTasks';

const SKELETON_ROW_IDS = ['skeleton-1', 'skeleton-2', 'skeleton-3'];

const StarterTasks = memo<OnboardingFlowController>(({ back, hasPrevious, next }) => {
  const { t } = useTranslation('onboarding');
  const { isLoading, rows, selectedCount, submit, submitting, toggle } = useStarterTasks(next);

  return (
    <StepCard
      continueLoading={submitting}
      description={t('flow.steps.starterTasks.subline')}
      title={t('flow.steps.starterTasks.title')}
      bannerContent={
        <QuoteBanner
          highlight={t('flow.steps.starterTasks.quoteHighlight')}
          quote={t('flow.steps.starterTasks.quote')}
        />
      }
      continueLabel={
        selectedCount > 0
          ? t('flow.steps.starterTasks.addTasks', { count: selectedCount })
          : t('flow.footer.continue')
      }
      titleExtra={
        <Button icon={PlayIcon} shape={'round'} size={'small'} style={{ flex: 'none' }}>
          {t('flow.steps.starterTasks.play')}
        </Button>
      }
      onBack={hasPrevious ? back : undefined}
      onContinue={submit}
    >
      <Flexbox gap={12}>
        <Text className={styles.sectionTitle}>{t('flow.steps.starterTasks.sectionLabel')}</Text>
        <Flexbox gap={4}>
          {isLoading
            ? SKELETON_ROW_IDS.map((id) => <TaskRowSkeleton key={id} />)
            : rows.map((row) => <TaskRow key={row.id} {...row} onToggle={toggle} />)}
        </Flexbox>
      </Flexbox>
    </StepCard>
  );
});

StarterTasks.displayName = 'StarterTasks';

export default StarterTasks;
