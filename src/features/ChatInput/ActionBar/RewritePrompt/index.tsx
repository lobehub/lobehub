'use client';

import { memo, useCallback } from 'react';

import PromptTransformAction from '@/features/PromptRewrite/PromptTransformAction';

import { useChatInputStore } from '../../store';

const RewritePrompt = memo(() => {
  const [editor, markdownContent] = useChatInputStore((s) => [s.editor, s.markdownContent]);

  const onPromptChange = useCallback(
    (prompt: string) => {
      if (!editor) return;
      editor.setDocument('markdown', prompt);
    },
    [editor],
  );

  return (
    <PromptTransformAction mode={'text'} prompt={markdownContent} onPromptChange={onPromptChange} />
  );
});

RewritePrompt.displayName = 'RewritePrompt';

export default RewritePrompt;
