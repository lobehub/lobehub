import { type InterfaceDensity } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useDensity } from '@/styles/density';

const AVATAR_GAP = {
  compact: 10,
  loose: 12,
} as const satisfies Record<InterfaceDensity, number>;

const TITLE_FONT_SIZE = {
  compact: 13,
  loose: undefined,
} as const satisfies Record<InterfaceDensity, number | undefined>;

interface BaseErrorFormProps {
  action?: ReactNode;
  avatar?: ReactNode;
  desc?: ReactNode;
  title?: ReactNode;
}
const BaseErrorForm = memo<BaseErrorFormProps>(({ title, desc, action, avatar }) => {
  const { density, tokens } = useDensity();
  return (
    <Block
      horizontal
      align={'center'}
      gap={8}
      justify={'space-between'}
      padding={tokens.cardPadding}
      variant={'outlined'}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <Flexbox horizontal align="center" gap={AVATAR_GAP[density]}>
        {avatar}
        <Flexbox gap={2}>
          <Text fontSize={TITLE_FONT_SIZE[density]} weight={500}>
            {title}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {desc}
          </Text>
        </Flexbox>
      </Flexbox>
      {action}
    </Block>
  );
});

export default BaseErrorForm;
