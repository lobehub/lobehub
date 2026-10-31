import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

import { styles } from '../style';
import moduleStyles from '../style.module.css';

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
      <Flexbox horizontal align={'center'} className={stylex.props(styles.toolbar).className}>
        {toolbar}
      </Flexbox>
    )}
    <div {...stylex.props(styles.stage)}>{children}</div>
    {overlay}
    <Flexbox horizontal align={'center'} className={stylex.props(styles.footer).className}>
      <div {...stylex.props(styles.meta)}>{meta}</div>
      <Flexbox horizontal className={moduleStyles.footerActions} gap={8}>
        {actions}
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

export const ToolbarDivider = () => <span aria-hidden {...stylex.props(styles.toolbarDivider)} />;

export default ExportLayout;
