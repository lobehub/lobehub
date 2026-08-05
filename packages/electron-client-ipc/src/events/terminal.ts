import type { TerminalDataPayload, TerminalExitPayload } from '../types/terminal';

export interface TerminalBroadcastEvents {
  terminalData: (payload: TerminalDataPayload) => void;
  terminalExit: (payload: TerminalExitPayload) => void;
}
