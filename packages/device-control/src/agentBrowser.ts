/**
 * The device side of the `lobe-browser` tool on a device without the desktop
 * app's browser panel: each api call becomes one `agent-browser batch` run
 * against a headless browser session keyed by the run's topic.
 *
 * The exec and file reads are injected so the mapping is testable without a
 * browser; `lh connect` supplies the real `agent-browser` process.
 */

/**
 * Tool identifier a device lists in `supportedTools` when it can run the
 * browser tool. Mirrors `BrowserIdentifier` in `@lobechat/builtin-tool-browser`,
 * which device runtimes do not import because it carries the React renders.
 */
import path from 'node:path';

import {
  browserEditCommandOf,
  DEFAULT_BROWSER_VIEWPORT,
  parseBrowserKey,
  parseBrowserViewport,
} from './browserInput';

export const BROWSER_IDENTIFIER = 'lobe-browser';

/** Matches the desktop `readPage` cap so both devices hand the model the same budget. */
export const READ_PAGE_MAX_CHARS = 12_000;

/** Matches the desktop upload cap. */
export const MAX_UPLOAD_FILES = 20;

/** What `uploadFile` targets when the call names no ref or selector. */
const FILE_INPUT_SELECTOR = 'input[type="file"]';

/**
 * Runs `agent-browser --session <session> --json batch --bail` once with the
 * JSON command list on stdin and resolves its stdout, even on a nonzero exit:
 * a failed step is reported inside the JSON array, not by the exit code alone.
 */
export type AgentBrowserExec = (session: string, commands: string[][]) => Promise<string>;

export interface AgentBrowserCallOptions {
  exec: AgentBrowserExec;
  /** Home folder a leading `~` in an upload path stands for. */
  homeDir?: string;
  /** OS of the browser's host, for `ControlOrMeta` and macOS editing shortcuts. */
  platform?: string;
  /** Reads the PNG the `screenshot` step wrote. */
  readFile: (filePath: string) => Promise<Uint8Array>;
  /** Where `screenshot` writes its capture; owned (and cleaned up) by the caller. */
  screenshotPath: string;
  /**
   * Stats an upload path. agent-browser attaches a missing path as an empty
   * file and reports success, so `uploadFile` refuses to run without it.
   */
  statFile?: (filePath: string) => Promise<{ isFile: () => boolean; size: number }>;
}

export interface AgentBrowserCommandContext {
  /** `fill` only: the target is a native `<select>`; see {@link runAgentBrowserCall}. */
  fillsSelect?: boolean;
  /** OS of the browser's host, for `ControlOrMeta` and macOS editing shortcuts. */
  platform?: string;
  /** `uploadFile` only: the checked absolute paths; see {@link resolveUploadFiles}. */
  uploadPaths?: string[];
}

export interface AgentBrowserToolResult {
  content: string;
  error?: string;
  state?: Record<string, unknown>;
  success: boolean;
}

interface BatchStep {
  command: string[];
  error: string | null;
  result: Record<string, unknown> | null;
  success: boolean;
}

/**
 * Session name for a run's browser, matching the desktop's `topic:<topicId>`
 * isolation: every topic drives its own page. agent-browser names sessions on
 * disk, so the id is reduced to a safe charset.
 */
export const agentBrowserSessionName = (topicId: unknown): string => {
  const id = typeof topicId === 'string' ? topicId.replaceAll(/[^\w-]/g, '_') : '';
  return id ? `lobehub-topic-${id}` : 'lobehub-default';
};

/** Model refs come as `e12` (or `@e12`, or `[ref=e12]`); agent-browser wants `@e12`. */
const toRef = (ref: unknown): string => {
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('ref is required');
  const id = ref
    .trim()
    .replace(/^\[?ref=/, '')
    .replace(/\]$/, '')
    .replace(/^@/, '');
  if (!/^e\d+$/.test(id))
    throw new Error(`Invalid ref "${ref}"; use a ref from the latest snapshot, e.g. "e12"`);
  return `@${id}`;
};

const toNumber = (value: unknown, name: string): string => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${name} must be a number`);
  return String(value);
};

const PAGE_INFO: string[][] = [
  ['get', 'title'],
  ['get', 'url'],
];

interface UploadFile {
  name: string;
  path: string;
  size: number;
}

/**
 * Checks every upload path before agent-browser sees it: absolute (a leading
 * `~` is the home folder) and an existing regular file. agent-browser itself
 * attaches a missing path as an empty file and reports success.
 */
export const resolveUploadFiles = async (
  paths: unknown,
  { homeDir, statFile }: Pick<AgentBrowserCallOptions, 'homeDir' | 'statFile'>,
): Promise<UploadFile[]> => {
  if (!statFile) throw new Error('File upload is not available on this device');
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths must list at least one absolute file path');
  }
  if (paths.length > MAX_UPLOAD_FILES) {
    throw new Error(`At most ${MAX_UPLOAD_FILES} files can be uploaded at once`);
  }

  const files: UploadFile[] = [];
  const problems: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.trim()) {
      problems.push(`${JSON.stringify(raw)} is not a path`);
      continue;
    }
    const trimmed = raw.trim();
    const filePath =
      homeDir && (trimmed === '~' || /^~[/\\]/.test(trimmed))
        ? path.join(homeDir, trimmed.slice(1))
        : trimmed;
    if (!path.isAbsolute(filePath)) {
      problems.push(`${raw} is not an absolute path`);
      continue;
    }
    const stats = await statFile(filePath).catch((error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' ? 'no such file on this device' : error.message,
    );
    if (typeof stats === 'string') problems.push(`${raw}: ${stats}`);
    else if (!stats.isFile()) problems.push(`${raw} is not a file`);
    else files.push({ name: path.basename(filePath), path: filePath, size: stats.size });
  }

  if (problems.length > 0) throw new Error(`Cannot upload: ${problems.join('; ')}`);
  return files;
};

/** Ref, CSS selector, or the page's only file input, as agent-browser's `upload` takes it. */
const uploadTarget = (args: Record<string, unknown>): string => {
  if (args.ref !== undefined && args.ref !== '') return toRef(args.ref);
  if (typeof args.selector === 'string' && args.selector.trim()) return args.selector.trim();
  return FILE_INPUT_SELECTOR;
};

/**
 * The agent-browser commands for one browser api call. Commands go as argv
 * arrays over stdin, never through a shell or a command string: agent-browser
 * has no `--` terminator, so text like `--headed` would otherwise parse as a flag.
 */
export const buildAgentBrowserCommands = (
  apiName: string,
  args: Record<string, unknown>,
  screenshotPath: string,
  {
    fillsSelect = false,
    platform = process.platform,
    uploadPaths,
  }: AgentBrowserCommandContext = {},
): string[][] => {
  switch (apiName) {
    case 'navigate': {
      const { url } = args;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new Error('url must be an absolute http(s) URL');
      }
      return [['open', url]];
    }
    case 'snapshot': {
      return [['snapshot', '-i'], ...PAGE_INFO];
    }
    case 'click': {
      if (args.ref !== undefined && args.ref !== '')
        return [['click', toRef(args.ref)], ...PAGE_INFO];
      const x = toNumber(args.x, 'x');
      const y = toNumber(args.y, 'y');
      return [['mouse', 'move', x, y], ['mouse', 'down'], ['mouse', 'up'], ...PAGE_INFO];
    }
    case 'fill': {
      if (typeof args.text !== 'string') throw new Error('text is required');
      // `fill` on a native <select> reports success but blanks it; `select`
      // takes the option value or its visible label, as the manifest promises.
      const commands = [[fillsSelect ? 'select' : 'fill', toRef(args.ref), args.text]];
      if (args.submit) commands.push(['press', 'Enter']);
      return commands;
    }
    case 'press': {
      // agent-browser reports success for any key name, pressed or not.
      const combo = parseBrowserKey(args.key, platform);
      const commands = [['press', combo.combo]];
      // Headless Chrome on macOS does not run Meta+A/C/V/X/Z from the key event.
      const editCommand = browserEditCommandOf(combo, platform);
      if (editCommand) {
        commands.push(['eval', `document.execCommand(${JSON.stringify(editCommand)})`]);
      }
      return commands;
    }
    case 'setViewport': {
      const { height, width } = parseBrowserViewport(args) ?? DEFAULT_BROWSER_VIEWPORT;
      return [['set', 'viewport', String(width), String(height)]];
    }
    case 'scroll': {
      return [['mouse', 'wheel', toNumber(args.dy, 'dy'), toNumber(args.dx ?? 0, 'dx')]];
    }
    case 'screenshot': {
      return [['screenshot', screenshotPath]];
    }
    case 'readPage': {
      return [['read'], ...PAGE_INFO];
    }
    case 'uploadFile': {
      if (!uploadPaths?.length) throw new Error('uploadFile needs checked file paths');
      return [['upload', uploadTarget(args), ...uploadPaths], ...PAGE_INFO];
    }
    default: {
      throw new Error(`Browser tool "${apiName}" is not available on this device`);
    }
  }
};

/**
 * agent-browser's `upload` takes the first match of a selector, so without a
 * ref or selector the page must have exactly one file input, as on desktop.
 */
const assertSingleFileInput = async (exec: AgentBrowserExec, session: string) => {
  const [step] = parseSteps(await exec(session, [['get', 'count', FILE_INPUT_SELECTOR]]));
  const count = Number(step?.success ? step.result?.count : Number.NaN);
  if (count === 0) {
    throw new Error(
      'This page has no file input; pass the ref of the upload button or drop zone instead',
    );
  }
  if (count > 1) {
    throw new Error(
      `This page has ${count} file inputs; pass a CSS selector for the one to use, e.g. input[type=file][accept=".zip"]`,
    );
  }
};

const parseSteps = (stdout: string): BatchStep[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`agent-browser returned unreadable output: ${stdout.slice(0, 500)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('agent-browser returned no batch results');
  return parsed as BatchStep[];
};

/**
 * Whether a ref points at a native `<select>`. agent-browser has no tag query,
 * but `get html` returns the element's inner HTML, which for a select is its
 * `<option>` list and for a text field is empty. A failed lookup falls back
 * to `fill`, whose own step then reports the bad ref.
 */
const isNativeSelect = async (exec: AgentBrowserExec, session: string, ref: unknown) => {
  const [step] = parseSteps(await exec(session, [['get', 'html', toRef(ref)]]));
  const html = step?.success ? step.result?.html : undefined;
  return typeof html === 'string' && /^\s*<(?:option|optgroup)\b/i.test(html);
};

/** PNG IHDR width/height, so the result reports the capture size like the desktop does. */
const pngSize = (bytes: Uint8Array): { height?: number; width?: number } => {
  if (bytes.length < 24) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x80_00) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x80_00));
  }
  return btoa(binary);
};

const pageLabel = (title?: string, url?: string) => `Page: ${title ?? ''} (${url ?? ''})`;

/**
 * Runs one `lobe-browser` api call through agent-browser and returns the same
 * `content` / `state` shape as the desktop client executor, so the server
 * runtime (screenshot upload included) and the chat renders need no branch.
 */
export const runAgentBrowserCall = async (
  apiName: string,
  rawArgs: Record<string, unknown>,
  options: AgentBrowserCallOptions,
): Promise<AgentBrowserToolResult> => {
  try {
    // The server rides the run identity in the args; it is not an api parameter.
    const { __agentId: _agentId, __topicId: topicId, ...args } = rawArgs;
    const session = agentBrowserSessionName(topicId);
    const platform = options.platform ?? process.platform;
    let uploads: UploadFile[] | undefined;
    if (apiName === 'uploadFile') {
      uploads = await resolveUploadFiles(args.paths, options);
      if (uploadTarget(args) === FILE_INPUT_SELECTOR) {
        await assertSingleFileInput(options.exec, session);
      }
    }
    const commands = buildAgentBrowserCommands(apiName, args, options.screenshotPath, {
      fillsSelect: apiName === 'fill' && (await isNativeSelect(options.exec, session, args.ref)),
      platform,
      uploadPaths: uploads?.map((file) => file.path),
    });
    const steps = parseSteps(await options.exec(session, commands));

    const failed = steps.find((step) => !step.success);
    if (failed || steps.length < commands.length) {
      throw new Error(failed?.error ?? `agent-browser stopped before ${apiName} finished`);
    }

    const result = (index: number) => steps[index]?.result ?? {};
    const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
    // `get title` / `get url` are the last two steps wherever PAGE_INFO is appended.
    const title = str(result(steps.length - 2).title);
    const url = str(result(steps.length - 1).url);

    switch (apiName) {
      case 'navigate': {
        const opened = result(0);
        const openedTitle = str(opened.title);
        const openedUrl = str(opened.url) ?? String(args.url);
        return {
          content: `Opened ${openedUrl}${openedTitle ? ` — "${openedTitle}"` : ''}.`,
          state: { title: openedTitle, url: openedUrl },
          success: true,
        };
      }
      case 'snapshot': {
        const snapshot = str(result(0).snapshot) ?? '';
        const header = pageLabel(title, url);
        // An empty snapshot is an answer, not a failure — see the desktop executor.
        return {
          content: snapshot
            ? `${header}\n${snapshot}`
            : `${header}\nNo interactive elements (links, buttons, form fields, headings) are visible on this page. Use readPage to read its text, or screenshot to see it.`,
          state: { snapshot, title, url },
          success: true,
        };
      }
      case 'click': {
        return {
          content: `Clicked${args.ref ? ` ${String(args.ref)}` : ''}. Now at ${url}${title ? ` — "${title}"` : ''}. Take a new snapshot if the page changed.`,
          state: { title, url },
          success: true,
        };
      }
      case 'fill': {
        return {
          content: `${commands[0][0] === 'select' ? 'Selected' : 'Filled'} ${String(args.ref)} with "${String(args.text)}"${args.submit ? ' and pressed Enter' : ''}.`,
          success: true,
        };
      }
      case 'press': {
        const combo = parseBrowserKey(args.key, platform);
        const editCommand = browserEditCommandOf(combo, platform);
        // `execCommand` answers false when the page refuses it, e.g. paste without clipboard access.
        const refused = editCommand && result(1).result === false;
        return {
          content: `Pressed ${combo.combo}${refused ? `, but the page did not run ${editCommand}` : ''}.`,
          success: true,
        };
      }
      case 'setViewport': {
        const [, , width, height] = commands[0];
        return { content: `Viewport set to ${width}×${height}.`, success: true };
      }
      case 'scroll': {
        return { content: `Scrolled by ${String(args.dy)}px.`, success: true };
      }
      case 'uploadFile': {
        // agent-browser cannot read the input back; the receipt is what was sent.
        const files = (uploads ?? []).map(({ name, size }) => ({ name, size }));
        const names = files.map((file) => `${file.name} (${file.size} B)`).join(', ');
        return {
          content: `Attached ${names} to the page's file input. The page handles them from here: take a new snapshot to see whether it uploaded them or still needs a confirm/submit click.`,
          state: { files, title, url, via: 'input' },
          success: true,
        };
      }
      case 'screenshot': {
        const bytes = await options.readFile(options.screenshotPath);
        const { height, width } = pngSize(bytes);
        return {
          content: `Screenshot captured (${width}×${height}).`,
          state: { dataUrl: `data:image/png;base64,${toBase64(bytes)}`, height, width },
          success: true,
        };
      }
      default: {
        const content = (str(result(0).content) ?? '').slice(0, READ_PAGE_MAX_CHARS);
        return {
          content: `${pageLabel(title, url)}\n${content}`,
          state: { content, title, url },
          success: true,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: '', error: message, success: false };
  }
};
