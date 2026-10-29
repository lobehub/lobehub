import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  createQueueSendNowGate,
  getContextWindowMessages,
  getConversationChatInputUiState,
  getConversationSendButtonProps,
  getQueuedHintKey,
  putQueuedMessageInEditor,
  sendQueuedMessageNow,
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

describe('getQueuedHintKey', () => {
  it('promises the next step boundary for the built-in runtime', () => {
    expect(getQueuedHintKey({ count: 1, waitsForRunEnd: false })).toBe('inputQueue.queuedHint');
    expect(getQueuedHintKey({ count: 2, waitsForRunEnd: false })).toBe(
      'inputQueue.queuedMergeHint',
    );
  });

  /**
   * @example A follow-up is queued while a Claude Code run is still calling tools.
   */
  it('promises the end of the whole run for heterogeneous agents', () => {
    // ROOT CAUSE:
    //
    // A Claude Code / Codex CLI turn cannot be handed back at a step boundary:
    // the queue drains only once the CLI run ends. QueueTray still captioned
    // the row "Sends when the current step finishes".
    //
    // Before: one caption for every runtime.
    // After: heterogeneous agents say the follow-up waits for the current run.
    expect(getQueuedHintKey({ count: 1, waitsForRunEnd: true })).toBe(
      'inputQueue.queuedRunEndHint',
    );
    expect(getQueuedHintKey({ count: 3, waitsForRunEnd: true })).toBe(
      'inputQueue.queuedRunEndMergeHint',
    );
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

describe('getContextWindowMessages', () => {
  it('uses the full conversation when history count is disabled', () => {
    expect(
      getContextWindowMessages(tokenMessages, {
        enableHistoryCount: false,
        historyCount: 2,
      }).map((message) => message.content),
    ).toEqual(['old user', 'old assistant', 'latest tool', 'latest user']);
  });

  it('slices chat messages according to history count', () => {
    expect(
      getContextWindowMessages(tokenMessages, {
        enableHistoryCount: true,
        historyCount: 2,
      }).map((message) => message.content),
    ).toEqual(['latest tool', 'latest user']);
  });

  it('returns no historical chat messages when history count is zero', () => {
    expect(
      getContextWindowMessages(tokenMessages, {
        enableHistoryCount: true,
        historyCount: 0,
      }),
    ).toEqual([]);
  });
});

describe('getConversationSendButtonProps', () => {
  it.each([false, true])(
    'keeps uploads disabled with generating=%s despite a host override',
    (generating) => {
      const defaults = {
        disabled: true,
        generating,
        onStop: vi.fn(),
        showSendWhileGenerating: generating,
      };
      const overrides = { disabled: false, shape: 'round' as const };

      expect(getConversationSendButtonProps(defaults, overrides, true)).toEqual({
        ...defaults,
        disabled: true,
        shape: 'round',
      });
      expect(getConversationSendButtonProps(defaults, overrides, false).disabled).toBe(false);
    },
  );

  it.each([
    { customDisabled: undefined, disabled: true, expected: true },
    { customDisabled: undefined, disabled: false, expected: false },
    { customDisabled: true, disabled: false, expected: true },
    { customDisabled: false, disabled: true, expected: false },
  ])(
    'preserves non-upload disabled overrides: $customDisabled / $disabled',
    ({ customDisabled, disabled, expected }) => {
      expect(
        getConversationSendButtonProps(
          { disabled, generating: false, onStop: vi.fn() },
          customDisabled === undefined ? undefined : { disabled: customDisabled },
          false,
        ).disabled,
      ).toBe(expected);
    },
  );
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
      showSendMenu: false,
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
      showSendMenu: false,
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
      showSendMenu: true,
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
      showSendMenu: false,
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

describe('sendQueuedMessageNow', () => {
  const context = { agentId: 'agt-1', topicId: 'tpc-1' };
  const msg = {
    content: 'now',
    createdAt: 1,
    id: 'q1',
    interruptMode: 'soft' as const,
    serverDelivery: 'server' as const,
  };
  const chatWith = (cancelled: boolean | Error) => {
    const order: string[] = [];
    const chat = {
      cancelOperation: vi.fn(async () => {
        order.push('cancel');
        if (cancelled instanceof Error) throw cancelled;
        return cancelled;
      }),
      restoreQueuedMessage: vi.fn(),
      operations: {
        'op-1': {
          context,
          id: 'op-1',
          metadata: { startTime: 1 },
          status: 'running',
          type: 'execServerAgentRuntime',
        },
      },
      operationsByContext: { [messageMapKey(context)]: ['op-1'] },
      queuedMessages: {
        [messageMapKey(context)]: [
          { content: 'before', createdAt: 0, id: 'q0', interruptMode: 'soft' },
          msg,
          { content: 'after', createdAt: 2, id: 'q2', interruptMode: 'soft' },
        ],
      },
      sendMessage: vi.fn(async () => {
        order.push('send');
      }),
    } as any;
    return { chat, order };
  };

  // ROOT CAUSE:
  //
  // Send now interrupted the run before withdrawing the item. When that run
  // had already taken it from the server, the withdrawal then failed and no
  // replacement send happened, leaving the follow-up unanswered.
  //
  // Before: cancel, then withdraw.
  // After: withdraw first; an item already on its way stops nothing.
  it('withdraws the item before interrupting the run, then sends it', async () => {
    const { chat, order } = chatWith(true);
    const withdraw = vi.fn(async () => {
      order.push('withdraw');
      return true;
    });

    await sendQueuedMessageNow({
      chat,
      context,
      contextKey: messageMapKey(context),
      msg,
      withdraw,
    });

    expect(order).toEqual(['withdraw', 'cancel', 'send']);
    expect(chat.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'now', metadata: { steer: true } }),
    );
  });

  it('sends on the runtime the item was queued for', async () => {
    // A task-run drawer queues follow-ups with `forceRuntime: 'gateway'`; Send
    // now must not fall back to the user's global runtime preference.
    const { chat } = chatWith(true);

    await sendQueuedMessageNow({
      chat,
      context,
      contextKey: messageMapKey(context),
      msg: { ...msg, forceRuntime: 'gateway' },
      withdraw: async () => true,
    });

    expect(chat.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ forceRuntime: 'gateway', message: 'now' }),
    );
  });

  it('stops nothing and sends nothing when the run already took it', async () => {
    const { chat } = chatWith(true);

    await sendQueuedMessageNow({
      chat,
      context,
      contextKey: messageMapKey(context),
      msg,
      withdraw: async () => false,
    });

    expect(chat.cancelOperation).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['unconfirmed', false],
    ['failed', new Error('device unreachable')],
  ])('puts the item back, held here, when the interrupt is %s', async (_label, cancelled) => {
    const { chat } = chatWith(cancelled);

    await expect(
      sendQueuedMessageNow({
        chat,
        context,
        contextKey: messageMapKey(context),
        msg,
        withdraw: async () => true,
      }),
    ).rejects.toThrow();

    // Back at its own place (index 1), not at the tail, so the order holds.
    expect(chat.restoreQueuedMessage).toHaveBeenCalledWith(
      messageMapKey(context),
      { ...msg, serverDelivery: undefined, serverUnconfirmed: undefined },
      1,
    );
    expect(chat.sendMessage).not.toHaveBeenCalled();
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
