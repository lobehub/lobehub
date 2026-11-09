import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useTaskFollowUpSubmit } from './useTaskFollowUpSubmit';

const mocks = vi.hoisted(() => ({
  config: {} as { agentGatewayUrl?: string; enableGatewayMode?: boolean },
  context: { agentId: 'agent', topicId: 'topic' },
  editor: undefined as unknown,
  sendMessage: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mocks.toastError },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({ serverConfig: mocks.config }),
}));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({ sendMessage: mocks.sendMessage }),
  useConversationStoreApi: () => ({
    getState: () => ({ context: mocks.context, editor: mocks.editor }),
  }),
}));

const draft = {
  root: {
    children: [{ children: [{ text: 'follow-up', type: 'text' }], type: 'paragraph' }],
    type: 'root',
  },
};

const setup = () => {
  const editor = {
    cleanDocument: vi.fn(),
    getDocument: vi.fn<(type: string) => unknown>((type) =>
      type === 'json' ? draft : 'follow-up',
    ),
    getLexicalEditor: vi.fn(() => ({})),
    setDocument: vi.fn(),
  };
  const onClear = vi.fn();
  mocks.editor = editor;
  const hook = renderHook(() =>
    useTaskFollowUpSubmit({ editor: editor as unknown as IEditor, onClear }),
  );
  return { ...hook, editor, onClear };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendMessage.mockReset().mockResolvedValue(undefined);
  mocks.config = { agentGatewayUrl: 'https://gateway.example.com', enableGatewayMode: true };
  mocks.context = { agentId: 'agent', topicId: 'topic' };
  useChatStore.setState({ failedSendDrafts: {} });
});

describe('useTaskFollowUpSubmit', () => {
  it.each([
    {},
    { enableGatewayMode: true },
    { agentGatewayUrl: 'https://gateway.example.com', enableGatewayMode: false },
  ])('keeps the draft and explains missing gateway configuration %j', async (config) => {
    mocks.config = config;
    const { editor, onClear, result } = setup();

    await act(async () => result.current.handleSubmit());

    expect(mocks.toastError).toHaveBeenCalledWith('taskDetail.gatewayRequired');
    expect(editor.cleanDocument).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  it('uses the task runtime and captured document when the gateway is configured', async () => {
    const { editor, result } = setup();

    await act(async () => result.current.handleSubmit());

    expect(editor.cleanDocument).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      editorData: draft,
      forceRuntime: 'gateway',
      message: 'follow-up',
      onBeforeSendFailure: expect.any(Function),
      onMessageAccepted: expect.any(Function),
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('restores the document and allows a retry when a preflight hook rejects', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('access check unavailable'));
    const { editor, result } = setup();

    await act(async () => result.current.handleSubmit());

    expect(editor.setDocument).toHaveBeenCalledWith('json', JSON.stringify(draft));
    expect(mocks.toastError).toHaveBeenCalledWith('taskDetail.followUpFailed');
    expect(result.current.submitting).toBe(false);

    await act(async () => result.current.handleSubmit());
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('recovers when a provider hook blocks the send without throwing', async () => {
    mocks.sendMessage.mockImplementationOnce(async ({ onBeforeSendFailure }) => {
      onBeforeSendFailure();
    });
    const { editor, result } = setup();
    await act(async () => result.current.handleSubmit());
    expect(editor.setDocument).toHaveBeenCalledWith('json', JSON.stringify(draft));
    expect(result.current.submitting).toBe(false);
  });

  it('does not send a duplicate before React updates the pending state', async () => {
    const { result } = setup();
    let finish!: () => void;
    mocks.sendMessage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    await act(async () => {
      const first = result.current.handleSubmit();
      await result.current.handleSubmit();
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
      finish();
      await first;
    });
  });

  it.each(['new draft', 'another topic'])(
    'preserves the current composer after a deferred rejection with %s',
    async (change) => {
      const { editor, result } = setup();
      let reject!: (reason: Error) => void;
      mocks.sendMessage.mockImplementationOnce(
        () =>
          new Promise<void>((_, fail) => {
            reject = fail;
          }),
      );

      await act(async () => {
        const sending = result.current.handleSubmit();
        if (change === 'new draft') {
          editor.getDocument.mockReturnValue({ root: { children: [{ text: 'new draft' }] } });
        } else {
          mocks.context = { agentId: 'agent', topicId: 'another-topic' };
        }
        reject(new Error('access check unavailable'));
        await sending;
      });

      expect(editor.setDocument).not.toHaveBeenCalled();
      expect(
        useChatStore.getState().failedSendDrafts[
          messageMapKey({ agentId: 'agent', topicId: 'topic' })
        ],
      ).toEqual([expect.objectContaining({ editorData: draft, message: 'follow-up' })]);
      expect(result.current.submitting).toBe(false);
    },
  );
});
