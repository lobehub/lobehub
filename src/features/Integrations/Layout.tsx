'use client';

import * as stylex from '@stylexjs/stylex';
import { memo, type PropsWithChildren } from 'react';

const styles = stylex.create({
  column: { width: '100%', maxWidth: '760px', marginInline: 'auto' },
  page: { overflowY: 'auto', flex: '1' },
});

/** A reading-width column: settings content wider than a paragraph reads as a dashboard. */
const IntegrationsLayout = memo<PropsWithChildren>(({ children }) => (
  <div {...stylex.props(styles.page)}>
    <div {...stylex.props(styles.column)}>{children}</div>
  </div>
));

IntegrationsLayout.displayName = 'IntegrationsLayout';

export default IntegrationsLayout;
