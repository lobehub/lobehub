import { execFile, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { createLogger } from '../logger';
import { getGitBranch } from './info';
import type {
  GitBranchDiffPatches,
  GitFileDiffStatus,
  GitWorkingTreeFiles,
  GitWorkingTreePatch,
  GitWorkingTreePatches,
  SubmoduleWorkingTreePatches,
} from './types';

const log = createLogger('local-file-shell:git');
const execFileAsync = promisify(execFile);

const MAX_PATCH_BYTES = 256 * 1024;

interface DirtyEntry {
  filePath: string;
  status: GitFileDiffStatus;
}

interface DiffBlock {
  isBinary: boolean;
  patch: string;
  /** Destination path (or source path for deleted files). */
  path: string;
}

/**
 * Split the output of `git diff HEAD --` into one block per file. Each block
 * starts at a `^diff --git ` line and runs to just before the next one (or EOF).
 */
const splitBulkDiff = (diffText: string): DiffBlock[] => {
  if (!diffText) return [];
  const blocks: DiffBlock[] = [];
  const headerRe = /^diff --git /gm;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(diffText)) !== null) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : diffText.length;
    const block = diffText.slice(start, end);
    const filePath = extractPathFromDiffBlock(block);
    if (!filePath) continue;
    blocks.push({
      isBinary: /^Binary files .* differ$/m.test(block),
      path: filePath,
      patch: block,
    });
  }
  return blocks;
};

/**
 * Pull the file path out of a per-file diff block. Looks at the `+++ b/<path>`
 * line first; falls back to `--- a/<path>` for deletes; final fallback is the
 * `diff --git a/x b/y` header line.
 */
const extractPathFromDiffBlock = (block: string): string | null => {
  let plusPath: string | null = null;
  let minusPath: string | null = null;
  for (const line of block.split('\n')) {
    if (line.startsWith('+++ ')) {
      plusPath = parseDiffPathLine(line.slice(4), 'b/');
    } else if (line.startsWith('--- ')) {
      minusPath = parseDiffPathLine(line.slice(4), 'a/');
    }
    // The file headers always come before the first hunk / binary marker.
    if (line.startsWith('@@') || line.startsWith('Binary files ')) break;
  }
  if (plusPath) return plusPath;
  if (minusPath) return minusPath;
  const header = block.split('\n', 1)[0];
  const match = /^diff --git a\/.+? b\/(.+)$/.exec(header);
  return match ? match[1] : null;
};

/**
 * Strip the `a/` or `b/` prefix off a `+++` / `---` line, drop the optional
 * trailing tab+timestamp, and de-quote git's C-style escaping. Returns null for
 * `/dev/null`.
 */
const parseDiffPathLine = (raw: string, prefix: 'a/' | 'b/'): string | null => {
  const tabIdx = raw.indexOf('\t');
  let p = tabIdx >= 0 ? raw.slice(0, tabIdx) : raw;
  if (p === '/dev/null') return null;
  if (p.startsWith('"') && p.endsWith('"')) {
    p = dequoteGitPath(p.slice(1, -1));
  }
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
};

export const dequoteGitPath = (s: string): string =>
  s.replaceAll(/\\(["\\trn]|[0-7]{3})/g, (_, esc: string) => {
    if (esc === '"') return '"';
    if (esc === '\\') return '\\';
    if (esc === 't') return '\t';
    if (esc === 'r') return '\r';
    if (esc === 'n') return '\n';
    return String.fromCodePoint(Number.parseInt(esc, 8));
  });

/**
 * Inverse of {@link dequoteGitPath} — returns either `<prefix><path>` (when no
 * escaping is needed) or git's C-style quoted form `"<prefix><escaped>"`. The
 * prefix lives inside the quotes so the output matches real `git diff`. Plain
 * spaces are not quoted.
 */
// eslint-disable-next-line no-control-regex
const NEEDS_QUOTING = /["\\\x00-\x1F\x7F]/;
export const quoteGitPath = (prefix: 'a/' | 'b/', filePath: string): string => {
  const combined = prefix + filePath;
  if (!NEEDS_QUOTING.test(combined)) return combined;
  let out = '"';
  for (const ch of combined) {
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else {
      const code = ch.codePointAt(0)!;
      if (code < 0x20 || code === 0x7f) {
        out += '\\' + code.toString(8).padStart(3, '0');
      } else {
        out += ch;
      }
    }
  }
  return out + '"';
};

/**
 * Status from a single diff block's preamble: `new file mode` → added,
 * `deleted file mode` → deleted, otherwise modified.
 */
const detectDiffBlockStatus = (block: string): GitFileDiffStatus => {
  for (const line of block.split('\n')) {
    if (line.startsWith('new file mode ')) return 'added';
    if (line.startsWith('deleted file mode ')) return 'deleted';
    if (line.startsWith('@@') || line.startsWith('Binary files ')) break;
  }
  return 'modified';
};

/** Walk a patch counting `+`/`-` lines while skipping `+++`/`---` headers. */
const countAddDel = (patch: string): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
};

const emptyPatch = (entry: DirtyEntry): GitWorkingTreePatch => ({
  additions: 0,
  deletions: 0,
  filePath: entry.filePath,
  isBinary: false,
  patch: '',
  status: entry.status,
  truncated: false,
});

const buildTrackedPatch = (
  entry: DirtyEntry,
  block: DiffBlock,
  maxBytes: number,
): GitWorkingTreePatch => {
  if (block.isBinary) {
    return { ...emptyPatch(entry), isBinary: true };
  }
  if (block.patch.length > maxBytes) {
    return { ...emptyPatch(entry), truncated: true };
  }
  const { additions, deletions } = countAddDel(block.patch);
  return {
    additions,
    deletions,
    filePath: entry.filePath,
    isBinary: false,
    patch: block.patch,
    status: entry.status,
    truncated: false,
  };
};

/**
 * Build a synthetic add-only patch for an untracked file by reading it from
 * disk. Binary detection uses a NUL-byte sniff over the first 8 KB.
 */
const readUntrackedAsPatch = async (
  cwd: string,
  entry: DirtyEntry,
  maxBytes: number,
): Promise<GitWorkingTreePatch> => {
  const absolute = path.resolve(cwd, entry.filePath);
  let size: number;
  try {
    const s = await stat(absolute);
    if (!s.isFile()) return emptyPatch(entry);
    size = s.size;
  } catch (error: any) {
    log.debug('[readUntrackedAsPatch] stat failed', {
      filePath: entry.filePath,
      message: error?.message,
    });
    return emptyPatch(entry);
  }
  const aPath = quoteGitPath('a/', entry.filePath);
  const bPath = quoteGitPath('b/', entry.filePath);
  if (size === 0) {
    return {
      ...emptyPatch(entry),
      patch:
        [
          `diff --git ${aPath} ${bPath}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ ${bPath}`,
        ].join('\n') + '\n',
    };
  }
  if (size > maxBytes) {
    return { ...emptyPatch(entry), truncated: true };
  }
  let buf: Buffer;
  try {
    buf = await readFile(absolute);
  } catch (error: any) {
    log.debug('[readUntrackedAsPatch] read failed', {
      filePath: entry.filePath,
      message: error?.message,
    });
    return emptyPatch(entry);
  }
  const sniffEnd = Math.min(buf.length, 8192);
  for (let i = 0; i < sniffEnd; i++) {
    if (buf[i] === 0) return { ...emptyPatch(entry), isBinary: true };
  }
  const text = buf.toString('utf8');
  const rawLines = text.split('\n');
  const trailingEmpty = rawLines.length > 0 && rawLines.at(-1) === '';
  const lineCount = trailingEmpty ? rawLines.length - 1 : rawLines.length;
  if (lineCount === 0) {
    return { ...emptyPatch(entry), patch: '' };
  }
  const body = rawLines
    .slice(0, lineCount)
    .map((line) => '+' + line)
    .join('\n');
  const noNewlineFooter = trailingEmpty ? '' : '\n\\ No newline at end of file';
  const patch =
    [
      `diff --git ${aPath} ${bPath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ ${bPath}`,
      `@@ -0,0 +1,${lineCount} @@`,
      body,
    ].join('\n') +
    noNewlineFooter +
    '\n';
  return {
    additions: lineCount,
    deletions: 0,
    filePath: entry.filePath,
    isBinary: false,
    patch,
    status: entry.status,
    truncated: false,
  };
};

/**
 * Stream a git invocation's stdout via `spawn` instead of `execFile`'s
 * fixed-size buffer. Resolves with the full stdout string; rejects with an Error
 * carrying `stderr` and `partialStdout` fields so callers can salvage partial
 * output (or fall back) on failure.
 */
const runGitCaptureStream = (cwd: string, args: string[], timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    const stdoutChunks: Buffer[] = [];
    let stderrBuf = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(Object.assign(err, { stderr: stderrBuf }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      if (timedOut) {
        const err: any = new Error('git command timed out');
        err.stderr = stderrBuf;
        err.partialStdout = stdout;
        return reject(err);
      }
      if (code !== 0) {
        const err: any = new Error(`git exited with code ${code}`);
        err.code = code;
        err.stderr = stderrBuf;
        err.partialStdout = stdout;
        return reject(err);
      }
      resolve(stdout);
    });
  });

/**
 * Last-resort per-file diff for tracked entries the bulk diff didn't cover.
 */
const fetchTrackedPatchPerFile = async (
  cwd: string,
  entry: DirtyEntry,
  maxBytes: number,
): Promise<GitWorkingTreePatch> => {
  let text: string;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'core.quotepath=off', 'diff', '--no-color', 'HEAD', '--', entry.filePath],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: maxBytes * 4,
        timeout: 10_000,
      },
    );
    text = stdout as string;
  } catch (error: any) {
    log.debug('[fetchTrackedPatchPerFile] diff failed', {
      filePath: entry.filePath,
      stderr: error?.stderr?.toString?.() ?? error?.stderr,
    });
    return emptyPatch(entry);
  }
  if (text.length > maxBytes) return { ...emptyPatch(entry), truncated: true };
  if (/^Binary files .* differ$/m.test(text)) return { ...emptyPatch(entry), isBinary: true };
  if (!text) return emptyPatch(entry);
  const { additions, deletions } = countAddDel(text);
  return {
    additions,
    deletions,
    filePath: entry.filePath,
    isBinary: false,
    patch: text,
    status: entry.status,
    truncated: false,
  };
};

/**
 * Bounded `Promise.all` — runs at most `limit` async tasks at a time.
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = Array.from({ length: items.length });
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx]);
      }
    }),
  );
  return results;
};

/**
 * List paths of initialized submodules registered in `dirPath`. Uninitialized
 * entries (`-` prefix) are skipped. Only direct submodules are listed.
 */
const listSubmodulePaths = async (dirPath: string): Promise<Set<string>> => {
  try {
    const { stdout } = await execFileAsync('git', ['submodule', 'status'], {
      cwd: dirPath,
      timeout: 5000,
    });
    const paths = new Set<string>();
    for (const line of stdout.split('\n')) {
      if (line.length < 2) continue;
      if (line[0] === '-') continue;
      const rest = line.slice(1);
      const firstSpace = rest.indexOf(' ');
      if (firstSpace < 0) continue;
      const sha = rest.slice(0, firstSpace);
      if (!/^[\da-f]{7,40}$/.test(sha)) continue;
      let p = rest.slice(firstSpace + 1);
      if (p.endsWith(')')) {
        const describeStart = p.lastIndexOf(' (');
        if (describeStart > 0) p = p.slice(0, describeStart);
      }
      if (p) paths.add(p);
    }
    return paths;
  } catch (error: any) {
    log.debug('[listSubmodulePaths] failed', {
      cwd: dirPath,
      stderr: error?.stderr?.toString?.() ?? error?.stderr,
    });
    return new Set();
  }
};

/**
 * Return dirty file paths bucketed into added / modified / deleted. Uses
 * `git status --porcelain -z` so paths are NUL-terminated and never C-quoted.
 */
export const getGitWorkingTreeFiles = async (dirPath: string): Promise<GitWorkingTreeFiles> => {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-u', '-z'], {
      cwd: dirPath,
      timeout: 5000,
    });
    const tokens = stdout.split('\0');
    let i = 0;
    while (i < tokens.length) {
      const entry = tokens[i];
      i++;
      if (entry.length < 3) continue;
      const x = entry[0];
      const y = entry[1];
      const filePath = entry.slice(3);
      if (x === 'R' || x === 'C') i++;
      if (!filePath) continue;
      if (x === '?' && y === '?') {
        added.push(filePath);
      } else if (x === '!' && y === '!') {
        // ignored — skip
      } else if (x === 'D' || y === 'D') {
        deleted.push(filePath);
      } else if (x === 'A' || y === 'A') {
        added.push(filePath);
      } else {
        modified.push(filePath);
      }
    }
    return { added, deleted, modified };
  } catch {
    return { added: [], deleted: [], modified: [] };
  }
};

interface PatchEntry {
  filePath: string;
  isUntracked: boolean;
  status: GitFileDiffStatus;
}

/**
 * Shared implementation for working-tree patch collection. The public entry
 * passes `recurseSubmodules: true`; recursive calls into each submodule pass
 * `false` to avoid traversing nested submodules.
 */
const collectWorkingTreePatches = async (
  dirPath: string,
  recurseSubmodules: boolean,
): Promise<GitWorkingTreePatches> => {
  const submodulePaths = recurseSubmodules ? await listSubmodulePaths(dirPath) : new Set<string>();

  const entries: PatchEntry[] = [];
  const submoduleDirtyEntries: PatchEntry[] = [];
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-u', '-z'], {
      cwd: dirPath,
      timeout: 5000,
    });
    const tokens = stdout.split('\0');
    let i = 0;
    while (i < tokens.length) {
      const entry = tokens[i];
      i++;
      if (entry.length < 3) continue;
      const x = entry[0];
      const y = entry[1];
      const filePath = entry.slice(3);
      if (x === 'R' || x === 'C') i++;
      if (!filePath) continue;
      let parsed: PatchEntry | null = null;
      if (x === '?' && y === '?') {
        parsed = { filePath, isUntracked: true, status: 'added' };
      } else if (x === '!' && y === '!') {
        // ignored
      } else if (x === 'D' || y === 'D') {
        parsed = { filePath, isUntracked: false, status: 'deleted' };
      } else if (x === 'A' || y === 'A') {
        parsed = { filePath, isUntracked: false, status: 'added' };
      } else {
        parsed = { filePath, isUntracked: false, status: 'modified' };
      }
      if (!parsed) continue;
      if (submodulePaths.has(filePath)) {
        submoduleDirtyEntries.push(parsed);
      } else {
        entries.push(parsed);
      }
    }
  } catch (error: any) {
    log.warn('[collectWorkingTreePatches] status failed', {
      cwd: dirPath,
      stderr: error?.stderr?.toString?.() ?? error?.stderr,
    });
    return { patches: [] };
  }

  const trackedEntries = entries.filter((e) => !e.isUntracked);
  const trackedByPath = new Map(trackedEntries.map((e) => [e.filePath, e]));
  const trackedPatches = new Map<string, GitWorkingTreePatch>();
  if (trackedEntries.length > 0) {
    let bulkDiff = '';
    try {
      bulkDiff = await runGitCaptureStream(
        dirPath,
        [
          '-c',
          'core.quotepath=off',
          'diff',
          '--no-color',
          'HEAD',
          '--',
          ...trackedEntries.map((e) => e.filePath),
        ],
        30_000,
      );
    } catch (error: any) {
      log.warn('[collectWorkingTreePatches] bulk diff failed; per-file fallback', {
        cwd: dirPath,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      if (typeof error?.partialStdout === 'string') bulkDiff = error.partialStdout;
    }
    for (const block of splitBulkDiff(bulkDiff)) {
      const entry = trackedByPath.get(block.path);
      if (!entry) continue;
      trackedPatches.set(entry.filePath, buildTrackedPatch(entry, block, MAX_PATCH_BYTES));
    }
    const stragglers = trackedEntries.filter((e) => !trackedPatches.has(e.filePath));
    if (stragglers.length > 0) {
      const recovered = await mapWithConcurrency(stragglers, 8, (entry) =>
        fetchTrackedPatchPerFile(dirPath, entry, MAX_PATCH_BYTES),
      );
      for (const patch of recovered) trackedPatches.set(patch.filePath, patch);
    }
  }

  const untrackedEntries = entries.filter((e) => e.isUntracked);
  const untrackedPatches = await Promise.all(
    untrackedEntries.map((entry) => readUntrackedAsPatch(dirPath, entry, MAX_PATCH_BYTES)),
  );

  const order: Record<GitFileDiffStatus, number> = { added: 0, modified: 1, deleted: 2 };
  const allPatches: GitWorkingTreePatch[] = [...trackedPatches.values(), ...untrackedPatches];
  allPatches.sort((a, b) => order[a.status] - order[b.status]);

  let submodules: SubmoduleWorkingTreePatches[] | undefined;
  if (submoduleDirtyEntries.length > 0) {
    submodules = await Promise.all(
      submoduleDirtyEntries.map(async (entry) => {
        const absolutePath = path.resolve(dirPath, entry.filePath);
        const [sub, branchInfo] = await Promise.all([
          collectWorkingTreePatches(absolutePath, false),
          getGitBranch(absolutePath),
        ]);
        return {
          absolutePath,
          branch: branchInfo.branch,
          detached: branchInfo.detached,
          name: path.basename(entry.filePath),
          patches: sub.patches,
          relativePath: entry.filePath,
        };
      }),
    );
  }

  return { patches: allPatches, submodules };
};

/**
 * Pull every dirty file's unified diff in one shot. Tracked changes come from a
 * single `git diff HEAD --` invocation split per-file in JS; untracked files are
 * read directly with `fs.readFile`. Per-file patches are capped at 256 KB.
 * Dirty submodules are surfaced as grouped `submodules[]` entries.
 */
export const getGitWorkingTreePatches = (dirPath: string): Promise<GitWorkingTreePatches> =>
  collectWorkingTreePatches(dirPath, true);

/**
 * Shared implementation for branch-diff collection. Each submodule's base ref is
 * resolved independently.
 */
const collectBranchDiff = async (
  dirPath: string,
  baseRefOverride: string | undefined,
  recurseSubmodules: boolean,
): Promise<GitBranchDiffPatches> => {
  // Step 1 — best-effort fetch so origin/<default> reflects remote HEAD.
  try {
    await execFileAsync('git', ['fetch', '--no-tags', '--quiet', 'origin'], {
      cwd: dirPath,
      timeout: 10_000,
    });
  } catch {
    // swallow — fall through to cached refs
  }

  // Step 2 — pick the comparison base.
  let baseRef: string | undefined = baseRefOverride;
  if (!baseRef) {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: dirPath, timeout: 5000 },
      );
      baseRef = stdout.trim() || undefined;
    } catch {
      baseRef = undefined;
    }
  }

  const headRef = (await getGitBranch(dirPath)).branch;

  if (!baseRef) {
    return { headRef, patches: [] };
  }

  // Step 3 — single bulk diff against the merge base (`base...HEAD`).
  let bulkDiff = '';
  try {
    bulkDiff = await runGitCaptureStream(
      dirPath,
      ['-c', 'core.quotepath=off', 'diff', '--no-color', `${baseRef}...HEAD`],
      30_000,
    );
  } catch (error: any) {
    log.warn('[collectBranchDiff] diff failed', {
      baseRef,
      cwd: dirPath,
      stderr: error?.stderr?.toString?.() ?? error?.stderr,
    });
    if (typeof error?.partialStdout === 'string') bulkDiff = error.partialStdout;
  }

  // Step 4 — split per-file, peeling out submodule pointer bumps.
  const submodulePaths = recurseSubmodules ? await listSubmodulePaths(dirPath) : new Set<string>();
  const patches: GitWorkingTreePatch[] = [];
  const pointerBumpPaths = new Set<string>();
  for (const block of splitBulkDiff(bulkDiff)) {
    if (submodulePaths.has(block.path)) {
      pointerBumpPaths.add(block.path);
      continue;
    }
    const status = detectDiffBlockStatus(block.patch);
    patches.push(buildTrackedPatch({ filePath: block.path, status }, block, MAX_PATCH_BYTES));
  }

  const order: Record<GitFileDiffStatus, number> = { added: 0, modified: 1, deleted: 2 };
  patches.sort((a, b) => order[a.status] - order[b.status]);

  // Step 5 — recurse for EVERY registered submodule (single-level only).
  let submodules: SubmoduleWorkingTreePatches[] | undefined;
  if (submodulePaths.size > 0) {
    const candidates = await Promise.all(
      Array.from(submodulePaths).map(async (relativePath) => {
        const absolutePath = path.resolve(dirPath, relativePath);
        const [sub, branchInfo] = await Promise.all([
          collectBranchDiff(absolutePath, undefined, false),
          getGitBranch(absolutePath),
        ]);
        return {
          group: {
            absolutePath,
            branch: branchInfo.branch,
            detached: branchInfo.detached,
            name: path.basename(relativePath),
            patches: sub.patches,
            relativePath,
          },
          keep: pointerBumpPaths.has(relativePath) || sub.patches.length > 0,
        };
      }),
    );
    const filtered = candidates.filter((c) => c.keep).map((c) => c.group);
    if (filtered.length > 0) submodules = filtered;
  }

  return { baseRef, headRef, patches, submodules };
};

/**
 * Diff every changed file between the current HEAD and the remote default branch
 * (resolved via `refs/remotes/origin/HEAD`, or an explicit `baseRef` override).
 * Uses `<base>...HEAD` three-dot semantics. Best-effort `git fetch` first.
 */
export const getGitBranchDiff = (payload: {
  baseRef?: string;
  path: string;
}): Promise<GitBranchDiffPatches> => collectBranchDiff(payload.path, payload.baseRef, true);
