import { QuickNoteIdentifier } from '@lobechat/builtin-tool-quick-note';

import { validateQuickNoteSubmission } from '@/server/services/quickNote/generation';

import type { ToolExecutionContext } from '../types';
import type { ServerRuntimeRegistration } from './types';

/**
 * Server runtime for the Quick Note submit tool.
 *
 * `submitResult` records nothing itself: the arguments stay on the tool call, which
 * `QuickNoteProcessingService.onRunComplete` reads back. A valid call returns `stop: true`, so
 * the Agent Runtime ends the run right after it; a rejected call keeps the run going so the
 * model can correct its arguments.
 */
class QuickNoteExecutionRuntime {
  constructor(private readonly scope?: string | null) {}

  submitResult = async (args: unknown) => {
    if (this.scope !== 'quick_note') {
      const message = 'submitResult is only available inside a Quick Note run.';
      return { content: message, error: { message, type: 'UNAVAILABLE' }, success: false };
    }

    const invalid = validateQuickNoteSubmission(args);
    if (invalid) {
      return {
        content: `Result rejected: ${invalid} Call submitResult again with corrected arguments.`,
        error: { message: invalid, type: 'INVALID_ARGUMENTS' },
        success: false,
      };
    }

    return {
      content: 'Result recorded. The run is complete; do not reply further.',
      state: { submitted: true },
      stop: true,
      success: true,
    };
  };
}

export const quickNoteRuntime: ServerRuntimeRegistration = {
  factory: (context: ToolExecutionContext) => new QuickNoteExecutionRuntime(context.scope),
  identifier: QuickNoteIdentifier,
};
