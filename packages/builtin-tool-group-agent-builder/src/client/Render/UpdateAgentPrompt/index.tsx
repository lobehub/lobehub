'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { UpdateAgentPromptParams, UpdateAgentPromptState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const UpdateAgentPromptRender = memo<
  BuiltinRenderProps<UpdateAgentPromptParams, UpdateAgentPromptState>
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

UpdateAgentPromptRender.displayName = 'UpdateAgentPromptRender';

export default UpdateAgentPromptRender;
