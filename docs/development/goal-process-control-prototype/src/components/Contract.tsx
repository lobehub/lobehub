import { Block, Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import {
  Check,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  HelpCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { memo, useState } from 'react';

import { usd } from '../model/format';
import type { GoalCheck, GoalInfo } from '../types';
import { SectionHeader } from './SectionHeader';
import { NewTag, useSharedStyles } from './shared';

// Mirrors TaskAcceptance: section header → body (padding-inline 12, gap 14) → 验收目标 text →
// checklist as CriterionList (Block variant="outlined", rows separated by adjacency, leading status
// icon + C{seq} + title + Required chip). Verdict is a colored icon, never a Tag.
// (src/features/AgentTasks/AgentTaskDetail/TaskAcceptance.tsx + src/features/Verify/CriterionList)

const useStyles = createStyles(({ css, token }) => ({
  body: css`
    padding-inline: 12px;
  `,
  list: css`
    overflow: hidden;
    width: 100%;
    padding: 0;
  `,
  row: css`
    padding-block: 10px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${token.colorBorderSecondary};
    }
  `,
  seq: css`
    flex: none;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  label: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  budget: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
  `,
}));

/** checkHeadMeta — the same state → icon/color table the acceptance checklist uses. */
const checkHeadMeta = (state: GoalCheck['state']) => {
  switch (state) {
    case 'passed':
      return { icon: Check, color: 'var(--ant-color-success)' };
    case 'failed':
      return { icon: XCircle, color: 'var(--ant-color-error)' };
    case 'uncertain':
      return { icon: HelpCircle, color: 'var(--ant-color-warning)' };
    default:
      return { icon: CircleDashed, color: 'var(--ant-color-text-quaternary)' };
  }
};

export const Contract = memo<{ goal: GoalInfo }>(({ goal }) => {
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const [open, setOpen] = useState(false);
  const passed = goal.checks.filter((c) => c.state === 'passed').length;

  return (
    <Flexbox gap={8}>
      <SectionHeader
        icon={ShieldCheck}
        title="目标验收"
        count={goal.checks.length}
        isOpen={open}
        onToggle={() => setOpen(!open)}
        extra={
          <>
            <Button icon={<Icon icon={ExternalLink} />} size="small" type="text">
              验收报告
            </Button>
            <Button size="small" type="text">
              编辑{' '}
              <NewTag title="Graph 型目标的 requirement 无更新接口；task 型走 acceptance.saveGoal" />
            </Button>
          </>
        }
      />
      {open && (
        <Flexbox className={styles.body} gap={14}>
          <Flexbox gap={6}>
            <span className={styles.label}>验收目标</span>
            <Text fontSize={13}>{goal.requirement}</Text>
          </Flexbox>
          <Flexbox gap={7}>
            <Flexbox horizontal align="center" gap={8}>
              <span className={styles.label}>验收清单</span>
              <Text fontSize={11} type="secondary">
                {passed} / {goal.checks.length} 通过
              </Text>
            </Flexbox>
            <Block variant="outlined" className={styles.list}>
              {goal.checks.map((c, i) => {
                const meta = checkHeadMeta(c.state);
                return (
                  <Flexbox key={c.label} horizontal align="center" gap={10} className={styles.row}>
                    <Icon color={meta.color} icon={meta.icon} size={16} style={{ flex: 'none' }} />
                    <span className={styles.seq}>C{i + 1}</span>
                    <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                      {c.label}
                    </Text>
                    <Tag color="info" size="small" variant="filled">
                      必需
                    </Tag>
                  </Flexbox>
                );
              })}
              <Flexbox horizontal gap={16} wrap="wrap" className={cx(styles.budget, shared.mono)}>
                <Text fontSize={12} type="secondary">
                  费用上限 {goal.maxTotalCost == null ? '不限' : usd(goal.maxTotalCost)}
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
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});
