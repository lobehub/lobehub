import type {
  GithubWorkResourceType,
  RegisterExternalWorkParams,
  SkillToolResultWorkInput,
  WorkDisplayField,
} from '@lobechat/types';

import { WORK_DESCRIPTION_PREVIEW_LENGTH } from './internal';
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
 * Only successful create/edit results become Works (LOBE-10967): read-only
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

const CONTROL_OPERATORS = new Set(['&&', '||', ';', '|', '&']);

/**
 * Minimal POSIX-ish tokenizer: whitespace splitting with single/double quote
 * and backslash handling. Returns null on unterminated quotes — better to
 * skip registration than to mis-attribute flag values.
 *
 * Deliberately hand-rolled instead of adding a `shell-quote`-style dependency:
 * a real shell parser would also expand what we must keep literal (`$VAR`,
 * globs) and adds a dependency to the database package for a best-effort
 * bookkeeping path whose worst failure mode is skipping a Work registration.
 * Known trade-off: quoting is stripped before operator splitting, so a quoted
 * literal like `--title '&&'` is treated as a control operator and at worst
 * truncates the parsed segment. Edge cases are pinned in
 * `__tests__/githubToolResult.test.ts`.
 */
const tokenizeShellCommand = (input: string): string[] | null => {
  const tokens: string[] = [];
  let current = '';
  let hasCurrent = false;
  let i = 0;

  const push = () => {
    if (hasCurrent) {
      tokens.push(current);
      current = '';
      hasCurrent = false;
    }
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) return null;
      current += input.slice(i + 1, end);
      hasCurrent = true;
      i = end + 1;
    } else if (ch === '"') {
      i++;
      let closed = false;
      while (i < input.length) {
        const c = input[i];
        if (c === '\\' && '"\\$`'.includes(input[i + 1] ?? '')) {
          current += input[i + 1];
          i += 2;
        } else if (c === '"') {
          closed = true;
          i++;
          break;
        } else {
          current += c;
          i++;
        }
      }
      if (!closed) return null;
      hasCurrent = true;
    } else if (ch === '\\') {
      // Backslash-newline is a line continuation; otherwise escape the next char.
      if (input[i + 1] === '\n') {
        i += 2;
      } else {
        current += input[i + 1] ?? '';
        hasCurrent = true;
        i += 2;
      }
    } else if (/\s/.test(ch)) {
      push();
      i++;
    } else {
      current += ch;
      hasCurrent = true;
      i++;
    }
  }

  push();
  return tokens;
};

/** Split a token stream on whitespace-separated shell control operators. */
const splitCommandSegments = (tokens: string[]): string[][] => {
  const segments: string[][] = [];
  let current: string[] = [];

  for (const token of tokens) {
    if (CONTROL_OPERATORS.has(token)) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }

  if (current.length > 0) segments.push(current);
  return segments;
};

/**
 * gh flags that consume a value. Needed even for flags we don't extract, so
 * their values are not misread as positional targets (`gh issue edit 952`).
 */
const GH_VALUE_FLAGS = new Set([
  '--add-assignee',
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

interface GithubEntityRef {
  entityType: GithubWorkEntityType;
  number: number;
  repo: string;
  url: string;
}

const GITHUB_ENTITY_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/gi;

const parseGithubEntityUrls = (text: string | null): GithubEntityRef[] => {
  if (!text) return [];

  return Array.from(text.matchAll(GITHUB_ENTITY_URL_RE), (match) => ({
    entityType: (match[3] === 'issues' ? 'issue' : 'pull_request') as GithubWorkEntityType,
    number: Number(match[4]),
    repo: `${match[1]}/${match[2]}`,
    url: match[0],
  }));
};

interface ParsedGhCommand {
  action: 'create' | 'edit';
  body: string | null;
  draft: boolean;
  entityType: GithubWorkEntityType;
  repo: string | null;
  targetNumber: number | null;
  targetRef: GithubEntityRef | null;
  title: string | null;
}

const parseGhSegment = (segment: string[]): ParsedGhCommand | null => {
  if (segment[0] !== 'gh') return null;

  const noun = segment[1];
  const action = segment[2];
  if (noun !== 'issue' && noun !== 'pr') return null;
  if (action !== 'create' && action !== 'edit') return null;

  let body: string | null = null;
  let draft = false;
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

    if (value === null && GH_VALUE_FLAGS.has(token)) {
      value = segment[i + 1] ?? null;
      i++;
    }

    switch (token) {
      case '-t':
      case '--title': {
        title = value;
        break;
      }
      case '-b':
      case '--body': {
        body = value;
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

  return {
    action,
    body,
    draft,
    entityType: noun === 'issue' ? 'issue' : 'pull_request',
    repo,
    targetNumber,
    targetRef,
    title,
  };
};

const normalizeGithubCliResult = (
  params: SkillToolResultWorkInput,
): ExternalToolWorkOperation | null => {
  const record = unwrapData(params.data);
  if (!record) return null;

  const exitCode = numberFromRecord(record, ['exitCode', 'exit_code']);
  if (exitCode !== null && exitCode !== 0) return null;

  const args = params.args ?? {};
  const command = fromRecord(record, ['command']) ?? fromRecord(args, ['command']);
  if (!command) return null;

  const tokens = tokenizeShellCommand(command);
  if (!tokens) return null;

  // A chained command (`git push && gh pr create ...`) reports one combined
  // stdout; the trailing URL belongs to the last gh create/edit segment.
  const parsed = splitCommandSegments(tokens)
    .map(parseGhSegment)
    .findLast((segment): segment is ParsedGhCommand => !!segment);
  if (!parsed) return null;

  // stdout is the source of truth for identity: `gh issue/pr create|edit`
  // prints the entity URL as its result line. Fall back to the edit target
  // in the command when stdout carries no URL.
  const output = fromRecord(record, ['output', 'stdout']);
  const ref =
    parseGithubEntityUrls(output).at(-1) ??
    parsed.targetRef ??
    (parsed.targetNumber !== null && parsed.repo
      ? {
          entityType: parsed.entityType,
          number: parsed.targetNumber,
          repo: parsed.repo,
          url: null,
        }
      : null);
  if (!ref) return null;

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
      rootOperationId: params.rootOperationId ?? null,
      // gh only exposes --draft on create; an edit carries no status signal.
      status: patch('status', parsed.action === 'create', parsed.draft ? 'draft' : 'open'),
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
