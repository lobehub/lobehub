'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import { useGroupProfileStore } from '@/store/groupProfile';

import type { UpdateAgentPromptParams } from '../../../types';

export const UpdateAgentPromptStreaming = memo<BuiltinStreamingProps<UpdateAgentPromptParams>>(
  ({ args }) => {
    const { agentId, prompt } = args || {};
    const setActiveTabId = useGroupProfileStore((s) => s.setActiveTabId);

    // Switch to agent tab when streaming agent prompt
    useEffect(() => {
      if (agentId) {
        setActiveTabId(agentId);
      }
    }, [agentId, setActiveTabId]);

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
