import { Flexbox, Text } from '@lobehub/ui';
import { Surface } from '@lobehub/ui/dashboard';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const styles = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
    padding: 16,
  },
});

interface SectionProps {
  children: ReactNode;
  /** The section's own action (e.g. "Connect another account"), aligned with its label. */
  extra?: ReactNode;
  label: ReactNode;
}

/** One labelled block of the connector detail page: the label above, the content in a Surface card. */
const Section = ({ children, extra, label }: SectionProps) => (
  <Flexbox gap={8}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <Text as={'div'} weight={600}>
        {label}
      </Text>
      {extra}
    </Flexbox>
    <Surface>
      <div {...stylex.props(styles.body)}>{children}</div>
    </Surface>
  </Flexbox>
);

export default Section;
