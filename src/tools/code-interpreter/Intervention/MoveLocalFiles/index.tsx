'use client';

import { type BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  path: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));

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
          <Flexbox align={'center'} gap={8} horizontal key={i}>
            <Text className={styles.path} ellipsis style={{ maxWidth: 200 }}>
              {op.source}
            </Text>
            <ArrowRight size={12} />
            <Text className={styles.path} ellipsis style={{ maxWidth: 200 }}>
              {op.destination}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default MoveLocalFiles;
