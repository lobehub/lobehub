import type { WorkVersionCumulativeUsage } from '@lobechat/types';

import type { WorkModel } from '@/database/models/work';

/**
 * One CLI family the shell Work scan knows how to turn into Works. The engine
 * (`registerShellWorks` in `../shellWorkRegistration`) owns everything
 * command-agnostic — source scoping, success gating, command/output
 * extraction, outcome counting — while a scanner supplies the two
 * CLI-specific pieces: a cheap text prefilter and the normalize-and-persist
 * call. One scanner per file in this directory; register it in `./index`.
 */
export interface ShellWorkScanner {
  /**
   * Cheap prefilter on the raw command text; `register` runs only when it
   * returns true. Keep it a substring check — precise parsing belongs to the
   * normalizer behind `register`.
   */
  matches: (command: string) => boolean;
  /** Scanner name, for logs. */
  name: string;
  /**
   * Normalize + persist one shell command record. Returns the registered Work
   * (null when the command doesn't resolve into a registerable entity — not
   * counted as attempted). A throw is counted as a registration failure.
   */
  register: (input: {
    agentId: string | null;
    cumulativeCost: number | null;
    cumulativeUsage: WorkVersionCumulativeUsage | null;
    data: { command: string; exitCode?: number; output?: string };
    messageId: string;
    rootOperationId: string;
    threadId: string | null;
    toolCallId: string | null;
    toolIdentifier: string;
    toolName: string;
    topicId: string;
    workModel: WorkModel;
  }) => Promise<unknown | null>;
}
