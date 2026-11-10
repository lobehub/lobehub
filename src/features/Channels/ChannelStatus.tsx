import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';

import type { ChannelStatusTone } from './jobStatus';
import { statusStyles, toneStyles } from './styles';

/**
 * A status line led by a tone dot, or by a check once the reply landed. `hideDot` is for a line
 * beside an avatar that already wears the same dot.
 */
export function ChannelStatus({
  hideDot,
  label,
  tone,
}: {
  hideDot?: boolean;
  label: string;
  tone: ChannelStatusTone;
}) {
  return (
    <span data-tone={tone} {...stylex.props(statusStyles.state, toneStyles[tone])}>
      {tone === 'done' ? (
        <Check size={12} />
      ) : hideDot ? null : (
        <span aria-hidden {...stylex.props(statusStyles.dot)} />
      )}
      {label}
    </span>
  );
}
