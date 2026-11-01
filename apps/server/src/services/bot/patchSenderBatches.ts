import type { Adapter, Chat, Message, MessageContext } from 'chat';

import { getSameSenderMessages } from './mergeMessages';

type Dispatch = (
  adapter: Adapter,
  threadId: string,
  message: Message,
  context?: MessageContext,
) => Promise<void>;

/**
 * Split collected messages before the SDK chooses mention/subscription handlers.
 * Keep the SDK's thread lock and arrival order, while resolving each author's
 * identity and access gates independently. Handler-level filtering is too late:
 * it can discard another author's message or inherit their mention flag.
 *
 * This internal SDK boundary is covered by real-package contract tests.
 */
export function patchSenderBatches(
  bot: Chat,
  isCommand: (message: Message) => boolean = () => false,
): void {
  const target = bot as unknown as { dispatchToHandlers: Dispatch };
  if (typeof target.dispatchToHandlers !== 'function') {
    throw new Error('Chat SDK does not expose the sender-batch dispatch boundary');
  }
  const dispatch = target.dispatchToHandlers.bind(bot);
  target.dispatchToHandlers = async (adapter, threadId, message, context) => {
    const batches: Message[][] = [];
    for (const source of [...(context?.skipped ?? []), message]) {
      const batch = batches.at(-1);
      // Commands change conversation state and must retain their own turn on
      // either side of ordinary content, even when every source has one author.
      if (
        batch &&
        !isCommand(source) &&
        !isCommand(batch[0]) &&
        getSameSenderMessages(source, [batch[0]]).length > 0
      ) {
        batch.push(source);
      } else {
        batches.push([source]);
      }
    }
    const failures: unknown[] = [];
    for (const batch of batches) {
      const latest = batch.at(-1)!;
      try {
        await dispatch(adapter, threadId, latest, {
          skipped: batch.slice(0, -1),
          totalSinceLastHandler: batch.length,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Sender batch dispatch failed');
  };
}
