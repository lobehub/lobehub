'use client';

import { PromptDiffView } from '@lobechat/builtin-tool-agent-builder/client';
import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { UpdateGroupPromptParams, UpdateGroupPromptState } from '../../../types';

export const UpdateGroupPromptRender = memo<
  BuiltinRenderProps<UpdateGroupPromptParams, UpdateGroupPromptState>
>(({ pluginState }) => {
  if (!pluginState) return null;

  return (
    <PromptDiffView newPrompt={pluginState.newPrompt} previousPrompt={pluginState.previousPrompt} />
  );
});

UpdateGroupPromptRender.displayName = 'UpdateGroupPromptRender';

export default UpdateGroupPromptRender;
