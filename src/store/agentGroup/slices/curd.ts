import { type LobeChatGroupConfig } from '@lobechat/types';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { type ChatGroupItem } from '@/database/schemas/chatGroup';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState } from '@/projection';
import { getChatGroupProjection } from '@/projection/modules/chatGroup/read';
import { chatGroupProjectionSelectors } from '@/projection/modules/chatGroup/selectors';
import { chatGroupService } from '@/services/chatGroup';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<ChatGroupStore>;

type ChatGroupStoreWithInternal = ChatGroupStore & {
  refreshGroupDetail: (groupId: string) => Promise<void>;
};

export class ChatGroupCurdAction {
  readonly #get: () => ChatGroupStoreWithInternal;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatGroupStoreWithInternal, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;

    this.#set = set;
    this.#get = get;
  }

  #commitGroupMutation = (id: string, value: Partial<ChatGroupItem>): void => {
    const group = getChatGroupProjection(chatGroupProjectionSelectors.getGroupById(id));
    if (!group) return;
    getProjectionStoreState().commitChatGroupItem(
      getCacheScope(),
      { ...group, ...value },
      'mutation',
    );
  };

  /**
   * Append content chunk to streaming system prompt
   */
  appendStreamingSystemPrompt = (chunk: string) => {
    const currentContent = this.#get().streamingSystemPrompt || '';
    this.#set(
      { streamingSystemPrompt: currentContent + chunk },
      false,
      'appendStreamingSystemPrompt',
    );
  };

  /**
   * Finish streaming and save final content to group config
   */
  finishStreamingSystemPrompt = async () => {
    const { streamingSystemPrompt } = this.#get();

    if (!streamingSystemPrompt) {
      this.#set({ streamingSystemPromptInProgress: false }, false, 'finishStreamingSystemPrompt');
      return;
    }

    // Save the streamed content to group config
    await this.updateGroupConfig({ systemPrompt: streamingSystemPrompt });

    // Reset streaming state
    this.#set(
      {
        streamingSystemPrompt: undefined,
        streamingSystemPromptInProgress: false,
      },
      false,
      'finishStreamingSystemPrompt',
    );
  };

  /**
   * Start streaming system prompt update
   */
  startStreamingSystemPrompt = () => {
    this.#set(
      {
        streamingSystemPrompt: '',
        streamingSystemPromptInProgress: true,
      },
      false,
      'startStreamingSystemPrompt',
    );
  };

  updateGroup = async (id: string, value: Partial<ChatGroupItem>) => {
    await chatGroupService.updateGroup(id, value);
    this.#commitGroupMutation(id, value);
    await this.#get().refreshGroupDetail(id);
  };

  updateGroupConfig = async (config: Partial<LobeChatGroupConfig>) => {
    const s = this.#get();
    const group = s.activeGroupId
      ? getChatGroupProjection(chatGroupProjectionSelectors.getGroupById(s.activeGroupId))
      : undefined;
    if (!group) return;

    const mergedConfig = {
      ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
      ...group.config,
      ...config,
    };

    // Update the database first
    await chatGroupService.updateGroup(group.id, { config: mergedConfig });

    this.#commitGroupMutation(group.id, { config: mergedConfig });

    // Refresh groups to ensure consistency
    await this.#get().refreshGroupDetail(group.id);
  };

  updateGroupMeta = async (meta: Partial<ChatGroupItem>) => {
    const s = this.#get();
    const group = s.activeGroupId
      ? getChatGroupProjection(chatGroupProjectionSelectors.getGroupById(s.activeGroupId))
      : undefined;
    if (!group) return;

    await this.updateGroupMetaById(group.id, meta);
  };

  updateGroupMetaById = async (id: string, meta: Partial<ChatGroupItem>) => {
    if (!id) return;

    await chatGroupService.updateGroup(id, meta);
    this.#commitGroupMutation(id, meta);
    await this.#get().refreshGroupDetail(id);
  };
}
