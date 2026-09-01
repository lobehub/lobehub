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
  // x2/x7 rather than x1/x6: on a light canvas the x1 tint is close to white,
  // and the kind glyph — the card's identity mark — washed out with it.
  decision: { line: cssVar.orange7, soft: cssVar.orange2 },
  finding: { line: cssVar.green7, soft: cssVar.green2 },
  problem: { line: cssVar.purple7, soft: cssVar.purple2 },
  task: { line: cssVar.blue7, soft: cssVar.blue2 },
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
