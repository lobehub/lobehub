'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { BroadcastParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  instruction: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export const BroadcastRender = memo<BuiltinRenderProps<BroadcastParams>>(({ args }) => {
  const { instruction } = args || {};

  if (!instruction) return null;

  return (
    <div className={styles.container}>
      <div className={styles.instruction}>
        <Markdown variant={'chat'}>{instruction}</Markdown>
      </div>
    </div>
  );
});

BroadcastRender.displayName = 'BroadcastRender';

export default BroadcastRender;
