'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReviewStageStep, reviewStepStates } from './reviewSteps';

const styles = stylex.create({
  current: {
    color: cssVar.colorText,
    fontWeight: 600,
  },
  done: {
    color: cssVar.colorTextTertiary,
  },
  check: {
    color: cssVar.colorSuccess,
    display: 'inline-flex',
  },
  dot: {
    backgroundColor: cssVar.colorPrimary,
    borderRadius: '50%',
    height: 6,
    width: 6,
  },
  separator: {
    color: cssVar.colorTextQuaternary,
    display: 'inline-flex',
  },
  step: {
    alignItems: 'center',
    display: 'inline-flex',
    fontSize: 12,
    gap: 4,
    lineHeight: '20px',
  },
  upcoming: {
    color: cssVar.colorTextQuaternary,
  },
});

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

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} aria-label={t('review.stage.label')} gap={6}>
        {reviewStepStates(stage).map(({ state, step }, index) => (
          <Fragment key={step}>
            {index > 0 && (
              <span {...stylex.props(styles.separator)}>
                <Icon icon={ChevronRightIcon} size={12} />
              </span>
            )}
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              {...stylex.props(styles.step, styles[state])}
            >
              {state === 'done' && (
                <span {...stylex.props(styles.check)}>
                  <Icon icon={CheckIcon} size={12} />
                </span>
              )}
              {state === 'current' && <span {...stylex.props(styles.dot)} />}
              {t(`review.stage.${step}`)}
            </span>
          </Fragment>
        ))}
      </Flexbox>
      <Text weight={600}>{t(`review.title.${stage}`, { title, version })}</Text>
      {children}
    </Flexbox>
  );
});

ReviewStage.displayName = 'DashboardReviewStage';

export default ReviewStage;
