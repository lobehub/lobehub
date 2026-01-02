import { type IEditor } from '@lobehub/editor';
import { useMemo } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';

export interface ChatInputEditor {
  clearContent: () => void;
  focus: () => void;
  getJSONState: () => any;
  getMarkdownContent: () => string;
  instance: IEditor;
  setExpand: (expand: boolean) => void;
  setJSONState: (content: any) => void;
}
export const useChatInputEditor = () => {
  const [editor, getMarkdownContent, getJSONState, setExpand, setJSONState] = useChatInputStore(
    (s) => [s.editor, s.getMarkdownContent, s.getJSONState, s.setExpand, s.setJSONState],
  );

  return useMemo<ChatInputEditor>(
    () => ({
      clearContent: () => {
        editor?.cleanDocument();
      },
      focus: () => {
        editor?.focus();
      },
      getJSONState,
      getMarkdownContent,
      instance: editor!,
      setExpand,
      setJSONState,
    }),
    [editor],
  );
};
