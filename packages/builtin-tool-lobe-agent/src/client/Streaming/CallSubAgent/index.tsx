'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { CallSubAgentParams } from '../../../types';

const styles = stylex.create({
  container: { padding: '12px', borderRadius: '8px', background: cssVar.colorFillQuaternary },
  instruction: { fontSize: '13px', color: cssVar.colorTextSecondary },
});

export const CallSubAgentStreaming = memo<BuiltinStreamingProps<CallSubAgentParams>>(({ args }) => {
  const { instruction } = args || {};

  if (!instruction) return null;

  return (
    <div {...stylex.props(styles.container)}>
      {instruction && (
        <div {...stylex.props(styles.instruction)}>
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
