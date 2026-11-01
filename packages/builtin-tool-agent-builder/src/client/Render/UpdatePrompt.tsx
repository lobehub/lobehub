import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { UpdatePromptParams, UpdatePromptState } from '../../types';
import PromptDiffView from './components/PromptDiffView';

const UpdatePrompt = memo<BuiltinRenderProps<UpdatePromptParams, UpdatePromptState>>(
  ({ pluginState }) => {
    const { newPrompt, previousPrompt } = pluginState || {};

    return <PromptDiffView newPrompt={newPrompt} previousPrompt={previousPrompt} />;
  },
);

export default UpdatePrompt;
