'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { CallSubAgentParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  description: css`
    margin-block-end: 8px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  instruction: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export const CallSubAgentStreaming = memo<BuiltinStreamingProps<CallSubAgentParams>>(({ args }) => {
  const { instruction } = args || {};

  if (!instruction) return null;

  return (
    <div className={styles.container}>
      {instruction && (
        <div className={styles.instruction}>
          <Markdown animated variant={'chat'}>
            {instruction}
          </Markdown>
        </div>
      )}
    </div>
  );
});

CallSubAgentStreaming.displayName = 'CallSubAgentStreaming';

export default CallSubAgentStreaming;
