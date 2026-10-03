import {
  diffLiteXMLBlocks,
  type EditorRuntime,
  formatModifyNodesResult,
  parseLiteXMLBlocks,
} from '@lobechat/editor-runtime';
import type { CommandName } from 'just-bash/browser';

import type { BashState } from '../types';

const DOC_XML = '/doc.xml';
const TITLE = '/title';
const OUTLINE = '/.meta/outline';

const ALLOWED_COMMANDS: CommandName[] = [
  'awk',
  'basename',
  'cat',
  'cp',
  'cut',
  'diff',
  'dirname',
  'echo',
  'egrep',
  'false',
  'fgrep',
  'find',
  'grep',
  'head',
  'help',
  'ls',
  'mkdir',
  'mv',
  'printf',
  'pwd',
  'rg',
  'rm',
  'sed',
  'sort',
  'tail',
  'tee',
  'touch',
  'tr',
  'tree',
  'true',
  'uniq',
  'wc',
  'which',
];

const STUB_COMMANDS = ['python3', 'python', 'pip', 'node', 'nodejs', 'perl', 'ruby', 'php'];

const AVAILABLE_HINT = `Available: ${ALLOWED_COMMANDS.join(' ')}`;

const MAX_OUTPUT_BYTES = 1024 * 1024;
// Stays well under the 30s edit-lock lease the server holds around a call.
const MAX_EXECUTION_MS = 10_000;

const buildOutline = (xml: string) => {
  const blocks = parseLiteXMLBlocks(xml);
  if (typeof blocks === 'string' || blocks.length === 0) return '';

  return `${blocks
    .map(({ id, tag, text }) => `${id ?? '-'} ${tag} ${text.slice(0, 80)}`.trim())
    .join('\n')}\n`;
};

const MIN_SIZE_LIMIT = 2 * 1024 * 1024;

const isTooLarge = (next: string, previous: string) =>
  next.length > Math.max(4 * previous.length, MIN_SIZE_LIMIT);

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const UTF8_BYTE_SEQUENCE =
  /[\u00C2-\u00DF][\u0080-\u00BF]|[\u00E0-\u00EF][\u0080-\u00BF]{2}|[\u00F0-\u00F4][\u0080-\u00BF]{3}/g;

// just-bash stores bytes a command wrote through a redirect (awk "\xe2\x82\xac")
// as one char per byte, while literal text stays as real chars, so a read-back
// file can mix both. Only sequences that are valid UTF-8 are decoded; a lone
// Latin-1 char such as "é" is not one and stays as is.
// ponytail: page text that genuinely contains mojibake like "Ã©" would be decoded too.
const decodeByteSequences = (text: string) =>
  text.replaceAll(UTF8_BYTE_SEQUENCE, (bytes) => {
    try {
      return strictUtf8.decode(Uint8Array.from(bytes, (char) => char.charCodeAt(0)));
    } catch {
      return bytes;
    }
  });

const readIfExists = async (
  fs: { exists: (path: string) => Promise<boolean>; readFile: (path: string) => Promise<string> },
  path: string,
) => ((await fs.exists(path)) ? decodeByteSequences(await fs.readFile(path)) : undefined);

export class PageChangedDuringCommandError extends Error {
  constructor(bodyChanged = false) {
    super(
      bodyChanged
        ? 'The body changes were saved for review, but the page changed while saving, so the title was not changed. Tell the user what completed and read the page again before retrying.'
        : 'The page changed while the command was running (it was edited or another page was opened), so nothing was written. Tell the user; if they still want the edit, read the page again before retrying.',
    );
    this.name = 'PageChangedDuringCommandError';
  }
}

// The command works on a snapshot; a live editor can change under it while it
// runs, and applying ids from that snapshot would overwrite the user's typing
// or land on another page.
const assertPageUnchanged = (
  runtime: EditorRuntime,
  xml: string,
  title: string,
  documentId: string | undefined,
  bodyChanged = false,
) => {
  let current: ReturnType<EditorRuntime['getPageContentContext']>;
  try {
    current = runtime.getPageContentContext('xml');
  } catch {
    throw new PageChangedDuringCommandError(bodyChanged);
  }
  if (
    runtime.getCurrentDocId() !== documentId ||
    (!bodyChanged && (current.xml ?? '') !== xml) ||
    current.metadata.title !== title
  ) {
    throw new PageChangedDuringCommandError(bodyChanged);
  }
};

export const runPageBash = async (
  runtime: EditorRuntime,
  command: string,
): Promise<{ content: string; state: BashState }> => {
  // The browser build keeps the virtual shell without tracing optional SQL,
  // Python, or JavaScript runtimes into serverless functions.
  const { Bash, defineCommand } = await import('just-bash/browser');

  const {
    metadata: { title },
    xml = '',
  } = runtime.getPageContentContext('xml');
  const documentId = runtime.getCurrentDocId();
  const outline = buildOutline(xml);

  const bash = new Bash({
    commands: ALLOWED_COMMANDS,
    customCommands: STUB_COMMANDS.map((name) =>
      defineCommand(name, async () => ({
        exitCode: 127,
        stderr: `${name} is not available in this workspace. Edit the page with shell text tools.\n${AVAILABLE_HINT}\n`,
        stdout: '',
      })),
    ),
    cwd: '/',
    // Defense-in-depth patches process-wide globals for the duration of exec, so
    // host code sharing the process (Next's async hooks, React's scheduler) hits
    // violations, and one thrown inside an async hook crashes the server. It only
    // guards JS/Python evaluation, which the command whitelist never exposes.
    defenseInDepth: false,
    executionLimitProfile: 'hardened',
    executionLimits: { maxExecutionTimeMs: MAX_EXECUTION_MS, maxOutputSize: MAX_OUTPUT_BYTES },
    files: {
      [DOC_XML]: xml,
      [OUTLINE]: outline,
      [TITLE]: `${title}\n`,
    },
  });
  await bash.fs.mkdir('/tmp', { recursive: true });
  const pathsBefore = new Set(bash.fs.getAllPaths());

  const output: string[] = [];
  const finish = (changed: boolean, exitCode: number, success: boolean) => {
    const content = output.filter(Boolean).join('\n') || '(no output)';
    return { content, state: { changed, exitCode, success } };
  };

  let exitCode: number;
  let hitLimit: boolean;
  try {
    const result = await bash.exec(command);
    exitCode = result.exitCode;
    hitLimit = exitCode === 126 && result.stderr.includes('executionLimits');
    output.push(result.stdout.trimEnd(), result.stderr.trimEnd());
  } catch (error) {
    output.push(`Command aborted: ${(error as Error).message}`, 'Nothing was written.');
    return finish(false, 1, false);
  }
  if (exitCode !== 0) output.push(`exit ${exitCode}`);

  const nextXml = await readIfExists(bash.fs, DOC_XML);
  const nextTitleFile = await readIfExists(bash.fs, TITLE);
  const nextOutline = await readIfExists(bash.fs, OUTLINE);

  const warnings: string[] = [];
  for (const [path, next] of [
    [DOC_XML, nextXml],
    [TITLE, nextTitleFile],
  ] as const) {
    if (next === undefined) warnings.push(`warning: ${path} was deleted; ignored.`);
  }
  if (nextOutline !== outline) warnings.push(`warning: ${OUTLINE} is read-only; ignored.`);
  const strayPaths = bash.fs
    .getAllPaths()
    .filter((path) => !pathsBefore.has(path) && path !== '/tmp' && !path.startsWith('/tmp/'));
  if (strayPaths.length > 0) {
    warnings.push(
      `warning: only /tmp is writable scratch space; ignored ${strayPaths.join(', ')}.`,
    );
  }
  output.push(...warnings);

  const xmlChanged = nextXml !== undefined && nextXml !== xml;
  const nextTitle = nextTitleFile?.replace(/\r?\n$/, '');
  const titleChanged = nextTitle !== undefined && nextTitle !== title;

  const reject = (reason: string) => {
    output.push(`Nothing was written: ${reason}`);
    return finish(false, exitCode, false);
  };

  if (hitLimit) {
    return reject('the command hit an execution limit. Split the work into smaller commands.');
  }
  if (xmlChanged && isTooLarge(nextXml!, xml)) {
    return reject('the edited page is too large compared with the current one.');
  }
  if (titleChanged && (!nextTitle!.trim() || /[\r\n]/.test(nextTitle!))) {
    return reject(`${TITLE} must hold a single non-empty line.`);
  }

  const diff = xmlChanged ? diffLiteXMLBlocks(xml, nextXml!) : undefined;
  if (diff && !diff.ok) return reject(`${DOC_XML} ${diff.reason}.`);

  if (xmlChanged || titleChanged) assertPageUnchanged(runtime, xml, title, documentId);

  let changed = false;

  if (diff?.ok && diff.operations.length === 0) {
    output.push(`${DOC_XML}: no block changes detected.`);
  } else if (diff?.ok) {
    const result = await runtime.modifyNodes({ operations: diff.operations }, () =>
      assertPageUnchanged(runtime, xml, title, documentId),
    );
    const { inserted, modified, removed } = diff.summary;
    output.push(
      `${DOC_XML}: ${modified} modified, ${inserted} inserted, ${removed} removed; changes await the user's review.`,
      formatModifyNodesResult(result),
    );
    changed =
      result.successCount > 0 || result.results.some((operation) => operation.partiallyApplied);
  }

  if (titleChanged) {
    await runtime.editTitle({ title: nextTitle!.trim() }, () =>
      assertPageUnchanged(runtime, xml, title, documentId, changed),
    );
    output.push(`${TITLE}: renamed to "${nextTitle!.trim()}".`);
    changed = true;
  }

  if (changed && runtime.isReady() && runtime.getCurrentDocId() === documentId) {
    const refreshed = buildOutline(runtime.getPageContentContext('xml').xml ?? '');
    output.push(`${OUTLINE} (ids refreshed; use these from now on):\n${refreshed}`);
  }

  return finish(changed, exitCode, true);
};
