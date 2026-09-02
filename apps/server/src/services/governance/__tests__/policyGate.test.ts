import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appEnv: { COMMAND_GOVERNANCE_ENABLED: false },
  listEnabledRulesForTarget: vi.fn(),
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('../rulesRepository', () => ({
  listEnabledRulesForTarget: mocks.listEnabledRulesForTarget,
}));

const { checkCommand, COMMAND_BLOCKED_MESSAGE, isGovernanceEnabled } =
  await import('../policyGate');

const baseCtx = {
  apiName: 'runCommand',
  commandText: 'rm -rf /',
  executionTarget: 'device' as const,
  toolIdentifier: 'lobe-local-system',
  userId: 'user-1',
};

const db = {} as any;

describe('policyGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appEnv.COMMAND_GOVERNANCE_ENABLED = false;
  });

  describe('isGovernanceEnabled', () => {
    it('is false by default', () => {
      expect(isGovernanceEnabled()).toBe(false);
    });

    it('is true when the flag is set', () => {
      mocks.appEnv.COMMAND_GOVERNANCE_ENABLED = true;
      expect(isGovernanceEnabled()).toBe(true);
    });
  });

  describe('checkCommand — flag off', () => {
    it('short-circuits to allowed=true without querying rules', async () => {
      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
      expect(mocks.listEnabledRulesForTarget).not.toHaveBeenCalled();
    });
  });

  describe('checkCommand — flag on, pattern matching', () => {
    beforeEach(() => {
      mocks.appEnv.COMMAND_GOVERNANCE_ENABLED = true;
    });

    it('denies on an exact match', async () => {
      mocks.listEnabledRulesForTarget.mockResolvedValueOnce([
        { id: 'rule-1', pattern: 'rm -rf /', patternType: 'exact' },
      ]);

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: false, ruleId: 'rule-1' });
    });

    it('allows when no rule matches', async () => {
      mocks.listEnabledRulesForTarget.mockResolvedValueOnce([
        { id: 'rule-1', pattern: 'shutdown', patternType: 'exact' },
      ]);

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
    });

    it('denies on a prefix match', async () => {
      mocks.listEnabledRulesForTarget.mockResolvedValueOnce([
        { id: 'rule-2', pattern: 'rm -rf', patternType: 'prefix' },
      ]);

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: false, ruleId: 'rule-2' });
    });

    it('does not deny a prefix rule that only matches a substring, not the start', async () => {
      mocks.listEnabledRulesForTarget.mockResolvedValueOnce([
        { id: 'rule-2', pattern: '-rf /', patternType: 'prefix' },
      ]);

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
    });

    it('denies on a regex match', async () => {
      mocks.listEnabledRulesForTarget.mockResolvedValueOnce([
        { id: 'rule-3', pattern: '^rm\\s+-rf\\s+/', patternType: 'regex' },
      ]);

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: false, ruleId: 'rule-3' });
    });

    it('treats an invalid regex as a non-match instead of throwing', async () => {
      mocks.listEnabledRulesForTarget.mockResolvedValueOnce([
        { id: 'rule-bad', pattern: '(unterminated', patternType: 'regex' },
      ]);

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
    });

    it('evaluates rules in order and denies on the first match', async () => {
      mocks.listEnabledRulesForTarget.mockResolvedValueOnce([
        { id: 'rule-no-match', pattern: 'shutdown', patternType: 'exact' },
        { id: 'rule-match', pattern: 'rm -rf', patternType: 'prefix' },
      ]);

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: false, ruleId: 'rule-match' });
    });
  });

  describe('checkCommand — fail open', () => {
    beforeEach(() => {
      mocks.appEnv.COMMAND_GOVERNANCE_ENABLED = true;
    });

    it('returns allowed=true when the rules lookup throws', async () => {
      mocks.listEnabledRulesForTarget.mockRejectedValueOnce(new Error('DB is down'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const decision = await checkCommand(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('COMMAND_BLOCKED_MESSAGE', () => {
    // Both chokepoints (`toolExecution/builtin.ts`, `sandbox/service.ts`) surface
    // this exact string as the tool result when a command is denied. A model
    // that sees only "this was blocked" has been observed retrying the same
    // command, or a reworded one — the message must explicitly rule that out
    // rather than leave it to the model to infer.
    it('explicitly tells the model to stop and never retry', () => {
      const message = COMMAND_BLOCKED_MESSAGE.toLowerCase();

      expect(message).toContain('do not attempt this action again');
      expect(message).toContain('blocked again');
      expect(message).toContain('stop this line of action');
    });
  });
});
