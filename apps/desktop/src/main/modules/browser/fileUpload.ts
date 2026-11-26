import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { BrowserUploadedFile } from '@lobechat/electron-client-ipc';
import type { WebContents } from 'electron';

/** More than anyone picks at once; guards against a runaway argument list. */
export const MAX_UPLOAD_FILES = 20;
/** How long a click gets to open the page's file chooser. */
export const FILE_CHOOSER_TIMEOUT_MS = 5000;

type GuestDebugger = WebContents['debugger'];

interface RemoteObject {
  description?: string;
  objectId?: string;
  subtype?: string;
  type: string;
  value?: any;
}

interface FileChooserOpened {
  backendNodeId?: number;
  mode: 'selectMultiple' | 'selectSingle';
}

interface InputState {
  accept?: string;
  disabled: boolean;
  files: BrowserUploadedFile[];
  multiple: boolean;
}

export interface UploadTarget {
  /** Checked absolute paths, see {@link checkUploadPaths}. */
  paths: string[];
  ref?: string;
  selector?: string;
}

export type UploadOutcome =
  | { accept?: string; files: BrowserUploadedFile[]; success: true; via: 'fileChooser' | 'input' }
  | { error: string; manualSelectionRequired?: boolean; success: false };

export interface UploadDeps {
  chooserTimeoutMs?: number;
  /**
   * Clicks the page at CSS coordinates with real input events. A page may only
   * open its file chooser from a user gesture, which `el.click()` is not.
   */
  clickAt: (x: number, y: number) => Promise<void>;
}

const expandHome = (filePath: string) =>
  filePath === '~' || /^~[/\\]/.test(filePath)
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath;

/**
 * Every path must name an existing regular file on this device. A wrong path
 * is reported up front, by name: Chromium would otherwise hand the page an
 * empty or unreadable file and the upload would fail somewhere out of sight.
 */
export const checkUploadPaths = async (
  paths: unknown,
): Promise<{ error: string } | { paths: string[] }> => {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { error: 'paths must list at least one absolute file path' };
  }
  if (paths.length > MAX_UPLOAD_FILES) {
    return { error: `At most ${MAX_UPLOAD_FILES} files can be uploaded at once` };
  }

  const resolved: string[] = [];
  const problems: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.trim()) {
      problems.push(`${JSON.stringify(raw)} is not a path`);
      continue;
    }
    const filePath = expandHome(raw.trim());
    if (!path.isAbsolute(filePath)) {
      problems.push(`${raw} is not an absolute path`);
      continue;
    }
    try {
      const stats = await stat(filePath);
      if (stats.isFile()) resolved.push(path.normalize(filePath));
      else problems.push(`${raw} is not a file`);
    } catch (error) {
      const { code, message } = error as NodeJS.ErrnoException;
      problems.push(`${raw}: ${code === 'ENOENT' ? 'no such file on this device' : message}`);
    }
  }

  if (problems.length > 0) return { error: `Cannot upload: ${problems.join('; ')}` };
  return { paths: resolved };
};

/**
 * Runs in the page: the element a ref or selector names, or the page's only
 * file input when neither is given. A string result is the reason it failed.
 */
export const uploadTargetExpression = (ref?: string, selector?: string) => `((ref, selector) => {
  if (ref) {
    const el = window.__lobeBrowserRefs && window.__lobeBrowserRefs[ref];
    return el && el.isConnected ? el : 'ref not found — take a new snapshot first';
  }
  if (selector) {
    try {
      return document.querySelector(selector) || 'no element matches the selector ' + selector;
    } catch {
      return 'invalid CSS selector: ' + selector;
    }
  }
  const inputs = document.querySelectorAll('input[type="file"]');
  if (inputs.length === 1) return inputs[0];
  return inputs.length === 0
    ? 'this page has no file input; pass the ref of the upload button or drop zone instead'
    : 'this page has ' + inputs.length + ' file inputs; pass the ref of the one to use from a new snapshot';
})(${JSON.stringify(ref ?? '')}, ${JSON.stringify(selector ?? '')})`;

/**
 * Called on the target element: the file input it is, labels, or sits next
 * to. Upload widgets keep a hidden input beside the visible button or drop
 * zone, so a lone input in a near ancestor counts; two or more is ambiguous.
 */
export const FILE_INPUT_OF = `function () {
  const isFileInput = (node) => node instanceof HTMLInputElement && node.type === 'file';
  if (isFileInput(this)) return this;
  if (this instanceof HTMLLabelElement && isFileInput(this.control)) return this.control;
  for (let node = this, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
    const inputs = node.querySelectorAll('input[type="file"]');
    if (inputs.length === 1) return inputs[0];
    if (inputs.length > 1) break;
  }
  return null;
}`;

const READ_INPUT = `function () {
  return {
    accept: this.accept || undefined,
    disabled: this.disabled,
    files: Array.from(this.files || [], (file) => ({ name: file.name, size: file.size })),
    multiple: this.multiple,
  };
}`;

const CENTER_OF = `function () {
  this.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  const r = this.getBoundingClientRect();
  return { height: r.height, width: r.width, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}`;

const send = (dbg: GuestDebugger, method: string, params?: object): Promise<any> =>
  dbg.sendCommand(method, params);

const callOn = async (dbg: GuestDebugger, objectId: string, fn: string, returnByValue = false) => {
  const { exceptionDetails, result } = await send(dbg, 'Runtime.callFunctionOn', {
    functionDeclaration: fn,
    objectId,
    returnByValue,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result as RemoteObject;
};

const readInput = async (dbg: GuestDebugger, objectId: string): Promise<InputState> =>
  (await callOn(dbg, objectId, READ_INPUT, true)).value;

const manual = (reason: string): UploadOutcome => ({
  error: reason,
  manualSelectionRequired: true,
  success: false,
});

const tooManyFiles = (count: number): UploadOutcome => ({
  error: `This file input takes a single file, but ${count} were given; upload one file`,
  success: false,
});

const waitForChooser = (dbg: GuestDebugger, timeoutMs: number) =>
  new Promise<FileChooserOpened | undefined>((resolve) => {
    const onMessage = (_event: unknown, method: string, params: FileChooserOpened) => {
      if (method === 'Page.fileChooserOpened') done(params);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    const done = (opened: FileChooserOpened | undefined) => {
      clearTimeout(timer);
      dbg.removeListener('message', onMessage);
      resolve(opened);
    };
    dbg.on('message', onMessage);
  });

const setOnInput = async (
  dbg: GuestDebugger,
  objectId: string,
  paths: string[],
): Promise<UploadOutcome> => {
  const input = await readInput(dbg, objectId);
  if (input.disabled) return { error: 'The file input is disabled', success: false };
  if (!input.multiple && paths.length > 1) return tooManyFiles(paths.length);

  // Chromium sets the files and fires `input` + `change`, as a real pick does.
  await send(dbg, 'DOM.setFileInputFiles', { files: paths, objectId });
  const after = await readInput(dbg, objectId);
  return { accept: after.accept, files: after.files, success: true, via: 'input' };
};

/**
 * The page has no file input until the click: a script creates one and opens
 * it. With interception on, Chromium reports the chooser's input instead of
 * showing the native dialog, and the files go onto that input.
 */
const uploadThroughChooser = async (
  dbg: GuestDebugger,
  objectId: string,
  paths: string[],
  deps: UploadDeps,
): Promise<UploadOutcome> => {
  const box = (await callOn(dbg, objectId, CENTER_OF, true)).value as {
    height: number;
    width: number;
    x: number;
    y: number;
  };
  if (box.width < 1 || box.height < 1) {
    return {
      error:
        'The element is not a file input and is not visible, so it cannot be clicked to open a file chooser',
      success: false,
    };
  }

  await send(dbg, 'Page.enable');
  await send(dbg, 'Page.setInterceptFileChooserDialog', { enabled: true });
  try {
    const opened = waitForChooser(dbg, deps.chooserTimeoutMs ?? FILE_CHOOSER_TIMEOUT_MS);
    await deps.clickAt(box.x, box.y);
    const chooser = await opened;

    if (!chooser) {
      return manual(
        'The element is not a file input, and clicking it did not open a file chooser. The page may only take files by drag and drop.',
      );
    }
    if (chooser.backendNodeId === undefined) {
      return manual(
        'The page opened a file picker that is not tied to a file input, so files cannot be attached to it.',
      );
    }
    if (chooser.mode === 'selectSingle' && paths.length > 1) return tooManyFiles(paths.length);

    await send(dbg, 'DOM.setFileInputFiles', {
      backendNodeId: chooser.backendNodeId,
      files: paths,
    });
    const { object } = await send(dbg, 'DOM.resolveNode', { backendNodeId: chooser.backendNodeId });
    const after = await readInput(dbg, object.objectId);
    return { accept: after.accept, files: after.files, success: true, via: 'fileChooser' };
  } finally {
    await send(dbg, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }
};

const upload = async (
  dbg: GuestDebugger,
  { paths, ref, selector }: UploadTarget,
  deps: UploadDeps,
): Promise<UploadOutcome> => {
  const { exceptionDetails, result } = await send(dbg, 'Runtime.evaluate', {
    expression: uploadTargetExpression(ref, selector),
  });
  if (exceptionDetails) {
    return {
      error: exceptionDetails.exception?.description ?? exceptionDetails.text,
      success: false,
    };
  }
  const target = result as RemoteObject;
  if (target.type === 'string') return { error: String(target.value), success: false };
  if (!target.objectId || target.subtype !== 'node') {
    return { error: 'The target is not a page element', success: false };
  }

  const input = await callOn(dbg, target.objectId, FILE_INPUT_OF);
  if (input.objectId && input.subtype === 'node') return setOnInput(dbg, input.objectId, paths);
  return uploadThroughChooser(dbg, target.objectId, paths, deps);
};

/**
 * Puts local files into a file input of the guest page through the DevTools
 * protocol (`DOM.setFileInputFiles`), the way choosing them in the file picker
 * would. Works on hidden inputs and on inputs a script only creates when its
 * upload button is clicked. Answers `manualSelectionRequired` when no input
 * can be reached, so the agent asks the user instead of retrying.
 */
export const uploadFilesToGuest = async (
  guest: WebContents,
  target: UploadTarget,
  deps: UploadDeps,
): Promise<UploadOutcome> => {
  const dbg = guest.debugger;
  // Another main-process caller (idle GC, tracing) may hold the debugger; share it then.
  const attachedHere = !dbg.isAttached();
  try {
    if (attachedHere) dbg.attach('1.3');
  } catch (error) {
    return manual(
      `The browser page could not be inspected to reach its file input (${(error as Error).message}).`,
    );
  }

  try {
    return await upload(dbg, target, deps);
  } finally {
    if (attachedHere && dbg.isAttached()) dbg.detach();
  }
};
