import type { ShellCommandAction, ShellCommandTitle } from './types';

/**
 * Steps of the CLIs an agent drives every day: GitHub's `gh`, Vercel's `vc`,
 * and LobeHub's `lh`. Their command lines are long
 * (`cd ~/code/app && gh api repos/owner/app/pulls/12/comments --jq ...`) while
 * what they did fits in a few words ("调用 GitHub API owner/app/pulls/12/comments").
 *
 * Ported from Caxri (`packages/protocol/src/agent/tool-rows/shell/agent-shell-cli.ts`).
 */

/**
 * Options of `gh`, `vc`, and `lh` whose value is the next word, so
 * `gh issue view -R owner/app 12` names `12`, not `owner/app`. Short options
 * that are booleans on some subcommands (`gh pr view -w`) are left out; a value
 * they mis-skip only costs the subject, never a wrong one.
 */
const VALUE_OPTIONS = new Set([
  '-R',
  '--repo',
  '-t',
  '--title',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-l',
  '--label',
  '-a',
  '--assignee',
  '-A',
  '--author',
  '-S',
  '--search',
  '-s',
  '--state',
  '-L',
  '--limit',
  '--json',
  '-q',
  '--jq',
  '--template',
  '-B',
  '--base',
  '-H',
  '--head',
  '--header',
  '-m',
  '--milestone',
  '-p',
  '--project',
  '--workflow',
  '-u',
  '--user',
  '-e',
  '--event',
  '-j',
  '--job',
  '--branch',
  '-X',
  '--method',
  '-f',
  '--raw-field',
  '--field',
  '--input',
  '--hostname',
  '--cache',
  '--preview',
  '-r',
  '--reviewer',
  '--add-label',
  '--remove-label',
  '--add-assignee',
  '--remove-assignee',
  '--scope',
  '--token',
  '--env',
  '--environment',
  '--cwd',
  '--target',
  '--meta',
  '--output',
]);

/** The value of the first of `options` in `words`, as `-m "message"` or `--message=message`. */
export const optionValue = (
  words: readonly string[],
  options: readonly string[],
): string | undefined => {
  const exact = new Set(options);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (exact.has(word)) return words[index + 1];
    const option = options.find((candidate) => word.startsWith(`${candidate}=`));
    if (option) return word.slice(option.length + 1);
  }
  return undefined;
};

/** The words that are not options or option values. */
const positionals = (words: readonly string[]): string[] => {
  const values: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--') {
      values.push(...words.slice(index + 1));
      break;
    }
    if (word !== '-' && word.startsWith('-')) {
      if (VALUE_OPTIONS.has(word)) index += 1;
      continue;
    }
    values.push(word);
  }
  return values;
};

/** `#12` for an issue, pull request, or run named by number (`12`, `#12`) or URL (`.../issues/12`). */
const numberReference = (word: string | undefined): string | undefined => {
  const match = /^#?(\d+)$|\/(?:issues|pull|runs)\/(\d+)/u.exec(word ?? '');
  const digits = match?.slice(1).find(Boolean);
  return digits && `#${digits}`;
};

const step = (action: ShellCommandAction, subject?: string, isProse = false): ShellCommandTitle => {
  const trimmed = subject?.trim();
  if (!trimmed) return { action };
  return isProse ? { action, isProse, subject: trimmed } : { action, subject: trimmed };
};

const PULL_REQUEST_ACTIONS: Readonly<Record<string, ShellCommandAction | undefined>> = {
  checks: 'pr.check',
  close: 'pr.close',
  comment: 'pr.comment',
  create: 'pr.create',
  diff: 'pr.check',
  edit: 'pr.edit',
  list: 'pr.list',
  merge: 'pr.merge',
  ready: 'pr.edit',
  review: 'pr.comment',
  status: 'pr.check',
  view: 'pr.check',
};

const pullRequestStep = (arguments_: readonly string[]): ShellCommandTitle | null => {
  const [verb = '', ...rest] = arguments_;
  const action = PULL_REQUEST_ACTIONS[verb];
  if (!action) return null;
  if (action === 'pr.create') return step(action, optionValue(rest, ['--title', '-t']), true);
  if (action === 'pr.list') {
    const search = optionValue(rest, ['--search', '-S']);
    return search ? step(action, search, true) : step(action, optionValue(rest, ['--head', '-H']));
  }
  return step(action, numberReference(positionals(rest).at(0)));
};

const ISSUE_ACTIONS: Readonly<Record<string, ShellCommandAction | undefined>> = {
  close: 'issue.close',
  comment: 'issue.comment',
  edit: 'issue.edit',
  reopen: 'issue.reopen',
  view: 'issue.view',
};

const issueStep = (arguments_: readonly string[]): ShellCommandTitle | null => {
  const [verb = '', ...rest] = arguments_;
  if (verb === 'create') return step('issue.create', optionValue(rest, ['--title', '-t']), true);
  if (verb === 'list') {
    const search = optionValue(rest, ['--search', '-S']);
    if (search) return step('issue.list', search, true);
    const label = optionValue(rest, ['--label', '-l']);
    return step('issue.list', label && `label: ${label}`);
  }
  const action = ISSUE_ACTIONS[verb];
  return action ? step(action, numberReference(positionals(rest).at(0))) : null;
};

const runStep = (arguments_: readonly string[]): ShellCommandTitle | null => {
  const [verb = '', ...rest] = arguments_;
  const run = numberReference(positionals(rest).at(0))?.slice(1);
  switch (verb) {
    case 'view':
    case 'watch': {
      const isLog = rest.some((word) => word === '--log' || word === '--log-failed');
      return step(isLog ? 'ci.logs' : 'ci.view', run);
    }
    case 'list': {
      return step(
        'ci.list',
        optionValue(rest, ['--branch', '-b']) ?? optionValue(rest, ['--workflow', '-w']),
      );
    }
    case 'rerun': {
      return step('ci.rerun', run);
    }
    case 'cancel': {
      return step('ci.cancel', run);
    }
    default: {
      return null;
    }
  }
};

/** A REST endpoint as the resource it names: `repos/owner/app/pulls/12?per_page=100` reads `owner/app/pulls/12`. */
const apiEndpoint = (arguments_: readonly string[]): string | undefined => {
  const endpoint = positionals(arguments_).at(0);
  if (!endpoint) return undefined;
  if (endpoint === 'graphql') return 'GraphQL';
  return endpoint
    .replace(/^\//u, '')
    .replace(/^repos\//u, '')
    .replace(/\?.*$/u, '');
};

const ghStep = (arguments_: readonly string[]): ShellCommandTitle | null => {
  const [group = '', ...rest] = arguments_;
  switch (group) {
    case 'pr': {
      return pullRequestStep(rest);
    }
    case 'issue': {
      return issueStep(rest);
    }
    case 'run': {
      return runStep(rest);
    }
    case 'workflow': {
      return rest[0] === 'run' ? step('ci.workflowRun', positionals(rest.slice(1)).at(0)) : null;
    }
    case 'api': {
      return step('githubApi', apiEndpoint(rest));
    }
    default: {
      return null;
    }
  }
};

/** A deployment named by URL reads as its host; a deployment ID (`dpl_...`) or project name as written. */
const deploymentName = (word: string | undefined): string | undefined => {
  if (!word) return undefined;
  try {
    // `new URL('mailto:x')` parses with an empty host.
    const { host } = new URL(word);
    if (host) return host;
  } catch {
    // not a URL
  }
  return word;
};

const vercelStep = (arguments_: readonly string[]): ShellCommandTitle | null => {
  const [verb = '', ...rest] = positionals(arguments_);
  const target = deploymentName(rest.at(0));
  switch (verb) {
    case 'inspect': {
      return step(arguments_.includes('--logs') ? 'vercel.logs' : 'vercel.inspect', target);
    }
    case 'logs': {
      return step('vercel.logs', target);
    }
    case 'ls':
    case 'list': {
      return step('vercel.list', rest.at(0));
    }
    case 'env': {
      if (rest[0] === 'ls' || rest[0] === 'list') return step('vercel.envList', rest.at(1));
      if (rest[0] === 'pull') return step('vercel.envPull');
      return null;
    }
    case 'redeploy': {
      return step('vercel.redeploy', target);
    }
    case 'deploy': {
      return step('vercel.deploy', arguments_.includes('--prod') ? 'production' : undefined);
    }
    case 'promote': {
      return step('vercel.promote', target);
    }
    default: {
      return null;
    }
  }
};

const lobeHubStep = (arguments_: readonly string[]): ShellCommandTitle | null => {
  const [group = '', verb = '', ...rest] = positionals(arguments_);
  if (group !== 'acceptance') return null;
  switch (verb) {
    case 'preflight': {
      return step('acceptance.preflight');
    }
    case 'view':
    case 'get': {
      return step('acceptance.view', rest.at(0));
    }
    case 'feedback': {
      return step('acceptance.feedback', rest.at(0));
    }
    case 'list': {
      return step('acceptance.list');
    }
    case 'publish': {
      return step('acceptance.publish');
    }
    case 'run': {
      return rest[0] === 'ingest' ? step('acceptance.ingest') : null;
    }
    case 'link-pr': {
      return step('acceptance.linkPr', numberReference(rest.at(1)) ?? rest.at(1));
    }
    default: {
      return null;
    }
  }
};

const CLI_STEPS: Readonly<
  Record<string, ((arguments_: readonly string[]) => ShellCommandTitle | null) | undefined>
> = {
  gh: ghStep,
  lh: lobeHubStep,
  vc: vercelStep,
  vercel: vercelStep,
};

/**
 * Reads one unwrapped command of `gh`, `vc`, or `lh`. `'other'` for a
 * subcommand this module does not name, which still titles as the command
 * line; `null` for anything else.
 */
export const describeCliStep = (words: readonly string[]): ShellCommandTitle | 'other' | null => {
  const [name = '', ...arguments_] = words;
  const read = CLI_STEPS[name];
  if (!read) return null;
  return read(arguments_) ?? 'other';
};
