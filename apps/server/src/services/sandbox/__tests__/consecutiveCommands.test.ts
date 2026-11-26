import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CloudSandboxExecutionRuntime } from '@lobechat/builtin-tool-cloud-sandbox/executionRuntime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';
import { preprocessLhCommand } from '@/server/services/toolExecution/preprocessLhCommand';

import type { SandboxInitialization } from '../environmentInit';
import { MarketSandboxProvider } from '../providers/market';
import { SandboxMiddlewareService } from '../service';

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: vi.fn().mockResolvedValue('mock-jwt-token'),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.lobehub.com' },
}));

vi.mock('@/utils/env', () => ({
  isDev: false,
}));

const hasPython = spawnSync('python3', ['--version']).status === 0;

const PAGE = 'e_training_demo.html';

/**
 * A variables-only environment: nothing to clone or set up, but every shell
 * command gets its `export` lines in front, so the command the sandbox runs is
 * a rewrite of the one the model wrote.
 */
const ENVIRONMENT: SandboxInitialization = {
  env: { DEMO_PAGE: PAGE },
  environmentId: 'env-1',
  name: 'demo',
  sources: [],
};

/**
 * Identical in every script, so a layer that keyed results on a cut-down
 * command would hand every later script the first one's output.
 */
const SHARED_PREFIX = Array.from(
  { length: 12 },
  (_, i) =>
    `# shared line ${i + 1}: the same in every script, past any prefix a cache key might keep`,
).join('\n');

/** One edit of the page, the way an agent writes it: read, change, write back, print what it sees. */
const editScript = (step: number, extra = '') =>
  [
    SHARED_PREFIX,
    extra,
    'import os, uuid',
    "page = os.environ['DEMO_PAGE']",
    "html = open(page, encoding='utf-8').read()",
    `html = html.replace('</div>', '<span>step ${step}</span></div>', 1)`,
    "open(page, 'w', encoding='utf-8').write(html)",
    `print('STEP=${step}')`,
    "print('NONCE=' + uuid.uuid4().hex)",
    "print('CURRENT card:', html)",
  ]
    .filter(Boolean)
    .join('\n');

const stdinHeredoc = (script: string) => `python3 - <<'PY'\n${script}\nPY`;

const pageAfter = (steps: number[]) =>
  `<div class="card">培训 v0${steps.map((step) => `<span>step ${step}</span>`).join('')}</div>`;

/**
 * Stands in for the Market execution plane: one long-lived sandbox (a single
 * directory every call runs in, like a topic's session) that decodes what the
 * SDK puts on the wire and runs it with bash. `failNext` makes the next call
 * fail the way the plane or its gateway can, without running anything.
 */
const createSandbox = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sandbox-consecutive-'));
  const work = path.join(root, 'work');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  for (const dir of [work, home, tmp]) mkdirSync(dir);
  writeFileSync(path.join(work, PAGE), pageAfter([]));

  const received: string[] = [];
  let nextFailure: (() => unknown) | undefined;

  const runBuildInTool = vi.fn(async (_toolName: string, params: Record<string, unknown>) => {
    // `@lobehub/market-sdk` sends the params as base64-encoded JSON.
    const wire = Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
    const { command } = JSON.parse(Buffer.from(wire, 'base64').toString('utf8'));
    received.push(command);

    const failure = nextFailure;
    nextFailure = undefined;
    if (failure) return failure();

    const run = spawnSync('bash', ['-c', command], {
      cwd: work,
      encoding: 'utf8',
      env: { HOME: home, PATH: process.env.PATH, TMPDIR: tmp },
    });

    return {
      data: { result: { exitCode: run.status, stderr: run.stderr, stdout: run.stdout } },
      success: true,
    };
  });

  const options = {
    marketService: {
      getSDK: () => ({ plugins: { runBuildInTool } }),
    } as unknown as MarketService,
    sandboxInitialization: ENVIRONMENT,
    topicId: 'topic-1',
    userId: 'user-1',
  };

  return {
    failNext: (failure: () => unknown) => {
      nextFailure = failure;
    },
    page: () => readFileSync(path.join(work, PAGE), 'utf8'),
    received,
    remove: () => rmSync(root, { force: true, recursive: true }),
    runtime: new CloudSandboxExecutionRuntime(
      new SandboxMiddlewareService(new MarketSandboxProvider(options), options),
    ),
  };
};

const nonceOf = (stdout: string) => /NONCE=(\w+)/.exec(stdout)?.[1];

// T-13926: an agent reported that, in one topic, consecutive different
// python3 heredoc scripts all came back with the same stdout. Every layer
// between the model's command and the sandbox is covered here, so a result
// cache, a replay of an earlier result, or a heredoc cut down to a shared key
// would make these fail.
describe.skipIf(!hasPython)('cloud sandbox runCommand across consecutive scripts', () => {
  let sandbox: ReturnType<typeof createSandbox>;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  afterEach(() => {
    sandbox.remove();
  });

  it('returns each heredoc script its own output', async () => {
    const steps = [1, 2, 3, 4, 5, 6, 7, 8];
    const outputs: string[] = [];

    for (const step of steps) {
      const command = stdinHeredoc(editScript(step));
      const result = await sandbox.runtime.runCommand({ command });

      expect(result.success).toBe(true);
      // The plane got this script whole, behind the environment's exports.
      expect(sandbox.received.at(-1)).toBe(`export DEMO_PAGE='${PAGE}'\n${command}`);
      expect(result.state.stdout).toContain(`STEP=${step}\n`);
      expect(result.state.stdout).toContain(pageAfter(steps.slice(0, step)));
      expect(result.content).toContain(`STEP=${step}\n`);
      outputs.push(result.state.stdout);
    }

    expect(new Set(outputs).size).toBe(steps.length);
    expect(sandbox.page()).toBe(pageAfter(steps));
  });

  it('runs the new script each time one script path is rewritten', async () => {
    const steps = [1, 2, 3, 4];
    const nonces = new Set<string | undefined>();

    for (const step of steps) {
      const command = `cat > edit.py <<'PY'\n${editScript(step)}\nPY\npython3 edit.py`;
      const result = await sandbox.runtime.runCommand({ command });

      expect(result.state.stdout).toContain(`STEP=${step}\n`);
      nonces.add(nonceOf(result.state.stdout));
    }

    expect(nonces.size).toBe(steps.length);
    expect(sandbox.page()).toBe(pageAfter(steps));
  });

  // A script that merely mentions `lh` gets the CLI shim, which runs the
  // command inside a subshell after its own heredoc.
  it('keeps each output its own when the lh shim wraps the heredoc', async () => {
    const steps = [1, 2, 3];

    for (const step of steps) {
      const command = stdinHeredoc(editScript(step, '# publish it later with lh doc'));
      const prepared = await preprocessLhCommand(command, 'user-1');
      expect(prepared.isLhCommand).toBe(true);

      const result = await sandbox.runtime.runCommand({ command: prepared.command });

      expect(result.success).toBe(true);
      expect(result.state.stdout).toContain(`STEP=${step}\n`);
      expect(result.state.stdout).toContain(pageAfter(steps.slice(0, step)));
    }

    expect(sandbox.page()).toBe(pageAfter(steps));
  });

  it('never answers a failed call with the previous output', async () => {
    const first = await sandbox.runtime.runCommand({ command: stdinHeredoc(editScript(1)) });
    const firstNonce = nonceOf(first.state.stdout);
    expect(firstNonce).toBeDefined();

    sandbox.failNext(() => ({
      error: { code: 'GATEWAY_TIMEOUT', message: 'Gateway Timeout' },
      success: false,
    }));
    const refused = await sandbox.runtime.runCommand({ command: stdinHeredoc(editScript(2)) });

    sandbox.failNext(() => {
      throw new Error('504 Gateway Timeout');
    });
    const thrown = await sandbox.runtime.runCommand({ command: stdinHeredoc(editScript(3)) });

    for (const failed of [refused, thrown]) {
      expect(failed.success).toBe(false);
      expect(failed.content).toContain('Gateway Timeout');
      expect(failed.content).not.toContain(firstNonce);
      expect(failed.state.stdout).toBeUndefined();
    }

    const next = await sandbox.runtime.runCommand({ command: stdinHeredoc(editScript(4)) });

    expect(next.state.stdout).toContain('STEP=4\n');
    expect(nonceOf(next.state.stdout)).not.toBe(firstNonce);
    // Neither failed call ran.
    expect(sandbox.page()).toBe(pageAfter([1, 4]));
  });
});
