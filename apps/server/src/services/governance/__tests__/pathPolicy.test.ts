import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appEnv: { COMMAND_GOVERNANCE_ENABLED: false },
  getUserExecutionPolicy: vi.fn(),
}));

vi.mock('@/envs/app', () => ({ appEnv: mocks.appEnv }));
vi.mock('../executionPolicy', () => ({
  getUserExecutionPolicy: mocks.getUserExecutionPolicy,
}));

const { checkPath, FILE_BLOCKED_MESSAGE, pathMatchesRoot } = await import('../pathPolicy');

const baseCtx = {
  apiName: 'writeFile',
  executionTarget: 'device' as const,
  path: '/home/alice/.ssh/config',
  toolIdentifier: 'lobe-local-system',
  userId: 'user-1',
};

const db = {} as any;

describe('pathMatchesRoot', () => {
  it('matches a half-width ~ root against a resolved absolute path', () => {
    expect(pathMatchesRoot('/home/alice/.ssh/config', '~/.ssh')).toBe(true);
  });

  it('matches a full-width ～ root the same way — this is the original bug', () => {
    expect(pathMatchesRoot('/home/alice/.ssh/config', '～/.ssh')).toBe(true);
  });

  it('matches a Windows path against a POSIX-style root', () => {
    expect(pathMatchesRoot('C:\\Users\\lijian\\.ssh\\test_env.txt', '~/.ssh')).toBe(true);
  });

  it('matches the root exactly, not just as a prefix of a longer segment', () => {
    expect(pathMatchesRoot('/home/alice/.ssh2/config', '~/.ssh')).toBe(false);
  });

  it('does not match an unrelated path', () => {
    expect(pathMatchesRoot('/home/alice/Desktop/notes.txt', '~/.ssh')).toBe(false);
  });

  it('is a known, accepted imprecision: a coincidental directory name still matches', () => {
    // Suffix/substring matching (chosen because the server cannot resolve a
    // remote device's real home directory) cannot tell "~/.ssh" apart from an
    // unrelated directory that happens to be named ".ssh" elsewhere. Documented
    // tradeoff, not a bug — see pathPolicy.ts's doc comment.
    expect(pathMatchesRoot('/data/backup/.ssh', '~/.ssh')).toBe(true);
  });
});

describe('checkPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appEnv.COMMAND_GOVERNANCE_ENABLED = false;
  });

  it('allows without querying the policy when governance is disabled', async () => {
    const decision = await checkPath(baseCtx, db);

    expect(decision).toEqual({ allowed: true });
    expect(mocks.getUserExecutionPolicy).not.toHaveBeenCalled();
  });

  describe('governance enabled', () => {
    beforeEach(() => {
      mocks.appEnv.COMMAND_GOVERNANCE_ENABLED = true;
    });

    it('allows when the user has no policy configured', async () => {
      mocks.getUserExecutionPolicy.mockResolvedValueOnce(null);

      const decision = await checkPath(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
    });

    it('allows when the policy has no denied roots for this direction', async () => {
      mocks.getUserExecutionPolicy.mockResolvedValueOnce({ deniedWriteRoots: [] });

      const decision = await checkPath(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
    });

    it('denies a write under deniedWriteRoots and reports which field matched', async () => {
      mocks.getUserExecutionPolicy.mockResolvedValueOnce({ deniedWriteRoots: ['~/.ssh'] });

      const decision = await checkPath(baseCtx, db);

      expect(decision).toEqual({ allowed: false, matchedField: 'deniedWriteRoots' });
    });

    it('checks reads against deniedReadRoots, not deniedWriteRoots', async () => {
      mocks.getUserExecutionPolicy.mockResolvedValueOnce({
        deniedReadRoots: ['~/.ssh'],
        deniedWriteRoots: [],
      });

      const decision = await checkPath({ ...baseCtx, apiName: 'readFile' }, db);

      expect(decision).toEqual({ allowed: false, matchedField: 'deniedReadRoots' });
    });

    it('does not deny a write against a deniedReadRoots-only policy', async () => {
      mocks.getUserExecutionPolicy.mockResolvedValueOnce({
        deniedReadRoots: ['~/.ssh'],
        deniedWriteRoots: [],
      });

      const decision = await checkPath(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
    });

    it('fails open when the policy lookup throws', async () => {
      mocks.getUserExecutionPolicy.mockRejectedValueOnce(new Error('DB is down'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const decision = await checkPath(baseCtx, db);

      expect(decision).toEqual({ allowed: true });
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});

describe('FILE_BLOCKED_MESSAGE', () => {
  // Mirrors COMMAND_BLOCKED_MESSAGE's rationale (policyGate.test.ts) — a model
  // that only sees "this path is blocked" has been observed retrying a nearby
  // path instead of stopping.
  it('explicitly tells the model to stop and never retry', () => {
    const message = FILE_BLOCKED_MESSAGE.toLowerCase();

    expect(message).toContain('do not attempt to read or write this path again');
    expect(message).toContain('blocked again');
    expect(message).toContain('stop this line of action');
  });
});
