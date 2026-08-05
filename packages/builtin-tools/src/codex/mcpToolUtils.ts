'use client';

export interface CodexMcpToolArgs extends Record<string, unknown> {
  arguments?: unknown;
  error?: unknown;
  result?: unknown;
  server?: unknown;
  tool?: unknown;
}

export interface CodexMcpToolState extends Record<string, unknown> {
  arguments?: unknown;
  error?: unknown;
  result?: unknown;
  server?: unknown;
  status?: unknown;
  tool?: unknown;
}

export interface FormattedMcpValue {
  language: string;
  text: string;
}

const LINEAR_CODEX_PREFIX = 'linear_';
const LINEAR_CODEX_SERVER_PREFIX = 'server_';
const GITHUB_CODEX_PREFIX = 'github_';
const GITHUB_CODEX_SERVER_PREFIX = 'server_github_';
const CODEX_LINEAR_FETCH_API_BY_ENTITY: Record<string, string> = {
  document: 'get_document',
  initiative: 'get_initiative',
  issue: 'get_issue',
  project: 'get_project',
};
const SERVER_KEYS = ['server', 'serverName', 'server_name', 'connector', 'connector_id'];
const TOOL_KEYS = ['tool', 'toolName', 'tool_name', 'name'];
const INPUT_KEYS = ['arguments', 'args', 'input', 'params', 'parameters'];

const COMPLETED_MCP_TOOL_CALL_PATTERN = /^Completed mcp_tool_call\.?$/iu;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const getStringByKeys = (record: Record<string, unknown> | undefined, keys: string[]) => {
  if (!record) return '';

  for (const key of keys) {
    const value = normalizeString(record[key]);
    if (value) return value;
  }

  return '';
};

export const getMcpServer = (args?: CodexMcpToolArgs, state?: CodexMcpToolState) =>
  getStringByKeys(args, SERVER_KEYS) || getStringByKeys(state, SERVER_KEYS);

export const getMcpToolName = (args?: CodexMcpToolArgs, state?: CodexMcpToolState) =>
  getStringByKeys(args, TOOL_KEYS) || getStringByKeys(state, TOOL_KEYS);

export const getMcpInput = (args?: CodexMcpToolArgs, state?: CodexMcpToolState) => {
  const records = [args, state].filter(isRecord);

  for (const record of records) {
    for (const key of INPUT_KEYS) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
  }
};

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export const getMcpInputRecord = (
  args?: CodexMcpToolArgs,
  state?: CodexMcpToolState,
): Record<string, unknown> | undefined => {
  const input = getMcpInput(args, state);
  if (isRecord(input)) return input;

  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    if (isRecord(parsed)) return parsed;
  }
};

const normalizeCodexLinearToolName = (toolName: string) => {
  if (!toolName) return { apiName: '', hasLinearPrefix: false };

  let apiName = toolName
    .trim()
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[.\-\s]+/g, '_')
    .toLowerCase();
  let hasLinearPrefix = false;

  let changed = true;
  while (changed) {
    changed = false;

    if (apiName.startsWith(LINEAR_CODEX_PREFIX)) {
      apiName = apiName.slice(LINEAR_CODEX_PREFIX.length);
      hasLinearPrefix = true;
      changed = true;
    }

    if (apiName.startsWith(LINEAR_CODEX_SERVER_PREFIX)) {
      apiName = apiName.slice(LINEAR_CODEX_SERVER_PREFIX.length);
      changed = true;
    }

    while (apiName.startsWith('_')) {
      apiName = apiName.slice(1);
      changed = true;
    }
  }

  return { apiName, hasLinearPrefix };
};

const normalizeCodexGithubToolName = (toolName: string) => {
  if (!toolName) return { apiName: '', hasGithubPrefix: false };

  let apiName = toolName
    .trim()
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[-\s]+/g, '_')
    .toLowerCase();
  let hasGithubPrefix = false;

  let changed = true;
  while (changed) {
    changed = false;

    if (apiName.startsWith(GITHUB_CODEX_SERVER_PREFIX)) {
      apiName = apiName.slice(GITHUB_CODEX_SERVER_PREFIX.length);
      hasGithubPrefix = true;
      changed = true;
    }

    if (apiName.startsWith(GITHUB_CODEX_PREFIX)) {
      apiName = apiName.slice(GITHUB_CODEX_PREFIX.length);
      hasGithubPrefix = true;
      changed = true;
    }

    while (apiName.startsWith('_')) {
      apiName = apiName.slice(1);
      changed = true;
    }
  }

  return { apiName, hasGithubPrefix };
};

const isLinearServerName = (server?: string) =>
  normalizeString(server)
    .split(/[^a-z0-9]+/iu)
    .some((part) => part.toLowerCase() === 'linear');

const isGithubServerName = (server?: string) =>
  normalizeString(server)
    .split(/[^a-z0-9]+/iu)
    .some((part) => part.toLowerCase() === 'github');

const getCodexLinearFetchApiName = (
  input: Record<string, unknown> | undefined,
  isLinearContext: boolean,
) => {
  const id = normalizeString(input?.id);
  const entityPrefix = id.includes(':') ? id.slice(0, id.indexOf(':')).toLowerCase() : '';
  const prefixedApiName = CODEX_LINEAR_FETCH_API_BY_ENTITY[entityPrefix];
  if (prefixedApiName) return prefixedApiName;

  if (!isLinearContext) return '';

  if (/^[A-Z][A-Z0-9]+-\d+$/u.test(id)) return 'get_issue';

  return 'fetch';
};

export const getCodexLinearMcpApiName = ({
  input,
  server,
  toolName,
}: {
  input?: Record<string, unknown>;
  server?: string;
  toolName: string;
}) => {
  const { apiName, hasLinearPrefix } = normalizeCodexLinearToolName(toolName);
  const isLinearContext = hasLinearPrefix || isLinearServerName(server);

  if (apiName === 'fetch') return getCodexLinearFetchApiName(input, isLinearContext);
  if (apiName === 'search') return isLinearContext ? apiName : '';

  return apiName;
};

export const getCodexGithubMcpApiName = ({
  server,
  toolName,
}: {
  server?: string;
  toolName: string;
}) => {
  const { apiName, hasGithubPrefix } = normalizeCodexGithubToolName(toolName);
  const isGithubContext = hasGithubPrefix || isGithubServerName(server);

  return isGithubContext ? apiName : '';
};

const stringifyValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getTextFromContentItem = (item: unknown): string => {
  if (typeof item === 'string') return item;
  if (!isRecord(item)) return stringifyValue(item);

  const text = normalizeString(item.text) || normalizeString(item.content);
  if (text) return text;

  return stringifyValue(item);
};

const unwrapMcpResultEnvelope = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  if ('Ok' in value) return value.Ok;
  if ('Err' in value) return value.Err;
  if ('ok' in value) return value.ok;
  if ('error' in value && Object.keys(value).length === 1) return value.error;

  return value;
};

export const getMcpResultText = (
  content?: string,
  state?: CodexMcpToolState,
  args?: CodexMcpToolArgs,
) => {
  const result = unwrapMcpResultEnvelope(state?.result ?? args?.result);

  if (Array.isArray(result)) {
    return result.map(getTextFromContentItem).filter(Boolean).join('\n\n');
  }

  if (isRecord(result)) {
    if (Array.isArray(result.content)) {
      return result.content.map(getTextFromContentItem).filter(Boolean).join('\n\n');
    }

    const text = normalizeString(result.text) || normalizeString(result.output);
    if (text) return text;
  }

  const resultText = stringifyValue(result);
  if (resultText) return resultText;

  const output = content?.trim() || '';
  if (COMPLETED_MCP_TOOL_CALL_PATTERN.test(output)) return '';

  return output;
};

export const getMcpErrorText = (state?: CodexMcpToolState, args?: CodexMcpToolArgs) => {
  const error = state?.error ?? args?.error;
  if (!error) return '';

  if (isRecord(error)) {
    const message = normalizeString(error.message) || normalizeString(error.error);
    if (message) return message;
  }

  return stringifyValue(error);
};

export const formatMcpInput = (
  input: unknown,
  toolName?: string,
): FormattedMcpValue | undefined => {
  if (input === undefined || input === null) return;

  const parsed = typeof input === 'string' ? tryParseJson(input) : undefined;
  const value = parsed ?? input;

  if (isRecord(value)) {
    const code = normalizeString(value.code);
    if (code && Object.keys(value).length === 1) {
      return {
        language: toolName === 'js' || toolName === 'javascript' ? 'javascript' : 'text',
        text: code,
      };
    }
  }

  return {
    language: typeof value === 'string' ? 'text' : 'json',
    text: stringifyValue(value),
  };
};

export const formatMcpOutput = (
  value: string,
  toolName?: string,
): FormattedMcpValue | undefined => {
  const text = value.trim();
  if (!text) return;

  const parsed = tryParseJson(text);
  if (parsed !== undefined) {
    return {
      language: 'json',
      text: stringifyValue(parsed),
    };
  }

  return {
    language: toolName === 'js' || toolName === 'javascript' ? 'javascript' : 'text',
    text,
  };
};
