import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { fileChatSelectors, useFileStore } from '@/store/file';
import type { UploadFileItem } from '@/types/files/upload';

import {
  clearSentAttachments,
  createQueueSendNowGate,
  getContextWindow,
  getConversationChatInputUiState,
  getConversationSendButtonProps,
  getInputTokenRatioAnchor,
  getQueuedHintKey,
  partitionSendableUploads,
  putQueuedMessageInEditor,
  toChatInputMessages,
  toDisplayableSendErrorMessage,
} from './utils';

const tokenMessages = [
  { content: 'old user', id: 'msg-1', role: 'user' },
  { content: 'old assistant', id: 'msg-2', role: 'assistant' },
  { content: 'latest tool', id: 'msg-3', role: 'tool' },
  { content: 'latest user', id: 'msg-4', role: 'user' },
] as UIChatMessage[];

describe('createQueueSendNowGate', () => {
  /**
   * @example Two different queued rows are clicked before the first writer exits.
   */
  it('rejects an overlapping row while the first send-now task is settling', async () => {
    // ROOT CAUSE:
    //
    // QueueTray previously keyed its in-flight guard by message id. Clicking a
    // second row after the first cancellation marked the blocker as cancelled
    // could therefore dispatch another turn while the native writer still exited.
    //
    // Before: each queued message owned an independent in-flight flag.
    // After: the conversation tray owns one gate across all queued messages.
    const gate = createQueueSendNowGate();
    let releaseFirst!: () => void;
    const firstTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const secondTask = vi.fn(async () => {});

    const first = gate.run(firstTask);
    const second = gate.run(secondTask);

    await expect(second).resolves.toBe(false);
    expect(secondTask).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toBe(true);
    await expect(gate.run(secondTask)).resolves.toBe(true);
    expect(secondTask).toHaveBeenCalledTimes(1);
  });
});

describe('getQueuedHintKey by Follow-up behavior', () => {
  it('says Queue sends one message per turn once the run ends', () => {
    expect(getQueuedHintKey({ count: 1, mode: 'queue', waitsForRunEnd: false })).toBe(
      'inputQueue.queuedRunEndHint',
    );
    expect(getQueuedHintKey({ count: 2, mode: 'queue', waitsForRunEnd: false })).toBe(
      'inputQueue.queuedOneByOneHint',
    );
  });

  it('says Steer joins the current run, merged', () => {
    expect(getQueuedHintKey({ count: 1, mode: 'steer', waitsForRunEnd: false })).toBe(
      'inputQueue.steerHint',
    );
    expect(getQueuedHintKey({ count: 3, mode: 'steer', waitsForRunEnd: false })).toBe(
      'inputQueue.steerMergeHint',
    );
  });

  it('says a run that cannot take a steer queues it until the end', () => {
    expect(getQueuedHintKey({ count: 1, mode: 'steer', waitsForRunEnd: true })).toBe(
      'inputQueue.steerUnsupportedHint',
    );
    expect(getQueuedHintKey({ count: 2, mode: 'steer', waitsForRunEnd: true })).toBe(
      'inputQueue.steerUnsupportedMergeHint',
    );
  });

  it('says a run that cannot take a steer is stopped and restarted, when that is on', () => {
    expect(
      getQueuedHintKey({ count: 1, mode: 'steer', restartsRun: true, waitsForRunEnd: true }),
    ).toBe('inputQueue.steerRestartHint');
    expect(
      getQueuedHintKey({ count: 2, mode: 'steer', restartsRun: true, waitsForRunEnd: true }),
    ).toBe('inputQueue.steerRestartMergeHint');
  });
});

describe('toChatInputMessages', () => {
  it('preserves user, assistant, and tool messages with their real roles', () => {
    expect(toChatInputMessages(tokenMessages).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ]);
  });

  it('filters out unsupported roles (e.g. system or custom roles)', () => {
    const mixedMessages = [
      { content: 'system message', id: 'msg-0', role: 'system' },
      { content: 'user message', id: 'msg-1', role: 'user' },
      { content: 'assistant message', id: 'msg-2', role: 'assistant' },
      { content: 'tool message', id: 'msg-3', role: 'tool' },
    ] as any[];

    expect(toChatInputMessages(mixedMessages)).toEqual([
      { content: 'user message', role: 'user' },
      { content: 'assistant message', role: 'assistant' },
      { content: 'tool message', role: 'tool' },
    ]);
  });

  it('coerces non-string content to an empty string', () => {
    const invalidContentMessages = [
      { content: undefined, id: 'msg-1', role: 'user' },
      { content: null, id: 'msg-2', role: 'assistant' },
      { content: ['array content'], id: 'msg-3', role: 'tool' },
      { content: { text: 'object content' }, id: 'msg-4', role: 'user' },
    ] as any[];

    expect(toChatInputMessages(invalidContentMessages)).toEqual([
      { content: '', role: 'user' },
      { content: '', role: 'assistant' },
      { content: '', role: 'tool' },
      { content: '', role: 'user' },
    ]);
  });
});

describe('getContextWindow', () => {
  const accounting = {
    bySource: {
      content: 500,
      fileContext: 0,
      reasoning: 0,
      thoughtSignature: 0,
      toolCallId: 2,
      toolCalls: 30,
      toolDefinition: 4000,
    },
    estimator: 'tokenx' as const,
    messageCount: 3,
    system: 2000,
    total: 6532,
  };

  it('uses the full conversation when history count is disabled', () => {
    const window = getContextWindow(tokenMessages, { enableHistoryCount: false, historyCount: 2 });

    expect(window.request).toBeUndefined();
    expect(window.history.map((message) => message.content)).toEqual([
      'old user',
      'old assistant',
      'latest tool',
      'latest user',
    ]);
  });

  it('slices chat messages according to history count', () => {
    expect(
      getContextWindow(tokenMessages, {
        enableHistoryCount: true,
        historyCount: 2,
      }).history.map((message) => message.content),
    ).toEqual(['latest tool', 'latest user']);
  });

  it('returns no historical chat messages when history count is zero', () => {
    expect(
      getContextWindow(tokenMessages, { enableHistoryCount: true, historyCount: 0 }).history,
    ).toEqual([]);
  });

  it('starts from the latest recorded request and keeps every message after it', () => {
    const messages = [
      { content: 'first', id: 'u1', role: 'user' },
      {
        content: 'older reply',
        id: 'a1',
        metadata: { contextAccounting: { ...accounting, total: 1 } },
        role: 'assistant',
      },
      { content: 'read the file', id: 'u2', role: 'user' },
      {
        content: '',
        id: 'a2',
        metadata: { contextAccounting: accounting },
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
        role: 'assistant',
        usage: { totalInputTokens: 7000 },
      },
      { content: 'file body', id: 't1', role: 'tool', tool_call_id: 'call_1' },
    ] as UIChatMessage[];

    const window = getContextWindow(messages, { enableHistoryCount: false });

    expect(window.request).toMatchObject({
      accounting,
      inputTokens: 7000,
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });
    expect(window.request?.messages?.map((message) => message.id)).toEqual(['a2', 't1']);

    // ROOT CAUSE: with a history count every request re-truncates history, so
    // messages the recorded request covered can drop out of the next one;
    // adding everything after the recorded reply on top overstated usage.
    const truncated = getContextWindow(messages, { enableHistoryCount: true, historyCount: 1 });

    expect(truncated.request).toMatchObject({ accounting, model: 'deepseek-v4-flash' });
    expect(truncated.request?.messages).toBeUndefined();
    expect(truncated.history.map((message) => message.id)).toEqual(['t1']);
  });

  it('ignores accounting on non-assistant messages', () => {
    const messages = [
      { content: 'hi', id: 'u1', metadata: { contextAccounting: accounting }, role: 'user' },
    ] as UIChatMessage[];

    expect(getContextWindow(messages, {}).request).toBeUndefined();
  });
});

describe('getInputTokenRatioAnchor', () => {
  const media = { audio: 0, image: 0, video: 0 };
  const request = {
    accounting: { bySource: {}, estimator: 'tokenx', media, system: 0, total: 8000 },
    inputTokens: 12_000,
    model: 'claude-sonnet-4-5',
    provider: 'lobehub',
  } as NonNullable<ReturnType<typeof getContextWindow>['request']>;
  const selection = { model: 'claude-sonnet-4-5', provider: 'lobehub' };

  it('anchors on a request to the selected model and provider', () => {
    expect(getInputTokenRatioAnchor(request, selection)).toEqual({
      actualTokens: 12_000,
      estimatedTokens: 8000,
      media,
    });
  });

  it.each([
    ['another provider', { ...request, provider: 'anthropic' }],
    ['an unknown provider', { ...request, provider: undefined }],
    ['an unknown model', { ...request, model: undefined }],
    ['runtime-estimated input tokens', { ...request, inputTokensEstimated: true }],
  ])('has no anchor for %s', (_, candidate) => {
    expect(getInputTokenRatioAnchor(candidate, selection)).toBeUndefined();
  });

  it('marks input tokens the runtime estimated without provider usage', () => {
    const messages = [
      {
        content: 'reply',
        id: 'a1',
        metadata: { contextAccounting: request.accounting, usageEstimated: true },
        model: 'claude-sonnet-4-5',
        provider: 'lobehub',
        role: 'assistant',
        usage: { totalInputTokens: 8100 },
      },
    ] as UIChatMessage[];

    const window = getContextWindow(messages, {});

    expect(window.request).toMatchObject({ inputTokens: 8100, inputTokensEstimated: true });
    expect(getInputTokenRatioAnchor(window.request, selection)).toBeUndefined();
  });
});

describe('getConversationSendButtonProps', () => {
  it.each([
    { customDisabled: undefined, disabled: true, expected: true },
    { customDisabled: undefined, disabled: false, expected: false },
    { customDisabled: true, disabled: false, expected: true },
    { customDisabled: false, disabled: true, expected: false },
  ])(
    'lets a host override disabled: $customDisabled / $disabled',
    ({ customDisabled, disabled, expected }) => {
      expect(
        getConversationSendButtonProps(
          { disabled, generating: false, onStop: vi.fn() },
          customDisabled === undefined ? undefined : { disabled: customDisabled },
        ).disabled,
      ).toBe(expected);
    },
  );
});

describe('partitionSendableUploads', () => {
  it('leaves failed and cancelled uploads out, keeping the rest in composer order', () => {
    const files = [
      { id: 'a', status: 'success' as const },
      { id: 'b', status: 'error' as const },
      { id: 'c', status: 'success' as const },
      { id: 'd', status: 'cancelled' as const },
    ];

    expect(partitionSendableUploads(files)).toEqual({
      failed: [files[1], files[3]],
      sendable: [files[0], files[2]],
    });
  });
});

describe('clearSentAttachments', () => {
  it('keeps a failed upload in the composer and clears only what was sent', () => {
    const contextKey = 'main_agent-1';
    const chip = (id: string, status: UploadFileItem['status']) =>
      ({ file: new File([], `${id}.zip`), id, status }) as UploadFileItem;
    const uploads = [chip('sent', 'success'), chip('failed', 'error')];
    useFileStore.setState({
      chatContextSelectionsByContext: { [contextKey]: [{ id: 'sel' } as any] },
      chatUploadFileListByContext: { [contextKey]: uploads },
    });

    const { sendable } = partitionSendableUploads(uploads);
    clearSentAttachments(useFileStore.getState(), contextKey, sendable);

    const state = useFileStore.getState();
    expect(
      fileChatSelectors
        .chatUploadFileList(contextKey)(state)
        .map((f) => f.id),
    ).toEqual(['failed']);
    expect(fileChatSelectors.chatContextSelections(contextKey)(state)).toEqual([]);
  });
});

describe('getConversationChatInputUiState', () => {
  it('shows follow-up placeholder and only the stop button while loading with an empty composer', () => {
    expect(
      getConversationChatInputUiState({
        isInputEmpty: true,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'followUp',
      showSendWhileGenerating: false,
      showStopButton: true,
    });
  });

  it('shows Send beside Stop while the user types a follow-up during loading', () => {
    // Regression: flipping Stop to Send the moment the composer had any text
    // read as "agent finished". Stop must stay up for the whole loading window;
    // Send appears next to it so the follow-up can be queued by click as well
    // as by Enter.
    expect(
      getConversationChatInputUiState({
        isInputEmpty: false,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendWhileGenerating: true,
      showStopButton: true,
    });
  });

  it('keeps only Stop while loading when the host disables queueing', () => {
    expect(
      getConversationChatInputUiState({
        disableQueue: true,
        isInputEmpty: false,
        isInputLoading: true,
      }),
    ).toMatchObject({
      showSendWhileGenerating: false,
      showStopButton: true,
    });
  });

  it('keeps the default composer state when not loading', () => {
    expect(
      getConversationChatInputUiState({
        isInputEmpty: false,
        isInputLoading: false,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendWhileGenerating: false,
      showStopButton: false,
    });
  });

  it('forces the default placeholder when disableFollowUpVariant is set, even while loading', () => {
    expect(
      getConversationChatInputUiState({
        disableFollowUpVariant: true,
        isInputEmpty: true,
        isInputLoading: true,
      }),
    ).toEqual({
      placeholderVariant: 'default',
      showSendWhileGenerating: false,
      showStopButton: true,
    });
  });
});

describe('toDisplayableSendErrorMessage', () => {
  /**
   * @example A send fails before the server's databaseError middleware strips it.
   */
  it('drops a raw database error instead of showing SQL and its bound values', () => {
    // ROOT CAUSE:
    //
    // `inputSendErrorMsg` is the failed call's `error.message` verbatim. Drizzle
    // stringifies a failed statement as `Failed query: <sql>\nparams: <values>`,
    // so this notice used to render the whole INSERT together with every bound
    // parameter — including the user's own message text — with no way for the
    // user to act on it.
    //
    // Before: the raw dump was rendered as-is.
    // After: the caller substitutes localized generic copy.
    const raw =
      'Failed query: insert into "messages" ("id", "role", "content") values ($1, $2, $3)\n' +
      'params: msg_1,user,a user message';

    expect(toDisplayableSendErrorMessage(raw)).toBeUndefined();
  });

  it('keeps a message the user can act on', () => {
    expect(toDisplayableSendErrorMessage('Internal server error (ref: db_abc123def456)')).toBe(
      'Internal server error (ref: db_abc123def456)',
    );
  });

  it('trims surrounding whitespace and treats blank input as nothing to show', () => {
    expect(toDisplayableSendErrorMessage('  Network error  ')).toBe('Network error');
    expect(toDisplayableSendErrorMessage('   ')).toBeUndefined();
    expect(toDisplayableSendErrorMessage()).toBeUndefined();
  });
});

describe('putQueuedMessageInEditor', () => {
  // ROOT CAUSE:
  //
  // Edit rebuilt the composer from the message text as markdown, dropping the
  // selected skills, tools and @-mentions the send reads from the structured
  // document — so an edited follow-up silently lost them.
  //
  // Before: always markdown.
  // After: the structured document when there is one.
  it('restores the structured document, so selections survive an edit', () => {
    const editor = { setDocument: vi.fn() };
    const editorData = { root: { type: 'root' } };

    putQueuedMessageInEditor(editor, { content: 'text', editorData });

    expect(editor.setDocument).toHaveBeenCalledWith('json', editorData);
  });

  it('falls back to markdown for a message without one', () => {
    const editor = { setDocument: vi.fn() };

    putQueuedMessageInEditor(editor, { content: 'text' });

    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'text');
  });
});
