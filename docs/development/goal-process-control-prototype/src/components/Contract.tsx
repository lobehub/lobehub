import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { Check, CircleDashed } from 'lucide-react';
import { memo } from 'react';

import { usd } from '../model/format';
import type { GoalInfo } from '../types';
import { NewTag, useSharedStyles } from './shared';

/** Requirement + goal-level checks + budget/recovery values (the TaskAcceptance analogue). */
export const Contract = memo<{ goal: GoalInfo }>(({ goal }) => {
  const { styles } = useSharedStyles();
  return (
    <Block variant="outlined" padding={16} gap={12}>
      <Flexbox horizontal justify="space-between" align="flex-start" gap={16}>
        <Text fontSize={13}>{goal.requirement}</Text>
        <Button size="small" type="text">
          编辑{' '}
          <NewTag title="Graph 型目标的 requirement 无更新接口；task 型走 acceptance.saveGoal" />
        </Button>
      </Flexbox>
      <Flexbox gap={6}>
        <Text fontSize={12} weight={600} type="secondary">
          整体验收项（独立 verifier 判定，最终由你确认）
        </Text>
        {goal.checks.map((c) => (
          <Flexbox key={c.label} horizontal gap={8} align="center">
            <Icon
              icon={c.state === 'passed' ? Check : CircleDashed}
              size={14}
              color={c.state === 'passed' ? 'var(--ant-color-success)' : undefined}
            />
            <Text fontSize={13} type={c.state === 'passed' ? undefined : 'secondary'}>
              {c.label}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
      <Flexbox horizontal gap={16} className={styles.mono} wrap="wrap">
        <Text fontSize={12} type="secondary">
          费用上限 {goal.maxTotalCost != null ? usd(goal.maxTotalCost) : '不限'}
        </Text>
        <Text fontSize={12} type="secondary">
          总尝试 {goal.maxRounds ?? '不限'}
        </Text>
        <Text fontSize={12} type="secondary">
          单项最多 {goal.maxAttemptsPerWork} 次
        </Text>
        <Text fontSize={12} type="secondary">
          失联判定 {goal.leaseTimeoutMin} 分钟
        </Text>
      </Flexbox>
    </Block>
  );
});
