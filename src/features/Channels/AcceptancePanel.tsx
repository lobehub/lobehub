import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useState } from 'react';

import type { InternalLinkReference } from '@/features/EntityLink';
import { PortalContent } from '@/features/Portal/router';
import RightPanel from '@/features/RightPanel';

import { styles } from './styles';
import { THREAD_FLOAT_BREAKPOINT } from './ThreadPanel';
import { useAcceptancePanel } from './useAcceptancePanel';

/** Entity details a Channel can show beside its feed; anything else follows its own route. */
export const CHANNEL_ENTITY_PORTAL_SCOPE = [
  'acceptance',
] as const satisfies readonly InternalLinkReference['type'][];

/** The acceptance report behind a link in the feed, beside the Channel like a thread. */
export function AcceptancePanel({
  availableWidth = 1000,
  channelId,
}: {
  availableWidth?: number;
  channelId: string;
}): ReactNode {
  const { close, open } = useAcceptancePanel(channelId);
  const [preferredWidth, setPreferredWidth] = useState(720);
  const narrow = availableWidth < THREAD_FLOAT_BREAKPOINT;
  const maxWidth = narrow ? availableWidth : availableWidth - 360;
  const width = Math.min(preferredWidth, maxWidth);

  return (
    <RightPanel
      className={stylex.props(styles.threadPanel).className}
      classNames={{ content: stylex.props(styles.threadContent).className }}
      expand={open}
      maxWidth={maxWidth}
      minWidth={Math.min(360, maxWidth)}
      mode={narrow ? 'float' : 'fixed'}
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      width={narrow ? availableWidth : width}
      onExpandChange={(expand) => {
        if (!expand) close();
      }}
      onSizeChange={(size) => {
        const next = Number.parseFloat(String(size?.width));
        if (Number.isFinite(next)) setPreferredWidth(next);
      }}
    >
      {open && (
        <Flexbox {...stylex.props(styles.body)}>
          <PortalContent onClose={close} />
        </Flexbox>
      )}
    </RightPanel>
  );
}
