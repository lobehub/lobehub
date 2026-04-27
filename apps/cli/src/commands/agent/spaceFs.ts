import { readFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';

import type { Command } from 'commander';
import dayjs from 'dayjs';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveAgentId } from './resolveAgentId';

const SKILL_FILE_NAME = 'SKILL.md';

const SKILL_NAMESPACE_PREFIXES = {
  'agent': './lobe/skills/agent/skills',
  'agent-topic': './lobe/skills/agent-topic/skills',
  'builtin': './lobe/skills/builtin/skills',
  'installed-active': './lobe/skills/installed/active/skills',
  'installed-all': './lobe/skills/installed/all/skills',
} as const;

const FS_PATH_ALIASES = {
  'agent': './',
  'builtin': 'builtin',
  'skills': 'agent',
  'installed-active': 'installed-active',
  'installed-all': 'installed-all',
  'topic-skills': 'agent-topic',
  'topic': 'agent-topic',
} as const;

type SkillFsNamespace = keyof typeof SKILL_NAMESPACE_PREFIXES;
type AgentFsClient = Awaited<ReturnType<typeof getTrpcClient>>;

interface AgentFsContext {
  agentId: string;
  topicId?: string;
}

interface AgentFsNode {
  content?: string;
  createdAt?: Date | string;
  mode?: number;
  mount?: {
    driver?: string;
    namespace?: string;
  };
  name: string;
  path: string;
  size?: number;
  type: 'directory' | 'file';
  updatedAt?: Date | string;
}

interface AgentFsResolvedPath {
  filePath?: string;
  namespace?: SkillFsNamespace;
  path: string;
  skillName?: string;
}

interface AgentFsOptions {
  agentId?: string;
  slug?: string;
  topicId?: string;
}

function getTrpcErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const value = error as {
    data?: { code?: string };
    shape?: { data?: { code?: string } };
  };

  return value.data?.code ?? value.shape?.data?.code;
}

function exitWithError(message: string): never {
  log.error(message);
  process.exit(1);
  throw new Error(message);
}

function resolveAgentFsPath(input = 'agent:/'): AgentFsResolvedPath {
  const raw = input.trim();

  const aliasMatch = raw.match(/^([a-z-]+):(\/.*)?$/);

  if (aliasMatch) {
    const alias = aliasMatch[1] as keyof typeof FS_PATH_ALIASES;
    const target = FS_PATH_ALIASES[alias];

    if (!target) {
      exitWithError(
        `Unknown fs namespace "${aliasMatch[1]}". Use agent, skills, topic-skills, builtin, installed-all, or installed-active.`,
      );
    }

    const suffix = aliasMatch[2]?.replace(/^\/+/, '').replace(/\/+$/, '') ?? '';
    const prefix = target === './' ? './' : SKILL_NAMESPACE_PREFIXES[target as SkillFsNamespace];

    return resolveAgentFsPath(suffix ? `${prefix}/${suffix}` : prefix);
  }

  if (raw === './' || raw === '.' || raw === '/') {
    return { path: './' };
  }

  const match = Object.entries(SKILL_NAMESPACE_PREFIXES).find(([, prefix]) => {
    return raw === prefix || raw.startsWith(`${prefix}/`);
  });

  if (!match) {
    if (!raw.startsWith('./')) {
      exitWithError(`Invalid fs path "${input}". Use aliases like "agent:/" or a full VFS path.`);
    }

    const normalizedPath = raw.replaceAll(/\/+/g, '/').replace(/\/+$/, '') || './';
    return { path: normalizedPath };
  }

  const [namespace, prefix] = match as [
    SkillFsNamespace,
    (typeof SKILL_NAMESPACE_PREFIXES)[SkillFsNamespace],
  ];
  const relativePath = raw.slice(prefix.length).replace(/^\/+/, '').replace(/\/+$/, '');

  if (
    relativePath.includes('//') ||
    relativePath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    exitWithError(`Invalid fs path "${input}"`);
  }

  if (!relativePath) {
    return { namespace, path: prefix };
  }

  const separatorIndex = relativePath.indexOf('/');

  if (separatorIndex < 0) {
    return {
      namespace,
      path: `${prefix}/${relativePath}`,
      skillName: relativePath,
    };
  }

  return {
    filePath: relativePath.slice(separatorIndex + 1),
    namespace,
    path: `${prefix}/${relativePath}`,
    skillName: relativePath.slice(0, separatorIndex),
  };
}

function requireTopicId(namespace: SkillFsNamespace | undefined, topicId?: string) {
  if (namespace === 'agent-topic' && !topicId) {
    exitWithError('--topic-id is required for agent-topic fs paths.');
  }
}

function requireSkillNamespace(resolved: AgentFsResolvedPath): SkillFsNamespace {
  if (!resolved.namespace) {
    exitWithError(`Expected a skill namespace path, but received "${resolved.path}".`);
  }

  return resolved.namespace;
}

function canonicalSkillFilePath(resolved: AgentFsResolvedPath) {
  if (!resolved.skillName) {
    exitWithError('Expected a skill path, but received a namespace root.');
  }

  if (resolved.filePath && resolved.filePath !== SKILL_FILE_NAME) {
    exitWithError(`Unsupported writable path "${resolved.path}". Only SKILL.md is mutable.`);
  }

  return `${SKILL_NAMESPACE_PREFIXES[requireSkillNamespace(resolved)]}/${resolved.skillName}/${SKILL_FILE_NAME}`;
}

function toDisplayPath(path: string) {
  if (path === './') return 'agent:/';
  if (path.startsWith('./') && path !== './lobe' && !path.startsWith('./lobe/')) {
    return `agent:/${path.slice(2)}`;
  }

  for (const [namespace, prefix] of Object.entries(SKILL_NAMESPACE_PREFIXES) as Array<
    [SkillFsNamespace, string]
  >) {
    const alias =
      namespace === 'agent' ? 'skills' : namespace === 'agent-topic' ? 'topic-skills' : namespace;
    if (path === prefix) return `${alias}:/`;
    if (path.startsWith(`${prefix}/`)) return `${alias}:/${path.slice(prefix.length + 1)}`;
  }

  return path;
}

function isWritableNode(node: { mode?: number }) {
  return ((node.mode ?? 0) & 4) !== 0;
}

function parseOptionalPositiveInteger(value?: string) {
  if (value === undefined) return undefined;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    exitWithError(`Expected a positive integer, received "${value}".`);
  }

  return parsed;
}

function formatFsNodeName(node: { mode?: number; name: string; type: 'directory' | 'file' }) {
  const suffix = node.type === 'directory' ? '/' : '';
  return isWritableNode(node) ? `${node.name}${suffix}` : pc.dim(`${node.name}${suffix}`);
}

function getFsNodeDisplayName(node: Pick<AgentFsNode, 'name' | 'type'>) {
  if (node.name === '.' || node.name === '..') return node.name;

  return `${node.name}${node.type === 'directory' ? '/' : ''}`;
}

function getParentFsPath(path: string) {
  if (path === './') return './';

  const segments = path.replace(/^\.\//, '').split('/').filter(Boolean);
  if (segments.length <= 1) return './';

  return `./${segments.slice(0, -1).join('/')}`;
}

function createSyntheticListingNode(name: '.' | '..', path: string): AgentFsNode {
  return {
    mode: 10,
    name,
    path,
    size: 0,
    type: 'directory',
  };
}

function formatFsPermissions(node: Pick<AgentFsNode, 'mode' | 'type'>) {
  const mode = node.mode ?? 0;
  const canRead = (mode & 2) !== 0 || (mode & 8) !== 0;
  const canWrite = (mode & 4) !== 0;
  const canExecute = (mode & 1) !== 0 || (node.type === 'directory' && (mode & 8) !== 0);
  const owner = `${canRead ? 'r' : '-'}${canWrite ? 'w' : '-'}${canExecute ? 'x' : '-'}`;

  return `${node.type === 'directory' ? 'd' : '-'}${owner}------`;
}

function formatFsLongDate(value?: Date | string) {
  if (!value) return '--- -- --:--';

  const date = dayjs(value);
  if (!date.isValid()) return '--- -- --:--';

  return date.format('MMM DD HH:mm');
}

function formatFsLongListing(nodes: AgentFsNode[]) {
  const sizeWidth = Math.max(1, ...nodes.map((node) => String(node.size ?? 0).length));
  const totalBlocks = nodes.reduce((total, node) => total + Math.ceil((node.size ?? 0) / 512), 0);
  const lines = [`total ${totalBlocks}`];

  for (const node of nodes) {
    const size = String(node.size ?? 0).padStart(sizeWidth, ' ');
    const mtime = formatFsLongDate(node.updatedAt ?? node.createdAt);
    lines.push(
      `${formatFsPermissions(node)}  1 agent  agent  ${size} ${mtime} ${getFsNodeDisplayName(node)}`,
    );
  }

  return lines;
}

async function readFsContentInput(options: { content?: string; contentFile?: string }) {
  if (options.contentFile) {
    return readFileSync(options.contentFile, 'utf8');
  }

  if (options.content !== undefined) return options.content;

  // NOTICE:
  // CLI write commands should compose with shell pipelines without blocking interactive runs.
  // Node marks piped stdin with `isTTY === false`, while normal terminals are `true` or undefined in tests.
  // Remove this branch only if Commander gains first-class stdin option support for these commands.
  if (process.stdin.isTTY === false) return text(process.stdin);

  return '';
}

async function resolveAgentFsContext(client: AgentFsClient, options: AgentFsOptions) {
  const agentId = await resolveAgentId(client, options);
  return { agentId, topicId: options.topicId };
}

async function getFsNode(client: AgentFsClient, context: AgentFsContext, path: string) {
  try {
    return (await client.agentDocument.statDocumentByPath.query({
      agentId: context.agentId,
      path,
      topicId: context.topicId,
    })) as AgentFsNode;
  } catch (error) {
    if (getTrpcErrorCode(error) === 'NOT_FOUND') return undefined;
    throw error;
  }
}

async function readFsFile(client: AgentFsClient, context: AgentFsContext, inputPath: string) {
  const resolved = resolveAgentFsPath(inputPath);
  requireTopicId(resolved.namespace, context.topicId);

  const readPath =
    resolved.skillName && !resolved.filePath
      ? `${SKILL_NAMESPACE_PREFIXES[requireSkillNamespace(resolved)]}/${resolved.skillName}/${SKILL_FILE_NAME}`
      : resolved.path;

  const stat = await getFsNode(client, context, readPath);

  if (!stat) {
    exitWithError(`Path not found: ${inputPath}`);
  }

  if (stat.type !== 'file') {
    exitWithError(`Cannot read directory path: ${inputPath}`);
  }

  const node = (await client.agentDocument.readDocumentByPath.query({
    agentId: context.agentId,
    path: readPath,
    topicId: context.topicId,
  })) as AgentFsNode;

  return { node, resolved: resolveAgentFsPath(readPath) };
}

async function writeFsFile(
  client: AgentFsClient,
  context: AgentFsContext,
  inputPath: string,
  content: string,
) {
  const resolved = resolveAgentFsPath(inputPath);
  requireTopicId(resolved.namespace, context.topicId);
  const existing = await getFsNode(
    client,
    context,
    resolved.skillName && !resolved.filePath ? canonicalSkillFilePath(resolved) : resolved.path,
  );
  const result = await client.agentDocument.writeDocumentByPath.mutate({
    agentId: context.agentId,
    content,
    createMode: existing ? 'must-exist' : 'if-missing',
    path: resolved.path,
    topicId: context.topicId,
  });

  return {
    action: existing ? ('updated' as const) : ('created' as const),
    path: result?.path ?? resolved.path,
  };
}

async function mkdirFsPath(
  client: AgentFsClient,
  context: AgentFsContext,
  inputPath: string,
  options?: { recursive?: boolean },
) {
  const resolved = resolveAgentFsPath(inputPath);
  requireTopicId(resolved.namespace, context.topicId);

  return client.agentDocument.mkdirDocumentByPath.mutate({
    agentId: context.agentId,
    path: resolved.path,
    recursive: options?.recursive,
    topicId: context.topicId,
  });
}

async function deleteFsPath(
  client: AgentFsClient,
  context: AgentFsContext,
  inputPath: string,
  options?: { force?: boolean; recursive?: boolean },
) {
  const resolved = resolveAgentFsPath(inputPath);
  requireTopicId(resolved.namespace, context.topicId);

  return client.agentDocument.deleteDocumentByPath.mutate({
    agentId: context.agentId,
    force: options?.force,
    path: resolved.path,
    recursive: options?.recursive,
    topicId: context.topicId,
  });
}

async function copyFsPath(
  client: AgentFsClient,
  context: AgentFsContext,
  source: string,
  destination: string,
  force?: boolean,
) {
  const sourceResolved = resolveAgentFsPath(source);
  const destinationResolved = resolveAgentFsPath(destination);

  requireTopicId(sourceResolved.namespace, context.topicId);
  requireTopicId(destinationResolved.namespace, context.topicId);

  return client.agentDocument.copyDocumentByPath.mutate({
    agentId: context.agentId,
    force,
    fromPath: sourceResolved.path,
    toPath: destinationResolved.path,
    topicId: context.topicId,
  });
}

async function renameFsPath(
  client: AgentFsClient,
  context: AgentFsContext,
  source: string,
  destination: string,
  force?: boolean,
) {
  const sourceResolved = resolveAgentFsPath(source);
  const destinationResolved = resolveAgentFsPath(destination);

  requireTopicId(sourceResolved.namespace, context.topicId);
  requireTopicId(destinationResolved.namespace, context.topicId);

  return client.agentDocument.renameDocumentByPath.mutate({
    agentId: context.agentId,
    force,
    fromPath: sourceResolved.path,
    toPath: destinationResolved.path,
    topicId: context.topicId,
  });
}

async function listTrashFsPath(client: AgentFsClient, context: AgentFsContext, inputPath?: string) {
  const resolved = resolveAgentFsPath(inputPath || 'agent:/');
  requireTopicId(resolved.namespace, context.topicId);

  return (await client.agentDocument.listTrashDocumentsByPath.query({
    agentId: context.agentId,
    path: resolved.path,
    topicId: context.topicId,
  })) as Array<Pick<AgentFsNode, 'path'>>;
}

async function restoreTrashFsPath(
  client: AgentFsClient,
  context: AgentFsContext,
  inputPath: string,
) {
  const resolved = resolveAgentFsPath(inputPath);
  requireTopicId(resolved.namespace, context.topicId);

  return client.agentDocument.restoreDocumentFromTrashByPath.mutate({
    agentId: context.agentId,
    path: resolved.path,
    topicId: context.topicId,
  });
}

async function deleteTrashFsPath(
  client: AgentFsClient,
  context: AgentFsContext,
  inputPath: string,
  options?: { force?: boolean; recursive?: boolean },
) {
  const resolved = resolveAgentFsPath(inputPath);
  requireTopicId(resolved.namespace, context.topicId);

  return client.agentDocument.deleteDocumentPermanentlyByPath.mutate({
    agentId: context.agentId,
    force: options?.force,
    path: resolved.path,
    recursive: options?.recursive,
    topicId: context.topicId,
  });
}

async function printFsTree(
  client: AgentFsClient,
  context: AgentFsContext,
  path: string,
  prefix = '',
  warnings: string[] = [],
) {
  let nodes: AgentFsNode[];

  try {
    nodes = (await client.agentDocument.listDocumentsByPath.query({
      agentId: context.agentId,
      path,
      topicId: context.topicId,
    })) as AgentFsNode[];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to list path';
    warnings.push(`${toDisplayPath(path)}: ${message}`);
    return;
  }

  for (const [index, node] of nodes.entries()) {
    const last = index === nodes.length - 1;
    console.log(`${prefix}${last ? '└── ' : '├── '}${formatFsNodeName(node)}`);

    if (node.type === 'directory') {
      await printFsTree(client, context, node.path, `${prefix}${last ? '    ' : '│   '}`, warnings);
    }
  }
}

function registerFsCommands(fsCommand: Command) {
  fsCommand
    .command('ls [path]')
    .description('List VFS entries')
    .option('-a, --all', 'Include hidden entries')
    .option('-l, --long', 'Use long listing format')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('--cursor <cursor>', 'Directory pagination cursor')
    .option('-L, --limit <n>', 'Maximum number of entries')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        inputPath: string | undefined,
        options: {
          agentId?: string;
          all?: boolean;
          cursor?: string;
          json?: string | boolean;
          limit?: string;
          long?: boolean;
          slug?: string;
          topicId?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const resolved = resolveAgentFsPath(inputPath || 'agent:/');
        requireTopicId(resolved.namespace, context.topicId);

        const nodes = ((await client.agentDocument.listDocumentsByPath.query({
          agentId: context.agentId,
          cursor: options.cursor,
          limit: parseOptionalPositiveInteger(options.limit),
          path: resolved.path,
          topicId: context.topicId,
        })) ?? []) as AgentFsNode[];
        const filtered = options.all ? nodes : nodes.filter((node) => !node.name.startsWith('.'));

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(filtered, fields);
          return;
        }

        if (options.long) {
          const longNodes = options.all
            ? [
                createSyntheticListingNode('.', resolved.path),
                createSyntheticListingNode('..', getParentFsPath(resolved.path)),
                ...filtered,
              ]
            : filtered;
          formatFsLongListing(longNodes).forEach((line) => console.log(line));
          return;
        }

        filtered.forEach((node) => console.log(formatFsNodeName(node)));
      },
    );

  fsCommand
    .command('tree [path]')
    .description('Print a tree view of the VFS')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .action(
      async (
        inputPath: string | undefined,
        options: { agentId?: string; slug?: string; topicId?: string },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const resolved = resolveAgentFsPath(inputPath || 'agent:/');
        requireTopicId(resolved.namespace, context.topicId);

        console.log(pc.bold(toDisplayPath(resolved.path)));
        const warnings: string[] = [];
        await printFsTree(client, context, resolved.path, '', warnings);

        for (const warning of warnings) {
          log.warn(warning);
        }
      },
    );

  fsCommand
    .command('cat <path>')
    .description('Read a VFS file')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .action(
      async (inputPath: string, options: { agentId?: string; slug?: string; topicId?: string }) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const { node } = await readFsFile(client, context, inputPath);
        process.stdout.write(node.content ?? '');
      },
    );

  fsCommand
    .command('stat <path>')
    .description('Show VFS node metadata')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        inputPath: string,
        options: {
          agentId?: string;
          json?: string | boolean;
          slug?: string;
          topicId?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const resolved = resolveAgentFsPath(inputPath);
        requireTopicId(resolved.namespace, context.topicId);

        const node = await getFsNode(client, context, resolved.path);

        if (!node) {
          exitWithError(`Path not found: ${inputPath}`);
        }

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(node, fields);
          return;
        }

        console.log(JSON.stringify(node, null, 2));
      },
    );

  fsCommand
    .command('touch <path>')
    .description('Create or update a VFS file')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('-c, --content <content>', 'File content')
    .option('-F, --content-file <path>', 'Read content from a local file')
    .action(
      async (
        inputPath: string,
        options: {
          agentId?: string;
          content?: string;
          contentFile?: string;
          slug?: string;
          topicId?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const content = await readFsContentInput(options);
        const result = await writeFsFile(client, context, inputPath, content);
        console.log(`${pc.green('✓')} ${result.action} ${pc.bold(toDisplayPath(result.path))}`);
      },
    );

  fsCommand
    .command('write <path>')
    .description('Write content to a VFS file')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('-c, --content <content>', 'File content')
    .option('-F, --content-file <path>', 'Read content from a local file')
    .action(
      async (
        inputPath: string,
        options: {
          agentId?: string;
          content?: string;
          contentFile?: string;
          slug?: string;
          topicId?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const content = await readFsContentInput(options);
        const result = await writeFsFile(client, context, inputPath, content);
        console.log(`${pc.green('✓')} ${result.action} ${pc.bold(toDisplayPath(result.path))}`);
      },
    );

  fsCommand
    .command('mkdir <path>')
    .description('Create a VFS directory')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('-p, --parents', 'Create parent directories as needed')
    .action(
      async (
        inputPath: string,
        options: { agentId?: string; parents?: boolean; slug?: string; topicId?: string },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const result = await mkdirFsPath(client, context, inputPath, {
          recursive: options.parents,
        });
        console.log(
          `${pc.green('✓')} created ${pc.bold(toDisplayPath(result?.path ?? inputPath))}`,
        );
      },
    );

  fsCommand
    .command('rm <path>')
    .description('Delete a VFS node into trash')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('-r, --recursive', 'Recursively delete a directory subtree')
    .option('-f, --force', 'Forward force semantics to the VFS delete primitive')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (
        inputPath: string,
        options: {
          agentId?: string;
          force?: boolean;
          recursive?: boolean;
          slug?: string;
          topicId?: string;
          yes?: boolean;
        },
      ) => {
        if (!options.yes) {
          const confirmed = await confirm(`Delete ${inputPath}?`);
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        await deleteFsPath(client, context, inputPath, {
          force: options.force,
          recursive: options.recursive,
        });
        console.log(`${pc.green('✓')} deleted ${pc.bold(inputPath)}`);
      },
    );

  fsCommand
    .command('cp <source> <destination>')
    .description('Copy a VFS node')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic source or destination paths')
    .option('-f, --force', 'Overwrite the destination if it exists')
    .action(
      async (
        source: string,
        destination: string,
        options: { agentId?: string; force?: boolean; slug?: string; topicId?: string },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const result = await copyFsPath(client, context, source, destination, options.force);
        console.log(
          `${pc.green('✓')} copied ${pc.bold(source)} → ${pc.bold(toDisplayPath(result?.path ?? destination))}`,
        );
      },
    );

  fsCommand
    .command('mv <source> <destination>')
    .description('Move or rename a VFS node')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic source or destination paths')
    .option('-f, --force', 'Overwrite the destination if it exists')
    .action(
      async (
        source: string,
        destination: string,
        options: { agentId?: string; force?: boolean; slug?: string; topicId?: string },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const sourceResolved = resolveAgentFsPath(source);
        const destinationResolved = resolveAgentFsPath(destination);

        if (sourceResolved.path === destinationResolved.path) {
          console.log(`${pc.yellow('!')} source and destination are the same.`);
          return;
        }

        const result = await renameFsPath(client, context, source, destination, options.force);
        console.log(
          `${pc.green('✓')} moved ${pc.bold(source)} → ${pc.bold(toDisplayPath(result?.path ?? destination))}`,
        );
      },
    );

  const trashCommand = fsCommand.command('trash').description('Operate on soft-deleted VFS nodes');

  trashCommand
    .command('ls [path]')
    .description('List trashed VFS nodes')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        inputPath: string | undefined,
        options: {
          agentId?: string;
          json?: string | boolean;
          slug?: string;
          topicId?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const nodes = await listTrashFsPath(client, context, inputPath);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(nodes, fields);
          return;
        }

        if (nodes.length === 0) {
          console.log('Trash is empty.');
          return;
        }

        nodes.forEach((node) => console.log(toDisplayPath(node.path)));
      },
    );

  trashCommand
    .command('restore <path>')
    .description('Restore a soft-deleted VFS node')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .action(
      async (inputPath: string, options: { agentId?: string; slug?: string; topicId?: string }) => {
        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        const result = await restoreTrashFsPath(client, context, inputPath);
        console.log(
          `${pc.green('✓')} restored ${pc.bold(toDisplayPath(result?.path ?? inputPath))}`,
        );
      },
    );

  trashCommand
    .command('rm <path>')
    .description('Permanently delete a trashed VFS node')
    .option('-A, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-t, --topic-id <id>', 'Topic ID for agent-topic paths')
    .option('-r, --recursive', 'Recursively delete a directory subtree')
    .option('-f, --force', 'Forward force semantics to the permanent delete primitive')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (
        inputPath: string,
        options: {
          agentId?: string;
          force?: boolean;
          recursive?: boolean;
          slug?: string;
          topicId?: string;
          yes?: boolean;
        },
      ) => {
        if (!options.yes) {
          const confirmed = await confirm(`Permanently delete ${inputPath}?`);
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const client = await getTrpcClient();
        const context = await resolveAgentFsContext(client, options);
        await deleteTrashFsPath(client, context, inputPath, {
          force: options.force,
          recursive: options.recursive,
        });
        console.log(`${pc.green('✓')} permanently deleted ${pc.bold(inputPath)}`);
      },
    );
}

/**
 * Register agent document VFS commands under `agent space fs`.
 *
 * Use when:
 * - The CLI should expose filesystem-like operations for an agent document space.
 * - Command registration should stay outside the core `agent` command file.
 *
 * Expects:
 * - `agentCommand` to be the existing `agent` command group.
 *
 * Returns:
 * - Registered Commander subcommands.
 */
export function registerAgentSpaceFsCommand(agentCommand: Command) {
  const spaceCommand = agentCommand.command('space').description('Manage agent document space');
  const fsCommand = spaceCommand.command('fs').description('Operate on the agent document VFS');
  registerFsCommands(fsCommand);
}
