'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { memo } from 'react';

import type { UpdateAgentPromptParams } from '../../../types';

export const UpdateAgentPromptStreaming = memo<BuiltinStreamingProps<UpdateAgentPromptParams>>(
  ({ args }) => {
    const { prompt } = args || {};

    if (!prompt) return null;

    return (
      <Block padding={4} variant={'outlined'} width="100%">
        <Markdown animated variant={'chat'}>
          {prompt}
        </Markdown>
      </Block>
    );
  },
);

UpdateAgentPromptStreaming.displayName = 'UpdateAgentPromptStreaming';

export default UpdateAgentPromptStreaming;
