import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';

import type { ChannelStatusTone } from './jobStatus';
import { statusStyles, toneStyles } from './styles';

/** A status line led by a tone dot, or by a check once the reply landed. */
export function ChannelStatus({ label, tone }: { label: string; tone: ChannelStatusTone }) {
  return (
    <span data-tone={tone} {...stylex.props(statusStyles.state, toneStyles[tone])}>
      {tone === 'done' ? (
        <Check size={12} />
      ) : (
        <span aria-hidden {...stylex.props(statusStyles.dot)} />
      )}
      {label}
    </span>
  );
}
