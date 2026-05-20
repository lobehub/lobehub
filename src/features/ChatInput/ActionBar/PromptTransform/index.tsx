'use client';

import { memo, useCallback } from 'react';

import PromptTransformAction from '@/features/PromptTransform/PromptTransformAction';

import { useChatInputStore } from '../../store';

const PromptTransform = memo(() => {
  const [editor, markdownContent] = useChatInputStore((s) => [s.editor, s.markdownContent]);

  const onPromptChange = useCallback(
    (prompt: string) => {
      if (!editor) return;
      // `keepHistory` prevents setDocument from wiping the undo/redo stacks.
      editor.setDocument('markdown', prompt, { keepHistory: true });
    },
    [editor],
  );

  // Image mode expands vague inputs; text mode forbids expansion.
  return (
    <PromptTransformAction
      mode={'image'}
      prompt={markdownContent}
      onPromptChange={onPromptChange}
    />
  );
});

PromptTransform.displayName = 'PromptTransform';

export default PromptTransform;
