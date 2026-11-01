import type { TestResult } from './index';

interface TestConnectionFailure {
  errors: Array<{ code?: string }>;
  message: string;
  valid: false;
}

export type TestConnectionOutcome = TestConnectionFailure | { valid: true };

/**
 * Turn a `testConnection` response into the banner shown under the form.
 * Recognized failures carry a code with a localized guidance line; the
 * platform's raw message stays underneath so the exact reason (e.g. the
 * Feishu error code) is still visible.
 */
export const toTestResult = (
  outcome: TestConnectionOutcome,
  hintForCode: (code: string) => string,
): TestResult => {
  if (outcome.valid) return { type: 'success' };

  const code = outcome.errors.find((e) => e.code)?.code;
  return {
    errorDetail: outcome.message,
    hint: (code && hintForCode(code)) || undefined,
    type: 'error',
  };
};

/**
 * The latest action's outcome is the one shown: a stale "Bot connected"
 * banner next to a failed test reads as contradictory. Keep an in-progress
 * queued/starting notice so the connect polling loop is not visually
 * interrupted.
 */
export const keepPendingConnectResult = (prev?: TestResult): TestResult | undefined =>
  prev?.type === 'info' ? prev : undefined;
