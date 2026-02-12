'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';

interface MoveLocalFilesParams {
  operations: Array<{ destination: string; source: string }>;
}

const MoveLocalFiles = memo<BuiltinInterventionProps<MoveLocalFilesParams>>(({ args }) => {
  const { operations } = args;

  return (
    <Flexbox gap={8}>
      <Text>Move {operations.length} item(s):</Text>
      <Flexbox gap={4}>
        {operations.map((op, i) => (
          <Flexbox horizontal align={'center'} gap={8} key={i}>
            <Text code ellipsis as={'span'} fontSize={12} style={{ maxWidth: 200 }}>
              {op.source}
            </Text>
            <ArrowRight size={12} />
            <Text code ellipsis as={'span'} fontSize={12} style={{ maxWidth: 200 }}>
              {op.destination}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default MoveLocalFiles;
