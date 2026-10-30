import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: '12px' },
  head: { alignItems: 'baseline', display: 'flex', gap: '8px' },
  title: {
    color: cssVar.colorTextSecondary,
    fontSize: '13px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    margin: 0,
  },
  extra: { color: cssVar.colorTextTertiary, fontSize: '12px' },
});

interface SectionProps {
  children: ReactNode;
  extra?: ReactNode;
  title: string;
}

/** Sections are separated by whitespace, not boxes: one column, read top to bottom. */
const Section = memo<SectionProps>(({ children, extra, title }) => (
  <section aria-label={title} {...stylex.props(styles.root)}>
    <div {...stylex.props(styles.head)}>
      <h3 {...stylex.props(styles.title)}>{title}</h3>
      {extra && <span {...stylex.props(styles.extra)}>{extra}</span>}
    </div>
    {children}
  </section>
));

Section.displayName = 'EntitySection';

export default Section;
