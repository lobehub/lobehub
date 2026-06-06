import type { FollowUpChip, FollowUpHint, FollowUpModelConfig } from '@lobechat/types';

import { aiChatService } from '@/services/aiChat';
import { followUpActionService } from '@/services/followUpAction';
import { type StoreSetter } from '@/store/types';

import { type FollowUpActionSlot } from './initialState';
import { type FollowUpActionStore } from './store';

// LLM `generateObject` for chip extraction routinely takes 8-12s end-to-end.
// Anything below ~20s aborts before the model can respond.
const TIMEOUT_MS = 20_000;

const IDLE_SLOT: FollowUpActionSlot = { chips: [], status: 'idle' };

type Setter = StoreSetter<FollowUpActionStore>;

interface FetchForParams {
  hint?: FollowUpHint;
  modelConfig: FollowUpModelConfig;
  threadId?: string;
  topicId: string;
}

const writeSlot = (
  set: Setter,
  conversationKey: string,
  slot: FollowUpActionSlot,
  action: string,
): void => {
  set(
    (state) => ({
      slots: {
        ...state.slots,
        [conversationKey]: slot,
      },
    }),
    false,
    action,
  );
};

const removeSlot = (set: Setter, conversationKey: string, action: string): void => {
  set(
    (state) => {
      if (!state.slots[conversationKey]) return state;

      const { [conversationKey]: _, ...rest } = state.slots;
      return { slots: rest };
    },
    false,
    action,
  );
};

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

  fetchFor = async (conversationKey: string, params: FetchForParams): Promise<void> => {
    const existing = this.#get().slots[conversationKey];
    if (existing?.status === 'loading') return;

    // A ready-but-unacted chip set being replaced by a new turn is a dismissal.
    // (Normally `onBeforeSendMessage` clears first, so this is a belt-and-braces
    // guard for paths that fetch without an explicit clear.)
    this.#maybeRecordDismissal(existing);
    existing?.abortController?.abort();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    writeSlot(
      this.#set,
      conversationKey,
      {
        abortController: controller,
        chips: [],
        status: 'loading',
      },
      'fetchFor:start',
    );

    const result = await followUpActionService.extract(
      {
        hint: params.hint,
        modelConfig: params.modelConfig,
        threadId: params.threadId,
        topicId: params.topicId,
      },
      controller.signal,
    );
    clearTimeout(timeoutId);

    // Identity guard: a same-key follow-up turn (next assistant settle) would
    // otherwise let an in-flight prior result overwrite the new turn's chips
    // when the network abort race is lost.
    if (this.#get().slots[conversationKey]?.abortController !== controller) return;

    if (!result || !result.messageId || result.chips.length === 0) {
      writeSlot(this.#set, conversationKey, { ...IDLE_SLOT }, 'fetchFor:fail');
      return;
    }

    writeSlot(
      this.#set,
      conversationKey,
      {
        chips: result.chips,
        messageId: result.messageId,
        status: 'ready',
        tracingId: result.tracingId,
      },
      'fetchFor:ready',
    );
  };

  abort = (conversationKey: string): void => {
    const slot = this.#get().slots[conversationKey];
    if (!slot) return;
    this.#maybeRecordDismissal(slot);
    slot.abortController?.abort();
    writeSlot(this.#set, conversationKey, { ...IDLE_SLOT }, 'abort');
  };

  clear = (conversationKey: string): void => {
    const slot = this.#get().slots[conversationKey];
    if (!slot) return;
    this.#maybeRecordDismissal(slot);
    slot.abortController?.abort();
    removeSlot(this.#set, conversationKey, 'clear');
  };

  consume = (conversationKey: string, chip: FollowUpChip): void => {
    void chip;
    this.clear(conversationKey);
  };

  /**
   * Report that the user clicked a chip — a positive feedback signal for the
   * generated suggestion set. Marks the slot so the subsequent clear-on-send
   * doesn't additionally fire a dismissal for the same chips.
   */
  recordChipClick = (conversationKey: string, chipIndex: number): void => {
    const slot = this.#get().slots[conversationKey];
    if (!slot || slot.status !== 'ready' || !slot.tracingId || slot.feedbackDone) return;

    void aiChatService
      .recordTracingFeedback({
        data: { chipIndex, totalChips: slot.chips.length },
        signal: 'positive',
        source: 'followup_clicked',
        tracingId: slot.tracingId,
      })
      .catch((err) => console.warn('[FollowUp] recordFeedback (clicked) failed', err));

    writeSlot(this.#set, conversationKey, { ...slot, feedbackDone: true }, 'recordChipClick');
  };

  /**
   * Fire a `negative` dismissal for a chip set the user saw but never clicked —
   * the suggestions weren't compelling. Together with `followup_clicked` this
   * makes chip click-through-rate computable per prompt version. No-op unless
   * the slot was actually shown (`ready`), carries a tracingId, and hasn't
   * already produced a click signal.
   */
  #maybeRecordDismissal = (slot: FollowUpActionSlot | undefined): void => {
    if (!slot || slot.status !== 'ready' || !slot.tracingId || slot.feedbackDone) return;

    void aiChatService
      .recordTracingFeedback({
        data: { totalChips: slot.chips.length },
        signal: 'negative',
        source: 'followup_dismissed',
        tracingId: slot.tracingId,
      })
      .catch((err) => console.warn('[FollowUp] recordFeedback (dismissed) failed', err));
  };
}

export type FollowUpActionAction = Pick<FollowUpActionImpl, keyof FollowUpActionImpl>;
