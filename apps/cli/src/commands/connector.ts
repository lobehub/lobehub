import { isLocalOrPrivateUrl } from '@lobechat/utils/url';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { resolveServerUrl } from '../settings';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import type { LocalMcpParams } from '../utils/localMcp';
import { listLocalMcpTools } from '../utils/localMcp';
import { log } from '../utils/logger';
import type { StdioLaunch } from '../utils/stdioTrust';
import { hashStdioLaunch, isStdioLaunchTrusted, trustStdioLaunch } from '../utils/stdioTrust';

type TrpcClient = Awaited<ReturnType<typeof getTrpcClient>>;
type CreateConnectorInput = Parameters<TrpcClient['connector']['create']['mutate']>[0];
type ConnectorDetail = Awaited<ReturnType<TrpcClient['connector']['getForEdit']['query']>>;

interface ConnectorEndpoint {
  mcpConnectionType?: string | null;
  mcpServerUrl?: string | null;
}

export type ConnectorAuthType = 'none' | 'bearer' | 'oauth2';

export interface ConnectorAddOptions {
  auth?: string;
  force?: boolean;
  header?: string[];
  identifier?: string;
  json?: string | boolean;
  name?: string;
  stdioArg?: string[];
  stdioCmd?: string;
  token?: string;
  url?: string;
}

const AUTH_TYPES: ConnectorAuthType[] = ['none', 'bearer', 'oauth2'];

const IDENTIFIER_RE = /^[\w-]+$/;

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

/** Parse repeated `--header key:value` flags into a header record. */
export function parseHeaders(headers: string[] = []): Record<string, string> | undefined {
  if (headers.length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const raw of headers) {
    const index = raw.indexOf(':');
    const key = index > 0 ? raw.slice(0, index).trim() : '';
    if (!key) throw new Error(`Invalid --header "${raw}". Expected key:value.`);
    result[key] = raw.slice(index + 1).trim();
  }
  return result;
}

/** Derive a connector identifier from `--name`, then the URL host or stdio command. */
export function deriveIdentifier(options: Pick<ConnectorAddOptions, 'name' | 'stdioCmd' | 'url'>) {
  if (options.name) {
    const fromName = slugify(options.name);
    if (fromName) return fromName;
  }

  if (options.url) {
    try {
      const host = new URL(options.url).hostname.replace(/^(www|mcp)\./, '');
      const fromUrl = slugify(host);
      if (fromUrl) return fromUrl;
    } catch {
      // Invalid URLs are rejected by buildCreateInput.
    }
  }

  if (options.stdioCmd) {
    const fromCmd = slugify(options.stdioCmd.split(/[/\\]/).pop() || '');
    if (fromCmd) return fromCmd;
  }

  return undefined;
}

/**
 * Turn `lh connector add` flags into a `connector.create` input. Field shapes
 * follow `createConnectorSchema` and the web custom-connector form: a bearer
 * token goes in `credentials`, custom headers in `metadata.customHeaders`, and
 * OAuth2 writes no credentials (the OAuth callback stores the tokens).
 */
export function buildCreateInput(options: ConnectorAddOptions): {
  authType: ConnectorAuthType;
  input: CreateConnectorInput;
} {
  if (options.url && options.stdioCmd) {
    throw new Error('Use either --url or --stdio-cmd, not both.');
  }
  if (!options.url && !options.stdioCmd) {
    throw new Error('Provide --url <mcp url> or --stdio-cmd <command>.');
  }

  const authType = (options.auth ?? (options.token ? 'bearer' : 'none')) as ConnectorAuthType;
  if (!AUTH_TYPES.includes(authType)) {
    throw new Error(`Invalid --auth "${options.auth}". Expected one of: ${AUTH_TYPES.join(', ')}.`);
  }
  if (authType === 'bearer' && !options.token) {
    throw new Error('--auth bearer requires --token <token>.');
  }
  if (authType !== 'bearer' && options.token) {
    throw new Error('--token is only valid with --auth bearer.');
  }
  if (options.stdioCmd && authType !== 'none') {
    throw new Error('stdio connectors do not support --auth; pass secrets via the command.');
  }
  if (options.stdioCmd && options.header?.length) {
    throw new Error('--header is only valid for HTTP connectors (--url).');
  }
  if (options.url) {
    try {
      new URL(options.url);
    } catch {
      throw new Error(`Invalid --url "${options.url}".`);
    }
  }

  const identifier = options.identifier || deriveIdentifier(options);
  if (!identifier) {
    throw new Error('Could not derive an identifier. Pass --identifier <id>.');
  }
  if (!IDENTIFIER_RE.test(identifier)) {
    throw new Error(`Invalid --identifier "${identifier}". Use letters, digits, "_" and "-" only.`);
  }

  const headers = parseHeaders(options.header);

  const input: CreateConnectorInput = {
    identifier,
    name: options.name || identifier,
    sourceType: 'custom',
    ...(options.url
      ? { mcpConnectionType: 'http' as const, mcpServerUrl: options.url }
      : {
          mcpConnectionType: 'stdio' as const,
          mcpStdioConfig: { args: options.stdioArg ?? [], command: options.stdioCmd! },
        }),
    ...(authType === 'bearer' && { credentials: { token: options.token!, type: 'bearer' } }),
    ...(headers && { metadata: { customHeaders: headers } }),
  };

  return { authType, input };
}

/** Resolve a connector uuid or identifier to its uuid via `connector.list`. */
export async function resolveConnectorId(client: TrpcClient, idOrIdentifier: string) {
  if (UUID_RE.test(idOrIdentifier)) return idOrIdentifier;

  const connectors = await client.connector.list.query();
  const matches = connectors.filter((c: any) => c.identifier === idOrIdentifier);

  if (matches.length === 0) throw new Error(`Connector "${idOrIdentifier}" not found.`);
  if (matches.length > 1) {
    throw new Error(
      `Multiple connectors match "${idOrIdentifier}": ${matches.map((c: any) => c.id).join(', ')}. Pass the id instead.`,
    );
  }
  return matches[0].id as string;
}

/**
 * Whether tools must be listed from the CLI host: stdio servers run on this
 * machine and local/private-network URLs are unreachable from a hosted server,
 * so the server-side `syncTools` would fail for both (same split as the desktop
 * app's `syncConnectorTools`).
 */
export function isMachineLocalConnector(connector: ConnectorEndpoint): boolean {
  if (connector.mcpConnectionType === 'stdio') return true;
  return !!connector.mcpServerUrl && isLocalOrPrivateUrl(connector.mcpServerUrl);
}

/** Build local MCP connection params from `connector.getForEdit`, mirroring the desktop app. */
export function buildLocalMcpParams(detail: ConnectorDetail): LocalMcpParams {
  if (detail.mcpConnectionType === 'stdio') {
    if (!detail.mcpStdioConfig?.command) throw new Error('Connector is missing stdio config.');
    return {
      args: detail.mcpStdioConfig.args ?? [],
      command: detail.mcpStdioConfig.command,
      env: detail.mcpStdioConfig.env ?? undefined,
      type: 'stdio',
    };
  }

  if (!detail.mcpServerUrl) throw new Error('Connector is missing an MCP server URL.');

  // Custom headers live in metadata.customHeaders; legacy rows stored them as
  // a 'header' credential — merge both, like the server-side sync.
  const credentials = detail.credentials as
    | { apiKey: string; type: 'apikey' }
    | { headers: Record<string, string>; type: 'header' }
    | { token: string; type: 'bearer' }
    | null
    | undefined;
  const customHeaders = (detail.metadata as Record<string, unknown> | null | undefined)
    ?.customHeaders as Record<string, string> | undefined;
  const headers: Record<string, string> = {
    ...(credentials?.type === 'header' ? credentials.headers : undefined),
    ...customHeaders,
  };
  const token =
    credentials?.type === 'bearer'
      ? credentials.token
      : credentials?.type === 'apikey'
        ? credentials.apiKey
        : undefined;
  if (token) headers.Authorization = `Bearer ${token}`;

  return {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    type: 'http',
    url: detail.mcpServerUrl,
  };
}

/**
 * Gate before launching a stored stdio command on this machine. Throws to
 * stop the launch.
 */
export type ConfirmLocalCommand = (
  detail: ConnectorDetail,
  params: Extract<LocalMcpParams, { type: 'stdio' }>,
) => Promise<void>;

/** Render a stdio launch as a shell-quoted argv the user can inspect. */
export function formatStdioCommand(params: { args?: string[]; command: string }): string {
  const quote = (value: string) =>
    /^[\w./:=@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
  return [params.command, ...(params.args ?? [])].map(quote).join(' ');
}

const stdioTrustKey = (id: string) => `${resolveServerUrl()}#${id}`;

/**
 * `confirmLocalCommand` for `add`: record the launch as approved on this
 * machine only when the stored config is exactly what the user typed. If it
 * changed between `create` and the read-back (a concurrent overwrite), fall
 * back to showing it and asking, like `refresh`.
 */
export const trustTypedStdioCommand =
  (typed: StdioLaunch | undefined): ConfirmLocalCommand =>
  async (detail, params) => {
    if (typed && hashStdioLaunch(typed) === hashStdioLaunch(params)) {
      trustStdioLaunch(stdioTrustKey(detail.id), params);
      return;
    }
    await confirmSharedStdioCommand(detail, params);
  };

/**
 * `confirmLocalCommand` for `refresh`: a workspace stdio connector can be
 * stored or overwritten by another member, and refreshing it executes that
 * command as the local OS user. Run it unprompted only when this exact
 * command/argv/env was approved on this machine; otherwise show it and
 * require an interactive yes. The row's creator is not evidence — an
 * overwrite keeps `userId` while replacing the command.
 */
export const confirmSharedStdioCommand: ConfirmLocalCommand = async (detail, params) => {
  const key = stdioTrustKey(detail.id);
  if (isStdioLaunchTrusted(key, params)) return;

  const envKeys = Object.keys(params.env ?? {});
  const summary = [
    "This stdio connector's command has not been approved on this machine (it is new here, or someone changed it). Refreshing it runs:",
    `  ${formatStdioCommand(params)}`,
    ...(envKeys.length > 0 ? [`  with env: ${envKeys.join(', ')}`] : []),
  ].join('\n');

  if (!process.stdin.isTTY) {
    throw new Error(`${summary}\nRefusing to run it without an interactive confirmation.`);
  }
  console.error(summary);
  if (!(await confirm('Run this command?'))) {
    throw new Error('Cancelled: the stdio command was not run.');
  }
  trustStdioLaunch(key, params);
};

/**
 * Refresh a connector's tools. Server-reachable connectors use
 * `connector.syncTools`; machine-local ones are listed on this machine and
 * reported through `connector.syncToolsFromClientById`.
 */
export async function syncConnectorTools(
  client: TrpcClient,
  id: string,
  connector: ConnectorEndpoint,
  options: { confirmLocalCommand?: ConfirmLocalCommand } = {},
): Promise<{ local: boolean; toolCount: number }> {
  if (!isMachineLocalConnector(connector)) {
    const { toolCount } = await client.connector.syncTools.mutate({ id });
    return { local: false, toolCount };
  }

  const detail = await client.connector.getForEdit.query({ id });
  const params = buildLocalMcpParams(detail);
  if (params.type === 'stdio') await options.confirmLocalCommand?.(detail, params);

  let tools: Awaited<ReturnType<typeof listLocalMcpTools>>;
  try {
    tools = await listLocalMcpTools(params);
  } catch (error) {
    throw new Error(
      `Could not list tools from the MCP server on this machine: ${(error as Error)?.message ?? String(error)}`,
      { cause: error },
    );
  }
  const { toolCount } = await client.connector.syncToolsFromClientById.mutate({ id, tools });
  return { local: true, toolCount };
}

/** Resolve a connector uuid or identifier to its `connector.list` row. */
export async function resolveConnector(client: TrpcClient, idOrIdentifier: string) {
  const connectors = await client.connector.list.query();
  if (UUID_RE.test(idOrIdentifier)) {
    const match = connectors.find((c: any) => c.id === idOrIdentifier);
    if (!match) throw new Error(`Connector "${idOrIdentifier}" not found.`);
    return match;
  }

  const matches = connectors.filter((c: any) => c.identifier === idOrIdentifier);
  if (matches.length === 0) throw new Error(`Connector "${idOrIdentifier}" not found.`);
  if (matches.length > 1) {
    throw new Error(
      `Multiple connectors match "${idOrIdentifier}": ${matches.map((c: any) => c.id).join(', ')}. Pass the id instead.`,
    );
  }
  return matches[0];
}

function fail(error: unknown, note?: string): never {
  log.error((error as Error)?.message ?? String(error));
  if (note) log.error(note);
  process.exit(1);
}

export function registerConnectorCommand(program: Command) {
  const connector = program
    .command('connector')
    .description('Manage MCP connectors (user connectors and their synced tools)');

  // ── list ──────────────────────────────────────────────

  connector
    .command('list')
    .description('List connectors')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.connector.list.query();
      const items = (Array.isArray(result) ? result : []).map((c: any) => ({
        ...c,
        toolCount: Array.isArray(c.tools) ? c.tools.length : 0,
      }));

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No connectors found.');
        return;
      }

      const rows = items.map((c: any) => [
        c.id || '',
        truncate(c.identifier || '', 30),
        truncate(c.name || '', 30),
        c.sourceType || '',
        c.status === 'connected' ? pc.green(c.status) : c.status || '',
        String(c.toolCount),
      ]);

      printTable(rows, ['ID', 'IDENTIFIER', 'NAME', 'SOURCE', 'STATUS', 'TOOLS']);
    });

  // ── add ───────────────────────────────────────────────

  connector
    .command('add')
    .description('Add a custom MCP connector and sync its tools')
    .option('--url <url>', 'MCP server URL (streamable HTTP / SSE)')
    .option('--name <name>', 'Display name (defaults to the identifier)')
    .option('--identifier <id>', 'Connector identifier (derived from --name or --url if omitted)')
    .option('--auth <type>', 'Auth type: none, bearer or oauth2')
    .option('--token <token>', 'Bearer token (with --auth bearer)')
    .option('--header <key:value>', 'Custom request header (repeatable)', collect, [])
    .option('--stdio-cmd <command>', 'stdio MCP server command')
    .option('--stdio-arg <arg>', 'stdio MCP server argument (repeatable)', collect, [])
    .option('--force', 'Overwrite an existing connector with the same identifier')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: ConnectorAddOptions) => {
      let built: ReturnType<typeof buildCreateInput>;
      try {
        built = buildCreateInput(options);
      } catch (error) {
        fail(error);
      }
      const { authType, input } = built;

      const client = await getTrpcClient();

      // `connector.create` upserts on identifier: re-adding replaces the existing
      // row's server, credentials and metadata, so require an explicit --force.
      if (!options.force) {
        const existing = await client.connector.list.query();
        if (existing.some((c: any) => c.identifier === input.identifier)) {
          fail(
            new Error(
              `Connector "${input.identifier}" already exists. Pass --identifier <id> to add another, or --force to overwrite it.`,
            ),
          );
        }
      }

      const { id, isNew } = await client.connector.create.mutate(input);

      // Never leave a freshly created connector behind when setup fails (mirrors
      // the web form), but keep a row the user already had. If the cleanup
      // itself fails, say so: the leftover row blocks a retry as a duplicate.
      const rollback = async (): Promise<string | undefined> => {
        if (!isNew) return;
        try {
          await client.connector.delete.mutate({ id });
        } catch (cleanupError) {
          return `Rollback failed: connector ${input.identifier} (${id}) was created but could not be removed (${(cleanupError as Error)?.message ?? String(cleanupError)}). Remove it with: lh connector remove ${id} --yes`;
        }
      };

      if (authType === 'oauth2') {
        let authorizationUrl: string;
        try {
          ({ authorizationUrl } = await client.connector.startOAuth.mutate({ id }));
        } catch (error) {
          fail(error, await rollback());
        }
        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(
            { authorizationUrl, id, identifier: input.identifier, isNew, status: 'pending_oauth' },
            fields,
          );
          return;
        }
        console.log(
          `${pc.green('✓')} Created connector ${pc.bold(input.identifier)} ${pc.dim(`(${id})`)}`,
        );
        console.log('Open this URL in your browser to authorize:');
        console.log(authorizationUrl);
        console.log(
          pc.dim(
            `After authorizing, run: lh connector refresh ${input.identifier} to fetch tools.`,
          ),
        );
        return;
      }

      let synced: { local: boolean; toolCount: number };
      try {
        synced = await syncConnectorTools(client, id, input, {
          confirmLocalCommand: trustTypedStdioCommand(input.mcpStdioConfig ?? undefined),
        });
      } catch (error) {
        fail(error, await rollback());
      }
      const { local, toolCount } = synced;

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson({ id, identifier: input.identifier, isNew, local, toolCount }, fields);
        return;
      }

      console.log(
        `${pc.green('✓')} ${isNew ? 'Added' : 'Updated'} connector ${pc.bold(input.identifier)} ${pc.dim(`(${id})`)} with ${toolCount} tool(s)${local ? pc.dim(' (synced from this machine)') : ''}`,
      );
    });

  // ── refresh ───────────────────────────────────────────

  connector
    .command('refresh <idOrIdentifier>')
    .alias('sync')
    .description('Refresh OAuth tokens and re-fetch the tool list from the MCP server')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (idOrIdentifier: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      let synced: { local: boolean; toolCount: number };
      let id: string;
      try {
        const target = await resolveConnector(client, idOrIdentifier);
        id = target.id;
        synced = await syncConnectorTools(client, id, target, {
          confirmLocalCommand: confirmSharedStdioCommand,
        });
      } catch (error) {
        fail(error);
      }
      const { local, toolCount } = synced;

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson({ id, local, toolCount }, fields);
        return;
      }

      console.log(
        `${pc.green('✓')} Refreshed ${pc.bold(idOrIdentifier)}: ${toolCount} tool(s)${local ? pc.dim(' (synced from this machine)') : ''}`,
      );
    });

  // ── remove ────────────────────────────────────────────

  connector
    .command('remove <idOrIdentifier>')
    .description('Remove a connector')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (idOrIdentifier: string, options: { yes?: boolean }) => {
      const client = await getTrpcClient();
      let id: string;
      try {
        id = await resolveConnectorId(client, idOrIdentifier);
      } catch (error) {
        fail(error);
      }

      if (!options.yes) {
        const confirmed = await confirm(`Remove connector ${idOrIdentifier}?`);
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      await client.connector.delete.mutate({ id });
      console.log(`${pc.green('✓')} Removed connector ${pc.bold(idOrIdentifier)}`);
    });
}
