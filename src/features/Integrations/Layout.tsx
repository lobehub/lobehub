'use client';

import { createStaticStyles } from 'antd-style';
import { memo, type PropsWithChildren } from 'react';

const styles = createStaticStyles(({ css }) => ({
  column: css`
    width: 100%;
    max-width: 760px;
    margin-inline: auto;
  `,
  page: css`
    overflow-y: auto;
    flex: 1;
  `,
}));

/** A reading-width column: settings content wider than a paragraph reads as a dashboard. */
const IntegrationsLayout = memo<PropsWithChildren>(({ children }) => (
  <div className={styles.page}>
    <div className={styles.column}>{children}</div>
  </div>
));

IntegrationsLayout.displayName = 'IntegrationsLayout';

export default IntegrationsLayout;
