/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FeedbackInput from './FeedbackInput';

const UPLOADING_DOC = {
  root: {
    children: [
      { src: 'blob:app://renderer/6c51', status: 'loading', type: 'block-image' },
      { children: [{ text: 'why so slow', type: 'text' }], type: 'paragraph' },
    ],
    type: 'root',
  },
};

const UPLOADED_DOC = {
  root: {
    children: [
      { src: 'https://app.lobehub.com/f/file_1', status: 'uploaded', type: 'block-image' },
      { children: [{ text: 'why so slow', type: 'text' }], type: 'paragraph' },
    ],
    type: 'root',
  },
};

const mocks = vi.hoisted(() => ({
  canvasProps: undefined as
    | undefined
    | {
        onContentChange?: () => void;
        onPressEnter?: (args: { event: { key: string } }) => boolean | void;
      },
  doc: { json: undefined as unknown, markdown: '' },
  editor: undefined as any,
  sendMessage: vi.fn(),
}));

mocks.editor = {
  cleanDocument: vi.fn(),
  getDocument: (format: string) => (format === 'markdown' ? mocks.doc.markdown : mocks.doc.json),
  getLexicalEditor: () => ({
    getEditorState: () => ({ read: (fn: () => void) => fn() }),
  }),
};

vi.mock('lexical', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  $getRoot: () => ({ getTextContent: () => mocks.doc.markdown }),
}));

vi.mock('@lobehub/editor/react', () => ({
  ChatInput: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  ChatInputActionBar: ({ right }: { right?: ReactNode }) => <div>{right}</div>,
  SendButton: ({ disabled, onClick }: { disabled?: boolean; onClick?: () => void }) => (
    <button data-testid="send" disabled={disabled} onClick={onClick} />
  ),
  useEditor: () => mocks.editor,
}));

vi.mock('@/features/EditorCanvas', () => ({
  EditorCanvas: (props: typeof mocks.canvasProps) => {
    mocks.canvasProps = props;
    return null;
  },
}));

vi.mock('@/features/AttachmentInput', () => ({ AttachmentUploadButton: () => null }));
vi.mock('@/features/Conversation/ChatInput/OpStatusTray', () => ({ default: () => null }));
vi.mock('@/features/Conversation/ChatInput/QueueTray', () => ({ default: () => null }));
vi.mock('@/features/Conversation/ChatInput/useConversationChatInputUiState', () => ({
  useConversationChatInputUiState: () => ({
    placeholderVariant: 'default',
    showSendWhileGenerating: false,
    showStopButton: false,
  }),
}));
vi.mock('@/features/Conversation/hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
}));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({ sendMessage: mocks.sendMessage, stopGenerating: vi.fn() }),
}));
vi.mock('@/hooks/useEnterToSend', () => ({ useEnterToSend: () => () => true }));
vi.mock('./useComposerFocus', () => ({
  useComposerFocus: () => ({
    collapse: vi.fn(),
    expand: vi.fn(),
    expanded: true,
    handleEditorInit: vi.fn(),
    reveal: vi.fn(),
  }),
}));
vi.mock('./useFollowUpQueue', () => ({
  useFollowUpQueue: () => ({ composerExpanded: true, hasQueuedMessages: false }),
}));

const setDoc = (json: unknown) => {
  mocks.doc.json = json;
  mocks.doc.markdown = 'why so slow';
  act(() => mocks.canvasProps?.onContentChange?.());
};

describe('FeedbackInput', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.editor.cleanDocument.mockReset();
    mocks.doc = { json: undefined, markdown: '' };
  });

  it('holds the follow-up while a pasted image is still uploading', async () => {
    render(<FeedbackInput defaultExpanded />);
    setDoc(UPLOADING_DOC);

    expect(screen.getByTestId('send')).toHaveProperty('disabled', true);

    await act(async () => {
      mocks.canvasProps?.onPressEnter?.({ event: { key: 'Enter' } });
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.editor.cleanDocument).not.toHaveBeenCalled();
  });

  it('sends once the image has finished uploading', async () => {
    render(<FeedbackInput defaultExpanded />);
    setDoc(UPLOADING_DOC);
    setDoc(UPLOADED_DOC);

    const send = screen.getByTestId('send');
    expect(send).toHaveProperty('disabled', false);

    await act(async () => {
      fireEvent.click(send);
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      editorData: UPLOADED_DOC,
      forceRuntime: 'gateway',
      message: 'why so slow',
    });
  });
});
