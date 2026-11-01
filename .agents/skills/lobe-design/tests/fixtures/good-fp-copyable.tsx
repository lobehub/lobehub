// GOOD fixture (false-positive regression): CopyableLabel inherits the font; it must not trip LOBE-FONT-FAMILY.
import { CopyButton, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui';
import type { CSSProperties } from 'react';
import { memo } from 'react';

const CopyableLabel = memo<{ style?: CSSProperties; value?: string | null }>(({ style, value }) => {
  const text = value && value !== '--' ? value : undefined;

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      style={{
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
    >
      <Text
        ellipsis={{ rows: 1 }}
        style={{
          color: 'inherit',
          flex: '1 1 auto',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          margin: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {text ?? '--'}
      </Text>
      {text ? <CopyButton content={text} size={'small'} /> : null}
    </Flexbox>
  );
});

export default CopyableLabel;
