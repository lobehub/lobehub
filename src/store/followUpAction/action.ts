import type { FollowUpChip, FollowUpHint, FollowUpModelConfig } from '@lobechat/types';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import { aiChatService } from '@/services/aiChat';
import { followUpActionService } from '@/services/followUpAction';
import { type StoreSetter } from '@/store/types';

import { type FollowUpActionSlot } from './initialState';
import { followUpSlotResource } from './projection';
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

export const createFollowUpActionSlice = (
  set: Setter,
  get: () => FollowUpActionStore,
  _api?: unknown,
) => new FollowUpActionImpl(set, get, _api);

export class FollowUpActionImpl {
  readonly #get: () => FollowUpActionStore;
  /** Local-first replica of the per-conversation chip slots (`slots` is its view). */
  readonly #slots;

  constructor(set: Setter, get: () => FollowUpActionStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#slots = createReplicaSlice(followUpSlotResource, {
      actionPrefix: 'followUpAction/slot',
      get,
      set,
      stateKey: 'slotsReplica',
      view: recordLens<FollowUpActionStore, FollowUpActionSlot>('slots'),
    });
  }

  /** Replace one conversation's slot (in-memory only — slots never persist). */
  #writeSlot = (conversationKey: string, slot: FollowUpActionSlot): void => {
    this.#slots.update(conversationKey, () => slot, { persist: false });
  };

  /** Drop one conversation's slot (and its replica bookkeeping entry). */
  #removeSlot = (conversationKey: string): void => {
    this.#slots.remove(conversationKey);
  };

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

    this.#writeSlot(conversationKey, {
      abortController: controller,
      chips: [],
      status: 'loading',
    });

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
      this.#writeSlot(conversationKey, { ...IDLE_SLOT });
      return;
    }

    this.#writeSlot(conversationKey, {
      chips: result.chips,
      messageId: result.messageId,
      status: 'ready',
      tracingId: result.tracingId,
    });
  };

  abort = (conversationKey: string): void => {
    const slot = this.#get().slots[conversationKey];
    if (!slot) return;
    this.#maybeRecordDismissal(slot);
    slot.abortController?.abort();
    this.#writeSlot(conversationKey, { ...IDLE_SLOT });
  };

  clear = (conversationKey: string): void => {
    const slot = this.#get().slots[conversationKey];
    if (!slot) return;
    this.#maybeRecordDismissal(slot);
    slot.abortController?.abort();
    this.#removeSlot(conversationKey);
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

    this.#writeSlot(conversationKey, { ...slot, feedbackDone: true });
  };

  /**
   * Fire a `negative` dismissal when an unclicked chip set is cleared or replaced.
   * Leaving the conversation does not produce a dismissal, so these signals
   * alone do not measure click-through rate across all impressions. No-op unless
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
