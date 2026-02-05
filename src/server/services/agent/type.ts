import type {LobeAgentConfig} from '@/types/agent';

export interface UpdateAgentResult {
  agent?: LobeAgentConfig;
  success: boolean;
}
