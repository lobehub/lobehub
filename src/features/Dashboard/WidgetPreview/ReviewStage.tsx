'use client';

import { Badge, Flexbox, Icon, Steps, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReviewStageStep, type ReviewStepState, reviewStepStates } from './reviewSteps';

const styles = stylex.create({
  check: {
    color: cssVar.colorSuccess,
    display: 'inline-flex',
  },
  description: {
    color: cssVar.colorTextDescription,
  },
  root: {
    paddingBlockStart: 8,
  },
});

// The step markers are status dots, not numbered circles: drop the circle so
// the current step reads as the blue live dot the rest of the app uses.
const INDICATOR_STYLE = {
  backgroundColor: 'transparent',
  borderWidth: 0,
  height: 14,
  width: 14,
};
const TITLE_STYLE = { fontSize: 13 };

const StepMarker = ({ state }: { state: ReviewStepState }) => {
  if (state === 'done') {
    return (
      <span {...stylex.props(styles.check)}>
        <Icon icon={CheckIcon} size={14} />
      </span>
    );
  }
  return <Badge status={state === 'current' ? 'processing' : 'default'} />;
};

interface ReviewStageProps {
  /** Under the title: what approving this stage does, or how the previous one went. */
  children?: ReactNode;
  stage: ReviewStageStep;
  title: string;
  version: number;
}

/**
 * A widget asks for approval twice — to dry-run a draft, then to publish it —
 * and both cards review the same widget and version. Without the path and the
 * stage in the heading the second reads as a repeat of the first.
 */
const ReviewStage = memo<ReviewStageProps>(({ children, stage, title, version }) => {
  const { t } = useTranslation('dashboard');
  const steps = reviewStepStates(stage);

  return (
    <Flexbox gap={12} {...stylex.props(styles.root)}>
      <Steps
        aria-label={t('review.stage.label')}
        current={steps.findIndex(({ state }) => state === 'current')}
        styles={{ indicator: INDICATOR_STYLE, title: TITLE_STYLE }}
        items={steps.map(({ state, step }) => ({
          icon: <StepMarker state={state} />,
          key: step,
          title: t(`review.stage.${step}`),
        }))}
      />
      <Flexbox gap={4}>
        <Text weight={600}>{t(`review.title.${stage}`, { title, version })}</Text>
        {children}
      </Flexbox>
    </Flexbox>
  );
});

ReviewStage.displayName = 'DashboardReviewStage';

/** Copy under a review title: the description tone, quieter than the title. */
export const ReviewStageNote = ({ children }: { children: ReactNode }) => (
  <Text fontSize={12} {...stylex.props(styles.description)}>
    {children}
  </Text>
);

export default ReviewStage;
