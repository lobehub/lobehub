import type { FollowUpChip, FollowUpHint } from '@lobechat/types';

import { followUpActionService } from '@/services/followUpAction';
import { type StoreSetter } from '@/store/types';

import { type FollowUpActionStore } from './store';

const TIMEOUT_MS = 3000;

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

  fetchFor = async (messageId: string, hint?: FollowUpHint): Promise<void> => {
    const cur = this.#get();
    if (cur.messageId === messageId && cur.status !== 'idle') return;

    cur.abortController?.abort();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    this.#set(
      { abortController: controller, chips: [], messageId, status: 'loading' },
      false,
      'fetchFor:start',
    );

    const result = await followUpActionService.extract({ messageId, hint }, controller.signal);
    clearTimeout(timeoutId);

    if (this.#get().messageId !== messageId) return;

    if (!result) {
      this.#set(
        { abortController: undefined, chips: [], messageId: undefined, status: 'idle' },
        false,
        'fetchFor:fail',
      );
      return;
    }

    this.#set(
      { abortController: undefined, chips: result.chips, status: 'ready' },
      false,
      'fetchFor:ready',
    );
  };

  abort = (): void => {
    const cur = this.#get();
    cur.abortController?.abort();
    this.#set(
      { abortController: undefined, chips: [], messageId: undefined, status: 'idle' },
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
