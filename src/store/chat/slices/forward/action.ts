import type { UIChatMessage } from '@lobechat/types';

import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';
import type { StoreSetter } from '@/store/types';

import type { ForwardContentOptions } from './helpers';
import { buildForwardedContent } from './helpers';

export interface ForwardTarget {
  id: string;
  title?: string | null;
}

export interface ForwardResultItem {
  agentId: string;
  error?: unknown;
  topicId?: string;
}

export interface ForwardResult {
  failed: ForwardResultItem[];
  succeeded: ForwardResultItem[];
}

export interface ForwardMessagesParams extends ForwardContentOptions {
  messages: UIChatMessage[];
  note?: string;
  targets: ForwardTarget[];
}

export interface ForwardTopicParams extends Omit<ForwardMessagesParams, 'messages'> {
  sourceAgentId: string;
  topicId: string;
}

type Setter = StoreSetter<ChatStore>;

export class ChatForwardActionImpl {
  readonly #get: () => ChatStore;

  constructor(_set: Setter, get: () => ChatStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  forwardMessages = async ({
    header,
    messages,
    note,
    roleLabel,
    targets,
  }: ForwardMessagesParams): Promise<ForwardResult> => {
    if (targets.length === 0) return { failed: [], succeeded: [] };

    const transcript = buildForwardedContent(messages, { header, roleLabel });
    const content = note?.trim() ? `${transcript}\n\n${note.trim()}` : transcript;
    const settled = await Promise.allSettled(
      targets.map(async ({ id }) => {
        const result = await this.#get().sendMessage({
          context: { agentId: id, isNew: true, isolatedTopic: true, scope: 'main' },
          message: content,
          messages: [],
        });

        return { agentId: id, topicId: result?.createdTopicId };
      }),
    );

    return settled.reduce<ForwardResult>(
      (result, item, index) => {
        if (item.status === 'fulfilled') {
          result.succeeded.push(item.value);
        } else {
          result.failed.push({ agentId: targets[index].id, error: item.reason });
        }
        return result;
      },
      { failed: [], succeeded: [] },
    );
  };

  forwardTopic = async ({
    sourceAgentId,
    topicId,
    ...params
  }: ForwardTopicParams): Promise<ForwardResult> => {
    const messages = await messageService.getMessages({ agentId: sourceAgentId, topicId });
    return this.forwardMessages({ ...params, messages });
  };
}

export type ChatForwardAction = Pick<ChatForwardActionImpl, keyof ChatForwardActionImpl>;
