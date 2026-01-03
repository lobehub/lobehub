import type { PartialDeep } from 'type-fest';
import { type StateCreator } from 'zustand/vanilla';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG, DEFAULT_CHAT_GROUP_META_CONFIG } from '@/const/settings';
import { type LobeChatGroupConfig, type LobeChatGroupMetaConfig } from '@/types/agentGroup';
import { setNamespace } from '@/utils/storeDebug';

import { type LoadingState, type State, initialState } from './initialState';

export interface PublicAction {
  /**
   * Reset group configuration to default
   */
  resetGroupConfig: () => Promise<void>;
  /**
   * Reset group metadata to default
   */
  resetGroupMeta: () => Promise<void>;
  /**
   * Update group configuration
   */
  updateGroupConfig: (config: Partial<LobeChatGroupConfig>) => Promise<void>;
  /**
   * Update group metadata
   */
  updateGroupMeta: (meta: Partial<LobeChatGroupMetaConfig>) => Promise<void>;
}

export interface Action extends PublicAction {
  setGroupConfig: (config: PartialDeep<LobeChatGroupConfig>) => Promise<void>;
  setGroupMeta: (meta: Partial<LobeChatGroupMetaConfig>) => Promise<void>;

  /**
   * Update loading state
   * @param key - LoadingState key
   * @param value - Loading state value
   */
  updateLoadingState: (key: keyof LoadingState, value: boolean) => void;
}

export type Store = Action & State;

const t = setNamespace('GroupChatSettings');

export const store: StateCreator<Store, [['zustand/devtools', never]]> = (set, get) => ({
  ...initialState,

  resetGroupConfig: async () => {
    const { onConfigChange } = get();

    const defaultConfig = DEFAULT_CHAT_GROUP_CHAT_CONFIG;

    await onConfigChange?.(defaultConfig);
    set({ config: defaultConfig }, false, t('resetGroupConfig'));
  },

  resetGroupMeta: async () => {
    const { onMetaChange } = get();

    const defaultMeta = DEFAULT_CHAT_GROUP_META_CONFIG;

    await onMetaChange?.(defaultMeta);
    set({ meta: defaultMeta }, false, t('resetGroupMeta'));
  },

  setGroupConfig: async (config) => {
    const { onConfigChange } = get();
    const currentConfig = get().config || DEFAULT_CHAT_GROUP_CHAT_CONFIG;
    const newConfig = { ...currentConfig, ...config };

    await onConfigChange?.(newConfig);
    set({ config: newConfig }, false, t('setGroupConfig'));
  },

  setGroupMeta: async (meta) => {
    const { onMetaChange } = get();
    const currentMeta = get().meta || DEFAULT_CHAT_GROUP_META_CONFIG;
    const newMeta = { ...currentMeta, ...meta };

    await onMetaChange?.(newMeta);
    set({ meta: newMeta }, false, t('setGroupMeta'));
  },

  updateGroupConfig: async (config) => {
    await get().setGroupConfig(config);
  },

  updateGroupMeta: async (meta) => {
    await get().setGroupMeta(meta);
  },

  updateLoadingState: (key, value) => {
    const { loadingState } = get();
    set(
      {
        loadingState: {
          ...loadingState,
          [key]: value,
        },
      },
      false,
      t('updateLoadingState', { [key]: value }),
    );
  },
});
