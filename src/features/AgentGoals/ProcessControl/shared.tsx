import type { GoalNodeKind } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleHelp, GitBranch, Lightbulb, ListChecks, type LucideIcon } from 'lucide-react';
import { memo } from 'react';

/**
 * One palette per node kind, used by both the graph cards and the inline
 * references in the frontier / findings / activity lists, so the same node
 * reads the same everywhere. State is carried by stroke and glyph, never by
 * filling a node with its status color.
 */
export const KIND_COLOR: Record<GoalNodeKind, { line: string; soft: string }> = {
  decision: { line: cssVar.orange6, soft: cssVar.orange1 },
  finding: { line: cssVar.green6, soft: cssVar.green1 },
  problem: { line: cssVar.purple6, soft: cssVar.purple1 },
  task: { line: cssVar.blue6, soft: cssVar.blue1 },
};

export const KIND_ICON: Record<GoalNodeKind, LucideIcon> = {
  decision: GitBranch,
  finding: Lightbulb,
  problem: CircleHelp,
  task: ListChecks,
};

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    display: inline-block;
    flex: none;

    width: 8px;
    height: 8px;
    border-radius: 2px;
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
}));

export const monoClass = styles.mono;

export const KindDot = memo<{ kind: GoalNodeKind }>(({ kind }) => (
  <span className={styles.dot} style={{ background: KIND_COLOR[kind].line }} />
));

KindDot.displayName = 'GoalKindDot';

export const MonoText = memo<{ children: React.ReactNode; title?: string }>(
  ({ children, title }) => (
    <Text className={styles.mono} fontSize={12} title={title} type={'secondary'}>
      {children}
    </Text>
  ),
);

MonoText.displayName = 'GoalMonoText';

export const KindIcon = memo<{ kind: GoalNodeKind; size?: number }>(({ kind, size = 14 }) => (
  <Icon color={KIND_COLOR[kind].line} icon={KIND_ICON[kind]} size={size} />
));

KindIcon.displayName = 'GoalKindIcon';
