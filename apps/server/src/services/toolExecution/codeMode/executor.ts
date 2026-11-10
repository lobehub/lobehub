import type { LobeToolManifest } from '@lobechat/context-engine';
import { truncateToolResult } from '@lobechat/prompts/toolResult';
import type { ChatToolPayload } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import debug from 'debug';

import { ConnectorToolPermission } from '@/database/schemas';

import type {
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutionResultResponse,
} from '../types';
import {
  CODE_MODE_MAX_LOG_CHARS,
  CODE_MODE_MAX_RESULT_CHARS,
  CODE_MODE_MAX_TOOL_CALLS,
  CODE_MODE_MEMORY_LIMIT_MB,
  CODE_MODE_SCRIPT_TIMEOUT_MS,
  CODE_MODE_SUMMARY_MAX_CHARS,
  CodeModeApiName,
} from './constants';
import { getCodeModeToolIds } from './manifest';
import {
  runCodeModeScript,
  type RunScriptOutcome,
  type ScriptToolCallResult,
} from './sandbox/runScript';

const log = debug('lobe-server:code-mode');

export interface CodeModeDeps {
  /**
   * The user's stored permission for one connector tool (null when none is
   * stored). Read again for every call a script makes: the run's manifests
   * were built when the operation started, and the user may have switched the
   * tool off since.
   */
  getPermission: (identifier: string, apiName: string) => Promise<ConnectorToolPermission | null>;
  /** The regular tool execution path; every script call goes through it. */
  invokeTool: (
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResultResponse>;
  /** Overridable for tests. */
  runScript?: typeof runCodeModeScript;
}

interface CatalogEntry {
  api: LobeToolManifest['api'][number];
  apiName: string;
  identifier: string;
  manifest: LobeToolManifest;
  name: string;
}

const buildCatalog = (context: ToolExecutionContext): Map<string, CatalogEntry> => {
  const manifestMap = (context.toolManifestMap ?? {}) as Record<string, LobeToolManifest>;
  const catalog = new Map<string, CatalogEntry>();
  for (const identifier of getCodeModeToolIds(manifestMap)) {
    const manifest = manifestMap[identifier];
    if (!manifest?.api) continue;
    for (const api of manifest.api) {
      const name = `${identifier}.${api.name}`;
      catalog.set(name, { api, apiName: api.name, identifier, manifest, name });
    }
  }
  return catalog;
};

const summarize = (description: string | undefined) => {
  const firstLine = (description ?? '').trim().split('\n')[0] ?? '';
  return firstLine.length > CODE_MODE_SUMMARY_MAX_CHARS
    ? `${firstLine.slice(0, CODE_MODE_SUMMARY_MAX_CHARS - 1)}…`
    : firstLine;
};

const failure = (code: string, message: string): ToolExecutionResult => ({
  content: message,
  // A script may already have changed things through its tool calls; the
  // runtime's retry must never replay it.
  error: { code, kind: 'stop', message },
  success: false,
});

const runDocs = (catalog: Map<string, CatalogEntry>, args: { tools?: unknown }) => {
  const requested = Array.isArray(args.tools)
    ? args.tools.filter((name): name is string => typeof name === 'string')
    : [];

  if (requested.length === 0) {
    type ConnectorListing = { title: string; tools: { name: string; summary: string }[] };
    const byConnector = new Map<string, ConnectorListing>();
    for (const entry of catalog.values()) {
      const group: ConnectorListing = byConnector.get(entry.identifier) ?? {
        title: entry.manifest.meta?.title || entry.identifier,
        tools: [],
      };
      group.tools.push({ name: entry.name, summary: summarize(entry.api.description) });
      byConnector.set(entry.identifier, group);
    }
    return {
      connectors: [...byConnector.entries()].map(([identifier, group]) => ({
        identifier,
        ...group,
      })),
      hint: 'Pass `tools` with the names you plan to call to get their input schemas.',
    };
  }

  const tools: { description: string; inputSchema: unknown; name: string }[] = [];
  const unknown: string[] = [];
  for (const name of requested) {
    const entry = catalog.get(name);
    if (entry) {
      tools.push({ description: entry.api.description, inputSchema: entry.api.parameters, name });
      continue;
    }
    // A bare connector identifier stands for all of its tools.
    const ofConnector = [...catalog.values()].filter((item) => item.identifier === name);
    if (ofConnector.length === 0) {
      unknown.push(name);
      continue;
    }
    for (const item of ofConnector) {
      tools.push({
        description: item.api.description,
        inputSchema: item.api.parameters,
        name: item.name,
      });
    }
  }

  return {
    tools,
    ...(unknown.length > 0 && {
      unknown,
      unknownHint: 'Call `docs` with no arguments to list the available tool names.',
    }),
  };
};

/**
 * What a script receives for a successful call: the MCP structured result
 * when the server sent one, otherwise the text result, JSON-decoded when it is
 * JSON.
 */
const toScriptValue = (response: ToolExecutionResultResponse): unknown => {
  const state = response.state as
    { content?: unknown; state?: { structuredContent?: unknown } } | undefined;
  if (state?.state?.structuredContent !== undefined) return state.state.structuredContent;

  const text = typeof state?.content === 'string' ? state.content : response.content;
  const parsed = typeof text === 'string' ? safeParseJSON(text) : undefined;
  return parsed === undefined ? text : parsed;
};

const toolErrorMessage = (response: ToolExecutionResultResponse) => {
  const error = response.error as { message?: string } | string | undefined;
  return (
    response.content ||
    (typeof error === 'string' ? error : error?.message) ||
    'The tool call failed without a message.'
  );
};

interface ToolCallRecord {
  durationMs: number;
  name: string;
  success: boolean;
}

const formatOutcome = (outcome: RunScriptOutcome, calls: ToolCallRecord[]) => {
  const body: Record<string, unknown> = outcome.ok
    ? { result: outcome.value ?? null }
    : { error: outcome.error };
  if (outcome.logs.length > 0) body.logs = outcome.logs;
  if (outcome.logsTruncated) body.logsTruncated = true;
  body.toolCalls = calls.map(({ name, success }) => ({ name, success }));

  const content = JSON.stringify(body, null, 2);
  return truncateToolResult(content, CODE_MODE_MAX_RESULT_CHARS);
};

const runExecute = async (
  payload: ChatToolPayload,
  context: ToolExecutionContext,
  deps: CodeModeDeps,
  catalog: Map<string, CatalogEntry>,
  code: string,
): Promise<ToolExecutionResult> => {
  const calls: ToolCallRecord[] = [];
  const startedAt = Date.now();
  let seq = 0;

  const onToolCall = async (name: string, argsJson: string): Promise<ScriptToolCallResult> => {
    const entry = catalog.get(name);
    if (!entry) {
      return {
        error: {
          code: 'UNKNOWN_TOOL',
          message: `"${name}" is not a Code Mode tool. Call \`docs\` to list the available tool names (\`identifier.toolName\`).`,
        },
        ok: false,
      };
    }

    const callStartedAt = Date.now();
    const record = (success: boolean) =>
      calls.push({ durationMs: Date.now() - callStartedAt, name, success });

    // Hard gate, checked for every call: a script must never be a way around
    // the user's per-tool switches.
    const permission = await deps.getPermission(entry.identifier, entry.apiName);
    if (permission === ConnectorToolPermission.disabled) {
      record(false);
      return {
        error: {
          code: 'TOOL_DISABLED',
          message:
            `The tool "${entry.apiName}" has been disabled by the user and cannot be executed. ` +
            'Tell the user it is disabled; they can re-enable it in Settings > Connectors.',
        },
        ok: false,
      };
    }
    if (permission === ConnectorToolPermission.needs_approval) {
      record(false);
      return {
        error: {
          code: 'TOOL_NEEDS_APPROVAL',
          message:
            `The tool "${entry.apiName}" requires the user's approval for every call, which a script cannot ask for, so it was not run. ` +
            'Tell the user; they can allow it to run without approval in Settings > Connectors.',
        },
        ok: false,
      };
    }

    seq += 1;
    const remainingMs = Math.max(1000, CODE_MODE_SCRIPT_TIMEOUT_MS - (Date.now() - startedAt));
    const response = await deps.invokeTool(
      {
        apiName: entry.apiName,
        arguments: argsJson,
        id: `${payload.id}:code-mode:${seq}`,
        identifier: entry.identifier,
        type: (entry.manifest.type ?? 'mcp') as ChatToolPayload['type'],
      },
      { ...context, executionTimeoutMs: remainingMs, skipResultTruncation: false },
    );

    record(response.success);
    if (!response.success) {
      const error = response.error as { code?: string } | undefined;
      return {
        error: {
          code: (typeof error === 'object' && error?.code) || 'TOOL_ERROR',
          message: toolErrorMessage(response),
        },
        ok: false,
      };
    }
    return { ok: true, value: toScriptValue(response) };
  };

  const runScript = deps.runScript ?? runCodeModeScript;
  const outcome = await runScript({
    code,
    maxLogChars: CODE_MODE_MAX_LOG_CHARS,
    maxToolCalls: CODE_MODE_MAX_TOOL_CALLS,
    memoryLimitMb: CODE_MODE_MEMORY_LIMIT_MB,
    onToolCall,
    timeoutMs: CODE_MODE_SCRIPT_TIMEOUT_MS,
    toolNames: [...catalog.keys()],
  });

  log(
    'execute finished: ok=%s calls=%d duration=%dms error=%s',
    outcome.ok,
    outcome.toolCallCount,
    Date.now() - startedAt,
    outcome.error?.code,
  );

  const content = formatOutcome(outcome, calls);
  const state = { toolCalls: calls };
  if (outcome.ok) return { content, state, success: true };

  return {
    ...failure(
      outcome.error?.code ?? 'SCRIPT_ERROR',
      outcome.error?.message ?? 'The script failed.',
    ),
    content,
    state,
  };
};

/**
 * Serve one Code Mode call (`docs` or `execute`).
 *
 * The callable set is the Code Mode manifest's `codeMode.toolIds`, the
 * connectors folded into it when the operation was assembled; nothing else in
 * the manifest map is reachable from a script.
 */
export const executeCodeModeTool = async (
  payload: ChatToolPayload,
  context: ToolExecutionContext,
  deps: CodeModeDeps,
): Promise<ToolExecutionResult> => {
  const args = (safeParseJSON(payload.arguments) ?? {}) as { code?: unknown; tools?: unknown };
  const catalog = buildCatalog(context);

  switch (payload.apiName) {
    case CodeModeApiName.docs: {
      return { content: JSON.stringify(runDocs(catalog, args), null, 2), success: true };
    }

    case CodeModeApiName.execute: {
      if (typeof args.code !== 'string' || !args.code.trim()) {
        return failure('INVALID_ARGUMENTS', '`execute` needs a non-empty `code` string.');
      }
      return runExecute(payload, context, deps, catalog, args.code);
    }

    default: {
      return failure(
        'UNKNOWN_API',
        `Code Mode has no API named "${payload.apiName}". Available APIs: ${CodeModeApiName.docs}, ${CodeModeApiName.execute}.`,
      );
    }
  }
};
