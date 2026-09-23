'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';

const SectionLabel = memo<{ count?: ReactNode; title: ReactNode }>(({ title, count }) => (
  <Flexbox horizontal align={'center'} justify={'space-between'}>
    <Text color={cssVar.colorTextTertiary} fontSize={11} weight={500}>
      {title}
    </Text>
    {count !== undefined && (
      <Text color={cssVar.colorTextTertiary} fontSize={11} weight={500}>
        {count}
      </Text>
    )}
  </Flexbox>
));

SectionLabel.displayName = 'QuickNoteSectionLabel';

export default SectionLabel;
