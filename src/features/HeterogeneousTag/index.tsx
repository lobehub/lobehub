import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import { Tag } from '@lobehub/ui';
import type { CSSProperties } from 'react';
import { memo } from 'react';

interface HeterogeneousTagProps {
  style?: CSSProperties;
  /**
   * Heterogeneous runtime type (e.g. `claude-code`). `null`/`undefined` renders
   * nothing, so callers can pass it unconditionally.
   */
  type?: string | null;
}

/**
 * Small pill that labels a heterogeneous agent by its runtime (Claude Code,
 * Codex, …). Single source of truth for the badge so every agent listing — the
 * home sidebar, the assignee picker, the task assignee chip — stays consistent.
 */
const HeterogeneousTag = memo<HeterogeneousTagProps>(({ type, style }) => {
  if (!type) return null;

  const label = HETEROGENEOUS_TYPE_LABELS[type] ?? type;

  return (
    <Tag size={'small'} style={{ flexShrink: 0, ...style }}>
      {label}
    </Tag>
  );
});

export default HeterogeneousTag;
