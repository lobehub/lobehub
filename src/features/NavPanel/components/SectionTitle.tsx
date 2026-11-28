import { Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

import { sidebarRow } from '@/styles/density.stylex';

import { useNavItemMetrics } from '../density';

const styles = stylex.create({
  item: {
    marginBlockEnd: { 'default': null, ':is([data-open])': sidebarRow.sectionGap },
  },
});

const SectionTitle = ({ children }: { children: ReactNode }) => {
  const metrics = useNavItemMetrics();

  return (
    <Text ellipsis color={metrics.sectionLabelColor} fontSize={12} weight={500}>
      {children}
    </Text>
  );
};

export const useSectionTriggerStyle = () => {
  const metrics = useNavItemMetrics();
  return {
    paddingBlock: metrics.sectionTriggerPaddingBlock,
    paddingInline: metrics.sectionTriggerPaddingInline,
  };
};

/**
 * Class for a sidebar section's `AccordionItem`. Collapsed section headers stack as
 * tightly as nav rows; only an expanded section keeps the section gap below its
 * content, so it stays apart from the next header.
 */
export const sectionItemClassName = stylex.props(styles.item).className;

export default SectionTitle;
