import { Block, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode, memo } from 'react';

interface BaseErrorFormProps {
  action?: ReactNode;
  avatar?: ReactNode;
  desc?: ReactNode;
  title?: ReactNode;
}
const BaseErrorForm = memo<BaseErrorFormProps>(({ title, desc, action, avatar }) => {
  return (
    <Block
      align={'center'}
      gap={8}
      horizontal
      justify={'space-between'}
      padding={16}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
      variant={'outlined'}
    >
      <Flexbox align="center" gap={12} horizontal>
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
