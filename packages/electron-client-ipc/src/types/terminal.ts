export interface TerminalCreateSessionParams {
  cols: number;
  /** Working directory for the shell; falls back to the user home dir when omitted or invalid */
  cwd?: string;
  rows: number;
}

export interface TerminalCreateSessionResult {
  cwd: string;
  id: string;
  pid: number;
  shell: string;
}

export interface TerminalWriteParams {
  data: string;
  id: string;
}

export interface TerminalResizeParams {
  cols: number;
  id: string;
  rows: number;
}

export interface TerminalKillParams {
  id: string;
}

export interface TerminalDataPayload {
  data: string;
  id: string;
}

export interface TerminalExitPayload {
  exitCode: number;
  id: string;
}
