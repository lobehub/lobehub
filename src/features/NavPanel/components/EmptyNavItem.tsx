import { ActionIcon, Block, Center, Text } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';

interface EmptyStatusProps {
  className?: string;
  onClick: () => void;
  title: string;
}

const EmptyNavItem = memo<EmptyStatusProps>(({ title, onClick, className }) => {
  return (
    <Block
      align={'center'}
      className={className}
      clickable
      gap={8}
      height={32}
      horizontal
      onClick={onClick}
      paddingInline={2}
      variant={'borderless'}
    >
      <Center flex={'none'} height={28} width={28}>
        <ActionIcon icon={PlusIcon} size={'small'} />
      </Center>
      <Text align={'center'} type={'secondary'}>
        {title}
      </Text>
    </Block>
  );
});

export default EmptyNavItem;
