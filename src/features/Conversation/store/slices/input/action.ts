import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { type StateCreator } from 'zustand';

import { aiAgentService } from '@/services/aiAgent';
import { useChatStore } from '@/store/chat';

import { type State } from '../../initialState';

export interface InputAction {
  /**
   * Cleanup input state
   */
  cleanupInput: () => void;

  /**
   * Commit the armed scheduled send: persist the composer's turn as a `scheduled`
   * topic that the backend cron fires at {@link State.scheduledSendAt}.
   *
   * Called from the send handler instead of `sendMessage` — nothing runs now, so
   * this deliberately does not go through the agent runtime.
   *
   * Returns whether the schedule was persisted. The send handler keeps the
   * composer intact until it is: scheduling is one rejectable round-trip (the
   * chosen time may have just gone past, the request may fail) and — unlike a
   * normal send — there is no message row to recover the text from afterwards.
   */
  commitScheduledSend: (message: string, files?: { id: string }[]) => Promise<boolean>;

  /**
   * Report the floating overlay height (TodoProgress + QueueTray) so the
   * ChatList scroll container can reserve matching bottom padding.
   */
  setChatInputOverlayHeight: (height: number) => void;

  /**
   * Set the editor instance
   */
  setEditor: (editor: any) => void;

  /** Arm (or, with `undefined`, disarm) a deferred send. */
  setScheduledSendAt: (runAt?: string) => void;

  /**
   * Update the input message
   */
  updateInputMessage: (message: string) => void;
}

export const inputSlice: StateCreator<State & InputAction, [], [], InputAction> = (set, get) => ({
  cleanupInput: () => {
    set({
      chatInputOverlayHeight: 0,
      editor: null,
      inputMessage: '',
      scheduledSendAt: undefined,
    });
    // Also clear ChatStore's mainInputEditor
    useChatStore.setState({ mainInputEditor: null });
  },

  commitScheduledSend: async (message, files) => {
    const { context, scheduledSendAt } = get();
    const agentId = context.agentId;
    if (!scheduledSendAt || !agentId || !message.trim()) return false;

    const fileIds = (files ?? []).map((file) => file.id);

    try {
      await aiAgentService.scheduleAgentRun({
        agentId,
        fileIds: fileIds.length > 0 ? fileIds : undefined,
        prompt: message,
        runAt: scheduledSendAt,
      });
    } catch (error) {
      // The composer still holds the text and the attachments — the send handler
      // clears it only on a `true` return — so the user can retry, or pick a new
      // time if this one went past while they were typing. Stay armed: the chip
      // is the only thing telling them the next Send is still a scheduled one.
      console.error('[commitScheduledSend] failed:', error);
      toast.error(t('input.schedule.failed', { ns: 'chat' }));
      return false;
    }

    // Disarm only now that the turn is parked: a live chip would otherwise claim
    // the NEXT message is scheduled too.
    set({ scheduledSendAt: undefined });

    // Surface the new topic in the sidebar, where it renders with a clock.
    await useChatStore.getState().refreshTopic();
    toast.success(
      t('input.schedule.scheduled', {
        ns: 'chat',
        time: new Date(scheduledSendAt).toLocaleString(undefined, {
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          month: '2-digit',
        }),
      }),
    );

    return true;
  },

  setChatInputOverlayHeight: (height) => {
    if (get().chatInputOverlayHeight === height) return;
    set({ chatInputOverlayHeight: height });
  },

  setEditor: (editor) => {
    set({ editor });
    // Sync to ChatStore's mainInputEditor for error recovery in sendMessage
    useChatStore.setState({ mainInputEditor: editor });
  },

  setScheduledSendAt: (runAt) => {
    set({ scheduledSendAt: runAt });
  },

  updateInputMessage: (message) => {
    set({ inputMessage: message });
  },
});
