import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { sendQueuedMessageNow, sendQueuedMessagesNow } from './sendQueuedNow';

describe('sendQueuedMessageNow', () => {
  const context = { agentId: 'agt-1', topicId: 'tpc-1' };
  const contextKey = messageMapKey(context);
  const msg = {
    content: 'now',
    createdAt: 1,
    id: 'q1',
    interruptMode: 'soft' as const,
    serverDelivery: 'server' as const,
  };
  const chatWith = (cancelled: boolean | Error) => {
    const order: string[] = [];
    const dbMessagesMap: Record<string, UIChatMessage[]> = { [contextKey]: [] };
    const chat = {
      cancelOperation: vi.fn(async () => {
        order.push('cancel');
        if (cancelled instanceof Error) throw cancelled;
        return cancelled;
      }),
      restoreQueuedMessage: vi.fn(),
      dbMessagesMap,
      internal_createClientMessage: vi.fn(
        (id: string, value: Pick<UIChatMessage, 'content' | 'metadata' | 'role'>) => {
          dbMessagesMap[contextKey].push({ ...value, createdAt: 1, id, updatedAt: 1 });
        },
      ),
      internal_dispatchMessage: vi.fn(({ id }: { id: string }) => {
        dbMessagesMap[contextKey] = dbMessagesMap[contextKey].filter(
          (message) => message.id !== id,
        );
      }),
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
      sendMessage: vi.fn(async ({ onMessageAccepted, optimisticUserMessageId }) => {
        order.push('send');
        const row = dbMessagesMap[contextKey].find(({ id }) => id === optimisticUserMessageId);
        if (row) row.metadata = { steer: true };
        onMessageAccepted();
      }),
    } as any;
    return { chat, order };
  };

  it('shows a user bubble with the final message ID while the device is still stopping', async () => {
    const { chat } = chatWith(true);
    const cancellation = Promise.withResolvers<boolean>();
    chat.cancelOperation.mockReturnValueOnce(cancellation.promise);

    const sending = sendQueuedMessageNow({
      context,
      contextKey,
      getChat: () => chat,
      msg,
      withdraw: async () => true,
    });

    await vi.waitFor(() => expect(chat.cancelOperation).toHaveBeenCalledOnce());
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(chat.dbMessagesMap[contextKey]).toEqual([
      expect.objectContaining({
        content: 'now',
        metadata: { scope: LOCAL_MESSAGE_SCOPE, steer: true },
        role: 'user',
      }),
    ]);
    const [{ id }] = chat.dbMessagesMap[contextKey];

    cancellation.resolve(true);
    await expect(sending).resolves.toBe('sent');
    expect(chat.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ optimisticUserMessageId: id }),
    );
    expect(chat.dbMessagesMap[contextKey]).toEqual([
      expect.objectContaining({ id, metadata: { steer: true } }),
    ]);
    expect(chat.restoreQueuedMessage).not.toHaveBeenCalled();
  });

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
      getChat: () => chat,
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
      getChat: () => chat,
      context,
      contextKey: messageMapKey(context),
      msg: { ...msg, forceRuntime: 'gateway' },
      withdraw: async () => true,
    });

    expect(chat.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ forceRuntime: 'gateway', message: 'now' }),
    );
  });

  it('stops nothing and sends nothing when the run already wrote it', async () => {
    const { chat } = chatWith(true);
    chat.queuedMessages[messageMapKey(context)] = [];

    const outcome = await sendQueuedMessageNow({
      getChat: () => chat,
      context,
      contextKey: messageMapKey(context),
      msg,
      withdraw: async () => false,
    });

    expect(outcome).toBe('delivered');
    expect(chat.cancelOperation).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  //
  // A CLI agent run takes a follow-up from the server but only writes it
  // between its own turns, so for minutes it stays "delivering". Send now read
  // that as already sent: it showed "Already sent to the agent" and neither
  // interrupted the run nor sent the message.
  //
  // Before: a refused withdrawal stopped nothing.
  // After: one still in the tray interrupts the run, which hands it back, and
  // is withdrawn again and sent.
  it('interrupts a run that took it but has not written it yet, then sends it', async () => {
    const { chat, order } = chatWith(true);
    let delivering = true;
    const withdraw = vi.fn(async () => {
      order.push('withdraw');
      return !delivering;
    });
    chat.cancelOperation.mockImplementation(async () => {
      order.push('cancel');
      delivering = false;
      return true;
    });

    const outcome = await sendQueuedMessageNow({
      getChat: () => chat,
      context,
      contextKey: messageMapKey(context),
      msg,
      withdraw,
    });

    expect(outcome).toBe('sent');
    expect(order).toEqual(['withdraw', 'cancel', 'withdraw', 'send']);
  });

  it('sends nothing when the run wrote it before the interrupt landed', async () => {
    const { chat } = chatWith(true);

    const outcome = await sendQueuedMessageNow({
      getChat: () => chat,
      context,
      contextKey: messageMapKey(context),
      msg,
      withdraw: async () => false,
    });

    expect(outcome).toBe('delivered');
    expect(chat.cancelOperation).toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(chat.dbMessagesMap[contextKey]).toEqual([]);
  });

  it('keeps an item the run holds in the tray when the interrupt fails', async () => {
    const { chat } = chatWith(false);

    await expect(
      sendQueuedMessageNow({
        getChat: () => chat,
        context,
        contextKey: messageMapKey(context),
        msg,
        withdraw: async () => false,
      }),
    ).rejects.toThrow();

    expect(chat.restoreQueuedMessage).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(chat.dbMessagesMap[contextKey]).toEqual([]);
  });

  it('restores the queue if the replacement send returns without accepting the message', async () => {
    const { chat } = chatWith(true);
    chat.sendMessage.mockResolvedValueOnce(undefined);

    await expect(
      sendQueuedMessageNow({
        context,
        contextKey,
        getChat: () => chat,
        msg,
        withdraw: async () => true,
      }),
    ).rejects.toThrow('The queued message was not accepted');

    expect(chat.restoreQueuedMessage).toHaveBeenCalledOnce();
    expect(chat.dbMessagesMap[contextKey]).toEqual([]);
  });

  it('keeps the bubble when persistence is acknowledged ahead of the transcript', async () => {
    const { chat } = chatWith(true);
    chat.sendMessage.mockImplementationOnce(
      async ({
        onMessageAccepted,
        onMessagePersisted,
      }: {
        onMessageAccepted: () => void;
        onMessagePersisted: () => void;
      }) => {
        onMessageAccepted();
        onMessagePersisted();
      },
    );

    await expect(
      sendQueuedMessageNow({
        context,
        contextKey,
        getChat: () => chat,
        msg,
        withdraw: async () => true,
      }),
    ).resolves.toBe('sent');
    expect(chat.dbMessagesMap[contextKey]).toEqual([expect.objectContaining({ content: 'now' })]);
  });

  it.each([
    ['unconfirmed', false],
    ['failed', new Error('device unreachable')],
  ])('puts the item back, held here, when the interrupt is %s', async (_label, cancelled) => {
    const { chat } = chatWith(cancelled);

    await expect(
      sendQueuedMessageNow({
        getChat: () => chat,
        context,
        contextKey: messageMapKey(context),
        msg,
        withdraw: async () => true,
      }),
    ).rejects.toThrow();

    // Back at its own place (index 1), not at the tail, so the order holds.
    expect(chat.restoreQueuedMessage).toHaveBeenCalledWith(
      messageMapKey(context),
      {
        ...msg,
        serverDelivering: undefined,
        serverDelivery: undefined,
        serverUnconfirmed: undefined,
      },
      1,
    );
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });
});

describe('sendQueuedMessagesNow', () => {
  const context = { agentId: 'agt-1', topicId: 'tpc-1' };
  const contextKey = messageMapKey(context);
  const queued = (id: string, createdAt: number, content = id) => ({
    content,
    createdAt,
    id,
    interruptMode: 'soft' as const,
  });

  const chatWith = (initialQueue: ReturnType<typeof queued>[]) => {
    const order: string[] = [];
    const dbMessagesMap: Record<string, UIChatMessage[]> = { [contextKey]: [] };
    const queuedMessages: Record<string, any[]> = { [contextKey]: [...initialQueue] };
    const chat = {
      cancelOperation: vi.fn(async () => {
        order.push('cancel');
        return true;
      }),
      dbMessagesMap,
      internal_createClientMessage: vi.fn(
        (id: string, value: Pick<UIChatMessage, 'content' | 'metadata' | 'role'>) => {
          dbMessagesMap[contextKey].push({ ...value, createdAt: 1, id, updatedAt: 1 });
        },
      ),
      internal_dispatchMessage: vi.fn(({ id }: { id: string }) => {
        dbMessagesMap[contextKey] = dbMessagesMap[contextKey].filter(
          (message) => message.id !== id,
        );
      }),
      operations: {
        'op-1': {
          context,
          id: 'op-1',
          metadata: { startTime: 1 },
          status: 'running',
          type: 'execHeterogeneousAgent',
        },
      },
      operationsByContext: { [contextKey]: ['op-1'] },
      queuedMessages,
      restoreQueuedMessage: vi.fn((key: string, msg: any, index: number) => {
        queuedMessages[key].splice(Math.min(index, queuedMessages[key].length), 0, msg);
      }),
      sendMessage: vi.fn(async ({ onMessageAccepted }) => {
        order.push('send');
        onMessageAccepted();
      }),
    } as any;
    const withdraw = vi.fn(async (msg: { id: string }) => {
      order.push(`withdraw:${msg.id}`);
      const queue = queuedMessages[contextKey];
      const index = queue.findIndex((item) => item.id === msg.id);
      if (index < 0) return false;
      queue.splice(index, 1);
      return true;
    });
    return { chat, order, queuedMessages, withdraw };
  };

  it('stops the run once and sends every queued message as one steered message', async () => {
    const a = queued('a', 1, 'first');
    const b = queued('b', 2, 'second');
    const { chat, order, withdraw } = chatWith([a, b]);

    await expect(
      sendQueuedMessagesNow({ context, contextKey, getChat: () => chat, msgs: [a, b], withdraw }),
    ).resolves.toBe('sent');

    expect(order).toEqual(['withdraw:a', 'withdraw:b', 'cancel', 'send']);
    expect(chat.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'first\n\nsecond', metadata: { steer: true } }),
    );
  });

  it('takes what was queued while the run stopped into the same message', async () => {
    const a = queued('a', 1, 'first');
    const { chat, order, queuedMessages, withdraw } = chatWith([a]);
    chat.cancelOperation.mockImplementationOnce(async () => {
      order.push('cancel');
      queuedMessages[contextKey].push(queued('late', 5, 'late'));
      return true;
    });

    await sendQueuedMessagesNow({
      context,
      contextKey,
      getChat: () => chat,
      msgs: [a],
      takeArrivals: true,
      withdraw,
    });

    expect(order).toEqual(['withdraw:a', 'cancel', 'withdraw:late', 'send']);
    expect(chat.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'first\n\nlate' }),
    );
    // The pending bubble the send takes over shows the merged message, not the first one alone.
    const [{ optimisticUserMessageId }] = chat.sendMessage.mock.calls[0];
    expect(chat.internal_createClientMessage).toHaveBeenLastCalledWith(
      optimisticUserMessageId,
      expect.objectContaining({ content: 'first\n\nlate' }),
      expect.anything(),
    );
    expect(queuedMessages[contextKey]).toEqual([]);
  });

  it('leaves arrivals queued without takeArrivals', async () => {
    const a = queued('a', 1);
    const { chat, queuedMessages, withdraw } = chatWith([a]);
    chat.cancelOperation.mockImplementationOnce(async () => {
      queuedMessages[contextKey].push(queued('late', 5));
      return true;
    });

    await sendQueuedMessagesNow({ context, contextKey, getChat: () => chat, msgs: [a], withdraw });

    expect(queuedMessages[contextKey]).toEqual([expect.objectContaining({ id: 'late' })]);
  });

  it('puts every withdrawn message back at its own place when the stop fails', async () => {
    const a = queued('a', 1);
    const keep = queued('keep', 2);
    const c = queued('c', 3);
    const { chat, queuedMessages, withdraw } = chatWith([a, keep, c]);
    chat.cancelOperation.mockResolvedValueOnce(false);

    await expect(
      sendQueuedMessagesNow({ context, contextKey, getChat: () => chat, msgs: [a, c], withdraw }),
    ).rejects.toThrow();

    expect(queuedMessages[contextKey].map((msg) => msg.id)).toEqual(['a', 'keep', 'c']);
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });
});
