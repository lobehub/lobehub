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
      align={'flex-start'}
      className={className}
      gap={4}
      style={{
        position: 'relative',
        width: '100%',
        ...style,
      }}
    >
      <Text
        style={{
          color: 'inherit',
          flex: 1,
          fontFamily: 'inherit',
          fontSize: 'inherit',
          margin: 0,
          minWidth: 0,
          overflowWrap: 'anywhere',
          whiteSpace: 'pre-wrap',
        }}
      >
        {value || '--'}
      </Text>
      <CopyButton content={value || '--'} size={'small'} />
    </Flexbox>
  );
});

export default CopyableLabel;
