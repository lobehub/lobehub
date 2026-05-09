import type { FollowUpChip, FollowUpHint } from '@lobechat/types';

import { followUpActionService } from '@/services/followUpAction';
import { type StoreSetter } from '@/store/types';

import { type FollowUpActionStore } from './store';

// LLM `generateObject` for chip extraction routinely takes 8-12s end-to-end.
// Anything below ~20s aborts before the model can respond.
const TIMEOUT_MS = 20_000;

type Setter = StoreSetter<FollowUpActionStore>;

export const createFollowUpActionSlice = (
  set: Setter,
  get: () => FollowUpActionStore,
  _api?: unknown,
) => new FollowUpActionImpl(set, get, _api);

export class FollowUpActionImpl {
  readonly #set: Setter;
  readonly #get: () => FollowUpActionStore;

  constructor(set: Setter, get: () => FollowUpActionStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  fetchFor = async (topicId: string, hint?: FollowUpHint): Promise<void> => {
    const cur = this.#get();
    // Dedupe: skip if already loading/ready for the same topic
    if (cur.pendingTopicId === topicId && cur.status !== 'idle') return;

    cur.abortController?.abort();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    this.#set(
      {
        abortController: controller,
        chips: [],
        messageId: undefined,
        pendingTopicId: topicId,
        status: 'loading',
        topicId: undefined,
      },
      false,
      'fetchFor:start',
    );

    const result = await followUpActionService.extract({ hint, topicId }, controller.signal);
    clearTimeout(timeoutId);

    // Discard stale results: if the active controller in state is no longer
    // this one, our call has been superseded — either by clear()/abort()
    // (e.g., user sent a new message) or by a newer fetchFor for the same
    // topic (next turn). Identity beats topicId here because a same-topic
    // follow-up turn would otherwise let an in-flight prior result overwrite
    // the new turn's chips when the network abort race is lost.
    if (this.#get().abortController !== controller) return;

    if (!result || !result.messageId || result.chips.length === 0) {
      this.#set(
        {
          abortController: undefined,
          chips: [],
          messageId: undefined,
          pendingTopicId: undefined,
          status: 'idle',
          topicId: undefined,
        },
        false,
        'fetchFor:fail',
      );
      return;
    }

    this.#set(
      {
        abortController: undefined,
        chips: result.chips,
        messageId: result.messageId,
        pendingTopicId: undefined,
        status: 'ready',
        topicId,
      },
      false,
      'fetchFor:ready',
    );
  };

  abort = (): void => {
    const cur = this.#get();
    cur.abortController?.abort();
    this.#set(
      {
        abortController: undefined,
        chips: [],
        messageId: undefined,
        pendingTopicId: undefined,
        status: 'idle',
        topicId: undefined,
      },
      false,
      'abort',
    );
  };

  clear = (): void => {
    this.abort();
  };

  consume = (chip: FollowUpChip): void => {
    void chip;
    this.clear();
  };
}

export type FollowUpActionAction = Pick<FollowUpActionImpl, keyof FollowUpActionImpl>;
