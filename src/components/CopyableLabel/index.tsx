import { CopyButton, Flexbox, Text } from '@lobehub/ui';
import { type CSSProperties } from 'react';
import { memo } from 'react';

interface CopyableLabelProps {
  className?: string;
  style?: CSSProperties;
  value?: string | null;
}

const CopyableLabel = memo<CopyableLabelProps>(({ className, style, value = '--' }) => {
  return (
    <Flexbox
      horizontal
      align={'center'}
      className={className}
      gap={4}
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
