'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const styles = stylex.create({
  head: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    minHeight: '24px',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  spacer: { flex: '1' },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: '24px',
    color: cssVar.colorText,
  },
});

interface GateSectionProps {
  children: ReactNode;
  extra?: ReactNode;
  title: string;
  titleExtra?: ReactNode;
}

const GateSection = ({ children, extra, title, titleExtra }: GateSectionProps) => (
  <section {...stylex.props(styles.root)}>
    <div {...stylex.props(styles.head)}>
      <h3 {...stylex.props(styles.title)}>{title}</h3>
      {titleExtra}
      <span {...stylex.props(styles.spacer)} />
      {extra}
    </div>
    {children}
  </section>
);

export default GateSection;
