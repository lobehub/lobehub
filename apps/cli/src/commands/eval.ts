import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { resolveLocalDeviceId } from '../utils/device';
import { log } from '../utils/logger';

const JSON_VERSION = 'v1' as const;

interface JsonError {
  code?: string;
  message: string;
}

interface JsonEnvelope<T> {
  data: T | null;
  error: JsonError | null;
  ok: boolean;
  version: typeof JSON_VERSION;
}

interface JsonOption {
  json?: boolean;
}

const printJson = (data: unknown) => {
  console.log(JSON.stringify(data, null, 2));
};

const outputJsonSuccess = (data: unknown) => {
  const payload: JsonEnvelope<unknown> = {
    data,
    error: null,
    ok: true,
    version: JSON_VERSION,
  };
  printJson(payload);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toJsonError = (error: unknown): JsonError => {
  if (error instanceof Error) {
    const maybeData = (error as Error & { data?: { code?: string } }).data;
    const code = maybeData?.code;

    return {
      code: typeof code === 'string' ? code : undefined,
      message: error.message,
    };
  }

  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code : undefined;
    const message = typeof error.message === 'string' ? error.message : 'Unknown error';
    return { code, message };
  }

  return { message: String(error) };
};

const handleCommandError = (error: unknown, json: boolean) => {
  const normalized = toJsonError(error);

  if (json) {
    const payload: JsonEnvelope<null> = {
      data: null,
      error: normalized,
      ok: false,
      version: JSON_VERSION,
    };
    printJson(payload);
  } else {
    log.error(normalized.message);
  }

  process.exit(1);
};

const parseScore = (value: string) => {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    throw new InvalidArgumentError(`Invalid score: ${value}`);
  }
  return score;
};

const parseBoolean = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new InvalidArgumentError(`Invalid boolean value: ${value}`);
};

const parseResultJson = (value: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError('Invalid JSON value for --result-json');
  }

  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new InvalidArgumentError('--result-json must be a JSON object');
  }

  return parsed;
};

const parseJsonObject = (option: string) => (value: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError(`Invalid JSON value for ${option}`);
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new InvalidArgumentError(`${option} must be a JSON object`);
  }
  return parsed;
};

const RUN_SET_STATUSES = ['completed', 'external', 'failed', 'aborted'] as const;
type RunSetStatus = (typeof RUN_SET_STATUSES)[number];

const parseRunStatus = (value: string): RunSetStatus => {
  if (!(RUN_SET_STATUSES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(
      `Only ${RUN_SET_STATUSES.map((s) => `'${s}'`).join(', ')} are supported`,
    );
  }

  return value as RunSetStatus;
};

const executeCommand = async (
  options: JsonOption,
  action: () => Promise<unknown>,
  successMessage?: string,
) => {
  try {
    const data = await action();
    if (options.json) {
      outputJsonSuccess(data);
      return;
    }

    if (successMessage) {
      console.log(`${pc.green('OK')} ${successMessage}`);
      return;
    }

    printJson(data);
  } catch (error) {
    handleCommandError(error, Boolean(options.json));
  }
};

export function registerEvalCommand(program: Command) {
  const evalCmd = program.command('eval').description('Manage evaluation workflows');

  // ============================================
  // Benchmark Operations
  // ============================================
  const benchmarkCmd = evalCmd.command('benchmark').description('Manage evaluation benchmarks');

  benchmarkCmd
    .command('list')
    .description('List benchmarks')
    .option('--include-system', 'Include system benchmarks')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { includeSystem?: boolean }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.listBenchmarks.query({
          includeSystem: options.includeSystem ?? true,
        });
      }),
    );

  benchmarkCmd
    .command('get')
    .description('Get benchmark details')
    .requiredOption('--id <id>', 'Benchmark ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.getBenchmark.query({ id: options.id });
      }),
    );

  benchmarkCmd
    .command('create')
    .description('Create a benchmark')
    .requiredOption('--identifier <identifier>', 'Unique identifier')
    .requiredOption('-n, --name <name>', 'Benchmark name')
    .option('-d, --description <desc>', 'Description')
    .option('--reference-url <url>', 'Reference URL')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          description?: string;
          identifier: string;
          name: string;
          referenceUrl?: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const input: Record<string, any> = {
              identifier: options.identifier,
              name: options.name,
            };
            if (options.description) input.description = options.description;
            if (options.referenceUrl) input.referenceUrl = options.referenceUrl;
            return client.agentEval.createBenchmark.mutate(input as any);
          },
          `Created benchmark ${pc.bold(options.name)}`,
        ),
    );

  benchmarkCmd
    .command('update')
    .description('Update a benchmark')
    .requiredOption('--id <id>', 'Benchmark ID')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <desc>', 'New description')
    .option('--reference-url <url>', 'New reference URL')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          description?: string;
          id: string;
          name?: string;
          referenceUrl?: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const input: Record<string, any> = { id: options.id };
            if (options.name) input.name = options.name;
            if (options.description) input.description = options.description;
            if (options.referenceUrl) input.referenceUrl = options.referenceUrl;
            return client.agentEval.updateBenchmark.mutate(input as any);
          },
          `Updated benchmark ${pc.bold(options.id)}`,
        ),
    );

  benchmarkCmd
    .command('delete')
    .description('Delete a benchmark')
    .requiredOption('--id <id>', 'Benchmark ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.deleteBenchmark.mutate({ id: options.id });
        },
        `Deleted benchmark ${pc.bold(options.id)}`,
      ),
    );

  // ============================================
  // Experiment Operations
  // ============================================
  const experimentCmd = evalCmd.command('experiment').description('Manage evaluation experiments');

  experimentCmd
    .command('list')
    .description('List experiments')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.listExperiments.query();
      }),
    );

  experimentCmd
    .command('get')
    .description('Get experiment details (benchmarks, datasets, runs)')
    .requiredOption('--id <id>', 'Experiment ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.getExperiment.query({ id: options.id });
      }),
    );

  experimentCmd
    .command('create')
    .description('Create an experiment')
    .requiredOption('-n, --name <name>', 'Experiment name')
    .requiredOption('--benchmark-ids <ids>', 'Comma-separated benchmark IDs')
    .option('--id <id>', 'Caller-supplied ID (idempotent cross-server create)')
    .option('-d, --description <desc>', 'Description')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          benchmarkIds: string;
          description?: string;
          id?: string;
          name: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const input: Record<string, any> = {
              benchmarkIds: options.benchmarkIds
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              name: options.name,
            };
            if (options.id) input.id = options.id;
            if (options.description) input.description = options.description;
            return client.agentEval.createExperiment.mutate(input as any);
          },
          `Created experiment ${pc.bold(options.name)}`,
        ),
    );

  experimentCmd
    .command('update')
    .description('Update an experiment')
    .requiredOption('--id <id>', 'Experiment ID')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <desc>', 'New description')
    .option('--benchmark-ids <ids>', 'Comma-separated benchmark IDs (replaces existing)')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          benchmarkIds?: string;
          description?: string;
          id: string;
          name?: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const input: Record<string, any> = { id: options.id };
            if (options.name) input.name = options.name;
            if (options.description) input.description = options.description;
            if (options.benchmarkIds)
              input.benchmarkIds = options.benchmarkIds
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            return client.agentEval.updateExperiment.mutate(input as any);
          },
          `Updated experiment ${pc.bold(options.id)}`,
        ),
    );

  experimentCmd
    .command('delete')
    .description('Delete an experiment (detaches runs and datasets)')
    .requiredOption('--id <id>', 'Experiment ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.deleteExperiment.mutate({ id: options.id });
        },
        `Deleted experiment ${pc.bold(options.id)}`,
      ),
    );

  // ============================================
  // Dataset Operations
  // ============================================
  const datasetCmd = evalCmd.command('dataset').description('Manage evaluation datasets');

  datasetCmd
    .command('list')
    .description('List datasets')
    .option('--benchmark-id <id>', 'Filter by benchmark ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { benchmarkId?: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.listDatasets.query(
          options.benchmarkId ? { benchmarkId: options.benchmarkId } : undefined,
        );
      }),
    );

  datasetCmd
    .command('get')
    .description('Get dataset details (use --external for external eval API)')
    .requiredOption('--id <id>', 'Dataset ID')
    .option('--external', 'Use external evaluation API')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { external?: boolean; id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        if (options.external) {
          return client.agentEvalExternal.datasetGet.query({ datasetId: options.id });
        }
        return client.agentEval.getDataset.query({ id: options.id });
      }),
    );

  datasetCmd
    .command('create')
    .description('Create a dataset')
    .requiredOption('--benchmark-id <id>', 'Benchmark ID')
    .requiredOption('--identifier <identifier>', 'Unique identifier')
    .requiredOption('-n, --name <name>', 'Dataset name')
    .option('-d, --description <desc>', 'Description')
    .option('--eval-mode <mode>', 'Evaluation mode')
    .option(
      '--eval-config <json>',
      'Evaluation config JSON object',
      parseJsonObject('--eval-config'),
    )
    .option('--metadata <json>', 'Dataset metadata JSON object', parseJsonObject('--metadata'))
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          benchmarkId: string;
          description?: string;
          evalConfig?: Record<string, unknown>;
          evalMode?: string;
          identifier: string;
          metadata?: Record<string, unknown>;
          name: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const input: Record<string, any> = {
              benchmarkId: options.benchmarkId,
              identifier: options.identifier,
              name: options.name,
            };
            if (options.description) input.description = options.description;
            if (options.evalMode) input.evalMode = options.evalMode;
            if (options.evalConfig) input.evalConfig = options.evalConfig;
            if (options.metadata) input.metadata = options.metadata;
            return client.agentEval.createDataset.mutate(input as any);
          },
          `Created dataset ${pc.bold(options.name)}`,
        ),
    );

  datasetCmd
    .command('update')
    .description('Update a dataset')
    .requiredOption('--id <id>', 'Dataset ID')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <desc>', 'New description')
    .option('--eval-mode <mode>', 'New evaluation mode')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          description?: string;
          evalMode?: string;
          id: string;
          name?: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const input: Record<string, any> = { id: options.id };
            if (options.name) input.name = options.name;
            if (options.description) input.description = options.description;
            if (options.evalMode) input.evalMode = options.evalMode;
            return client.agentEval.updateDataset.mutate(input as any);
          },
          `Updated dataset ${pc.bold(options.id)}`,
        ),
    );

  datasetCmd
    .command('delete')
    .description('Delete a dataset')
    .requiredOption('--id <id>', 'Dataset ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.deleteDataset.mutate({ id: options.id });
        },
        `Deleted dataset ${pc.bold(options.id)}`,
      ),
    );

  // ============================================
  // TestCase Operations
  // ============================================
  const testcaseCmd = evalCmd.command('testcase').description('Manage evaluation test cases');

  testcaseCmd
    .command('list')
    .description('List test cases')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .option('-L, --limit <n>', 'Page size', '50')
    .option('--offset <n>', 'Offset', '0')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { datasetId: string; limit?: string; offset?: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.listTestCases.query({
          datasetId: options.datasetId,
          limit: Number.parseInt(options.limit || '50', 10),
          offset: Number.parseInt(options.offset || '0', 10),
        });
      }),
    );

  testcaseCmd
    .command('get')
    .description('Get test case details')
    .requiredOption('--id <id>', 'Test case ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.getTestCase.query({ id: options.id });
      }),
    );

  testcaseCmd
    .command('create')
    .description('Create a test case')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .requiredOption('--input <text>', 'Input text')
    .option('--expected <text>', 'Expected output')
    .option('--category <cat>', 'Category')
    .option('--case-id <id>', 'Dataset-native case ID (stored in metadata.caseId)')
    .option('--sort-order <n>', 'Sort order')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          caseId?: string;
          category?: string;
          datasetId: string;
          expected?: string;
          input: string;
          sortOrder?: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const content: Record<string, any> = { input: options.input };
            if (options.expected) content.expected = options.expected;
            if (options.category) content.category = options.category;

            const input: Record<string, any> = { content, datasetId: options.datasetId };
            if (options.caseId) input.metadata = { caseId: options.caseId };
            if (options.sortOrder) input.sortOrder = Number.parseInt(options.sortOrder, 10);
            return client.agentEval.createTestCase.mutate(input as any);
          },
          'Created test case',
        ),
    );

  testcaseCmd
    .command('update')
    .description('Update a test case')
    .requiredOption('--id <id>', 'Test case ID')
    .option('--input <text>', 'New input text')
    .option('--expected <text>', 'New expected output')
    .option('--category <cat>', 'New category')
    .option('--sort-order <n>', 'New sort order')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          category?: string;
          expected?: string;
          id: string;
          input?: string;
          sortOrder?: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            const input: Record<string, any> = { id: options.id };
            const content: Record<string, any> = {};
            if (options.input) content.input = options.input;
            if (options.expected) content.expected = options.expected;
            if (options.category) content.category = options.category;
            if (Object.keys(content).length > 0) input.content = content;
            if (options.sortOrder) input.sortOrder = Number.parseInt(options.sortOrder, 10);
            return client.agentEval.updateTestCase.mutate(input as any);
          },
          `Updated test case ${pc.bold(options.id)}`,
        ),
    );

  testcaseCmd
    .command('delete')
    .description('Delete a test case')
    .requiredOption('--id <id>', 'Test case ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.deleteTestCase.mutate({ id: options.id });
        },
        `Deleted test case ${pc.bold(options.id)}`,
      ),
    );

  testcaseCmd
    .command('count')
    .description('Count test cases by dataset (external eval API)')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { datasetId: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.testCasesCount.query({ datasetId: options.datasetId });
      }),
    );

  // ============================================
  // Run Operations
  // ============================================
  const runCmd = evalCmd.command('run').description('Manage evaluation runs');

  runCmd
    .command('list')
    .description('List evaluation runs')
    .option('--benchmark-id <id>', 'Filter by benchmark ID')
    .option('--dataset-id <id>', 'Filter by dataset ID')
    .option('--experiment-id <id>', 'Filter by experiment ID')
    .option('--status <status>', 'Filter by status')
    .option('-L, --limit <n>', 'Page size', '50')
    .option('--offset <n>', 'Offset', '0')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          benchmarkId?: string;
          datasetId?: string;
          experimentId?: string;
          limit?: string;
          offset?: string;
          status?: string;
        },
      ) =>
        executeCommand(options, async () => {
          const client = await getTrpcClient();
          const input: Record<string, any> = {};
          if (options.benchmarkId) input.benchmarkId = options.benchmarkId;
          if (options.datasetId) input.datasetId = options.datasetId;
          if (options.experimentId) input.experimentId = options.experimentId;
          if (options.status) input.status = options.status;
          input.limit = Number.parseInt(options.limit || '50', 10);
          input.offset = Number.parseInt(options.offset || '0', 10);
          return client.agentEval.listRuns.query(input as any);
        }),
    );

  runCmd
    .command('get')
    .description('Get run details (use --external for external eval API)')
    .requiredOption('--id <id>', 'Run ID')
    .option('--external', 'Use external evaluation API')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { external?: boolean; id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        if (options.external) {
          return client.agentEvalExternal.runGet.query({ runId: options.id });
        }
        return client.agentEval.getRunDetails.query({ id: options.id });
      }),
    );

  runCmd
    .command('create')
    .description('Create an evaluation run')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .option('--agent-id <id>', 'Target agent ID')
    .option('-n, --name <name>', 'Run name')
    .option('--k <n>', 'Number of runs per test case (1-10)')
    .option('--max-concurrency <n>', 'Max concurrency (1-10)')
    .option('--max-steps <n>', 'Max steps (1-1000)')
    .option('--timeout <ms>', 'Timeout in ms (60000-3600000)')
    .option('--experiment-id <id>', 'Experiment ID')
    .option('--external', 'Create a claimable external run (pending, no topics, k=1)')
    .option('--id <id>', 'Caller-supplied run ID (idempotent create; 409 if params differ)')
    .option('--include-cases <ids>', 'Comma-separated dataset-native case IDs to include')
    .option('--exclude-cases <ids>', 'Comma-separated dataset-native case IDs to exclude')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          agentId?: string;
          datasetId: string;
          excludeCases?: string;
          experimentId?: string;
          external?: boolean;
          id?: string;
          includeCases?: string;
          k?: string;
          maxConcurrency?: string;
          maxSteps?: string;
          name?: string;
          timeout?: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            if (options.includeCases && options.excludeCases) {
              throw new InvalidArgumentError('Use only one of --include-cases or --exclude-cases');
            }

            const client = await getTrpcClient();
            const input: Record<string, any> = { datasetId: options.datasetId };
            if (options.agentId) input.targetAgentId = options.agentId;
            if (options.name) input.name = options.name;
            if (options.experimentId) input.experimentId = options.experimentId;
            if (options.id) input.id = options.id;
            const config: Record<string, any> = {};
            if (options.k) config.k = Number.parseInt(options.k, 10);
            if (options.maxConcurrency)
              config.maxConcurrency = Number.parseInt(options.maxConcurrency, 10);
            if (options.maxSteps) config.maxSteps = Number.parseInt(options.maxSteps, 10);
            if (options.timeout) config.timeout = Number.parseInt(options.timeout, 10);
            const parseCaseIds = (csv: string) =>
              csv
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (options.includeCases)
              config.caseSelection = {
                caseIds: parseCaseIds(options.includeCases),
                mode: 'include',
              };
            if (options.excludeCases)
              config.caseSelection = {
                caseIds: parseCaseIds(options.excludeCases),
                mode: 'exclude',
              };
            if (Object.keys(config).length > 0) input.config = config;
            if (options.external) {
              return client.agentEvalExternal.runCreate.mutate(input as any);
            }
            return client.agentEval.createRun.mutate(input as any);
          },
          'Created evaluation run',
        ),
    );

  runCmd
    .command('claim')
    .description('Claim a pending external run (pending -> running) and fetch its workload')
    .requiredOption('--id <id>', 'Run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.runClaim.mutate({ runId: options.id });
      }),
    );

  runCmd
    .command('delete')
    .description('Delete an evaluation run')
    .requiredOption('--id <id>', 'Run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.deleteRun.mutate({ id: options.id });
        },
        `Deleted run ${pc.bold(options.id)}`,
      ),
    );

  runCmd
    .command('start')
    .description('Start an evaluation run')
    .requiredOption('--id <id>', 'Run ID')
    .option('--force', 'Force restart even if already running')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { force?: boolean; id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.startRun.mutate({ id: options.id, force: options.force });
        },
        `Started run ${pc.bold(options.id)}`,
      ),
    );

  runCmd
    .command('abort')
    .description('Abort a running evaluation')
    .requiredOption('--id <id>', 'Run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.abortRun.mutate({ id: options.id });
        },
        `Aborted run ${pc.bold(options.id)}`,
      ),
    );

  runCmd
    .command('retry-errors')
    .description('Retry failed test cases in a run')
    .requiredOption('--id <id>', 'Run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEval.retryRunErrors.mutate({ id: options.id });
        },
        `Retrying errors for run ${pc.bold(options.id)}`,
      ),
    );

  runCmd
    .command('progress')
    .description('Get run progress')
    .requiredOption('--id <id>', 'Run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.getRunProgress.query({ id: options.id });
      }),
    );

  runCmd
    .command('results')
    .description('Get run results')
    .requiredOption('--id <id>', 'Run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.getRunResults.query({ id: options.id });
      }),
    );

  runCmd
    .command('set-status')
    .description('Set run status (external eval API: completed | external | failed | aborted)')
    .requiredOption('--id <id>', 'Run ID')
    .requiredOption(
      '--status <status>',
      'Status (completed | external | failed | aborted)',
      parseRunStatus,
    )
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { id: string; status: RunSetStatus }) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEvalExternal.runSetStatus.mutate({
            runId: options.id,
            status: options.status,
          });
        },
        `Run ${pc.bold(options.id)} status updated to ${pc.bold(options.status)}`,
      ),
    );

  // ============================================
  // Run-Topic Operations (external eval API)
  // ============================================
  const runTopicCmd = evalCmd.command('run-topic').description('Manage evaluation run topics');

  runTopicCmd
    .command('list')
    .description('List topics in a run')
    .requiredOption('--run-id <id>', 'Run ID')
    .option('--only-external', 'Only return topics pending external evaluation')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { onlyExternal?: boolean; runId: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.runTopicsList.query({
          onlyExternal: Boolean(options.onlyExternal),
          runId: options.runId,
        });
      }),
    );

  runTopicCmd
    .command('report-result')
    .description('Report one evaluation result for a run topic')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption('--topic-id <id>', 'Topic ID')
    .option('--thread-id <id>', 'Thread ID (required for k > 1)')
    .requiredOption('--score <score>', 'Evaluation score', parseScore)
    .requiredOption('--correct <boolean>', 'Whether the result is correct', parseBoolean)
    .requiredOption('--result-json <json>', 'Raw evaluation result JSON object', parseResultJson)
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          correct: boolean;
          resultJson: Record<string, unknown>;
          runId: string;
          score: number;
          threadId?: string;
          topicId: string;
        },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();
            return client.agentEvalExternal.runTopicReportResult.mutate({
              correct: options.correct,
              result: options.resultJson,
              runId: options.runId,
              score: options.score,
              threadId: options.threadId,
              topicId: options.topicId,
            });
          },
          `Reported result for topic ${pc.bold(options.topicId)}`,
        ),
    );

  runTopicCmd
    .command('report-results')
    .description('Batch report evaluation results from a JSON file (or stdin with -)')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption(
      '--file <path>',
      'JSON file: array of {topicId, score, correct, result?, threadId?} (use - for stdin)',
    )
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { file: string; runId: string }) =>
      executeCommand(
        options,
        async () => {
          const raw =
            options.file === '-'
              ? await new Promise<string>((resolve, reject) => {
                  let data = '';
                  process.stdin.on('data', (chunk) => (data += chunk));
                  process.stdin.on('end', () => resolve(data));
                  process.stdin.on('error', reject);
                })
              : await readFile(options.file, 'utf8');

          const parsed = JSON.parse(raw);
          const items = Array.isArray(parsed) ? parsed : parsed.items;
          if (!Array.isArray(items) || items.length === 0) {
            throw new InvalidArgumentError(
              'Expected a JSON array of result items (or { items: [...] })',
            );
          }

          const client = await getTrpcClient();
          return client.agentEvalExternal.reportResultsBatch.mutate({
            items,
            runId: options.runId,
          } as any);
        },
        `Reported batch results for run ${pc.bold(options.runId)}`,
      ),
    );

  // ============================================
  // Eval Thread Operations (external eval API)
  // ============================================
  evalCmd
    .command('thread')
    .description('Manage evaluation threads')
    .command('list')
    .description('List threads by topic')
    .requiredOption('--topic-id <id>', 'Topic ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { topicId: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.threadsList.query({ topicId: options.topicId });
      }),
    );

  // ============================================
  // Eval Agent Execution (external eval API)
  // ============================================
  evalCmd
    .command('agent')
    .description('Run eval agent operations')
    .command('run')
    .description('Execute one case of a claimed run (creates topic on demand)')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption('--case-id <id>', 'Dataset-native case ID (or internal test case ID)')
    .option('--prompt <text>', 'Override the case input prompt')
    .option('--device <target>', 'Target device ID, or "local" for the current connected device')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & { caseId: string; device?: string; prompt?: string; runId: string },
      ) =>
        executeCommand(
          options,
          async () => {
            const client = await getTrpcClient();

            let deviceId: string | undefined;
            if (options.device !== undefined) {
              if (options.device === 'local') {
                deviceId = resolveLocalDeviceId();
                if (!deviceId) {
                  throw new InvalidArgumentError(
                    "No local device found. Run 'lh connect' first, then retry with --device local.",
                  );
                }
              } else {
                deviceId = options.device;
              }

              const devices = await client.device.listDevices.query();
              const matched = devices.find(
                (device: { deviceId?: string; online?: boolean }) => device.deviceId === deviceId,
              );
              if (!matched) {
                throw new InvalidArgumentError(
                  `Device "${deviceId}" was not found. Check 'lh device list' and try again.`,
                );
              }
              if (!matched.online) {
                throw new InvalidArgumentError(
                  `Device "${deviceId}" is not online. Bring it online and try again.`,
                );
              }
            }

            return client.agentEvalExternal.runExecuteCase.mutate({
              caseId: options.caseId,
              deviceId,
              prompt: options.prompt,
              runId: options.runId,
            });
          },
          `Started case ${pc.bold(options.caseId)} for run ${pc.bold(options.runId)}`,
        ),
    );

  // ============================================
  // Eval Message Operations (external eval API)
  // ============================================
  evalCmd
    .command('message')
    .description('Manage evaluation messages')
    .command('list')
    .description('List messages by topic and optional thread')
    .requiredOption('--topic-id <id>', 'Topic ID')
    .option('--thread-id <id>', 'Thread ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { threadId?: string; topicId: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.messagesList.query({
          threadId: options.threadId,
          topicId: options.topicId,
        });
      }),
    );
}
