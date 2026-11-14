'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

interface SectionHeaderProps {
  /** Status or the action that belongs to this section, kept on the title row. */
  extra?: ReactNode;
  title: string;
}

const SectionHeader = memo<SectionHeaderProps>(({ title, extra }) => (
  <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
    <Text fontSize={14} weight={600}>
      {title}
    </Text>
    {extra}
  </Flexbox>
));

SectionHeader.displayName = 'AgentIdentitySectionHeader';

export default SectionHeader;
