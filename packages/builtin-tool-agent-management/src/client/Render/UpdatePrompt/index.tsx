'use client';

import type { UpdatePromptState } from '@lobechat/agent-manager-runtime';
import { PromptDiffView } from '@lobechat/builtin-tool-agent-builder/client';
import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { UpdatePromptParams } from '../../../types';

export const UpdatePromptRender = memo<BuiltinRenderProps<UpdatePromptParams, UpdatePromptState>>(
  ({ args, pluginState }) => {
    // Fall back to the requested prompt when the tool result carries no state (e.g. failed calls)
    const newPrompt = pluginState?.newPrompt ?? args?.prompt;

    if (!newPrompt && !pluginState) return null;

    return <PromptDiffView newPrompt={newPrompt} previousPrompt={pluginState?.previousPrompt} />;
  },
);

UpdatePromptRender.displayName = 'UpdatePromptRender';

export default UpdatePromptRender;
