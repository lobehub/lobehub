import { useCallback, useRef } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';

export const composeVoiceTranscript = (baseText: string, transcript: string) => {
  const normalizedTranscript = transcript.trim();

  if (!normalizedTranscript) return baseText;
  if (!baseText.trim()) return normalizedTranscript;

  const separator = /\s$/.test(baseText) ? '' : ' ';
  return `${baseText}${separator}${normalizedTranscript}`;
};

export const useApplyTranscriptToEditor = () => {
  const [editor, getMarkdownContent, setDocument, updateMarkdownContent] = useChatInputStore(
    (s) => [s.editor, s.getMarkdownContent, s.setDocument, s.updateMarkdownContent],
  );
  const baseTextRef = useRef<string>('');

  const begin = useCallback(() => {
    baseTextRef.current = getMarkdownContent();
  }, [getMarkdownContent]);

  const apply = useCallback(
    (transcript: string) => {
      const nextContent = composeVoiceTranscript(baseTextRef.current, transcript);

      setDocument('markdown', nextContent, { keepHistory: true });
      updateMarkdownContent();
      editor?.focus();
    },
    [editor, setDocument, updateMarkdownContent],
  );

  const end = useCallback(() => {
    baseTextRef.current = getMarkdownContent();
  }, [getMarkdownContent]);

  return { apply, begin, end };
};
