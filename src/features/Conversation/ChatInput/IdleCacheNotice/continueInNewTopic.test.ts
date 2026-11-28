import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft } from '@/features/ChatInput/draftStorage';
import type { ChatInputEditor } from '@/features/ChatInput/hooks/useChatInputEditor';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';

import { continueInNewTopic } from './continueInNewTopic';

const context = { agentId: 'agent-1', topicId: 'topic-1' };
const draftDocument = { root: { children: [{ text: 'next question' }] } };

/** Shaped like the `useChatInputEditor` wrapper the conversation store actually holds. */
const createEditor = (markdown: string) =>
  ({
    clearContent: vi.fn(),
    focus: vi.fn(),
    getJSONState: vi.fn(() => draftDocument),
    getMarkdownContent: vi.fn(() => markdown),
    instance: {} as ChatInputEditor['instance'],
    setDocument: vi.fn(),
    setExpand: vi.fn(),
    setJSONState: vi.fn(),
  }) satisfies ChatInputEditor;

describe('continueInNewTopic', () => {
  const openNewTopicOrSaveTopic = vi.fn(async () => {});
  const moveChatComposerAttachments = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useChatStore.setState({ openNewTopicOrSaveTopic } as any);
    useFileStore.setState({ moveChatComposerAttachments } as any);
  });

  it('carries the draft and attachments to the blank topic, then opens it', async () => {
    const editor = createEditor('next question');

    await expect(continueInNewTopic({ context, editor })).resolves.toBe(true);

    const toKey = messageMapKey({ agentId: 'agent-1', topicId: null });
    expect(getDraft(toKey)).toEqual(draftDocument);
    expect(editor.clearContent).toHaveBeenCalledOnce();
    expect(moveChatComposerAttachments).toHaveBeenCalledWith(messageMapKey(context), toKey);
    expect(openNewTopicOrSaveTopic).toHaveBeenCalledOnce();
  });

  it('keeps the draft, attachments and topic when the draft cannot be saved', async () => {
    const editor = createEditor('next question');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    try {
      await expect(continueInNewTopic({ context, editor })).resolves.toBe(false);
    } finally {
      setItem.mockRestore();
    }

    expect(editor.clearContent).not.toHaveBeenCalled();
    expect(moveChatComposerAttachments).not.toHaveBeenCalled();
    expect(openNewTopicOrSaveTopic).not.toHaveBeenCalled();
  });

  it('opens the blank topic without saving an empty draft', async () => {
    const editor = createEditor('   ');

    await continueInNewTopic({ context, editor });

    expect(getDraft(messageMapKey({ agentId: 'agent-1', topicId: null }))).toBeFalsy();
    expect(editor.clearContent).not.toHaveBeenCalled();
    expect(openNewTopicOrSaveTopic).toHaveBeenCalledOnce();
  });
});
