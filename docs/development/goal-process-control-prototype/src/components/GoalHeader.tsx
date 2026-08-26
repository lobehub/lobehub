import { Button, Flexbox, Icon, InputNumber, Modal, Popover, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { createStyles } from 'antd-style';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { memo, useState } from 'react';

import { clock, duration, elapsed, usd } from '../model/format';
import { type Frontier, countAttempts, goalSentence } from '../model/frontier';
import type { GoalState } from '../types';
import { NewTag, useSharedStyles } from './shared';

// Mirrors the shipped Goal detail header (src/features/AgentGoals/GoalDetailPage.tsx):
// title → description → a row of metric cells (18px value / 12px label, separated by a left border)
// → the requirement block. The run/pause control sits with the metrics; budget is edited from the
// 费用 cell.

const useStyles = createStyles(({ css, token }) => ({
  header: css`
    padding-block: 8px 4px;
  `,
  title: css`
    width: 100%;
    padding: 0;
    border: none;

    font-size: 24px;
    font-weight: 600;
    line-height: 1.3;
    color: ${token.colorText};

    background: transparent;
    outline: none;
  `,
  metric: css`
    min-width: 112px;

    & + & {
      padding-inline-start: 18px;
      border-inline-start: 1px solid ${token.colorBorderSecondary};
    }
  `,
  clickable: css`
    cursor: pointer;
  `,
}));

interface GoalHeaderProps {
  state: GoalState;
  frontier: Frontier;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onSetBudget: (v: { rounds: number | null; cost: number | null; perWork: number }) => void;
}

const RunPauseAction = ({
  state,
  onStart,
  onPause,
  onResume,
}: Omit<GoalHeaderProps, 'frontier' | 'onSetBudget'>) => {
  const [open, setOpen] = useState(false);
  const { goal } = state;
  if (['achieved', 'failed', 'canceled'].includes(goal.status))
    return (
      <Button size="small" icon={<Icon icon={RotateCcw} />}>
        重新打开 <NewTag title="终态目标无 reopen 事件" />
      </Button>
    );
  if (goal.status === 'planning')
    return (
      <Button type="primary" size="small" icon={<Icon icon={Play} />} onClick={onStart}>
        开始执行
      </Button>
    );
  if (goal.status === 'paused')
    return (
      <Button type="primary" size="small" icon={<Icon icon={Play} />} onClick={onResume}>
        继续
      </Button>
    );
  return (
    <>
      <Button size="small" icon={<Icon icon={Pause} />} onClick={() => setOpen(true)}>
        暂停
      </Button>
      <Modal
        open={open}
        title="暂停这个目标？"
        okText="暂停"
        cancelText="取消"
        onCancel={() => setOpen(false)}
        onOk={() => {
          setOpen(false);
          onPause();
        }}
      >
        <Flexbox gap={8}>
          <Text>
            暂停后不会再开始新的尝试；正在进行的尝试会跑到它自己结束为止，期间的费用仍会计入。
          </Text>
          <Text type="secondary" fontSize={13}>
            随时可以点「继续」恢复。立刻中断正在执行的 Agent 目前还做不到{' '}
            <NewTag title="AbortSignal 未接入 runtime；红线" />。
          </Text>
        </Flexbox>
      </Modal>
    </>
  );
};

const Metric = memo<{ label: string; children: React.ReactNode; onClick?: () => void }>(
  ({ label, children, onClick }) => {
    const { styles, cx } = useStyles();
    return (
      <Flexbox className={cx(styles.metric, onClick && styles.clickable)} gap={2} onClick={onClick}>
        {children}
        <Text fontSize={12} type="secondary">
          {label}
        </Text>
      </Flexbox>
    );
  },
);

export const GoalHeader = memo<GoalHeaderProps>(
  ({ state, frontier, onStart, onPause, onResume, onSetBudget }) => {
    const { styles } = useStyles();
    const { styles: shared } = useSharedStyles();
    const { goal } = state;
    const [budgetOpen, setBudgetOpen] = useState(false);
    const [rounds, setRounds] = useState<number | null>(goal.maxRounds);
    const [cost, setCost] = useState<number | null>(goal.maxTotalCost);
    const [perWork, setPerWork] = useState(goal.maxAttemptsPerWork);
    const overCost = goal.maxTotalCost != null && goal.spent >= goal.maxTotalCost;
    const passed = goal.checks.filter((c) => c.state === 'passed').length;
    const attempts = countAttempts(state);
    const progress = goal.checks.length ? Math.round((passed / goal.checks.length) * 100) : 0;
    const running = goal.nodes ? 0 : 0;

    return (
      <Flexbox className={styles.header} gap={8}>
        <Flexbox gap={5}>
          <input className={styles.title} defaultValue={goal.title} />
          <Text fontSize={15} style={{ lineHeight: 1.65 }}>
            {goal.requirement}
          </Text>
        </Flexbox>

        <Flexbox horizontal gap={18} wrap="wrap" align="center" paddingBlock={'6px 0'}>
          <Metric label="验收进度">
            <Flexbox horizontal align="center" gap={7}>
              <Progress
                percent={progress}
                showInfo={false}
                size={24}
                strokeColor="var(--ant-color-success)"
                type="circle"
              />
              <Text fontSize={18} weight={600}>
                {passed}/{goal.checks.length}
              </Text>
            </Flexbox>
          </Metric>
          <Metric label={frontier.needsYou > 0 ? '状态 · 需要你' : '状态'}>
            <Text
              fontSize={18}
              weight={600}
              type={
                frontier.needsYou ? 'warning' : goal.status === 'achieved' ? 'success' : undefined
              }
            >
              {goalSentence(goal, frontier)}
            </Text>
          </Metric>
          <Metric label="已进行">
            <Text fontSize={18} weight={600}>
              {goal.startedAt ? duration(clock.now - goal.startedAt) : '—'}
            </Text>
          </Metric>
          <Metric label={`尝试 · 单项最多 ${goal.maxAttemptsPerWork}`}>
            <Text fontSize={18} weight={600}>
              {attempts}
              <Text fontSize={13} type="secondary">
                {' '}
                / {goal.maxRounds ?? '∞'}
              </Text>
            </Text>
          </Metric>
          <Popover
            open={budgetOpen}
            onOpenChange={setBudgetOpen}
            trigger="click"
            content={
              <Flexbox gap={12} style={{ width: 260 }} padding={4}>
                <Text weight={600}>预算与保护</Text>
                <Flexbox gap={8}>
                  <Flexbox horizontal justify="space-between" align="center">
                    <Text fontSize={13}>总费用上限</Text>
                    <InputNumber
                      value={cost}
                      min={0}
                      step={1}
                      prefix="$"
                      onChange={(v) => setCost(v == null ? null : Number(v))}
                      style={{ width: 110 }}
                      placeholder="不限"
                    />
                  </Flexbox>
                  <Flexbox horizontal justify="space-between" align="center">
                    <Text fontSize={13}>总尝试次数</Text>
                    <InputNumber
                      value={rounds}
                      min={1}
                      onChange={(v) => setRounds(v == null ? null : Number(v))}
                      style={{ width: 110 }}
                      placeholder="不限"
                    />
                  </Flexbox>
                  <Flexbox horizontal justify="space-between" align="center">
                    <Text fontSize={13}>单项任务最多尝试</Text>
                    <InputNumber
                      value={perWork}
                      min={1}
                      onChange={(v) => setPerWork(Number(v ?? 1))}
                      style={{ width: 110 }}
                    />
                  </Flexbox>
                </Flexbox>
                <Text fontSize={12} type="secondary">
                  超过任一上限时目标会自动停下并来问你，不会静默继续花钱。
                </Text>
                <Flexbox horizontal justify="flex-end" gap={8}>
                  <Button size="small" onClick={() => setBudgetOpen(false)}>
                    取消
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                      onSetBudget({ rounds, cost, perWork });
                      setBudgetOpen(false);
                    }}
                  >
                    保存
                  </Button>
                </Flexbox>
              </Flexbox>
            }
          >
            <div>
              <Metric
                label={`费用 · 上限 ${goal.maxTotalCost == null ? '不限' : usd(goal.maxTotalCost)}`}
                onClick={() => setBudgetOpen(true)}
              >
                <Text
                  fontSize={18}
                  weight={600}
                  className={shared.mono}
                  type={overCost ? 'warning' : undefined}
                >
                  {usd(goal.spent)}
                </Text>
              </Metric>
            </div>
          </Popover>
          <Flexbox style={{ marginLeft: 'auto' }}>
            <RunPauseAction state={state} onStart={onStart} onPause={onPause} onResume={onResume} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);
