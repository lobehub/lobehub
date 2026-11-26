import { Block, Center, Icon, Text } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';

import { useNavItemMetrics } from '../density';

interface EmptyStatusProps {
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}

const EmptyNavItem = memo<EmptyStatusProps>(({ title, onClick, className, disabled }) => {
  const metrics = useNavItemMetrics();
  const mergedStyle =
    disabled || metrics.radius !== undefined
      ? {
          ...(metrics.radius === undefined ? undefined : { borderRadius: metrics.radius }),
          ...(disabled ? { cursor: 'not-allowed', opacity: 0.5 } : undefined),
        }
      : undefined;

  return (
    <Block
      horizontal
      align={'center'}
      className={className}
      clickable={!disabled}
      gap={metrics.gap}
      height={metrics.rowHeight}
      paddingInline={metrics.paddingInline}
      style={mergedStyle}
      variant={'borderless'}
      onClick={disabled ? undefined : onClick}
    >
      <Center flex={'none'} height={metrics.iconBox} width={metrics.iconBox}>
        <Icon icon={PlusIcon} size={'small'} />
      </Center>
      {/* One line like a NavItem: a long title (e.g. in a narrow sidebar) truncates
          instead of wrapping out of the fixed-height row. */}
      <Text
        ellipsis={{ tooltipWhenOverflow: true }}
        fontSize={metrics.fontSize}
        style={{ flex: 1, minWidth: 0 }}
        type={'secondary'}
      >
        {title}
      </Text>
    </Block>
  );
});

export default EmptyNavItem;
