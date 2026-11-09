import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { initialState } from '@/store/chat/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useFailedSendDrafts } from './useFailedSendDrafts';

const mocks = vi.hoisted(() => ({
  context: { agentId: 'agent', topicId: 'topic' },
  document: '',
  info: vi.fn(),
  write: vi.fn(),
  wrapped: false,
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { info: mocks.info },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStoreApi: () => ({
    getState: () => {
      const editor = {
        getDocument: (type: string) =>
          type === 'markdown' ? mocks.document : { root: { children: [] } },
        getLexicalEditor: () => ({}),
        setDocument: mocks.write,
      };
      return {
        context: mocks.context,
        editor: mocks.wrapped
          ? { getJSONState: () => ({}), instance: editor, setJSONState: mocks.write }
          : editor,
      };
    },
  }),
}));

const key = messageMapKey({ agentId: 'agent', topicId: 'topic' });
const draft = {
  editorData: { root: { children: [{ fileId: 'file_1', type: 'file' }] } },
  id: 'failed-send',
  message: 'original message',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context = { agentId: 'agent', topicId: 'topic' };
  mocks.document = '';
  mocks.wrapped = false;
  useChatStore.setState({ ...initialState, failedSendDrafts: { [key]: [draft] } });
});

describe('failed send draft recovery', () => {
  it('restores through the main composer adapter', () => {
    mocks.wrapped = true;
    const { result } = renderHook(() => useFailedSendDrafts(key));
    act(() => result.current.restore(draft));
    expect(mocks.write).toHaveBeenCalledWith(draft.editorData);
    expect(result.current.drafts).toEqual([expect.objectContaining({ ...draft, restored: true })]);
  });

  it('restores the original rich document and removes only that failed item', () => {
    const other = { ...draft, id: 'other-send' };
    useChatStore.getState().retainFailedSendDraft(key, other);
    const { result } = renderHook(() => useFailedSendDrafts(key));
    act(() => result.current.restore(draft));
    expect(mocks.write).toHaveBeenCalledWith('json', JSON.stringify(draft.editorData));
    expect(result.current.drafts).toEqual([
      expect.objectContaining({ ...draft, restored: true }),
      expect.objectContaining({ ...other, createdAt: expect.any(Number) }),
    ]);
  });

  it('keeps both drafts if the composer has newer text', () => {
    mocks.document = 'newer draft';
    const { result } = renderHook(() => useFailedSendDrafts(key));
    act(() => result.current.restore(draft));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(result.current.drafts).toEqual([draft]);
    expect(mocks.info).toHaveBeenCalledWith('input.failedSend.keepCurrentDraft');
  });

  it('cannot restore into a different conversation even with an empty document', () => {
    const { result } = renderHook(() => useFailedSendDrafts(key));
    mocks.context = { agentId: 'agent', topicId: 'another-topic' };
    act(() => result.current.restore(draft));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(result.current.drafts).toEqual([draft]);
  });

  it('retains the original payload when the editor write fails', () => {
    mocks.write.mockImplementationOnce(() => {
      throw new Error('editor destroyed');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useFailedSendDrafts(key));
    act(() => result.current.restore(draft));
    expect(result.current.drafts).toEqual([draft]);
    log.mockRestore();
  });
});
