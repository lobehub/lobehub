'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { UpdatePromptParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  label: css`
    margin-block-end: 4px;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export const UpdatePromptRender = memo<BuiltinRenderProps<UpdatePromptParams>>(({ args }) => {
  const prompt = args?.prompt;

  if (!prompt) return null;

  return (
    <div className={styles.container}>
      <div className={styles.label}>System Prompt</div>
      <Block paddingBlock={8} paddingInline={12} variant={'outlined'} width="100%">
        <Markdown fontSize={13} variant={'chat'}>
          {prompt}
        </Markdown>
      </Block>
    </div>
  );
});

UpdatePromptRender.displayName = 'UpdatePromptRender';

export default UpdatePromptRender;
