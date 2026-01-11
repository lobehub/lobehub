'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { memo } from 'react';

import type { UpdateGroupPromptParams } from '../../../types';

export const UpdateGroupPromptStreaming = memo<BuiltinStreamingProps<UpdateGroupPromptParams>>(
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

UpdateGroupPromptStreaming.displayName = 'UpdateGroupPromptStreaming';

export default UpdateGroupPromptStreaming;
