import { Avatar, Icon, Tooltip } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  Clock,
  HandIcon,
  PauseCircle,
} from 'lucide-react';
import { memo } from 'react';

import type { NodeKind } from '../types';

export const KIND_LABEL: Record<NodeKind, string> = {
  goal: 'GOAL',
  problem: 'PROBLEM',
  work: 'WORK',
  finding: 'FINDING',
  decision: 'DECISION',
};

/** User-facing names. The domain says Work; the surface says 任务. */
export const KIND_CN: Record<NodeKind, string> = {
  goal: '目标',
  problem: '问题',
  work: '任务',
  finding: '结论',
  decision: '决策',
};

/** Stable per-kind palette (the user's explicit ask). State is stroke, never fill. */
export const useKindColors = () => {
  const { theme } = useSharedStyles();
  return {
    goal: { line: theme.colorBorder, soft: theme.colorBgContainer },
    problem: { line: theme.purple6, soft: theme.purple1 },
    work: { line: theme.blue6, soft: theme.blue1 },
    finding: { line: theme.green6, soft: theme.green1 },
    decision: { line: theme.orange6, soft: theme.orange1 },
  } as Record<NodeKind, { line: string; soft: string }>;
};

export const useSharedStyles = createStyles(({ css, token }) => ({
  mono: css`
    font-family: ${token.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
  muted: css`
    color: ${token.colorTextTertiary};
  `,
  newTag: css`
    padding-block: 0;
    padding-inline: 4px;
    border: 1px solid ${token.colorWarningBorder};
    border-radius: ${token.borderRadiusXS}px;

    font-family: ${token.fontFamilyCode};
    font-size: 10px;
    line-height: 14px;
    color: ${token.colorWarningText};
    vertical-align: middle;

    background: ${token.colorWarningBg};
  `,
  kindDot: css`
    display: inline-block;
    flex-shrink: 0;

    width: 8px;
    height: 8px;
    border-radius: 2px;
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorBgContainer};
  `,
  sectionHead: css`
    cursor: pointer;
    user-select: none;
  `,
  evidence: css`
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusSM}px;

    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextSecondary};
    white-space: pre-wrap;
  `,
  ring: css`
    animation: goal-ring 0.9s linear infinite;

    @keyframes goal-ring {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

/** Marks an element the business cannot back today (P-05 theatre guard). */
export const NewTag = memo<{ title?: string }>(({ title }) => {
  const { styles } = useSharedStyles();
  return (
    <Tooltip title={title ?? '业务模型里还没有这个概念/事件'}>
      <span className={styles.newTag}>NEW</span>
    </Tooltip>
  );
});

export const KindDot = memo<{ kind: NodeKind }>(({ kind }) => {
  const { styles } = useSharedStyles();
  const colors = useKindColors();
  return <span className={styles.kindDot} style={{ background: colors[kind]?.line }} />;
});

// ── Execution status glyphs — mirrors src/components/ExecutionStatus.ts (TASK_STATUS_VISUALS).
// On move: replace with `TaskStatusIcon` / `RunningGlyph` from the app; keep the same semantics.

export type ExecStatus =
  | 'backlog'
  | 'running'
  | 'completed'
  | 'failed'
  | 'waitingForHuman'
  | 'scheduled'
  | 'paused'
  | 'canceled'
  | 'idle';

const STATUS_VISUALS: Record<ExecStatus, { color: string; icon: LucideIcon }> = {
  backlog: { color: 'var(--ant-color-text-quaternary)', icon: CircleDashed },
  canceled: { color: 'var(--ant-color-text-secondary)', icon: CircleSlash },
  completed: { color: 'var(--ant-color-success)', icon: CircleCheck },
  failed: { color: 'var(--ant-color-error)', icon: CircleX },
  idle: { color: 'var(--ant-color-text-tertiary)', icon: Circle },
  running: { color: 'var(--ant-color-warning)', icon: CircleDot },
  scheduled: { color: 'var(--ant-color-warning)', icon: Clock },
  waitingForHuman: { color: 'var(--ant-color-info)', icon: HandIcon },
  paused: { color: 'var(--ant-color-text-secondary)', icon: PauseCircle },
};

/** The app's RingLoadingIcon look: warning arc over a translucent warning track. */
const RingSpinner = memo<{ size: number }>(({ size }) => {
  const { styles } = useSharedStyles();
  const r = (size - 2) / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={styles.ring}
      style={{ display: 'block' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ant-color-warning)"
        strokeOpacity={0.35}
        strokeWidth={2}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ant-color-warning)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={`${Math.PI * r * 0.6} ${Math.PI * r * 1.4}`}
      />
    </svg>
  );
});

/** One glyph per execution semantic; `live` swaps the static running dot for the ring spinner. */
export const StatusGlyph = memo<{ status: ExecStatus; live?: boolean; size?: number }>(
  ({ status, live, size = 16 }) => {
    if (status === 'running' && live) return <RingSpinner size={size} />;
    const meta = STATUS_VISUALS[status];
    return <Icon icon={meta.icon} size={size} color={meta.color} />;
  },
);

// Heterogeneous CLI agents (Kimi Code / Claude Code / Codex) get their own mark; in the product this
// is the agent's avatar from the agent store.
const AGENT_AVATAR: Record<string, string> = {
  'Kimi Code': '🌙',
  'verify-agent': '🔍',
  'Coding Agent': '🧑‍💻',
  '你': '👤',
  '系统': '⚙️',
  'verifier': '🔍',
  'Agent': '🧑‍💻',
};

export const ActorAvatar = memo<{ name: string; size?: number }>(({ name, size = 20 }) => (
  <Avatar avatar={AGENT_AVATAR[name] ?? '🤖'} size={size} />
));
