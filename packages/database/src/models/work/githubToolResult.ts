import type {
  GithubWorkResourceType,
  RegisterExternalWorkParams,
  SkillToolResultWorkInput,
  WorkDisplayField,
  WorkVersionMetadata,
} from '@lobechat/types';

import { WORK_DESCRIPTION_PREVIEW_LENGTH } from './internal';
import { parseShellCommandSegments } from './shellCommandParsing';
import {
  type ExternalToolWorkOperation,
  fromRecord,
  hasOwn,
  isApplicationError,
  parseMaybeJSON,
  sanitizeExternalUrl,
  stringValue,
  toRecord,
} from './toolResultParsing';

/** GitHub entity vocabulary internal to this normalizer. */
type GithubWorkEntityType = 'issue' | 'pull_request';

/**
 * Only successful create/edit results become Works: read-only
 * queries (get/list/search), comments, and branch/repo operations are
 * intentionally excluded, mirroring the Linear adaptation.
 *
 * The github skill has two tool surfaces:
 * - structured REST-shaped tools (`create_issue`, `update_pull_request`, ...)
 * - a generic `runCommand` that executes `gh` CLI in the cloud sandbox — the
 *   dominant surface in production, whose results are only a command string
 *   plus stdout.
 *
 * Both normalize to the same identity: `owner/repo#number`. The CLI surface
 * never returns a GitHub node_id, so node_id cannot be the dedup key — the
 * same issue touched via both surfaces must land on one Work row.
 */
const GITHUB_WORK_TOOLS: Record<
  string,
  { entityType: GithubWorkEntityType; changeType: 'created' | 'updated' }
> = {
  create_issue: { entityType: 'issue', changeType: 'created' },
  create_pull_request: { entityType: 'pull_request', changeType: 'created' },
  update_issue: { entityType: 'issue', changeType: 'updated' },
  update_pull_request: { entityType: 'pull_request', changeType: 'updated' },
};

const GITHUB_CLI_TOOLS = new Set(['runCommand', 'run_command']);

/**
 * Builds a `patch` helper bound to a `patchFields` set: it records that a field
 * is present in the partial snapshot and returns the value only when present
 * (so absent fields stay `undefined` and don't overwrite the current snapshot).
 * Shared by the structured-tool and gh-CLI param builders.
 */
const makePatch =
  (patchFields: Set<WorkDisplayField>) =>
  <T>(field: WorkDisplayField, present: boolean, value: T): T | undefined => {
    if (present) patchFields.add(field);
    return present ? value : undefined;
  };

/** The card-preview `description` column stores capped text; the full body goes to `content`. */
const previewText = (value: unknown): string | null => {
  const text = stringValue(value);
  if (!text) return null;

  return text.length > WORK_DESCRIPTION_PREVIEW_LENGTH
    ? `${text.slice(0, WORK_DESCRIPTION_PREVIEW_LENGTH)}...`
    : text;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());

  return null;
};

const numberFromRecord = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== null) return value;
  }

  return null;
};

/** Join MCP-style content parts (`{ content: [{ text }] }`) back into one string. */
const textFromContentParts = (value: unknown): string | null => {
  /* v8 ignore next -- unreachable: both callers pass a value already checked with Array.isArray */
  if (!Array.isArray(value)) return null;

  const joined = value
    .map((item) => {
      if (typeof item === 'string') return item;
      const record = toRecord(item);
      return record ? (stringValue(record.text) ?? stringValue(record.content)) : null;
    })
    .filter(Boolean)
    .join('\n\n');

  return joined || null;
};

const RESOURCE_WRAPPER_KEYS = ['issue', 'pull_request', 'pullRequest', 'data', 'result'];

const unwrapData = (data: unknown): Record<string, unknown> | null => {
  let parsed = parseMaybeJSON(data);

  if (Array.isArray(parsed)) {
    parsed = parseMaybeJSON(textFromContentParts(parsed)) ?? toRecord(parsed[0]);
  }

  let record = toRecord(parsed);
  if (!record) return null;

  if (Array.isArray(record.content)) {
    const inner = parseMaybeJSON(textFromContentParts(record.content));
    record = toRecord(inner) ?? record;
  }

  for (const key of RESOURCE_WRAPPER_KEYS) {
    const nested = toRecord(record[key]);
    if (nested) return nested;
  }

  return record;
};

const ownerRepoFromUrl = (url: string | null): string | null => {
  if (!url) return null;

  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    // https://api.github.com/repos/{owner}/{repo}/... vs https://github.com/{owner}/{repo}/...
    const start = segments[0] === 'repos' ? 1 : 0;
    const owner = segments[start];
    const repo = segments[start + 1];
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
};

const isOwnerRepo = (value: string | null): value is string =>
  !!value && /^[^/\s]+\/[^/\s#]+$/.test(value);

const resolveRepo = (
  record: Record<string, unknown>,
  args: Record<string, unknown>,
): string | null => {
  const direct =
    fromRecord(record, ['repository_full_name', 'full_name', 'repositoryFullName']) ??
    fromRecord(toRecord(record.repository) ?? {}, ['full_name', 'fullName']) ??
    fromRecord(toRecord(toRecord(record.base)?.repo) ?? {}, ['full_name', 'fullName']);
  if (isOwnerRepo(direct)) return direct;

  const fromUrls =
    ownerRepoFromUrl(fromRecord(record, ['repository_url', 'repositoryUrl'])) ??
    ownerRepoFromUrl(fromRecord(record, ['html_url', 'htmlUrl']));
  if (fromUrls) return fromUrls;

  const fromArgs = fromRecord(args, ['repository_full_name', 'full_name', 'repository', 'repo']);
  if (isOwnerRepo(fromArgs)) return fromArgs;

  const owner = fromRecord(args, ['owner']);
  const repo = fromRecord(args, ['repo', 'name']);
  return owner && repo ? `${owner}/${repo}` : null;
};

const resolveNumber = (
  record: Record<string, unknown>,
  args: Record<string, unknown>,
): number | null =>
  numberFromRecord(record, ['number']) ??
  numberFromRecord(args, ['issue_number', 'pull_number', 'issueNumber', 'pullNumber', 'number']);

const resolveUrl = (record: Record<string, unknown>): string | null => {
  const htmlUrl = fromRecord(record, ['html_url', 'htmlUrl']);
  if (htmlUrl) return htmlUrl;

  const url = fromRecord(record, ['url']);
  return url && /^https?:\/\/github\.com\//i.test(url) ? url : null;
};

/**
 * Collapse GitHub's state/merged/draft triplet into one display status:
 * merged and draft win over the raw `state` ('open' | 'closed').
 */
const resolveStatus = (record: Record<string, unknown>): string | null => {
  if (record.merged === true) return 'merged';
  if (record.draft === true) return 'draft';
  return fromRecord(record, ['state']);
};

const hasStatusSignal = (record: Record<string, unknown>) =>
  hasOwn(record, 'state') ||
  typeof record.merged === 'boolean' ||
  typeof record.draft === 'boolean';

/** PR branches as version metadata; `undefined` when neither is known. */
const branchMetadata = (
  head: string | null,
  base: string | null,
): WorkVersionMetadata | undefined => {
  if (!head && !base) return undefined;

  return { ...(head && { headBranch: head }), ...(base && { baseBranch: base }) };
};

/**
 * A PR version registered from a command that named the PR. Version metadata
 * merges over the previous version's, so without its own marker it would
 * inherit `pullRequestLink: 'push'` from an earlier push link.
 */
const pullRequestCommandMetadata = (
  head: string | null,
  base: string | null,
): WorkVersionMetadata => ({ ...branchMetadata(head, base), pullRequestLink: 'command' });

/**
 * A REST pull request carries `head` / `base` as `{ ref }` objects; the
 * `create_pull_request` arguments name them as plain strings.
 */
const resolveBranch = (
  record: Record<string, unknown>,
  args: Record<string, unknown>,
  key: 'base' | 'head',
): string | null => fromRecord(toRecord(record[key]) ?? {}, ['ref']) ?? fromRecord(args, [key]);

const githubResourceType = (entityType: GithubWorkEntityType): GithubWorkResourceType =>
  entityType === 'issue' ? 'github_issue' : 'github_pull_request';

const buildParams = (
  params: SkillToolResultWorkInput,
  tool: { entityType: GithubWorkEntityType; changeType: 'created' | 'updated' },
  record: Record<string, unknown>,
): Omit<RegisterExternalWorkParams, 'resourceId' | 'toolIdentifier'> => {
  const args = params.args ?? {};
  const repo = resolveRepo(record, args);
  const number = resolveNumber(record, args);
  // Allowlist http(s) only: a tool-result `html_url` is member-controlled and
  // the persisted url reaches shell.openExternal on desktop.
  const url = sanitizeExternalUrl(resolveUrl(record));

  const patchFields = new Set<WorkDisplayField>();
  const patch = makePatch(patchFields);

  // `owner/repo#number` is encoded into `identifier`; repo/number are no longer
  // persisted as their own display fields.
  if (repo && number !== null) patchFields.add('identifier');
  if (url) patchFields.add('url');

  return {
    agentId: params.agentId ?? null,
    changeType: tool.changeType,
    // The FULL issue/PR body (layer 3); the card preview is the capped `description`.
    content: patch('content', hasOwn(record, 'body'), stringValue(record.body)),
    cumulativeCost: params.cumulativeCost ?? null,
    cumulativeUsage: params.cumulativeUsage ?? null,
    description: patch('description', hasOwn(record, 'body'), previewText(record.body)),
    identifier: repo && number !== null ? `${repo}#${number}` : null,
    resourceType: githubResourceType(tool.entityType),
    messageId: params.messageId ?? null,
    metadata:
      tool.entityType === 'pull_request'
        ? pullRequestCommandMetadata(
            resolveBranch(record, args, 'head'),
            resolveBranch(record, args, 'base'),
          )
        : undefined,
    rootOperationId: params.rootOperationId ?? null,
    status: patch('status', hasStatusSignal(record), resolveStatus(record)),
    threadId: params.threadId ?? null,
    title: patch('title', hasOwn(record, 'title'), stringValue(record.title)),
    toolCallId: params.toolCallId ?? null,
    toolName: params.toolName,
    topicId: params.topicId ?? null,
    url,
    // Evaluated last: every patch() call above must run before the set is
    // materialized (object literal properties evaluate in order).
    patchFields: Array.from(patchFields),
  };
};

// ---------------------------------------------------------------------------
// gh CLI (`runCommand`) parsing
// ---------------------------------------------------------------------------

/**
 * gh flags that consume a value. Needed even for flags we don't extract, so
 * their values are not misread as positional targets (`gh issue edit 952`).
 */
const GH_VALUE_FLAGS = new Set([
  '--add-assignee',
  '--author-email',
  '--match-head-commit',
  '--subject',
  '-A',
  '--add-label',
  '--add-project',
  '--add-reviewer',
  '--assignee',
  '--base',
  '--body',
  '--body-file',
  '--head',
  '--label',
  '--milestone',
  '--project',
  '--recover',
  '--remove-assignee',
  '--remove-label',
  '--remove-project',
  '--remove-reviewer',
  '--repo',
  '--reviewer',
  '--template',
  '--title',
  '-a',
  '-B',
  '-b',
  '-F',
  '-H',
  '-l',
  '-m',
  '-p',
  '-R',
  '-r',
  '-T',
  '-t',
]);

/**
 * `gh pr merge` switches that share a short name with a value flag of
 * create/edit (`-m` milestone, `-r` reviewer): on merge they pick the method and
 * take no value, so the pull request number after them must not be swallowed.
 */
const GH_MERGE_SWITCHES = new Set(['-m', '-r']);

interface GithubEntityRef {
  entityType: GithubWorkEntityType;
  number: number;
  repo: string;
  url: string;
}

const GITHUB_ENTITY_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/gi;

/**
 * `owner/repo#123` mentions. `gh pr merge` / `gh pr ready` print no URL, only a
 * `✓ Merged pull request owner/repo#123 (title)` line — and only to a terminal,
 * so this is a best effort on top of the command's own target.
 */
const GITHUB_ENTITY_REF_RE = /(?:^|[\s(])([\w.-]+)\/([\w.-]+)#(\d+)\b/g;

const parseGithubEntityRefs = (
  text: string | null,
  entityType: GithubWorkEntityType,
): Omit<GithubEntityRef, 'url'>[] => {
  if (!text) return [];

  return Array.from(text.matchAll(GITHUB_ENTITY_REF_RE), (match) => ({
    entityType,
    number: Number(match[3]),
    repo: `${match[1]}/${match[2]}`,
  }));
};

const parseGithubEntityUrls = (text: string | null): GithubEntityRef[] => {
  if (!text) return [];

  return Array.from(text.matchAll(GITHUB_ENTITY_URL_RE), (match) => ({
    entityType: (match[3] === 'issues' ? 'issue' : 'pull_request') as GithubWorkEntityType,
    number: Number(match[4]),
    repo: `${match[1]}/${match[2]}`,
    url: match[0],
  }));
};

/**
 * Pull request lifecycle commands, recognized only when the caller opts in
 * ({@link GithubShellNormalizeOptions.pullRequestLifecycle}). `gh pr view` /
 * `diff` / `checkout` / `review` stay out on purpose: reading or reviewing
 * someone else's pull request must not tie it to the conversation.
 */
type GhLifecycleAction = 'merge' | 'ready';

interface ParsedGhCommand {
  action: 'create' | 'edit' | GhLifecycleAction;
  /** `gh pr merge --auto` only queues the merge; `--disable-auto` cancels it. */
  autoMerge: boolean;
  /** `--base`: set on `gh pr create`, or changed by `gh pr edit`. */
  base: string | null;
  body: string | null;
  draft: boolean;
  entityType: GithubWorkEntityType;
  /** `--head`, `gh pr create` only; without it gh uses the checked-out branch, which the command text does not name. */
  head: string | null;
  repo: string | null;
  targetNumber: number | null;
  targetRef: GithubEntityRef | null;
  title: string | null;
  /** `gh pr ready --undo` turns the pull request back into a draft. */
  undo: boolean;
}

const isLifecycleAction = (action: string): action is GhLifecycleAction =>
  action === 'merge' || action === 'ready';

const parseGhSegment = (segment: string[], lifecycle: boolean): ParsedGhCommand | null => {
  if (segment[0] !== 'gh') return null;

  const noun = segment[1];
  const action = segment[2];
  if (noun !== 'issue' && noun !== 'pr') return null;
  const isLifecycle = lifecycle && noun === 'pr' && isLifecycleAction(action);
  if (action !== 'create' && action !== 'edit' && !isLifecycle) return null;

  let autoMerge = false;
  let undo = false;
  let base: string | null = null;
  let body: string | null = null;
  let draft = false;
  let head: string | null = null;
  let repoFlag: string | null = null;
  let title: string | null = null;
  const positionals: string[] = [];

  for (let i = 3; i < segment.length; i++) {
    let token = segment[i];
    let value: string | null = null;

    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      value = token.slice(eq + 1);
      token = token.slice(0, eq);
    }

    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const takesValue = GH_VALUE_FLAGS.has(token) && !(isLifecycle && GH_MERGE_SWITCHES.has(token));
    if (value === null && takesValue) {
      value = segment[i + 1] ?? null;
      i++;
    }

    switch (token) {
      // On `gh pr merge`, -t / -b name the merge COMMIT, not the pull request.
      case '-t':
      case '--title': {
        if (!isLifecycle) title = value;
        break;
      }
      case '-b':
      case '--body': {
        if (!isLifecycle) body = value;
        break;
      }
      case '--auto':
      case '--disable-auto': {
        autoMerge = true;
        break;
      }
      case '--undo': {
        undo = true;
        break;
      }
      case '-R':
      case '--repo': {
        repoFlag = value;
        break;
      }
      case '-d':
      case '--draft': {
        draft = true;
        break;
      }
      case '-B':
      case '--base': {
        base = value;
        break;
      }
      case '-H':
      case '--head': {
        head = value;
        break;
      }
      default: {
        // Other value flags had their value consumed above; other boolean
        // flags (--web, --fill, ...) carry nothing we snapshot.
        break;
      }
    }
  }

  const repo = isOwnerRepo(repoFlag) ? repoFlag : ownerRepoFromUrl(repoFlag);

  // Edit target: `gh issue edit 952` or `gh pr edit <url>`.
  let targetNumber: number | null = null;
  let targetRef: GithubEntityRef | null = null;
  for (const positional of positionals) {
    const ref = parseGithubEntityUrls(positional)[0];
    if (ref) targetRef = ref;
    else if (/^\d+$/.test(positional)) targetNumber = Number(positional);
  }

  // Issues have no branches; drop any stray `-B` / `-H` values.
  const isPullRequest = noun === 'pr';

  return {
    action: action as ParsedGhCommand['action'],
    autoMerge,
    base: isPullRequest ? base : null,
    body,
    draft,
    entityType: isPullRequest ? 'pull_request' : 'issue',
    head: isPullRequest ? head : null,
    repo,
    targetNumber,
    targetRef,
    title,
    undo,
  };
};

/** Options for the shell-surface gh normalizer; both are off for the github skill. */
export interface GithubShellNormalizeOptions {
  /**
   * Also register `gh pr ready <n>` / `gh pr merge <n>` (Better Coding
   * Experience): touching a pull request by number ties it to the conversation.
   */
  pullRequestLifecycle?: boolean;
  /**
   * Pull requests (`owner/repo#n`) already linked to the conversation. A
   * lifecycle command that names only a number — gh resolves the repository
   * from the working directory, which the command text does not carry — is
   * matched against these; an ambiguous or unknown number registers nothing.
   */
  topicPullRequests?: string[];
}

/**
 * gh's confirmation that the merge itself happened (`✓ Merged pull request …`,
 * `Squashed and merged`, `Rebased and merged`, `… was already merged`). A
 * repository with a merge queue only queues the PR, and gh prints nothing at
 * all to a non-terminal — neither is proof it merged.
 */
const MERGE_CONFIRMED_RE = /\b(?:merged pull request|was already merged)\b/i;

/** What a lifecycle command leaves the pull request in; null when it does not say. */
const lifecycleStatus = (parsed: ParsedGhCommand, output: string | null): string | null => {
  if (parsed.action === 'merge') {
    return !parsed.autoMerge && output && MERGE_CONFIRMED_RE.test(output) ? 'merged' : null;
  }
  if (parsed.action === 'ready') return parsed.undo ? 'draft' : 'open';
  return null;
};

const resolveRepoFromTopic = (number: number, topicPullRequests: string[] = []) => {
  const repos = topicPullRequests
    .filter((identifier) => identifier.endsWith(`#${number}`))
    .map((identifier) => identifier.slice(0, identifier.lastIndexOf('#')));
  return repos.length === 1 ? repos[0] : null;
};

const normalizeGithubCliResult = (
  params: SkillToolResultWorkInput,
  options: GithubShellNormalizeOptions = {},
): ExternalToolWorkOperation | null => {
  const record = unwrapData(params.data);
  if (!record) return null;

  const exitCode = numberFromRecord(record, ['exitCode', 'exit_code']);
  if (exitCode !== null && exitCode !== 0) return null;

  const args = params.args ?? {};
  const command = fromRecord(record, ['command']) ?? fromRecord(args, ['command']);
  if (!command) return null;

  const segments = parseShellCommandSegments(command);
  if (!segments) return null;

  // A chained command (`git push && gh pr create ...`) reports one combined
  // stdout; the trailing URL belongs to the last gh create/edit segment.
  const parsed = segments
    .map((segment) => parseGhSegment(segment, !!options.pullRequestLifecycle))
    .findLast((segment): segment is ParsedGhCommand => !!segment);
  if (!parsed) return null;

  const isLifecycle = isLifecycleAction(parsed.action);
  // Only a NUMBERED lifecycle command counts: without one gh acts on whatever
  // branch is checked out, which says nothing about which pull request it was.
  if (isLifecycle && parsed.targetNumber === null && !parsed.targetRef) return null;

  // stdout is the source of truth for identity: `gh issue/pr create|edit`
  // prints the entity URL as its result line. Fall back to the edit target
  // in the command when stdout carries no URL.
  const output = fromRecord(record, ['output', 'stdout']);
  const targetRepo =
    parsed.repo ??
    (isLifecycle && parsed.targetNumber !== null
      ? (parseGithubEntityRefs(output, parsed.entityType).find(
          (ref) => ref.number === parsed.targetNumber,
        )?.repo ?? resolveRepoFromTopic(parsed.targetNumber, options.topicPullRequests))
      : null);
  const commandRef =
    parsed.targetRef ??
    (parsed.targetNumber !== null && targetRepo
      ? {
          entityType: parsed.entityType,
          number: parsed.targetNumber,
          repo: targetRepo,
          url: null,
        }
      : null);
  // A lifecycle command prints no URL of its own, so any URL in a chained
  // command's output belongs to another segment: trust only the target.
  const ref = isLifecycle ? commandRef : (parseGithubEntityUrls(output).at(-1) ?? commandRef);
  if (!ref) return null;

  const status = isLifecycle
    ? lifecycleStatus(parsed, output)
    : parsed.action === 'create'
      ? parsed.draft
        ? 'draft'
        : 'open'
      : null;

  const identifier = `${ref.repo}#${ref.number}`;

  // Allowlist http(s) only: the url is parsed from member-controlled `gh`
  // stdout and reaches shell.openExternal on desktop.
  const safeUrl = sanitizeExternalUrl(ref.url);

  const patchFields = new Set<WorkDisplayField>(['identifier']);
  const patch = makePatch(patchFields);

  return {
    params: {
      agentId: params.agentId ?? null,
      changeType: parsed.action === 'create' ? 'created' : 'updated',
      // The FULL `--body` value (layer 3); the card preview is the capped `description`.
      content: patch('content', parsed.body !== null, parsed.body),
      cumulativeCost: params.cumulativeCost ?? null,
      cumulativeUsage: params.cumulativeUsage ?? null,
      description: patch('description', parsed.body !== null, previewText(parsed.body)),
      identifier,
      resourceId: identifier,
      resourceType: githubResourceType(ref.entityType),
      messageId: params.messageId ?? null,
      metadata:
        ref.entityType === 'pull_request'
          ? pullRequestCommandMetadata(parsed.head, parsed.base)
          : undefined,
      rootOperationId: params.rootOperationId ?? null,
      // gh only exposes --draft on create; an edit carries no status signal,
      // while merge / ready say what they left the pull request in.
      status: patch('status', status !== null, status),
      threadId: params.threadId ?? null,
      title: patch('title', parsed.title !== null, stringValue(parsed.title)),
      toolCallId: params.toolCallId ?? null,
      toolName: params.toolName,
      topicId: params.topicId ?? null,
      url: patch('url', !!safeUrl, safeUrl),
      // Evaluated last: every patch() call above must run before the set is
      // materialized (object literal properties evaluate in order).
      patchFields: Array.from(patchFields),
    },
    type: 'register',
  };
};

/**
 * Normalize a HETEROGENEOUS / device shell tool result (codex
 * `command_execution`, claude-code `Bash`, lobe-local-system `runCommand`) that
 * may have run `gh issue|pr create/edit`.
 *
 * Reuses the github skill's gh-CLI parsing wholesale: callers present the
 * record as `data: { command, output, exitCode }`. Unlike
 * {@link normalizeGithubToolResult} there is no toolName gate — the caller has
 * already scoped the record to a shell tool, and `toolName` carries the real
 * provenance name (`Bash` / `command_execution` / `runCommand`).
 */
export const normalizeGithubShellToolResult = (
  params: SkillToolResultWorkInput,
  options?: GithubShellNormalizeOptions,
): ExternalToolWorkOperation | null => {
  if (isApplicationError(params.data)) return null;

  return normalizeGithubCliResult(params, options);
};

export const normalizeGithubToolResult = (
  params: SkillToolResultWorkInput,
): ExternalToolWorkOperation | null => {
  // Payload apiNames sometimes carry the provider prefix (e.g. `github_create_issue`).
  const toolName = params.toolName.replace(/^github_/, '');

  if (isApplicationError(params.data)) return null;

  if (GITHUB_CLI_TOOLS.has(toolName)) return normalizeGithubCliResult(params);

  const tool = GITHUB_WORK_TOOLS[toolName];
  if (!tool) return null;

  const record = unwrapData(params.data);
  if (!record) return null;

  const base = buildParams(params, tool, record);
  // `owner/repo#number` is the canonical github Work identity — the CLI
  // surface never returns node_id, so REST-shaped results must dedupe against
  // CLI-created rows through the same key. Unidentifiable results are skipped.
  if (!base.identifier) return null;

  return { params: { ...base, resourceId: base.identifier }, type: 'register' };
};
