import { Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';

import { styles } from '../style';

interface ExportLayoutProps {
  actions: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
  overlay?: ReactNode;
  toolbar?: ReactNode;
}

const ExportLayout = ({ actions, children, meta, overlay, toolbar }: ExportLayoutProps) => (
  <Flexbox flex={1} style={{ minHeight: 0, position: 'relative' }}>
    {toolbar && (
      <Flexbox horizontal align={'center'} className={styles.toolbar}>
        {toolbar}
      </Flexbox>
    )}
    <div className={styles.stage}>{children}</div>
    {overlay}
    <Flexbox horizontal align={'center'} className={styles.footer}>
      <div className={styles.meta}>{meta}</div>
      <Flexbox horizontal className={styles.footerActions} gap={8}>
        {actions}
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

export const ToolbarDivider = () => <span aria-hidden className={styles.toolbarDivider} />;

export default ExportLayout;
