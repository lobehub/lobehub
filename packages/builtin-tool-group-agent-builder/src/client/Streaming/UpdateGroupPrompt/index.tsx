'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import { useGroupProfileStore } from '@/store/groupProfile';

import type { UpdateGroupPromptParams } from '../../../types';

export const UpdateGroupPromptStreaming = memo<BuiltinStreamingProps<UpdateGroupPromptParams>>(
  ({ args }) => {
    const { prompt } = args || {};
    const setActiveTabId = useGroupProfileStore((s) => s.setActiveTabId);

    // Switch to group tab when streaming group prompt
    useEffect(() => {
      setActiveTabId('group');
    }, []);

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
