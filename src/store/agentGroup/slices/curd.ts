import type { LobeChatGroupConfig } from '@lobechat/types';
import { type StateCreator } from 'zustand/vanilla';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import { chatGroupService } from '@/services/chatGroup';
import { type ChatGroupStore } from '@/store/agentGroup/store';

import { agentGroupSelectors } from '../selectors';

export interface ChatGroupCurdAction {
  /**
   * Append content chunk to streaming system prompt
   */
  appendStreamingSystemPrompt: (chunk: string) => void;
  /**
   * Finish streaming and save final content to group config
   */
  finishStreamingSystemPrompt: () => Promise<void>;
  /**
   * Start streaming system prompt update
   */
  startStreamingSystemPrompt: () => void;
  updateGroup: (id: string, value: Partial<ChatGroupItem>) => Promise<void>;
  updateGroupConfig: (config: Partial<LobeChatGroupConfig>) => Promise<void>;
  updateGroupMeta: (meta: Partial<ChatGroupItem>) => Promise<void>;
}

export const chatGroupCurdSlice: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupCurdAction
> = (set, get) => ({
  appendStreamingSystemPrompt: (chunk) => {
    const currentContent = get().streamingSystemPrompt || '';
    set({ streamingSystemPrompt: currentContent + chunk }, false, 'appendStreamingSystemPrompt');
  },

  finishStreamingSystemPrompt: async () => {
    const { streamingSystemPrompt, updateGroupConfig } = get();

    if (!streamingSystemPrompt) {
      set({ streamingSystemPromptInProgress: false }, false, 'finishStreamingSystemPrompt');
      return;
    }

    // Save the streamed content to group config
    await updateGroupConfig({ systemPrompt: streamingSystemPrompt });

    // Reset streaming state
    set(
      {
        streamingSystemPrompt: undefined,
        streamingSystemPromptInProgress: false,
      },
      false,
      'finishStreamingSystemPrompt',
    );
  },

  startStreamingSystemPrompt: () => {
    set(
      {
        streamingSystemPrompt: '',
        streamingSystemPromptInProgress: true,
      },
      false,
      'startStreamingSystemPrompt',
    );
  },

  updateGroup: async (id, value) => {
    await chatGroupService.updateGroup(id, value);
    get().internal_dispatchChatGroup({ payload: { id, value }, type: 'updateGroup' });
    await get().refreshGroupDetail(id);
  },

  updateGroupConfig: async (config) => {
    const group = agentGroupSelectors.currentGroup(get());
    if (!group) return;

    const mergedConfig = {
      ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
      ...group.config,
      ...config,
    };

    // Update the database first
    await chatGroupService.updateGroup(group.id, { config: mergedConfig });

    // Immediately update the local store to ensure configuration is available
    // Note: reducer expects payload: { id, value }
    get().internal_dispatchChatGroup({
      payload: { id: group.id, value: { config: mergedConfig } },
      type: 'updateGroup',
    });

    // Refresh groups to ensure consistency
    await get().refreshGroupDetail(group.id);
  },

  updateGroupMeta: async (meta) => {
    const group = agentGroupSelectors.currentGroup(get());
    if (!group) return;

    const id = group.id;

    await chatGroupService.updateGroup(id, meta);
    // Keep local store in sync immediately
    get().internal_dispatchChatGroup({ payload: { id, value: meta }, type: 'updateGroup' });
    await get().refreshGroupDetail(id);
  },
});
