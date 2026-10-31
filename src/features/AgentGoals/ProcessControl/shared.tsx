import { Icon, Text } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Boxes,
  CircleHelp,
  FlaskConical,
  GitBranch,
  Lightbulb,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import type { GoalGraphNodeKind } from '../Experiments/model';

/**
 * One palette per node kind, used by both the graph cards and the inline
 * references in the frontier / findings / activity lists, so the same node
 * reads the same everywhere. State is carried by stroke and glyph, never by
 * filling a node with its status color.
 */
export const KIND_COLOR: Record<GoalGraphNodeKind, { line: string; soft: string }> = {
  // LobeHub's theme palette is an 11-step scale, not antd's 10-step one: the
  // primary-strength band sits at x9–x10, and x6/x7 resolve to near-pastel
  // tints (light-mode blue-7 is #93c8ff). x3/x10 gives the glyph a visible
  // tinted tile with a saturated line in both themes.
  // A batch is one repeated mould delivered as a class; geekblue keeps it
  // distinct from the single `task` blue while sitting beside the experiment cyan.
  batch: { line: cssVar.geekblue10, soft: cssVar.geekblue3 },
  decision: { line: cssVar.orange10, soft: cssVar.orange3 },
  experiment: { line: cssVar.cyan10, soft: cssVar.cyan3 },
  finding: { line: cssVar.green10, soft: cssVar.green3 },
  problem: { line: cssVar.purple10, soft: cssVar.purple3 },
  task: { line: cssVar.blue10, soft: cssVar.blue3 },
};

/**
 * A batch's release gate is where a person steps in when the batch breaks, so
 * it wears the cyan the product uses for "a person decides here" — not the
 * decision orange, and not a red that reads as an error.
 */
export const GATE_COLOR = { line: cssVar.cyan10, soft: cssVar.cyan3 };

/**
 * A batch's execution plan kept as a skill in the user's library. It is the
 * graph's `finding` node underneath, but it reads as a skill — the thing every
 * unit loads — not as a conclusion. It wears the color skills wear everywhere
 * else (the chat input's skill tags), so it reads as the same thing.
 */
export const SKILL_COLOR = { line: cssVar.colorSuccess, soft: cssVar.colorSuccessBg };
export const SKILL_ICON = SkillsIcon as unknown as LucideIcon;

export const KIND_ICON: Record<GoalGraphNodeKind, LucideIcon> = {
  batch: Boxes,
  decision: GitBranch,
  experiment: FlaskConical,
  finding: Lightbulb,
  problem: CircleHelp,
  task: ListChecks,
};

const styles = stylex.create({
  dot: { display: 'inline-block', flex: 'none', width: '8px', height: '8px', borderRadius: '2px' },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
});

export const KindDot = memo<{ kind: GoalGraphNodeKind }>(({ kind }) => (
  <span {...sx([styles.dot], undefined, { background: KIND_COLOR[kind].line })} />
));

KindDot.displayName = 'GoalKindDot';

export const MonoText = memo<{ children: React.ReactNode; title?: string }>(
  ({ children, title }) => (
    <Text
      className={stylex.props(styles.mono).className}
      fontSize={12}
      title={title}
      type={'secondary'}
    >
      {children}
    </Text>
  ),
);

MonoText.displayName = 'GoalMonoText';

export const KindIcon = memo<{ kind: GoalGraphNodeKind; size?: number }>(({ kind, size = 14 }) => (
  <Icon color={KIND_COLOR[kind].line} icon={KIND_ICON[kind]} size={size} />
));

KindIcon.displayName = 'GoalKindIcon';
