import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { timeAgo } from '../../utils/format';
import { log } from '../../utils/logger';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const MAX_CONTENT_LENGTH = 20_000;
const MAX_TOOL_ARGUMENTS_LENGTH = 8_000;
const MAX_DATA_URL_PREFIX_LENGTH = 256;

interface TopicViewOptions {
  from?: string;
  json?: boolean;
  limit?: string;
  messages?: boolean;
  to?: string;
}

interface PersistedToolPayload {
  apiName?: string;
  arguments?: string;
  id?: string;
  identifier?: string;
}

interface TranscriptMessage {
  content: string | null;
  createdAt: Date;
  id: string;
  messageGroupId: string | null;
  parentId: string | null;
  role: string;
  threadId: string | null;
  tools: unknown[] | null;
}

interface TopicDetail {
  favorite?: boolean | null;
  id: string;
  model?: string | null;
  provider?: string | null;
  status?: string | null;
  title?: string | null;
  updatedAt?: Date | string | null;
}

interface Pagination {
  from: number;
  limit: number;
  offset: number;
}

const fail = (message: string): never => {
  log.error(message);
  process.exit(1);
};

const parsePositiveInteger = (value: string, option: string): number => {
  if (!/^\d+$/.test(value)) {
    return fail(`${option} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fail(`${option} must be a positive safe integer.`);
  }

  return parsed;
};

const resolvePagination = (options: TopicViewOptions): Pagination => {
  const from = parsePositiveInteger(options.from ?? '1', '--from');

  if (options.to !== undefined && options.limit !== undefined) {
    return fail('--to cannot be combined with --limit. Use one to define the page size.');
  }

  let limit: number;
  if (options.to !== undefined) {
    const to = parsePositiveInteger(options.to, '--to');
    if (to < from) {
      return fail('--to must be greater than or equal to --from.');
    }
    limit = to - from + 1;
  } else {
    limit = parsePositiveInteger(options.limit ?? String(DEFAULT_LIMIT), '--limit');
  }

  if (limit > MAX_LIMIT) {
    return fail(`A topic view page cannot exceed ${MAX_LIMIT} messages.`);
  }

  return { from, limit, offset: from - 1 };
};

const isBase64Character = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === '+' ||
    char === '/' ||
    char === '=' ||
    char === '-' ||
    char === '_'
  );
};

/** Replace base64 data URLs without scanning an unbounded prefix or using a backtracking regexp. */
const redactBase64DataUrls = (value: string): string => {
  const lowerValue = value.toLowerCase();
  const marker = ';base64,';
  let cursor = 0;
  let output = '';

  while (cursor < value.length) {
    const dataStart = lowerValue.indexOf('data:', cursor);
    if (dataStart === -1) {
      output += value.slice(cursor);
      break;
    }

    const payloadMarker = lowerValue.indexOf(marker, dataStart + 5);
    if (payloadMarker === -1 || payloadMarker - dataStart > MAX_DATA_URL_PREFIX_LENGTH) {
      output += value.slice(cursor, dataStart + 5);
      cursor = dataStart + 5;
      continue;
    }

    let payloadEnd = payloadMarker + marker.length;
    while (payloadEnd < value.length && isBase64Character(value[payloadEnd])) {
      payloadEnd += 1;
    }

    output += `${value.slice(cursor, dataStart)}[base64 data omitted]`;
    cursor = payloadEnd;
  }

  return output;
};

const sanitizeTerminalControls = (value: string): string =>
  value
    .replaceAll('�', '')
    // Keep newlines and tabs for formatting while dropping terminal control sequences.
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\u0000-\u0008\v\f\u000E-\u001F\u007F-\u009F]/g, '')
    // Preserve valid surrogate pairs (emoji) and remove only lone surrogates.
    .replaceAll(/[\uD800-\uDFFF]/gu, '');

const normalizeTerminalText = (value: string): string =>
  redactBase64DataUrls(
    sanitizeTerminalControls(value)
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replaceAll('\t', '    ')
      .replaceAll(/[\u202A-\u202E\u2066-\u2069]/g, ''),
  );

const formatTerminalText = (value: string, maxLength: number, label: string): string => {
  const truncated = value.length > maxLength;
  const normalized = normalizeTerminalText(truncated ? value.slice(0, maxLength) : value);

  return truncated ? `${normalized}\n[${label} truncated; use --json for full output]` : normalized;
};

const formatSingleLine = (value: unknown, maxLength = 200): string => {
  const stringValue = String(value ?? '');
  const truncated = stringValue.length > maxLength;
  const normalized = normalizeTerminalText(
    truncated ? stringValue.slice(0, maxLength) : stringValue,
  )
    .replaceAll(/\s+/g, ' ')
    .trim();

  return truncated ? `${normalized}…` : normalized;
};

const colorRole = (role: string): string => {
  const padded = role.padEnd(10);
  if (role === 'user') return pc.green(padded);
  if (role === 'assistant') return pc.blue(padded);
  if (role === 'tool') return pc.yellow(padded);
  return pc.magenta(padded);
};

const formatToolArguments = (argumentsValue: unknown): string | undefined => {
  if (typeof argumentsValue !== 'string' || argumentsValue.length === 0) return undefined;

  if (argumentsValue.length > MAX_TOOL_ARGUMENTS_LENGTH) {
    return `[tool arguments omitted: ${argumentsValue.length.toLocaleString('en-US')} characters; use --json for full output]`;
  }

  let formatted = argumentsValue;
  try {
    formatted = JSON.stringify(JSON.parse(argumentsValue), null, 2);
  } catch {
    // Tool arguments can be partial JSON while the model is still streaming.
  }

  return formatTerminalText(formatted, MAX_TOOL_ARGUMENTS_LENGTH, 'tool arguments');
};

const renderTopicHeader = (topic: TopicDetail) => {
  const id = formatSingleLine(topic.id);
  const title = formatSingleLine(topic.title || 'Untitled');

  console.log('');
  console.log(`${pc.bold('Topic:')}   ${pc.cyan(title)}  ${pc.dim(`(${id})`)}`);
  if (topic.favorite) console.log(`${pc.bold('Favorite:')} ★`);
  if (topic.updatedAt) console.log(`${pc.bold('Updated:')}  ${timeAgo(topic.updatedAt)}`);
  if (topic.status) console.log(`${pc.bold('Status:')}   ${formatSingleLine(topic.status)}`);
  if (topic.model) {
    const provider = topic.provider ? ` (${formatSingleLine(topic.provider)})` : '';
    console.log(`${pc.bold('Model:')}    ${formatSingleLine(topic.model)}${provider}`);
  }
  console.log('');
};

const renderMessage = (message: TranscriptMessage) => {
  const role = formatSingleLine(message.role || 'unknown', 32) || 'unknown';
  const thread = message.threadId
    ? pc.dim(`↳ [thread ${formatSingleLine(message.threadId, 80)}] `)
    : '';
  const content = message.content
    ? formatTerminalText(message.content, MAX_CONTENT_LENGTH, 'message content').trim()
    : '';

  if (content) {
    const lines = content.split('\n');
    console.log(`  ${thread}${colorRole(role)}  ${lines[0]}`);
    for (const line of lines.slice(1)) console.log(`              ${line}`);
  } else if (!message.tools?.length) {
    console.log(`  ${thread}${colorRole(role)}  ${pc.dim('(empty)')}`);
  }

  for (const rawTool of message.tools ?? []) {
    const tool =
      rawTool && typeof rawTool === 'object'
        ? (rawTool as PersistedToolPayload)
        : ({} as PersistedToolPayload);
    const identifier = formatSingleLine(tool.identifier, 80);
    const apiName = formatSingleLine(tool.apiName, 80);
    const toolName =
      identifier && apiName
        ? `${identifier}.${apiName}`
        : apiName || identifier || tool.id || 'unknown';
    console.log(`    ${pc.yellow('⚙')} ${pc.bold(formatSingleLine(toolName, 160))}`);

    const toolArguments = formatToolArguments(tool.arguments);
    if (toolArguments) {
      for (const line of toolArguments.split('\n')) console.log(`      ${line}`);
    }
  }
};

export function registerTopicViewCommand(topic: Command) {
  topic
    .command('view <id>')
    .description('View topic details and its messages')
    .option('-L, --limit <n>', `Number of messages to show (default: 50, max: ${MAX_LIMIT})`)
    .option('--from <n>', 'Show messages starting from this index (1-based)', '1')
    .option('--to <n>', 'Show messages up to this index (inclusive)')
    .option('--no-messages', 'Skip messages, show topic metadata only')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: TopicViewOptions) => {
      const includeMessages = options.messages !== false;
      const pagination = includeMessages
        ? resolvePagination(options)
        : { from: 1, limit: DEFAULT_LIMIT, offset: 0 };
      const client = await getTrpcClient();
      const result = await client.topic.getTopicTranscript.query({
        includeMessages,
        limit: pagination.limit,
        offset: pagination.offset,
        topicId: id,
      });

      const messages = result.items as TranscriptMessage[];
      const topicDetail = result.topic as TopicDetail;
      const total = result.total ?? 0;
      const displayedTo = messages.length > 0 ? pagination.from + messages.length - 1 : null;

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              messages,
              pagination: includeMessages
                ? {
                    from: pagination.from,
                    limit: pagination.limit,
                    to: displayedTo,
                    total,
                  }
                : null,
              topic: topicDetail,
            },
            null,
            2,
          ),
        );
        return;
      }

      renderTopicHeader(topicDetail);

      if (!includeMessages) {
        console.log(pc.dim('  (messages skipped)'));
        return;
      }

      if (messages.length === 0) {
        console.log(
          pc.dim(
            total === 0
              ? '  (no messages)'
              : `  (no messages in requested range; topic has ${total} messages)`,
          ),
        );
        return;
      }

      for (const message of messages) renderMessage(message);

      console.log('');
      const next =
        displayedTo !== null && displayedTo < total
          ? ` Next: --from ${displayedTo + 1} -L ${pagination.limit}`
          : '';
      console.log(pc.dim(`  Showing ${pagination.from}–${displayedTo} of ${total}.${next}`));
    });
}
