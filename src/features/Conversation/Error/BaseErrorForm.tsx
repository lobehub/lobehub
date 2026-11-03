import { Block, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

interface BaseErrorFormProps {
  action?: ReactNode;
  avatar?: ReactNode;
  desc?: ReactNode;
  title?: ReactNode;
}
const BaseErrorForm = memo<BaseErrorFormProps>(({ title, desc, action, avatar }) => {
  return (
    <Block
      horizontal
      align={'center'}
      gap={8}
      justify={'space-between'}
      padding={16}
      variant={'outlined'}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <Flexbox horizontal align="center" gap={12}>
        {avatar}
        <Flexbox gap={2}>
          <Text weight={500}>{title}</Text>
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
