'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, type ReactNode } from 'react';

interface SectionHeaderProps {
  desc: string;
  /** Status or the action that belongs to this section, kept on the title row. */
  extra?: ReactNode;
  title: string;
}

const SectionHeader = memo<SectionHeaderProps>(({ title, desc, extra }) => (
  <Flexbox gap={2}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <Text fontSize={14} weight={600}>
        {title}
      </Text>
      {extra}
    </Flexbox>
    <Text fontSize={12} type={'secondary'}>
      {desc}
    </Text>
  </Flexbox>
));

SectionHeader.displayName = 'AgentIdentitySectionHeader';

export default SectionHeader;
