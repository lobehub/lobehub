import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
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
 * Codex, …) using the shared runtime label resolver.
 */
const HeterogeneousTag = memo<HeterogeneousTagProps>(({ type, style }) => {
  const label = getHeterogeneousTypeLabel(type);
  if (!label) return null;

  return (
    <Tag size={'small'} style={{ flexShrink: 0, ...style }}>
      {label}
    </Tag>
  );
});

export default HeterogeneousTag;
