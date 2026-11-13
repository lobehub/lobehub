import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const styles = stylex.create({
  label: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontWeight: 500,
  },
});

interface SectionProps {
  children: ReactNode;
  /** The section's own action (e.g. "Connect another account"), aligned with its label. */
  extra?: ReactNode;
  label: string;
}

/** One labelled block of the connector Overview tab. */
const Section = ({ children, extra, label }: SectionProps) => (
  <Flexbox gap={8}>
    {extra ? (
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <span {...stylex.props(styles.label)}>{label}</span>
        {extra}
      </Flexbox>
    ) : (
      <span {...stylex.props(styles.label)}>{label}</span>
    )}
    {children}
  </Flexbox>
);

export default Section;
