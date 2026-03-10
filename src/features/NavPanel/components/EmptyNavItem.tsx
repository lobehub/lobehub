import { Block, Center, Icon, Text } from '@lobehub/ui';
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
      clickable
      horizontal
      align={'center'}
      className={className}
      gap={8}
      height={32}
      paddingInline={2}
      variant={'borderless'}
      onClick={onClick}
    >
      <Center flex={'none'} height={28} width={28}>
        <Icon icon={PlusIcon} size={'small'} />
      </Center>
      <Text align={'center'} type={'secondary'}>
        {title}
      </Text>
    </Block>
  );
});

export default EmptyNavItem;
