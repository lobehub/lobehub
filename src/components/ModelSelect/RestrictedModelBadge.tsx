import { Icon, Tag, Tooltip } from '@lobehub/ui';
import { Lock } from 'lucide-react';
import { memo } from 'react';

interface RestrictedModelBadgeProps {
  /** Plan or tier that unlocks the model, e.g. `Pro`. */
  label: string;
  /** Hover text explaining the lock, e.g. which plan unlocks the model. */
  tooltip?: string;
}

/**
 * Badge of a model the current plan cannot use. The lock icon tells it apart from a
 * plan label the user already has, so the name reads as "needs this plan".
 */
export const RestrictedModelBadge = memo<RestrictedModelBadgeProps>(({ label, tooltip }) => {
  const tag = (
    <Tag color="gold" icon={<Icon icon={Lock} />} size="small" style={{ flex: 'none' }}>
      {label}
    </Tag>
  );

  if (!tooltip) return tag;

  return <Tooltip title={tooltip}>{tag}</Tooltip>;
});

RestrictedModelBadge.displayName = 'RestrictedModelBadge';
