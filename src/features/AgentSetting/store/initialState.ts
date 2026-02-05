import { DEFAULT_AGENT_META } from '@/const/meta';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import type {LobeAgentConfig} from '@/types/agent';
import type {MetaData} from '@/types/meta';

export type LoadingState = Record<Partial<keyof MetaData> | string, boolean>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

export interface State {
  config: LobeAgentConfig;
  id?: string;
  lastUpdatedTime?: Date | null;
  loading?: boolean;
  loadingState?: LoadingState;
  meta: MetaData;
  onConfigChange?: (config: LobeAgentConfig) => void;
  onMetaChange?: (meta: MetaData) => void;
  saveStatus?: SaveStatus;
}

export const initialState: State = {
  config: DEFAULT_AGENT_CONFIG,
  lastUpdatedTime: null,
  loading: true,
  loadingState: {
    avatar: false,
    backgroundColor: false,
    description: false,
    tags: false,
    title: false,
  },
  meta: DEFAULT_AGENT_META,
  saveStatus: 'idle',
};
