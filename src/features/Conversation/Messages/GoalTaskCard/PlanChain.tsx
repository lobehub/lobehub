'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, type LucideIcon, ShieldCheck } from 'lucide-react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { TASK_HOLD_VISUALS } from '@/features/AgentGoals/ProcessControl/taskHold';
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
  stalled: {
    ...TASK_HOLD_VISUALS.stalled,
    labelKey: 'goalProcess.tag.stalled',
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
  waitingQuota: {
    ...TASK_HOLD_VISUALS.waitingQuota,
    labelKey: 'goalProcess.tag.waitingQuota',
    open: true,
  },
};

const styles = stylex.create({
  arrow: { flex: 'none', color: cssVar.colorTextQuaternary },
  more: {
    flex: 'none',
    paddingBlock: '3px',
    paddingInline: '8px',
    borderRadius: '6px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  placeholder: {
    paddingBlock: '4px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: '6px',
  },
  step: {
    overflow: 'hidden',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0',
    minWidth: '0',
    maxWidth: '240px',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '6px',
  },
  stepOpen: {
    borderColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  stepQueued: { borderStyle: 'dashed' },
});

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
      className={
        stylex.props(
          styles.step,
          visual.open && styles.stepOpen,
          step.state === 'queued' && styles.stepQueued,
        ).className
      }
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
      <Flexbox
        horizontal
        className={stylex.props(styles.placeholder).className}
        style={{ alignSelf: 'flex-start' }}
      >
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
          <span {...stylex.props(styles.more)}>+{hiddenBefore}</span>
          <Icon className={stylex.props(styles.arrow).className} icon={ArrowRight} size={12} />
        </>
      )}
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && (
            <Icon className={stylex.props(styles.arrow).className} icon={ArrowRight} size={12} />
          )}
          <Step step={step} />
        </Fragment>
      ))}
      {hiddenAfter > 0 && (
        <>
          <Icon className={stylex.props(styles.arrow).className} icon={ArrowRight} size={12} />
          <span {...stylex.props(styles.more)}>+{hiddenAfter}</span>
        </>
      )}
    </Flexbox>
  );
});

PlanChain.displayName = 'GoalPlanChain';

export default PlanChain;
