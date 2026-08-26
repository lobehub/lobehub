import { Avatar, Tooltip } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';

import type { NodeKind } from '../types';

export const KIND_LABEL: Record<NodeKind, string> = {
  goal: 'GOAL',
  problem: 'PROBLEM',
  work: 'WORK',
  finding: 'FINDING',
  decision: 'DECISION',
};

export const KIND_CN: Record<NodeKind, string> = {
  goal: 'Goal',
  problem: '问题',
  work: 'Work',
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
  spin: css`
    animation: goal-spin 1.2s linear infinite;

    @keyframes goal-spin {
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
