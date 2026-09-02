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
  // LobeHub's theme palette is an 11-step scale, not antd's 10-step one: the
  // primary-strength band sits at x9–x10, and x6/x7 resolve to near-pastel
  // tints (light-mode blue-7 is #93c8ff). x3/x10 gives the glyph a visible
  // tinted tile with a saturated line in both themes.
  decision: { line: cssVar.orange10, soft: cssVar.orange3 },
  finding: { line: cssVar.green10, soft: cssVar.green3 },
  problem: { line: cssVar.purple10, soft: cssVar.purple3 },
  task: { line: cssVar.blue10, soft: cssVar.blue3 },
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
