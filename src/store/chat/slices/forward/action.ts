import type { UIChatMessage } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
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
  onTopicCreated?: (target: ForwardTarget, topicId: string) => void;
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
    onTopicCreated,
    roleLabel,
    targets,
  }: ForwardMessagesParams): Promise<ForwardResult> => {
    if (targets.length === 0) return { failed: [], succeeded: [] };

    const transcript = buildForwardedContent(messages, { header, roleLabel });
    const content = note?.trim() ? `${transcript}\n\n${note.trim()}` : transcript;
    const settled = await Promise.allSettled(
      targets.map(async (target) => {
        const { id } = target;
        if (!agentSelectors.getAgentConfigById(id)(getAgentStoreState())) {
          const config = await agentService.getAgentConfigById(id);
          if (!config) throw new Error(`Forwarding target agent not found: ${id}`);

          getAgentStoreState().internal_dispatchAgentMap(id, config);
        }

        const result = await this.#get().sendMessage({
          context: { agentId: id, isNew: true, isolatedTopic: true, scope: 'main' },
          message: content,
          messages: [],
          onTopicCreated: (topicId) => onTopicCreated?.(target, topicId),
        });
        if (!result?.createdTopicId) throw new Error(`Forwarding did not create a topic for ${id}`);

        return { agentId: id, topicId: result.createdTopicId };
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
    topicId,
    note,
    onTopicCreated,
    targets,
  }: ForwardTopicParams): Promise<ForwardResult> => {
    if (targets.length === 0) return { failed: [], succeeded: [] };

    const instruction = [
      `Use the LobeHub CLI to read the full conversation history for topic ${topicId}:`,
      '',
      `lh topic view ${topicId} -L 500`,
      '',
      'Every message it prints is the context from the previous Agent. If the topic has more than 500 messages, page through the remainder with --from and --to. Continue the work from where it left off and handle the remaining request item by item.',
      note?.trim() ? `Additional instructions from the user:\n\n${note.trim()}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
    const settled = await Promise.allSettled(
      targets.map(async (target) => {
        if (!agentSelectors.getAgentConfigById(target.id)(getAgentStoreState())) {
          const config = await agentService.getAgentConfigById(target.id);
          if (!config) throw new Error(`Forwarding target agent not found: ${target.id}`);
          getAgentStoreState().internal_dispatchAgentMap(target.id, config);
        }

        const result = await this.#get().sendMessage({
          context: { agentId: target.id, isNew: true, isolatedTopic: true, scope: 'main' },
          message: instruction,
          messages: [],
          onTopicCreated: (createdTopicId) => onTopicCreated?.(target, createdTopicId),
        });
        if (!result?.createdTopicId)
          throw new Error(`Forwarding did not create a topic for ${target.id}`);

        return { agentId: target.id, topicId: result.createdTopicId };
      }),
    );

    return settled.reduce<ForwardResult>(
      (result, item, index) => {
        if (item.status === 'fulfilled') result.succeeded.push(item.value);
        else result.failed.push({ agentId: targets[index].id, error: item.reason });
        return result;
      },
      { failed: [], succeeded: [] },
    );
  };
}

export type ChatForwardAction = Pick<ChatForwardActionImpl, keyof ChatForwardActionImpl>;
