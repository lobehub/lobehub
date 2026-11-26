/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerDraftBus } from '../../../../composerDraftBus';
import type { MessageActionContext } from '../types';
import { editInNewTopicAction } from './editInNewTopic';

const MAIN_KEY = 'main_agt_1_tpc_1';

const mocks = vi.hoisted(() => ({
  clearChatUploadFileList: vi.fn(),
  context: {} as Record<string, unknown>,
  dispatchChatUploadFileList: vi.fn(),
  draftEntry: undefined as undefined | { json: object; updatedAt: number },
  isThreadMode: false,
  stagedFiles: [] as { id: string }[],
  setPendingNewTopicDirectory: vi.fn(),
  switchTopic: vi.fn(),
}));

vi.mock('../../../../store', () => ({
  conversationSelectors: { composerKey: () => 'main_agt_1_tpc_1' },
  messageStateSelectors: { isThreadMode: () => mocks.isThreadMode },
  useConversationStore: (selector: (s: unknown) => unknown) => selector({ context: mocks.context }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({
      setPendingNewTopicDirectory: mocks.setPendingNewTopicDirectory,
      switchTopic: mocks.switchTopic,
    }),
}));

vi.mock('@/features/ChatInput/draftStorage', () => ({
  getDraftEntry: () => mocks.draftEntry,
}));

vi.mock('@/store/file', () => ({
  fileChatSelectors: { chatUploadFileList: () => () => mocks.stagedFiles },
  useFileStore: {
    getState: () => ({
      clearChatUploadFileList: mocks.clearChatUploadFileList,
      dispatchChatUploadFileList: mocks.dispatchChatUploadFileList,
    }),
  },
}));

const build = (data: Partial<UIChatMessage>, role: MessageActionContext['role'] = 'user') =>
  renderHook(() => editInNewTopicAction.useBuild({ data: data as UIChatMessage, id: 'm1', role }))
    .result.current;

describe('editInNewTopicAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context = { agentId: 'agt_1', topicId: 'tpc_1' };
    mocks.isThreadMode = false;
    mocks.draftEntry = undefined;
    mocks.stagedFiles = [];
    useComposerDraftBus.setState({ attached: true, contextKey: MAIN_KEY, draft: null });
  });

  it('is offered on user messages of the main conversation', () => {
    expect(build({ content: 'hi' })).toMatchObject({ key: 'editInNewTopic' });
  });

  it('is hidden for assistant messages', () => {
    expect(build({ content: 'hi' }, 'assistant')).toBeNull();
  });

  it('is hidden when the main composer is not this conversation', () => {
    useComposerDraftBus.setState({ attached: true, contextKey: 'main_other_new' });
    expect(build({ content: 'hi' })).toBeNull();

    useComposerDraftBus.setState({ attached: false, contextKey: undefined });
    expect(build({ content: 'hi' })).toBeNull();
  });

  it('is hidden in threads and group conversations', () => {
    mocks.isThreadMode = true;
    expect(build({ content: 'hi' })).toBeNull();

    mocks.isThreadMode = false;
    mocks.context = { agentId: 'agt_1', groupId: 'grp_1', topicId: 'tpc_1' };
    expect(build({ content: 'hi' })).toBeNull();
  });

  it('stages text and attachments for the new topic, then switches to it', async () => {
    const editorData = { root: { children: [] } };
    const action = build({
      content: 'look at this',
      editorData,
      fileList: [{ fileType: 'application/pdf', id: 'f1', name: 'a.pdf', size: 100, url: 'u-f1' }],
      imageList: [{ alt: 'pic', id: 'i1', url: 'u-i1' }],
    })!;

    await act(async () => {
      await action.handleClick!();
    });

    // Attachments go to the new topic's composer bucket, not the current one.
    expect(mocks.dispatchChatUploadFileList).toHaveBeenCalledWith('main_agt_1_new', {
      files: [
        expect.objectContaining({
          fileType: 'image/png',
          id: 'i1',
          previewUrl: 'u-i1',
          skipRemoveFile: true,
        }),
        expect.objectContaining({ id: 'f1', previewUrl: 'u-f1', skipRemoveFile: true }),
      ],
      type: 'addFiles',
    });

    expect(useComposerDraftBus.getState().draft).toEqual({
      append: false,
      editorData,
      target: { agentId: 'agt_1' },
      text: 'look at this',
    });
    expect(mocks.setPendingNewTopicDirectory).toHaveBeenCalledWith();
    expect(mocks.switchTopic).toHaveBeenCalledWith(null);
  });

  // Regression: an unsent draft already waiting in the new topic was wiped.
  it('adds to an unsent new-topic draft instead of replacing it', async () => {
    mocks.draftEntry = { json: { root: {} }, updatedAt: 1 };
    mocks.stagedFiles = [{ id: 'i_old' }, { id: 'i1' }];
    const action = build({
      content: 'again',
      editorData: { root: { children: [] } },
      imageList: [
        { alt: 'pic', id: 'i1', url: 'u-i1' },
        { alt: 'pic2', id: 'i2', url: 'u-i2' },
      ],
    })!;

    await act(async () => {
      await action.handleClick!();
    });

    expect(mocks.clearChatUploadFileList).not.toHaveBeenCalled();
    // Only attachments not already staged are added.
    expect(mocks.dispatchChatUploadFileList).toHaveBeenCalledWith('main_agt_1_new', {
      files: [expect.objectContaining({ id: 'i2' })],
      type: 'addFiles',
    });
    expect(useComposerDraftBus.getState().draft).toEqual({
      append: true,
      editorData: { root: { children: [] } },
      target: { agentId: 'agt_1' },
      text: 'again',
    });
  });

  // Regression: a message without editor JSON appended to a rich draft made
  // the receiver reparse the whole draft as Markdown, flattening its image
  // references; it now joins as plain paragraphs merged into the JSON.
  it('appends a message without editor JSON as plain paragraphs', async () => {
    mocks.draftEntry = { json: { root: {} }, updatedAt: 1 };
    const action = build({ content: 'line 1\n\n**line 2**' })!;

    await act(async () => {
      await action.handleClick!();
    });

    const draft = useComposerDraftBus.getState().draft!;
    expect(draft.append).toBe(true);
    const paragraphs = (draft.editorData!.root as { children: any[] }).children;
    expect(paragraphs.map((p) => p.children.map((c: any) => c.text).join(''))).toEqual([
      'line 1',
      '',
      '**line 2**',
    ]);
  });

  it('keeps Markdown parsing for a message without editor JSON on a clean composer', async () => {
    const action = build({ content: '**bold**' })!;

    await act(async () => {
      await action.handleClick!();
    });

    expect(useComposerDraftBus.getState().draft).toMatchObject({
      append: false,
      editorData: undefined,
      text: '**bold**',
    });
  });

  it('does not switch again when already on the new topic', async () => {
    mocks.context = { agentId: 'agt_1', topicId: null };
    const action = build({ content: 'hi' })!;

    await act(async () => {
      await action.handleClick!();
    });

    expect(mocks.dispatchChatUploadFileList).not.toHaveBeenCalled();
    // The live editor may hold unsaved text, so the message is added to it.
    expect(useComposerDraftBus.getState().draft).toMatchObject({ append: true, text: 'hi' });
    expect(mocks.switchTopic).not.toHaveBeenCalled();
  });
});
