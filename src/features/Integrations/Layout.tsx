'use client';

import { createStaticStyles } from '@lobehub/ui';
import { memo, type PropsWithChildren } from 'react';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    overflow-y: auto;
    flex: 1;
  `,
}));

/** Fills the shared settings column, so switching tabs keeps the same content width. */
const IntegrationsLayout = memo<PropsWithChildren>(({ children }) => (
  <div className={styles.page}>{children}</div>
));

IntegrationsLayout.displayName = 'IntegrationsLayout';

export default IntegrationsLayout;
