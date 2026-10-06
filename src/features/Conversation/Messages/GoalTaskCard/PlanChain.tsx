'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ArrowRight, type LucideIcon, ShieldCheck } from 'lucide-react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { shinyTextStyles } from '@/styles';

import type { GoalCardModel, PlanStep, PlanStepState } from './goalCardModel';

const STEP_VISUAL: Record<
  PlanStepState,
  { color: string; icon?: LucideIcon; labelKey: string; open?: boolean }
> = {
  done: {
    color: TASK_STATUS_VISUALS.completed.color,
    icon: TASK_STATUS_VISUALS.completed.icon,
    labelKey: 'goalProcess.node.done',
  },
  failed: {
    color: TASK_STATUS_VISUALS.failed.color,
    icon: TASK_STATUS_VISUALS.failed.icon,
    labelKey: 'goalTask.status.error',
  },
  lost: {
    color: TASK_STATUS_VISUALS.failed.color,
    icon: TASK_STATUS_VISUALS.failed.icon,
    labelKey: 'goalProcess.tag.lost',
    open: true,
  },
  queued: {
    color: TASK_STATUS_VISUALS.backlog.color,
    icon: TASK_STATUS_VISUALS.backlog.icon,
    labelKey: 'goalTask.step.queued',
  },
  retired: {
    color: TASK_STATUS_VISUALS.canceled.color,
    icon: TASK_STATUS_VISUALS.canceled.icon,
    labelKey: 'goalProcess.tag.retired',
  },
  // Running uses the animated ring shared by every live surface.
  running: {
    color: TASK_STATUS_VISUALS.running.color,
    labelKey: 'goalProcess.node.running',
    open: true,
  },
  stopped: {
    color: TASK_STATUS_VISUALS.canceled.color,
    icon: TASK_STATUS_VISUALS.canceled.icon,
    labelKey: 'goalProcess.node.stopped',
  },
  verifying: {
    color: cssVar.colorInfo,
    icon: ShieldCheck,
    labelKey: 'goalProcess.tag.verifying',
    open: true,
  },
  waiting: {
    color: TASK_STATUS_VISUALS.paused.color,
    icon: TASK_STATUS_VISUALS.paused.icon,
    labelKey: 'goalProcess.node.waiting',
    open: true,
  },
};

const styles = createStaticStyles(({ css }) => ({
  arrow: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
  `,
  more: css`
    flex: none;

    padding-block: 3px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  placeholder: css`
    padding-block: 4px;
    padding-inline: 10px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: 6px;
  `,
  step: css`
    overflow: hidden;

    /* Equal share of the row, so a long first title cannot squeeze the rest to a few characters. */
    flex: 1 1 0;

    min-width: 0;
    max-width: 240px;
    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;
  `,
  stepOpen: css`
    border-color: ${cssVar.colorBorder};
    background: ${cssVar.colorFillTertiary};
  `,
  stepQueued: css`
    border-style: dashed;
  `,
}));

const Step = memo<{ step: PlanStep }>(({ step }) => {
  const { t } = useTranslation('chat');
  const visual = STEP_VISUAL[step.state];
  const title = step.titleKey ? t(step.titleKey as any) : step.title;

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={6}
      title={`${t(visual.labelKey as any)} · ${title}`}
      className={cx(
        styles.step,
        visual.open && styles.stepOpen,
        step.state === 'queued' && styles.stepQueued,
      )}
    >
      {visual.icon ? (
        <Icon color={visual.color} icon={visual.icon} size={13} style={{ flex: 'none' }} />
      ) : (
        <RunningGlyph size={13} />
      )}
      <Text
        ellipsis
        fontSize={12}
        style={{ color: visual.open ? cssVar.colorText : cssVar.colorTextSecondary }}
      >
        {title}
      </Text>
    </Flexbox>
  );
});

Step.displayName = 'GoalPlanStep';

/**
 * The plan as a left-to-right chain of its tasks, each carrying its own state,
 * windowed around the task that is moving so a long plan still reads at a glance.
 */
const PlanChain = memo<{
  model: Pick<GoalCardModel, 'hiddenAfter' | 'hiddenBefore' | 'stage' | 'steps'>;
}>(({ model }) => {
  const { t } = useTranslation('chat');
  const { hiddenAfter, hiddenBefore, stage, steps } = model;

  if (steps.length === 0) {
    if (stage !== 'planning') return null;
    return (
      <Flexbox horizontal className={styles.placeholder} style={{ alignSelf: 'flex-start' }}>
        <Text className={shinyTextStyles.shinyText} fontSize={12}>
          {t('goalTask.plan.drafting')}
        </Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
      {hiddenBefore > 0 && (
        <>
          <span className={styles.more}>+{hiddenBefore}</span>
          <Icon className={styles.arrow} icon={ArrowRight} size={12} />
        </>
      )}
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && <Icon className={styles.arrow} icon={ArrowRight} size={12} />}
          <Step step={step} />
        </Fragment>
      ))}
      {hiddenAfter > 0 && (
        <>
          <Icon className={styles.arrow} icon={ArrowRight} size={12} />
          <span className={styles.more}>+{hiddenAfter}</span>
        </>
      )}
    </Flexbox>
  );
});

PlanChain.displayName = 'GoalPlanChain';

export default PlanChain;
