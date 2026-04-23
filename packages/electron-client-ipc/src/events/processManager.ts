import type { ProcessInfo } from '../types/processManager';

export interface ProcessManagerBroadcastEvents {
  processManagerChanged: (data: {
    process: ProcessInfo;
    type: 'registered' | 'exited' | 'killed';
  }) => void;
}
