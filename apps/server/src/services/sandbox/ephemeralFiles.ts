import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';

import type { EphemeralSandboxActivity } from '@/server/services/redis/ephemeralSandbox';

const log = debug('lobe-server:sandbox:ephemeral-files');

/**
 * How long a temporary sandbox survives without a call: the execution plane's
 * idle teardown. Past it, the session the agent wrote into is gone, and the
 * next call would quietly start an empty one in its place.
 */
export const EPHEMERAL_SANDBOX_IDLE_MS = 15 * 60 * 1000;

/**
 * How long the execution plane keeps a sandbox alive past its idle window once
 * an `lh hetero exec` agent (Claude Code, Codex) starts in it: that agent works
 * inside the sandbox for hours without another tool call coming through here.
 */
export const EPHEMERAL_SANDBOX_KEEP_ALIVE_MS = 4 * 60 * 60 * 1000;

/**
 * The execution plane's own test for that launch: a `runCommand` whose command
 * runs `lh hetero exec`, path-qualified and quoted or not.
 */
const HETERO_EXEC_COMMAND_PATTERN =
  /(?:^|[\s&(;|])["']?(?:[\w./-]*\/)?lh["']?\s+["']?hetero["']?\s+["']?exec["']?(?:\s|$)/;

export const isHeteroExecLaunch = (toolName: string, params: Record<string, unknown>) =>
  toolName === 'runCommand' &&
  (params.heteroExec === true ||
    (typeof params.command === 'string' && HETERO_EXEC_COMMAND_PATTERN.test(params.command)));

/** Entries one listing returns; a sandbox holding a cloned repository can hold many more. */
export const EPHEMERAL_SANDBOX_MAX_ENTRIES = 5000;

const LISTING_TIMEOUT_MS = 30_000;

/**
 * Directories listed as a row but never walked: dependency trees, VCS
 * internals and caches, which would crowd out the files the agent produced,
 * plus `.creds`, where credentials injected into the sandbox are kept.
 */
const PRUNED_DIRECTORIES = [
  '.cache',
  '.creds',
  '.git',
  '.next',
  '.npm',
  '.pnpm-store',
  '.venv',
  '__pycache__',
  'node_modules',
  'venv',
];

const ROOT_MARKER = '__LOBE_SANDBOX_ROOT__';

/**
 * Prints the directory a temporary sandbox starts in — where the agent's
 * relative paths land — and everything under it, one `<type>\t<path>` line per
 * entry, relative to that directory. One line past the cap says the listing
 * stopped short. No depth limit: a cut-off below some depth would show its
 * last folder as empty without saying anything was left out, and the entry
 * cap already bounds the walk.
 */
export const buildEphemeralListingCommand = () => {
  const pruned = PRUNED_DIRECTORIES.map((name) => `-name '${name}'`).join(' -o ');

  return [
    `printf '${ROOT_MARKER}\\t%s\\n' "$PWD"`,
    `find . -mindepth 1 \\( ${pruned} \\) -prune -printf 'd\\t%P\\n' -o -printf '%y\\t%P\\n' 2>/dev/null | head -n ${EPHEMERAL_SANDBOX_MAX_ENTRIES + 1}`,
  ].join('; ');
};

export interface EphemeralSandboxFileEntry {
  isDirectory: boolean;
  name: string;
  /** Relative to {@link EphemeralSandboxListing.root}, without a trailing slash. */
  path: string;
}

export interface EphemeralSandboxListing {
  entries: EphemeralSandboxFileEntry[];
  /** Absolute path of the directory the sandbox starts in. */
  root: string;
  truncated: boolean;
}

export const parseEphemeralListing = (stdout: string): EphemeralSandboxListing | undefined => {
  const lines = stdout.split('\n');
  const rootLine = lines.find((line) => line.startsWith(`${ROOT_MARKER}\t`));
  const root = rootLine?.slice(ROOT_MARKER.length + 1).trim();
  if (!root || !root.startsWith('/')) return undefined;

  const entries: EphemeralSandboxFileEntry[] = [];
  let count = 0;
  for (const line of lines) {
    if (!line || line === rootLine) continue;
    const tab = line.indexOf('\t');
    if (tab !== 1) continue;
    const path = line.slice(2);
    if (!path || path.startsWith('/') || path.split('/').includes('..')) continue;

    count += 1;
    if (count > EPHEMERAL_SANDBOX_MAX_ENTRIES) break;
    entries.push({
      isDirectory: line[0] === 'd',
      name: path.split('/').pop() || path,
      path,
    });
  }

  return {
    entries,
    root: root.length > 1 ? root.replace(/\/+$/, '') : root,
    truncated: count > EPHEMERAL_SANDBOX_MAX_ENTRIES,
  };
};

export type EphemeralSandboxFilesResult =
  | ({ status: 'ready' } & EphemeralSandboxListing)
  /** The sandbox the agent wrote into was recycled; its files are gone. */
  | { status: 'expired' }
  /** Nothing has run in this conversation's temporary sandbox yet. */
  | { status: 'notStarted' };

/**
 * Whether a record already settles the question without asking the sandbox.
 * `undefined` means it does not — the sandbox may be alive, or there is no
 * record to go by (no Redis), so only a listing can tell.
 */
export const settledEphemeralSandboxStatus = (
  activity: EphemeralSandboxActivity | null | undefined,
  now = Date.now(),
): 'expired' | 'notStarted' | undefined => {
  if (activity === undefined) return undefined;
  if (activity === null || !activity.activeAt) return 'notStarted';
  if (activity.recycledAt && activity.recycledAt >= activity.activeAt) return 'expired';

  // A long-running agent holds the sandbox open: only the sandbox can say.
  if ((activity.keepAliveUntil ?? 0) > now) return undefined;

  const lastSeen = Math.max(activity.activeAt, activity.aliveAt ?? 0);
  if (now - lastSeen >= EPHEMERAL_SANDBOX_IDLE_MS) return 'expired';

  return undefined;
};

interface ListEphemeralSandboxFilesInput {
  activity: EphemeralSandboxActivity | null | undefined;
  /** Runs one tool call in the conversation's own sandbox session, as a viewer. */
  callTool: (toolName: string, params: Record<string, unknown>) => Promise<SandboxCallToolResult>;
  topicId: string;
}

/**
 * The Files panel's view of a conversation's temporary sandbox.
 *
 * A record that already says the sandbox is gone is answered without a call:
 * listing it would start a fresh, empty sandbox and show that as this
 * conversation's files. Otherwise the listing goes through the topic's own
 * session — which is what keeps it to this conversation — and a session the
 * call had to recreate is reported as recycled, never as an empty tree.
 */
export const listEphemeralSandboxFiles = async ({
  activity,
  callTool,
  topicId,
}: ListEphemeralSandboxFilesInput): Promise<EphemeralSandboxFilesResult> => {
  const settled = settledEphemeralSandboxStatus(activity);
  if (settled) return { status: settled };

  const result = await callTool('runCommand', {
    command: buildEphemeralListingCommand(),
    timeout: LISTING_TIMEOUT_MS,
  });

  if (result.sessionExpiredAndRecreated) return { status: 'expired' };
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to list the sandbox files');
  }

  const raw = (result.result ?? {}) as { output?: unknown; stdout?: unknown };
  const listing = parseEphemeralListing(String(raw.stdout ?? raw.output ?? ''));
  if (!listing) {
    log('Unreadable listing for topic %s: %O', topicId, result.result);
    throw new Error('The sandbox returned an unreadable file listing');
  }

  return { status: 'ready', ...listing };
};
