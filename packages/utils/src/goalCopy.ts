/**
 * The goal coordinator authors its gate/attempt strings in English on the
 * server (`GoalService.openFailureDecision` and the verify settle reasons).
 * The reason templates are a stable, finite vocabulary, so every surface that
 * shows them — the goal page, the approval island and the inbox brief the
 * server writes — recognizes them and swaps in the reader's language through
 * the `chat` namespace; anything not recognized renders verbatim.
 */

export interface LocalizedCopyRef {
  key: (typeof REASON_PATTERNS)[number]['key'];
  params?: Record<string, string>;
}

/** Strip the coordinator question template down to its dynamic reason half. */
const QUESTION_TAILS = [
  /\.?\s*Retry or retire this task node\?$/,
  /\.?\s*Fix it, then retry or retire this task node\?$/,
  /\.?\s*Retry Goal acceptance or fail this Goal\?$/,
  /\.?\s*Retry Goal acceptance, abandon it, or fail this Goal\?$/,
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
const REASON_PATTERNS = [
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
    key: 'goalProcess.gate.reason.recoveryFailed',
    pattern:
      /^Automatic recovery could not (start the next attempt|restart an abandoned operation)$/,
  },
  {
    // A run that failed outright leaves its runtime error type as the reason
    // (e.g. `InvalidProviderAPIKey`). The code stays visible for support; the
    // sentence around it is the user's language.
    key: 'goalProcess.gate.reason.runError',
    param: 'code',
    pattern: /^([A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)$/,
  },
] as const;

export const coordinatorReasonCopy = (reason?: string | null): LocalizedCopyRef | undefined => {
  if (!reason) return undefined;
  const trimmed = reason.trim();
  for (const entry of REASON_PATTERNS) {
    const { key, pattern } = entry;
    const param = 'param' in entry ? entry.param : undefined;
    const params = 'params' in entry ? entry.params : undefined;
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
