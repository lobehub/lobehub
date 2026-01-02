import { CopyButton, Flexbox, Text } from '@lobehub/ui';
import { type CSSProperties, memo } from 'react';

interface CopyableLabelProps {
  className?: string;
  style?: CSSProperties;
  value?: string | null;
}

const CopyableLabel = memo<CopyableLabelProps>(({ className, style, value = '--' }) => {
  return (
    <Flexbox
      align={'center'}
      className={className}
      gap={4}
      horizontal
      style={{
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
    >
      <Text
        ellipsis
        style={{
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          margin: 0,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {value || '--'}
      </Text>
      <CopyButton content={value || '--'} size={'small'} />
    </Flexbox>
  );
});

export default CopyableLabel;
