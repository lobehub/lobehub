import type { HeterogeneousAgentRuntimeStatus } from '../types';

export interface HeterogeneousAgentBroadcastEvents {
  heteroAgentRuntimeStatus: (params: HeterogeneousAgentRuntimeStatus) => void;
}
