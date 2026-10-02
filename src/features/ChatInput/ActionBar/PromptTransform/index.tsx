'use client';

import { memo, useCallback } from 'react';

import PromptTransformAction from '@/features/PromptTransform/PromptTransformAction';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useChatInputStore } from '../../store';
import { ChatInputAction } from '../components/ChatInputAction';

const PromptTransform = memo(() => {
  const [editor, markdownContent] = useChatInputStore((s) => [s.editor, s.markdownContent]);

  const agentId = useAgentId();
  // Reuse the model the conversation is actually running on — including a
  // topic-pinned model — so prompt optimization never needs a separately
  // configured system-agent model.
  const { model, provider } = useEffectiveModel(agentId);

  const onPromptChange = useCallback(
    (prompt: string) => {
      if (!editor) return;
      // `keepHistory` prevents setDocument from wiping the undo/redo stacks.
      editor.setDocument('markdown', prompt, { keepHistory: true });
    },
    [editor],
  );

  // Chat composer: optimize the user's text request, not an image prompt.
  return (
    <PromptTransformAction
      ActionComponent={ChatInputAction}
      mode={'text'}
      model={model}
      prompt={markdownContent}
      provider={provider}
      onPromptChange={onPromptChange}
    />
  );
});

PromptTransform.displayName = 'PromptTransform';

export default PromptTransform;
