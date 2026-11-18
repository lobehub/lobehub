import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const styles = stylex.create({
  // A page heading over a thin rule, so the detail reads as one scrolling page.
  label: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorText,
    flex: '1',
    fontSize: cssVar.fontSizeHeading5,
    fontWeight: 600,
    paddingBlockEnd: 8,
  },
});

interface SectionProps {
  children: ReactNode;
  /** The section's own action (e.g. "Connect another account"), aligned with its label. */
  extra?: ReactNode;
  label: ReactNode;
}

/** One labelled block of the connector detail page. */
const Section = ({ children, extra, label }: SectionProps) => (
  <Flexbox gap={12}>
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
