import type { UIChatMessage } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
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
  sourceSchedulePaused?: boolean;
  succeeded: ForwardResultItem[];
}

export interface ForwardMessagesParams extends ForwardContentOptions {
  messages: UIChatMessage[];
  note?: string;
  onTopicCreated?: (target: ForwardTarget, topicId: string) => void | Promise<void>;
  targets: ForwardTarget[];
}

export interface ForwardTopicParams extends Omit<ForwardMessagesParams, 'messages'> {
  cancelSourceContinuation?: boolean;
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
    cancelSourceContinuation,
    header,
    topicId,
    note,
    onTopicCreated,
    roleLabel,
    sourceAgentId,
    targets,
  }: ForwardTopicParams): Promise<ForwardResult> => {
    if (targets.length === 0) return { failed: [], succeeded: [] };

    const cliInstruction = [
      `Use the LobeHub CLI to read the full conversation history for topic ${topicId}:`,
      '',
      `lh topic view ${topicId} -L 500`,
      '',
      'Every message it prints is the context from the previous Agent. If the topic has more than 500 messages, page through the remainder with --from and --to. Continue the work from where it left off and handle the remaining request item by item.',
      'If the CLI is unavailable, continue using the conversation transcript included below.',
    ]
      .filter(Boolean)
      .join('\n');
    let transcriptPromise: Promise<string> | undefined;
    const getTranscript = () => {
      transcriptPromise ??= messageService
        .getMessages({ agentId: sourceAgentId, topicId })
        .then((messages) => {
          const transcript = buildForwardedContent(messages, { header, roleLabel });
          return note?.trim() ? `${transcript}\n\n${note.trim()}` : transcript;
        });
      return transcriptPromise;
    };
    // Resolve configuration and context before touching the source schedule.
    const prepared = await Promise.allSettled(
      targets.map(async (target) => {
        let config = agentSelectors.getAgentConfigById(target.id)(getAgentStoreState());
        if (!config) {
          const fetchedConfig = await agentService.getAgentConfigById(target.id);
          if (!fetchedConfig) throw new Error(`Forwarding target agent not found: ${target.id}`);
          config = fetchedConfig;
          getAgentStoreState().internal_dispatchAgentMap(target.id, fetchedConfig);
        }

        const content = config.agencyConfig?.heterogeneousProvider
          ? `${cliInstruction}\n\n${await getTranscript()}`
          : await getTranscript();

        return { content, target };
      }),
    );
    const hasReadyTarget = prepared.some((item) => item.status === 'fulfilled');
    // A claimed source rejects the handoff before any target can start.
    const cancellation =
      cancelSourceContinuation && hasReadyTarget
        ? await topicService.cancelRateLimitContinuation(topicId)
        : null;
    if (cancellation)
      this.#get().internal_dispatchTopic({
        id: topicId,
        type: 'updateTopic',
        value: { metadata: cancellation.metadata, status: 'failed' },
      });
    let accepted = false;
    const settled = await Promise.allSettled(
      prepared.map(async (item) => {
        if (item.status === 'rejected') throw item.reason;
        const { content, target } = item.value;
        const result = await this.#get().sendMessage({
          context: { agentId: target.id, isNew: true, isolatedTopic: true, scope: 'main' },
          message: content,
          messages: [],
          onTopicCreated: async (createdTopicId) => {
            accepted = true;
            await onTopicCreated?.(target, createdTopicId);
          },
        });
        if (!result?.createdTopicId)
          throw new Error(`Forwarding did not create a topic for ${target.id}`);

        accepted = true;
        return { agentId: target.id, topicId: result.createdTopicId };
      }),
    );

    // A failed response can follow a persisted target. Do not re-arm the source
    // on ambiguous sends; let the user inspect the target before retrying.
    return settled.reduce<ForwardResult>(
      (result, item, index) => {
        if (item.status === 'fulfilled') result.succeeded.push(item.value);
        else result.failed.push({ agentId: targets[index].id, error: item.reason });
        return result;
      },
      { failed: [], succeeded: [], sourceSchedulePaused: !!cancellation && !accepted },
    );
  };
}

export type ChatForwardAction = Pick<ChatForwardActionImpl, keyof ChatForwardActionImpl>;
