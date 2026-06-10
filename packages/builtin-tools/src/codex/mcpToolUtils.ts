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

export const getCodexLinearMcpApiName = (toolName: string) => {
  if (!toolName) return '';

  let apiName = toolName.trim();
  if (apiName.startsWith(LINEAR_CODEX_PREFIX)) {
    apiName = apiName.slice(LINEAR_CODEX_PREFIX.length);
  }
  if (apiName.startsWith(LINEAR_CODEX_SERVER_PREFIX)) {
    apiName = apiName.slice(LINEAR_CODEX_SERVER_PREFIX.length);
  }

  return apiName;
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
