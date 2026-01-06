import { DEFAULT_CHAT_GROUP_CHAT_CONFIG, DEFAULT_CHAT_GROUP_META_CONFIG } from '@/const/settings';
import { type LobeChatGroupConfig, type LobeChatGroupMetaConfig } from '@/types/agentGroup';

export type LoadingState = Record<string, boolean>;

export interface State {
  config?: LobeChatGroupConfig;
  id?: string;
  loading?: boolean;
  loadingState?: LoadingState;
  meta?: LobeChatGroupMetaConfig;
  onConfigChange?: (config: LobeChatGroupConfig) => void;
  onMetaChange?: (meta: LobeChatGroupMetaConfig) => void;
}

export const initialState: State = {
  config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
  loading: true,
  loadingState: {
    meta: false,
  },
  meta: DEFAULT_CHAT_GROUP_META_CONFIG,
};
