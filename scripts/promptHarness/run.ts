import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildDatabaseUrl,
  cloneDatabase,
  dropDatabase,
  parseDatabaseUrl,
  repointMockProvider,
  seedDatabase,
} from './database';
import {
  getScenario,
  HARNESS_AGENT_PROMPT,
  PROMPT_SCENARIOS,
  type PromptScenario,
} from './fixtures';
import { allocatePort, isPortOpen, waitForHttp, waitForPort } from './ports';
import { type ManagedProcess, spawnManaged, stopAll } from './processes';
import {
  type HarnessManifest,
  type ScenarioRun,
  type VerificationCheck,
  verifyHarnessRun,
} from './verify';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const parseArgs = (argv: string[]) => {
  let scenarioIds = PROMPT_SCENARIOS.map((scenario) => scenario.id);
  let infoFile: string | undefined;
  let keep = false;
  let serve = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keep') {
      keep = true;
    } else if (arg === '--serve') {
      serve = true;
    } else if (arg === '--info-file') {
      infoFile = argv[++index];
    } else if (arg.startsWith('--info-file=')) {
      infoFile = arg.slice('--info-file='.length);
    } else if (arg === '--scenario') {
      scenarioIds = [argv[++index] ?? ''];
    } else if (arg.startsWith('--scenario=')) {
      scenarioIds = arg.slice('--scenario='.length).split(',').filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { infoFile, keep, scenarioIds: scenarioIds.map(getScenario), serve };
};

const readCaptureFiles = async (captureDir: string): Promise<string[]> =>
  (await readdir(captureDir)).filter((file) => /^\d{3}-.*\.json$/.test(file)).sort();

const isAgentPromptCapture = async (captureDir: string, file: string): Promise<boolean> => {
  const capture = JSON.parse(await readFile(path.join(captureDir, file), 'utf8')) as {
    mockResponse?: { object?: string; protocol?: string };
    rawRequest?: { messages?: unknown };
  };
  // Agent Signal uses the Responses API for auxiliary classification. Those
  // calls are not the product request under test and have no Chat Completions
  // messages envelope.
  return (
    capture.mockResponse?.protocol !== 'responses' &&
    capture.mockResponse?.object === 'chat.completion' &&
    Array.isArray(capture.rawRequest?.messages)
  );
};

const parseOperationId = (stdout: string): string => {
  const events = JSON.parse(stdout) as Array<{ operationId?: string; type?: string }>;
  const operation = events.find((event) => event.type === 'connected' && event.operationId);
  if (!operation?.operationId)
    throw new Error('CLI JSON did not contain a connected operation id.');
  return operation.operationId;
};

const parseTopicId = (stdout: string, operationId: string): string => {
  const events = JSON.parse(stdout) as Array<{
    data?: { topicId?: string; uiMessages?: Array<{ topicId?: string }> };
    type?: string;
  }>;
  const fromEvent =
    events.find((event) => event.type === 'agent_runtime_init')?.data?.topicId ??
    events
      .find((event) => event.type === 'step_start')
      ?.data?.uiMessages?.find((message) => message.topicId)?.topicId;
  if (fromEvent) return fromEvent;

  const fromOperation = operationId.match(/tpc_[A-Za-z0-9]+/)?.[0];
  if (fromOperation) return fromOperation;
  throw new Error(`Could not resolve a topic id from CLI JSON for ${operationId}.`);
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const assertTestEnvironment = () => {
  requireEnv('PROMPT_HARNESS_ENV');
  if (process.env.PROMPT_HARNESS_ENV !== 'test') {
    throw new Error('PROMPT_HARNESS_ENV must be exactly "test".');
  }
  for (const value of [
    process.env.APP_URL,
    process.env.LOBEHUB_SERVER,
    process.env.PROMPT_HARNESS_PRODUCTION_URL,
  ]) {
    if (!value) continue;
    if (
      value.includes('_dangerous_local_dev_proxy') ||
      value.includes('app.lobehub.com') ||
      value.includes(':3010')
    ) {
      throw new Error(`Harness refuses production/dev-proxy URL: ${value}`);
    }
  }
};

const runScenario = async ({
  cliHome,
  scenario,
  serverUrl,
  runRoot,
  topicId,
}: {
  cliHome: string;
  runRoot: string;
  scenario: PromptScenario;
  serverUrl: string;
  topicId?: string;
}): Promise<{ operationId: string; runOutputPath: string; topicId: string }> => {
  const apiKey = requireEnv('LOBEHUB_CLI_API_KEY');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOBE_API_KEY: apiKey,
    LOBEHUB_CLI_API_KEY: apiKey,
    LOBEHUB_CLI_HOME: cliHome,
    LOBEHUB_JWT: '',
    LOBEHUB_SERVER: serverUrl,
  };
  delete env.LOBEHUB_JWT;

  const args = [
    'src/index.ts',
    'agent',
    'run',
    '-a',
    scenario.agentId,
    '-p',
    scenario.prompt,
    '--sse',
    '--json',
  ];
  if (topicId) args.push('-t', topicId);
  for (const skill of scenario.selectedSkills ?? []) {
    args.push('--skill', skill);
  }
  const result = await execFileAsync('bun', args, {
    cwd: path.join(repoRoot, 'apps/cli'),
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const runOutputPath = path.join(runRoot, 'runs', `${scenario.id}.json`);
  await writeFile(runOutputPath, result.stdout);
  if (result.stderr) {
    await writeFile(path.join(runRoot, 'logs', `${scenario.id}-cli.log`), result.stderr);
  }

  const operationId = parseOperationId(result.stdout);
  return {
    operationId,
    runOutputPath,
    topicId: parseTopicId(result.stdout, operationId),
  };
};

const inspectTrace = async ({
  cliHome,
  operationId,
  outputPath,
  serverUrl,
}: {
  cliHome: string;
  operationId: string;
  outputPath: string;
  serverUrl: string;
}): Promise<void> => {
  const apiKey = requireEnv('LOBEHUB_CLI_API_KEY');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOBE_API_KEY: apiKey,
    LOBEHUB_CLI_API_KEY: apiKey,
    LOBEHUB_CLI_HOME: cliHome,
    LOBEHUB_SERVER: serverUrl,
  };
  delete env.LOBEHUB_JWT;

  const result = await execFileAsync('lh', ['trace', 'op', 'inspect', operationId, '-j'], {
    env,
    maxBuffer: 128 * 1024 * 1024,
  });
  await writeFile(outputPath, result.stdout);
};

const main = async () => {
  assertTestEnvironment();
  const { infoFile, keep, scenarioIds, serve } = parseArgs(process.argv.slice(2));
  const runId = `t105-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const runRoot = await mkdtemp(path.join(tmpdir(), `lobehub-${runId}.`));
  const captureDir = path.join(runRoot, 'captures');
  const traceDir = path.join(runRoot, 'traces');
  const logDir = path.join(runRoot, 'logs');
  await Promise.all([
    mkdir(captureDir, { recursive: true }),
    mkdir(traceDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(path.join(runRoot, 'runs'), { recursive: true }),
  ]);

  const managed: ManagedProcess[] = [];
  let databaseDropped = false;
  const nextPort = await allocatePort();
  const mockPort = await allocatePort([nextPort]);
  const serverUrl = `http://127.0.0.1:${nextPort}`;
  const mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`;
  const databaseParts = parseDatabaseUrl(requireEnv('DATABASE_URL'));
  const runDatabase = `t105_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const clonedDatabaseUrl = buildDatabaseUrl(databaseParts, runDatabase);
  const pgContainer = process.env.PROMPT_HARNESS_PG_CONTAINER ?? 'lobehub-agent-testing-postgres';
  const distDir = `.next-${runId}`;
  const cliHome = path.join(runRoot, 'cli-home');
  const freezeClockPath = path.join(repoRoot, 'scripts/promptHarness/freezeClock.cjs');
  const scenarioRuns: ScenarioRun[] = [];
  const topicByScenario = new Map<string, string>();
  let provider: { providerRowId: string; vaultKeys: string[] } = {
    providerRowId: '',
    vaultKeys: [],
  };
  let failure: unknown;

  const stackInfo = {
    captureDir,
    mockPort,
    nextPort,
    runDatabase,
    runId,
    runRoot,
    serverUrl,
    traceDir,
  };
  console.log(JSON.stringify(stackInfo));
  if (infoFile) {
    await writeFile(infoFile, JSON.stringify(stackInfo, null, 2));
  }

  try {
    await cloneDatabase({
      container: pgContainer,
      sourceDatabase: databaseParts.database,
      targetDatabase: runDatabase,
      user: databaseParts.user,
    });
    await seedDatabase({
      container: pgContainer,
      database: runDatabase,
      fixturePath: path.join(repoRoot, 'scripts/promptHarness/fixtures/seed.sql'),
      user: databaseParts.user,
    });
    provider = await repointMockProvider({
      databaseUrl: clonedDatabaseUrl,
      keyVaultsSecret: requireEnv('KEY_VAULTS_SECRET'),
      mockBaseUrl,
      userId: 'user_agent_testing_001',
    });

    managed.push(
      spawnManaged({
        args: ['scripts/promptHarness/mockProvider.ts'],
        command: 'bun',
        cwd: repoRoot,
        env: {
          ...process.env,
          PROMPT_HARNESS_CAPTURE_DIR: captureDir,
          PROMPT_HARNESS_MOCK_PORT: String(mockPort),
        },
        logPath: path.join(logDir, 'mock.log'),
        name: 'mock',
      }),
    );
    await waitForHttp({ url: `${mockBaseUrl}/models`, timeoutMs: 15_000 });

    managed.push(
      spawnManaged({
        args: ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(nextPort)],
        command: 'pnpm',
        cwd: repoRoot,
        env: {
          ...process.env,
          AGENT_RUNTIME_MODE: 'local',
          APP_URL: serverUrl,
          DATABASE_DRIVER: 'node',
          DATABASE_URL: clonedDatabaseUrl,
          INTERNAL_APP_URL: serverUrl,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${freezeClockPath}`]
            .filter(Boolean)
            .join(' '),
          PORT: String(nextPort),
          PROMPT_HARNESS_FROZEN_TIME:
            process.env.PROMPT_HARNESS_FROZEN_TIME ?? '2026-11-02T12:00:00.000Z',
          REDIS_PREFIX: `prompt-harness:${runId}:`,
          REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380',
          PROMPT_HARNESS_NEXT_DIST_DIR: distDir,
        },
        logPath: path.join(logDir, 'next.log'),
        name: 'next',
      }),
    );
    await waitForPort({ port: nextPort, timeoutMs: 180_000 });
    await waitForHttp({
      timeoutMs: 180_000,
      url: `${serverUrl}/api/v1/users/me?includeCount=0`,
    });

    if (serve) {
      console.log(`Serving isolated prompt harness at ${serverUrl}`);
      console.log('Press Ctrl-C to stop the stack and drop the cloned database.');
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      console.log('Stopping isolated prompt harness.');
    }

    if (!serve) {
      for (const scenario of scenarioIds) {
        if (scenario.manualOnly) {
          console.log(`skipped ${scenario.id}: manual product UI scenario`);
          continue;
        }
        const topicId =
          scenario.topicId ??
          (scenario.topicFromScenarioId
            ? topicByScenario.get(scenario.topicFromScenarioId)
            : undefined);
        if (scenario.topicFromScenarioId && !topicId) {
          throw new Error(
            `${scenario.id} requires the completed topic from ${scenario.topicFromScenarioId}.`,
          );
        }
        for (const fixturePath of scenario.beforeFixturePaths ?? []) {
          await seedDatabase({
            container: pgContainer,
            database: runDatabase,
            fixturePath: path.join(repoRoot, fixturePath),
            user: databaseParts.user,
          });
        }
        const before = new Set(await readCaptureFiles(captureDir));
        const run = await runScenario({
          cliHome,
          runRoot,
          scenario,
          serverUrl,
          topicId,
        });
        const tracePath = path.join(traceDir, `${scenario.id}.json`);
        await inspectTrace({
          cliHome,
          operationId: run.operationId,
          outputPath: tracePath,
          serverUrl,
        });
        const after = await readCaptureFiles(captureDir);
        const scenarioCaptureFiles: string[] = [];
        for (const file of after) {
          if (before.has(file)) continue;
          if (await isAgentPromptCapture(captureDir, file)) scenarioCaptureFiles.push(file);
        }
        scenarioRuns.push({
          captureFiles: scenarioCaptureFiles,
          scenario,
          tracePath,
        });
        topicByScenario.set(scenario.id, run.topicId);
        for (const fixturePath of scenario.afterFixturePaths ?? []) {
          await seedDatabase({
            container: pgContainer,
            database: runDatabase,
            fixturePath: path.join(repoRoot, fixturePath),
            user: databaseParts.user,
          });
        }
        console.log(`captured ${scenario.id}: ${run.operationId}`);
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    await stopAll(managed);
    try {
      await dropDatabase({
        container: pgContainer,
        database: runDatabase,
        user: databaseParts.user,
      });
      databaseDropped = true;
    } catch (error) {
      console.error('Failed to drop harness database:', error);
    }
    await rm(path.join(repoRoot, distDir), { force: true, recursive: true });
  }

  const manifest: HarnessManifest = {
    captureDir,
    cleanup: {
      databaseDropped,
      portsClosed:
        !(await isPortOpen('127.0.0.1', nextPort)) && !(await isPortOpen('127.0.0.1', mockPort)),
      processesStopped: managed.every(
        (process) => process.child.exitCode !== null || process.child.signalCode !== null,
      ),
    },
    provider,
    runId,
    runRoot,
    scenarios: scenarioRuns,
  };
  const manifestPath = path.join(runRoot, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  let checks: VerificationCheck[] = [];
  if (!failure) {
    const baselinePath = path.join(repoRoot, 'scripts/promptHarness/fixtures/legacyBaseline.json');
    const chatBaselinePath = path.join(
      repoRoot,
      'scripts/promptHarness/fixtures/legacyChatBaseline.json',
    );
    let hasBaseline = true;
    let hasChatBaseline = true;
    try {
      await readFile(baselinePath);
    } catch {
      hasBaseline = false;
    }
    try {
      await readFile(chatBaselinePath);
    } catch {
      hasChatBaseline = false;
    }
    checks = await verifyHarnessRun({
      ...(hasBaseline && { legacyBaselinePath: baselinePath }),
      ...(hasChatBaseline && { legacyChatBaselinePath: chatBaselinePath }),
      manifest,
    });
  }

  const result = {
    agentPrompts: Object.fromEntries(
      scenarioIds.map((scenario) => [scenario.id, scenario.agentPrompt]),
    ),
    baselineAgentPrompt: HARNESS_AGENT_PROMPT,
    checks,
    error: failure instanceof Error ? failure.message : failure ? String(failure) : undefined,
    manifest,
    passed: !failure && checks.every((check) => check.status === 'PASS'),
  };
  const resultPath = path.join(runRoot, 'result.json');
  await writeFile(resultPath, JSON.stringify(result, null, 2));

  for (const check of checks) {
    console.log(`[${check.status}] ${check.id}: ${check.detail}`);
  }
  if (keep) console.log(`kept harness run at ${runRoot}`);
  if (failure) throw failure;
  if (!result.passed) process.exitCode = 1;
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
