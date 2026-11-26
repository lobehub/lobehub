'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  group: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: {
      ':last-child': 'none',
      'default': 'solid',
    },
    borderBlockEndWidth: 1,
    paddingBlock: 24,
  },
});

interface PanelSectionProps {
  children: ReactNode;
  desc?: ReactNode;
  /** Sits under the description, for something true of this group only. */
  notice?: ReactNode;
  title: ReactNode;
}

/**
 * One group of an environment's form: a title, what it is for, then its
 * fields. Groups sit one under another with a rule between them — they are
 * parts of one definition, not steps, so nothing draws them as a sequence.
 */
const PanelSection = memo<PanelSectionProps>(({ children, desc, notice, title }) => (
  <Flexbox gap={12} {...stylex.props(styles.group)}>
    <Flexbox gap={4}>
      <Text fontSize={15} weight={600}>
        {title}
      </Text>
      {desc && (
        <Text fontSize={12} type={'secondary'}>
          {desc}
        </Text>
      )}
      {notice}
    </Flexbox>
    <Flexbox gap={16}>{children}</Flexbox>
  </Flexbox>
));

PanelSection.displayName = 'PanelSection';

export default PanelSection;
