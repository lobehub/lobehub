import { Avatar, Button, Flexbox, Icon, InputNumber, Modal, Popover, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Coins, Pause, Play, RotateCcw } from 'lucide-react';
import { memo, useState } from 'react';

import { clock, duration, usd } from '../model/format';
import { type Frontier, countAttempts, goalSentence } from '../model/frontier';
import type { GoalState } from '../types';
import { NewTag, useSharedStyles } from './shared';

// Mirrors the top of TaskDetailPage: TaskDetailTitleInput · run/pause action · TaskProperties column.

const useStyles = createStyles(({ css, token }) => ({
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
  propRow: css`
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 8px;
    align-items: center;

    min-height: 28px;
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
    const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
      <div className={styles.propRow}>
        <Text fontSize={12} type="secondary">
          {label}
        </Text>
        <div>{children}</div>
      </div>
    );

    return (
      <Flexbox gap={16}>
        <input className={styles.title} defaultValue={goal.title} />
        <Flexbox horizontal gap={24} align="flex-start" justify="space-between">
          <Flexbox gap={12} flex={1} style={{ minWidth: 240 }}>
            <Flexbox horizontal gap={8} align="center" wrap="wrap">
              <RunPauseAction
                state={state}
                onStart={onStart}
                onPause={onPause}
                onResume={onResume}
              />
              {goal.startedAt && (
                <Text fontSize={12} className={shared.muted}>
                  已进行 {duration(clock.now - goal.startedAt)}
                </Text>
              )}
            </Flexbox>
            <Text fontSize={13} type="secondary">
              {goal.requirement}
            </Text>
          </Flexbox>
          <Flexbox gap={2} style={{ width: 300, flexShrink: 0 }}>
            <Row label="状态">
              <Text
                fontSize={13}
                type={
                  frontier.needsYou ? 'warning' : goal.status === 'achieved' ? 'success' : undefined
                }
                weight={frontier.needsYou ? 600 : undefined}
              >
                {goalSentence(goal, frontier)}
              </Text>
            </Row>
            <Row label="费用">
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
                <Text
                  fontSize={13}
                  className={shared.mono}
                  type={overCost ? 'warning' : undefined}
                  style={{ cursor: 'pointer' }}
                >
                  {usd(goal.spent)} / {goal.maxTotalCost != null ? usd(goal.maxTotalCost) : '不限'}{' '}
                  <Icon icon={Coins} size={12} />
                </Text>
              </Popover>
            </Row>
            <Row label="尝试">
              <Text fontSize={13} className={shared.mono}>
                {attempts} / {goal.maxRounds ?? '∞'}{' '}
                <Text fontSize={12} className={shared.muted}>
                  · 单项最多 {goal.maxAttemptsPerWork}
                </Text>
              </Text>
            </Row>
            <Row label="验收">
              <Text
                fontSize={13}
                className={shared.mono}
                type={passed === goal.checks.length ? 'success' : undefined}
              >
                {passed} / {goal.checks.length} 项通过
              </Text>
            </Row>
            <Row label="负责">
              <Flexbox horizontal gap={6} align="center">
                <Avatar avatar="🧑‍💻" size={18} />
                <Text fontSize={13}>{goal.agent}</Text>
              </Flexbox>
            </Row>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);
