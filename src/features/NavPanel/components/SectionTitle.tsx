import { Text } from '@lobehub/ui';
import { type ReactNode } from 'react';

import { useNavItemMetrics } from '../density';

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

export default SectionTitle;
