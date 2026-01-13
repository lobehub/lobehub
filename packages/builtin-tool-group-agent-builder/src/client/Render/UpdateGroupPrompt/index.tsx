'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { UpdateGroupPromptParams, UpdateGroupPromptState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const UpdateGroupPromptRender = memo<
  BuiltinRenderProps<UpdateGroupPromptParams, UpdateGroupPromptState>
>(({ pluginState }) => {
  const prompt = pluginState?.newPrompt;

  if (!prompt) return null;

  return (
    <div className={styles.container}>
      <div>
        <Markdown variant={'chat'}>{prompt}</Markdown>
      </div>
    </div>
  );
});

UpdateGroupPromptRender.displayName = 'UpdateGroupPromptRender';

export default UpdateGroupPromptRender;
