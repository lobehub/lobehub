import type { StoreSetter } from '@/store/types';

import {
  createOptimisticTopicCommentKey,
  type OptimisticTopicComment,
  type OptimisticTopicCommentMutation,
  type OptimisticTopicCommentReplyCountMutation,
  type TopicCommentDraft,
} from './initialState';
import type { TopicCommentStore } from './store';

type Setter = StoreSetter<TopicCommentStore>;

export const createTopicCommentSlice = (
  set: Setter,
  get: () => TopicCommentStore,
  _api?: unknown,
) => new TopicCommentActionImpl(set, get, _api);

export class TopicCommentActionImpl {
  readonly #get: () => TopicCommentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TopicCommentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  clearDraft = (key: string, expectedClientId?: string): void => {
    if (expectedClientId && this.#get().drafts[key]?.clientId !== expectedClientId) return;

    const { [key]: _, ...drafts } = this.#get().drafts;
    this.#set({ drafts }, false, 'clearDraft');
  };

  removeOptimisticComment = (targetKey: string, clientId: string): void => {
    const key = createOptimisticTopicCommentKey(targetKey, clientId);
    const { [key]: _, ...optimisticComments } = this.#get().optimisticComments;
    this.#set({ optimisticComments }, false, 'removeOptimisticComment');
  };

  removeOptimisticMutation = (commentId: string): void => {
    const { [commentId]: _, ...optimisticMutations } = this.#get().optimisticMutations;
    this.#set({ optimisticMutations }, false, 'removeOptimisticMutation');
  };

  removeOptimisticReplyCountMutation = (id: string): void => {
    const { [id]: _, ...optimisticReplyCountMutations } = this.#get().optimisticReplyCountMutations;
    this.#set({ optimisticReplyCountMutations }, false, 'removeOptimisticReplyCountMutation');
  };

  setDraft = (key: string, draft: TopicCommentDraft): void => {
    this.#set({ drafts: { ...this.#get().drafts, [key]: draft } }, false, 'setDraft');
  };

  setDraftContent = (
    key: string,
    content: string,
    editorData?: TopicCommentDraft['editorData'],
  ): void => {
    const current = this.#get().drafts[key];
    const clientId =
      current?.clientId && current.content.trim() === content.trim() ? current.clientId : undefined;

    this.#set(
      {
        drafts: {
          ...this.#get().drafts,
          [key]:
            editorData === undefined ? { clientId, content } : { clientId, content, editorData },
        },
      },
      false,
      'setDraftContent',
    );
  };

  upsertOptimisticComment = (comment: OptimisticTopicComment): void => {
    const key = createOptimisticTopicCommentKey(comment.targetKey, comment.comment.clientId);
    this.#set(
      {
        optimisticComments: {
          ...this.#get().optimisticComments,
          [key]: comment,
        },
      },
      false,
      'upsertOptimisticComment',
    );
  };

  upsertOptimisticMutation = (mutation: OptimisticTopicCommentMutation): void => {
    this.#set(
      {
        optimisticMutations: {
          ...this.#get().optimisticMutations,
          [mutation.comment.id]: mutation,
        },
      },
      false,
      'upsertOptimisticMutation',
    );
  };

  upsertOptimisticReplyCountMutation = (
    mutation: OptimisticTopicCommentReplyCountMutation,
  ): void => {
    this.#set(
      {
        optimisticReplyCountMutations: {
          ...this.#get().optimisticReplyCountMutations,
          [mutation.id]: mutation,
        },
      },
      false,
      'upsertOptimisticReplyCountMutation',
    );
  };
}

export type TopicCommentAction = Pick<TopicCommentActionImpl, keyof TopicCommentActionImpl>;
