import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
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

interface RunGetOptions extends JsonOption {
  runId: string;
}

interface RunSetStatusOptions extends JsonOption {
  runId: string;
  status: 'completed' | 'external';
}

interface DatasetGetOptions extends JsonOption {
  datasetId: string;
}

interface RunTopicsListOptions extends JsonOption {
  onlyExternal?: boolean;
  runId: string;
}

interface ThreadsListOptions extends JsonOption {
  topicId: string;
}

interface MessagesListOptions extends JsonOption {
  threadId?: string;
  topicId: string;
}

interface TestCasesCountOptions extends JsonOption {
  datasetId: string;
}

interface RunTopicReportResultOptions extends JsonOption {
  correct: boolean;
  resultJson: Record<string, unknown>;
  runId: string;
  score: number;
  threadId?: string;
  topicId: string;
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

const parseRunStatus = (value: string) => {
  if (value !== 'completed' && value !== 'external') {
    throw new InvalidArgumentError("Only 'completed' and 'external' are supported");
  }

  return value as 'completed' | 'external';
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
  const evalCmd = program.command('eval').description('Manage external evaluation workflows');

  const runCmd = evalCmd.command('run').description('Manage evaluation runs');

  runCmd
    .command('get')
    .description('Get run information')
    .requiredOption('--run-id <id>', 'Run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: RunGetOptions) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.runGet.query({ runId: options.runId });
      }),
    );

  runCmd
    .command('set-status')
    .description('Set run status (external API supports completed or external)')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption('--status <status>', 'Status (completed | external)', parseRunStatus)
    .option('--json', 'Output JSON envelope')
    .action(async (options: RunSetStatusOptions) =>
      executeCommand(
        options,
        async () => {
          const client = await getTrpcClient();
          return client.agentEvalExternal.runSetStatus.mutate({
            runId: options.runId,
            status: options.status,
          });
        },
        `Run ${pc.bold(options.runId)} status updated to ${pc.bold(options.status)}`,
      ),
    );

  evalCmd
    .command('dataset')
    .description('Manage evaluation datasets')
    .command('get')
    .description('Get dataset information')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: DatasetGetOptions) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.datasetGet.query({ datasetId: options.datasetId });
      }),
    );

  evalCmd
    .command('run-topics')
    .description('Manage run topics')
    .command('list')
    .description('List topics in a run')
    .requiredOption('--run-id <id>', 'Run ID')
    .option('--only-external', 'Only return topics pending external evaluation')
    .option('--json', 'Output JSON envelope')
    .action(async (options: RunTopicsListOptions) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.runTopicsList.query({
          onlyExternal: Boolean(options.onlyExternal),
          runId: options.runId,
        });
      }),
    );

  evalCmd
    .command('threads')
    .description('Manage evaluation threads')
    .command('list')
    .description('List threads by topic')
    .requiredOption('--topic-id <id>', 'Topic ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: ThreadsListOptions) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.threadsList.query({ topicId: options.topicId });
      }),
    );

  evalCmd
    .command('messages')
    .description('Manage evaluation messages')
    .command('list')
    .description('List messages by topic and optional thread')
    .requiredOption('--topic-id <id>', 'Topic ID')
    .option('--thread-id <id>', 'Thread ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: MessagesListOptions) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.messagesList.query({
          threadId: options.threadId,
          topicId: options.topicId,
        });
      }),
    );

  evalCmd
    .command('test-cases')
    .description('Manage evaluation test cases')
    .command('count')
    .description('Count test cases by dataset')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: TestCasesCountOptions) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEvalExternal.testCasesCount.query({ datasetId: options.datasetId });
      }),
    );

  evalCmd
    .command('run-topic')
    .description('Manage evaluation run-topic reporting')
    .command('report-result')
    .description('Report one evaluation result for a run topic')
    .requiredOption('--run-id <id>', 'Run ID')
    .requiredOption('--topic-id <id>', 'Topic ID')
    .option('--thread-id <id>', 'Thread ID (required for k > 1)')
    .requiredOption('--score <score>', 'Evaluation score', parseScore)
    .requiredOption('--correct <boolean>', 'Whether the result is correct', parseBoolean)
    .requiredOption('--result-json <json>', 'Raw evaluation result JSON object', parseResultJson)
    .option('--json', 'Output JSON envelope')
    .action(async (options: RunTopicReportResultOptions) =>
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
}
