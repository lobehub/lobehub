'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { SpeakParams } from '../../../types';

const styles = stylex.create({
  container: { padding: '12px', borderRadius: '8px', background: cssVar.colorFillQuaternary },
  instruction: { fontSize: '13px', color: cssVar.colorTextSecondary },
});

export const SpeakRender = memo<BuiltinRenderProps<SpeakParams>>(({ args }) => {
  const { instruction } = args || {};

  if (!instruction) return null;

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.instruction)}>
        <Markdown variant={'chat'}>{instruction}</Markdown>
      </div>
    </div>
  );
});

SpeakRender.displayName = 'SpeakRender';

export default SpeakRender;
