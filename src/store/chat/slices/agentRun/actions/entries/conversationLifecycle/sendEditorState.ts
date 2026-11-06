import type { ChatInputEditor } from '@/features/ChatInput';

type SendEditor = Pick<ChatInputEditor, 'setDocument'> &
  Partial<Pick<ChatInputEditor, 'getJSONState' | 'setJSONState'>> & {
    getDocument?: (type: string) => unknown;
  };

// Embedded composers pass the native editor; the main composer can pass its
// ChatInputEditor adapter. Keep recovery compatible with both public APIs.
export const readSendEditorState = (editor?: SendEditor | null) => {
  try {
    return editor?.getJSONState?.() ?? editor?.getDocument?.('json');
  } catch {
    return undefined;
  }
};

export const restoreSendEditorState = (
  editor: SendEditor | null | undefined,
  editorData: unknown,
  message: string,
  initialSnapshot?: { json: string | undefined },
) => {
  try {
    if (initialSnapshot && JSON.stringify(readSendEditorState(editor)) !== initialSnapshot.json)
      return;

    if (editorData) {
      if (editor?.setJSONState) {
        editor.setJSONState(editorData);
      } else {
        editor?.setDocument('json', JSON.stringify(editorData));
      }
    } else {
      editor?.setDocument('markdown', message);
    }
  } catch (error) {
    // A composer may unmount during the request. Recovery must not interrupt
    // operation cleanup or leave optimistic messages looking persisted.
    console.error('[sendMessage] Failed to restore composer:', error);
  }
};
