/**
 * The goal coordinator authors its gate/attempt strings in English on the
 * server (`GoalService.openFailureDecision` and the verify settle reasons).
 * The reason templates are a stable, finite vocabulary, so every surface that
 * shows them — the goal page, the approval island and the inbox brief the
 * server writes — recognizes them and swaps in the reader's language through
 * the `chat` namespace; anything not recognized renders verbatim.
 */

export interface LocalizedCopyRef {
  key: string;
  params?: Record<string, string>;
}

/** Strip the coordinator question template down to its dynamic reason half. */
const QUESTION_TAILS = [
  /\.?\s*Retry or retire this task node\?$/,
  /\.?\s*Fix it, then retry or retire this task node\?$/,
  /\.?\s*Retry Goal acceptance or fail this Goal\?$/,
  /\.?\s*Retry Goal acceptance, abandon it, or fail this Goal\?$/,
  // The batch pattern-break gate (see `GoalService.openPatternBreakGate`).
  /\.?\s*How should this batch proceed\?$/,
  // The batch release-approval gate (see `GoalService.openReleaseReview`).
  /\.?\s*Release the next wave\?$/,
];

export const coordinatorGateReason = (question?: string | null): string | undefined => {
  if (!question) return undefined;
  for (const tail of QUESTION_TAILS) {
    if (tail.test(question)) {
      const reason = question.replace(tail, '').trim();
      return reason || undefined;
    }
  }
  return question;
};

/** Known coordinator reason templates → chat-ns locale refs. */
const REASON_PATTERNS: Array<{
  key: string;
  param?: string;
  /** Names for several capture groups, in order; `param` names just the first. */
  params?: string[];
  pattern: RegExp;
}> = [
  // Machine gates (see `machineRecovery.ts`): what broke, then what to change.
  {
    key: 'goalProcess.gate.reason.setupWorkingDirectory',
    params: ['path'],
    pattern: /^Setup problem: Working directory does not exist: (.+?)\. Create \1 on the device/,
  },
  {
    key: 'goalProcess.gate.reason.setupCli',
    params: ['error'],
    pattern: /^Setup problem: (.+?)\. Install the CLI on the device/,
  },
  {
    key: 'goalProcess.gate.reason.setupCredentials',
    params: ['error'],
    pattern: /^Setup problem: (.+?)\. Update the provider credentials/,
  },
  {
    key: 'goalProcess.gate.reason.setupDevice',
    params: ['error'],
    pattern: /^Setup problem: (.+?)\. Reconnect the device/,
  },
  {
    key: 'goalProcess.gate.reason.setupGateway',
    params: ['error'],
    pattern: /^Setup problem: (.+?)\. Configure the device gateway/,
  },
  {
    key: 'goalProcess.gate.reason.quotaFarReset',
    params: ['error', 'at'],
    pattern: /^Usage limit: (.+?)\. It does not reset until (\S+), more than a day away/,
  },
  {
    key: 'goalProcess.gate.reason.quotaRetriesSpent',
    params: ['error', 'count', 'duration'],
    pattern: /^Usage limit: (.+?)\. Retried (\d+) time\(s\) over (.+?) and the limit still applies/,
  },
  {
    key: 'goalProcess.gate.reason.transientRetriesSpent',
    params: ['error', 'count', 'duration'],
    pattern: /^Run failed: (.+?)\. Retried (\d+) time\(s\) over (.+?) and it failed the same way/,
  },
  {
    key: 'goalProcess.gate.reason.verifyInternalError',
    pattern: /^Verification could not run \(internal error\); the delivery was not evaluated\.?$/,
  },
  {
    key: 'goalProcess.gate.reason.verifyFailed',
    param: 'id',
    pattern: /^Task (\S+) did not pass verification$/,
  },
  {
    key: 'goalProcess.gate.reason.verifyStalled',
    params: ['id', 'count'],
    pattern: /^Task (\S+) failed verification the same way (\d+) times in a row$/,
  },
  {
    key: 'goalProcess.gate.reason.goalAcceptanceFailed',
    pattern: /^Goal-level acceptance did not pass$/,
  },
  {
    key: 'goalProcess.gate.reason.attemptBudgetExhausted',
    pattern: /^Task attempt budget was exhausted( after an operation was abandoned)?$/,
  },
  {
    key: 'goalProcess.gate.reason.costBudgetExhausted',
    pattern: /^Goal cost budget was exhausted( after an operation was abandoned)?$/,
  },
  {
    key: 'goalProcess.gate.reason.deviceStayedOffline',
    pattern: /^Task device stayed offline$/,
  },
  {
    // The spawn failure `runTask` refused with, when it is one a person can act on.
    key: 'goalProcess.gate.reason.recoveryFailedWithError',
    param: 'error',
    pattern:
      /^Automatic recovery could not (?:start the next attempt|restart an abandoned operation): (.+)$/,
  },
  {
    key: 'goalProcess.gate.reason.recoveryFailed',
    pattern:
      /^Automatic recovery could not (start the next attempt|restart an abandoned operation)$/,
  },
  // A passed batch gate held for approval (see `GoalService.routeRolloutRelease`).
  {
    key: 'goalProcess.gate.reason.batchReleaseProbes',
    params: ['revision', 'wave', 'count'],
    pattern:
      /^Experiments of v(\d+) finished; start batch execution with wave (\d+) \((\d+) units?\)$/,
  },
  {
    key: 'goalProcess.gate.reason.batchReleaseRevised',
    params: ['version', 'wave', 'count'],
    pattern:
      /^The main Agent revised the plan to v(\d+) from your correction; approve releasing wave (\d+) \((\d+) units?\)$/,
  },
  {
    key: 'goalProcess.gate.reason.batchReleaseEscalated',
    params: ['wave', 'count'],
    pattern: /^The main Agent asked you to approve releasing wave (\d+) \((\d+) units?\)$/,
  },
  {
    key: 'goalProcess.gate.reason.batchReleaseNoAgent',
    params: ['wave', 'count'],
    pattern:
      /^Batch gate passed and no main Agent could review the release; approve releasing wave (\d+) \((\d+) units?\)$/,
  },
  {
    // A run that failed outright leaves its runtime error type as the reason
    // (e.g. `InvalidProviderAPIKey`). The code stays visible for support; the
    // sentence around it is the user's language.
    key: 'goalProcess.gate.reason.runError',
    param: 'code',
    pattern: /^([A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)$/,
  },
];

/**
 * The batch gate's blockers — the finite sentences `evaluateRolloutGate`
 * withholds a wave for. A pattern break joins every blocker it hit with `; `,
 * so each is mapped on its own and the parts rejoin.
 */
const BATCH_BLOCKER_PATTERNS: ReasonPattern[] = [
  {
    key: 'goalProcess.gate.reason.batchUnsettled',
    params: ['count'],
    pattern: /^(\d+) unit\(s\) have not settled$/,
  },
  {
    key: 'goalProcess.gate.reason.batchBroken',
    params: ['count'],
    pattern: /^(\d+) unit\(s\) did not succeed$/,
  },
  {
    key: 'goalProcess.gate.reason.batchOpenDecision',
    pattern: /^a human decision is still open in this batch$/,
  },
  {
    key: 'goalProcess.gate.reason.batchTemplateIncomplete',
    pattern: /^the batch template is incomplete$/,
  },
  {
    key: 'goalProcess.gate.reason.batchUntestedAxes',
    params: ['axes'],
    pattern: /^untested axes: (.+)$/,
  },
];

interface ReasonPattern {
  key: string;
  param?: string;
  /** Names for several capture groups, in order; `param` names just the first. */
  params?: string[];
  pattern: RegExp;
}

const matchReason = (patterns: ReasonPattern[], trimmed: string): LocalizedCopyRef | undefined => {
  for (const { key, param, params, pattern } of patterns) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const names = params ?? (param ? [param] : []);
    const values = Object.fromEntries(
      names.flatMap((name, index) => (match[index + 1] ? [[name, match[index + 1]]] : [])),
    );
    return { key, ...(names.length > 0 ? { params: values } : {}) };
  }
  return undefined;
};

export const coordinatorReasonCopy = (reason?: string | null): LocalizedCopyRef | undefined => {
  if (!reason) return undefined;
  const trimmed = reason.trim();
  return matchReason(REASON_PATTERNS, trimmed) ?? matchReason(BATCH_BLOCKER_PATTERNS, trimmed);
};

/**
 * Every coordinator reason in a stored gate question, in order. A batch gate
 * lists each blocker it hit at once, joined by `; ` (see `evaluateRolloutGate`),
 * so they are localized one by one and the parts rejoin — the reader sees no
 * English left in the sentence. All-or-nothing: one unrecognized sentence means
 * the question is not (fully) coordinator-authored, or an error message happened
 * to contain `; `, so the stored copy is kept rather than half-translated.
 */
export const coordinatorReasonCopies = (reason?: string | null): LocalizedCopyRef[] | undefined => {
  if (!reason) return undefined;
  const trimmed = reason.trim();
  const single = coordinatorReasonCopy(trimmed);
  if (single) return [single];
  const segments = trimmed.split(/;\s+/).filter(Boolean);
  if (segments.length < 2) return undefined;
  const refs = segments.map((segment) => coordinatorReasonCopy(segment));
  return refs.every((ref): ref is LocalizedCopyRef => !!ref) ? refs : undefined;
};
