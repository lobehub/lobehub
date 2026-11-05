import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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
      <Flexbox horizontal align={'center'} className={stylex.props(styles.toolbar).className}>
        {toolbar}
      </Flexbox>
    )}
    <div {...stylex.props(styles.stage)}>{children}</div>
    {overlay}
    <Flexbox horizontal align={'center'} className={stylex.props(styles.footer).className}>
      <div {...stylex.props(styles.meta)}>{meta}</div>
      <Flexbox horizontal gap={8}>
        {actions}
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

export const exportActionClassName = stylex.props(styles.footerAction).className;

export const ToolbarDivider = () => <span aria-hidden {...stylex.props(styles.toolbarDivider)} />;

export default ExportLayout;
