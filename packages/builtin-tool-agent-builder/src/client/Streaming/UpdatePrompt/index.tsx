'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { memo } from 'react';

import type { UpdatePromptParams } from '../../../types';

export const UpdatePromptStreaming = memo<BuiltinStreamingProps<UpdatePromptParams>>(
  ({ args }) => {
    const { prompt } = args || {};

    if (!prompt) return null;

    return (
      <Block paddingBlock={8} paddingInline={12} variant={'outlined'} width="100%">
        <Markdown animated variant={'chat'}>
          {prompt}
        </Markdown>
      </Block>
    );
  },
);

UpdatePromptStreaming.displayName = 'UpdatePromptStreaming';

export default UpdatePromptStreaming;
