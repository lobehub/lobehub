import type { LobeToolManifest } from '@lobechat/context-engine';

import {
  CODE_MODE_EXECUTE_TIMEOUT_MS,
  CODE_MODE_IDENTIFIER,
  CODE_MODE_MAX_RESULT_CHARS,
  CODE_MODE_MAX_TOOL_CALLS,
  CODE_MODE_MEMORY_LIMIT_MB,
  CODE_MODE_SCRIPT_TIMEOUT_MS,
  CodeModeApiName,
} from './constants';

/** One connector whose tools were folded into Code Mode. */
export interface CodeModeConnector {
  identifier: string;
  title: string;
  /** API names the user has not disabled — the ones advertised to the model. */
  toolNames: string[];
}

/**
 * The Code Mode manifest, plus the runtime-only list of identifiers it stands
 * in for. The list is the authority on what `execute` may call: the run's
 * manifest map also holds tools that were never enabled (discoverable ones the
 * activator could reach), and a script must not be a way around activation.
 */
export interface CodeModeManifest extends LobeToolManifest {
  codeMode: { toolIds: string[] };
}

export const getCodeModeToolIds = (manifestMap: Record<string, unknown>): string[] => {
  const manifest = manifestMap[CODE_MODE_IDENTIFIER] as Partial<CodeModeManifest> | undefined;
  return Array.isArray(manifest?.codeMode?.toolIds) ? manifest.codeMode.toolIds : [];
};

const buildSystemRole = (connectors: CodeModeConnector[]) => {
  const lines = connectors.map(
    (connector) =>
      `- ${connector.identifier} (${connector.title}): ${connector.toolNames.join(', ') || '(all tools disabled)'}`,
  );

  return [
    'The connector tools below are not offered as separate functions. Use them through Code Mode:',
    '',
    `1. Call \`${CodeModeApiName.docs}\` with the tool names you need (\`identifier.toolName\`) to read their descriptions and input schemas. Skip this only for a tool whose schema you already read in this conversation.`,
    `2. Call \`${CodeModeApiName.execute}\` with a script that calls them and returns only what you need. Chain dependent calls, loop, filter and aggregate inside one script instead of making one call per step.`,
    '',
    'Available connector tools:',
    ...lines,
  ].join('\n');
};

export const buildCodeModeManifest = (connectors: CodeModeConnector[]): CodeModeManifest => ({
  api: [
    {
      description:
        'Look up the connector tools you can call from `execute`. With no arguments, lists every tool with a one-line summary. ' +
        "With `tools`, returns each named tool's full description and JSON input schema; a bare connector identifier returns all of that connector's tools.",
      name: CodeModeApiName.docs,
      parameters: {
        properties: {
          tools: {
            description:
              'Tool names as `identifier.toolName` (e.g. `github.list_issues`), or a connector identifier for all of its tools.',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: CODE_MODE_EXECUTE_TIMEOUT_MS,
      description:
        'Run a JavaScript or TypeScript script that calls connector tools and returns one combined result. ' +
        'The script is the body of an async function: use `await`, and `return` the value you want back (it is JSON-serialized). ' +
        'Call a tool with `await tools.<identifier>.<toolName>(args)` or `await callTool("identifier.toolName", args)`; ' +
        'it resolves to the tool result (parsed JSON when the result is JSON, otherwise text) and throws an Error with a `code` when the call fails or the tool is disabled. ' +
        '`console.log` output is returned with the result. There is no network, filesystem, timer or import access — only tool calls. ' +
        `Limits per script: ${CODE_MODE_SCRIPT_TIMEOUT_MS / 1000}s, ${CODE_MODE_MEMORY_LIMIT_MB} MB, ${CODE_MODE_MAX_TOOL_CALLS} tool calls; output beyond ${CODE_MODE_MAX_RESULT_CHARS} characters is truncated, so return a focused result. ` +
        'A failed script is not retried automatically: tool calls made before the failure have already run.',
      name: CodeModeApiName.execute,
      parameters: {
        properties: {
          code: {
            description:
              'The script body. Plain JavaScript or TypeScript with erasable type annotations.',
            type: 'string',
          },
        },
        required: ['code'],
        type: 'object',
      },
    } as LobeToolManifest['api'][number],
  ],
  codeMode: { toolIds: connectors.map((connector) => connector.identifier) },
  identifier: CODE_MODE_IDENTIFIER,
  meta: {
    description: 'Call connector tools from a script',
    title: 'Code Mode',
  },
  systemRole: buildSystemRole(connectors),
  type: 'builtin',
});
