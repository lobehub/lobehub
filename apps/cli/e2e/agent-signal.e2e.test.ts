import { execSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * E2E tests for `lh agent-signal trigger`.
 *
 * Requires a running server + authenticated CLI and is gated behind
 * AGENT_SIGNAL_AGENT_ID (or AGENT_ID). Offline golden fixture coverage lives
 * in tests/agentSignalGolden.test.ts.
 *
 * Prerequisites for the live block:
 * - `lh` (or LH_CLI_PATH) points at the built CLI
 * - User is authenticated (`lh login`) against a dev server with Agent Signal enabled
 * - AGENT_SIGNAL_AGENT_ID=<agentId> identifies a target agent the user owns
 */

const CLI = process.env.LH_CLI_PATH || 'lh';
const AGENT_ID = process.env.AGENT_SIGNAL_AGENT_ID || process.env.AGENT_ID;
const TIMEOUT = 60_000;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    timeout: TIMEOUT,
  }).trim();
}

describe.skipIf(!AGENT_ID)('lh agent-signal trigger - live', () => {
  it('triggers a nightly review and returns a workflow run id', () => {
    const output = run(
      `agent-signal trigger --source-type agent.nightly_review.requested --agent ${AGENT_ID} --json`,
    );
    const result = JSON.parse(output);
    expect(result).toHaveProperty('accepted');
    expect(result).toHaveProperty('scopeKey');
    // When Agent Signal is enabled for the account, a workflow run id is returned.
    if (result.accepted) {
      expect(typeof result.workflowRunId).toBe('string');
      expect(result.workflowRunId.length).toBeGreaterThan(0);
    }
  });

  it('exits non-zero on an invalid source type', () => {
    expect(() =>
      run(`agent-signal trigger --source-type not.a.real.type --agent ${AGENT_ID}`),
    ).toThrow();
  });
});
