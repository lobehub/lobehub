import { execFile, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  GetGitBranchDiffPayload,
  GitAheadBehind,
  GitBranchDiffPatches,
  GitBranchInfo,
  GitBranchListItem,
  GitCheckoutResult,
  GitFileDiffStatus,
  GitLinkedPullRequestResult,
  GitPullResult,
  GitPushResult,
  GitRemoteBranchListItem,
  GitWorkingTreeFiles,
  GitWorkingTreePatch,
  GitWorkingTreePatches,
  GitWorkingTreeStatus,
} from '@lobechat/electron-client-ipc';

import { detectRepoType, resolveGitDir } from '@/utils/git';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:GitCtr');

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
 * starts at a `^diff --git ` line and runs to just before the next one (or
 * EOF). Path comes from the `+++ b/<path>` line, falling back to `--- a/<path>`
 * when the destination is `/dev/null` (deletion). Quoted paths (spaces /
 * non-ASCII when `core.quotepath` is on) are minimally de-escaped.
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
 * line first (covers add/modify); falls back to `--- a/<path>` for deletes
 * where `+++` is `/dev/null`; final fallback is the `diff --git a/x b/y`
 * header line.
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
    // The file headers always come before the first hunk / binary marker;
    // bail once we hit either to avoid scanning huge diff bodies.
    if (line.startsWith('@@') || line.startsWith('Binary files ')) break;
  }
  if (plusPath) return plusPath;
  if (minusPath) return minusPath;
  // Last-resort: parse the `diff --git a/x b/y` header itself.
  const header = block.split('\n', 1)[0];
  const match = /^diff --git a\/.+? b\/(.+)$/.exec(header);
  return match ? match[1] : null;
};

/**
 * Strip the `a/` or `b/` prefix off a `+++` / `---` line, drop the optional
 * trailing tab+timestamp, and de-quote git's C-style escaping. Returns null
 * for `/dev/null` (which means the other side of the diff is the real path).
 */
const parseDiffPathLine = (raw: string, prefix: 'a/' | 'b/'): string | null => {
  const tabIdx = raw.indexOf('\t');
  let p = tabIdx >= 0 ? raw.slice(0, tabIdx) : raw;
  if (p === '/dev/null') return null;
  // Quoted form: "b/path with spaces"
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
 * Inverse of {@link dequoteGitPath} — returns either `<prefix><path>` (when
 * no escaping is needed) or git's C-style quoted form `"<prefix><escaped>"`
 * (when the path contains TAB / LF / CR / quote / backslash / control bytes).
 * The prefix lives *inside* the quotes so the output matches what real `git
 * diff` would emit, e.g. `"a/file\twith tab.txt"` rather than `a/"file\twith
 * tab.txt"`. Plain spaces are not quoted (git tolerates them; the trailing
 * ` b/<path>` marker on the diff header is enough to delimit the source).
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
 * `deleted file mode` → deleted, otherwise modified. Used by branch-diff mode
 * where there's no `git status` to consult — the diff itself is the source.
 */
const detectDiffBlockStatus = (block: string): GitFileDiffStatus => {
  // Only scan up to the first hunk / binary marker so huge bodies aren't walked.
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
 * disk — replaces the per-file `git diff --no-index /dev/null <file>` fork.
 * Binary detection uses a NUL-byte sniff over the first 8 KB (matches what
 * git itself does internally).
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
    logger.debug('[readUntrackedAsPatch] stat failed', {
      filePath: entry.filePath,
      message: error?.message,
    });
    return emptyPatch(entry);
  }
  // Pre-quote so the path is C-style escaped wherever it lands in the synthetic
  // patch — raw `entry.filePath` interpolation would emit malformed `diff --git`
  // / `+++` lines for filenames containing TAB / LF / quote / backslash.
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
  // Cap the synthesized patch by *file* size, not patch size — a 200 KB file
  // produces a ~200 KB patch (one `+` per line). Close enough.
  if (size > maxBytes) {
    return { ...emptyPatch(entry), truncated: true };
  }
  let buf: Buffer;
  try {
    buf = await readFile(absolute);
  } catch (error: any) {
    logger.debug('[readUntrackedAsPatch] read failed', {
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
  // text.split('\n') leaves a trailing '' when the file ends with '\n';
  // exclude it so the hunk header line count matches git's own output.
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
  // Mirror `git diff --no-index`'s "no newline at end of file" footer when the
  // source had no trailing newline — keeps PatchDiff's hunk parser happy.
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
 * fixed-size buffer. Replaces the bulk-diff caller's old 64 MB `maxBuffer`
 * cap — pipe-buffer-sized chunks accumulate in memory until the process
 * exits, with no hard ceiling. SIGTERM on timeout. Resolves with the full
 * stdout string; rejects with an Error carrying `stderr` and `partialStdout`
 * fields so callers can salvage partial output (or fall back) on failure.
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
      // `git diff HEAD` (without --exit-code) exits 0 even when there are
      // diffs; non-zero is therefore a real error.
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
 * Last-resort per-file diff for tracked entries the bulk diff didn't cover —
 * either because the bulk command failed entirely or because git emitted no
 * patch for a path the status step listed (rare race with concurrent writes).
 * Mirrors the original per-file behavior so individual files keep their
 * patches even when the bulk fast-path is unavailable.
 */
const fetchTrackedPatchPerFile = async (
  cwd: string,
  entry: DirtyEntry,
  maxBytes: number,
): Promise<GitWorkingTreePatch> => {
  const execFileAsync = promisify(execFile);
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
    logger.debug('[fetchTrackedPatchPerFile] diff failed', {
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
 * Bounded `Promise.all` — runs at most `limit` async tasks at a time. Used
 * for the per-file fallback so we cap fork pressure at a small constant
 * instead of replaying the original 200-parallel `git diff` storm.
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

export default class GitController extends ControllerModule {
  static override readonly groupName = 'git';

  @IpcMethod()
  async detectRepoType(dirPath: string): Promise<'git' | 'github' | undefined> {
    return detectRepoType(dirPath);
  }

  /**
   * Read current git branch from `.git/HEAD`. Returns short sha on detached HEAD.
   * Handles both standard `.git` directories and `.git` worktree pointer files.
   */
  @IpcMethod()
  async getGitBranch(dirPath: string): Promise<GitBranchInfo> {
    try {
      const gitDir = await resolveGitDir(dirPath);
      if (!gitDir) return {};

      const head = (await readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
      const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      if (refMatch) {
        return { branch: refMatch[1] };
      }
      // Detached HEAD — HEAD file contains the full sha
      if (/^[\da-f]{40}$/i.test(head)) {
        return { branch: head.slice(0, 7), detached: true };
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Query `gh` CLI for an open pull request whose head branch matches `branch`.
   * Returns status = 'gh-missing' when `gh` is not installed / not authenticated,
   * so the UI can render a helpful tooltip instead of an error.
   */
  @IpcMethod()
  async getLinkedPullRequest(payload: {
    branch: string;
    path: string;
  }): Promise<GitLinkedPullRequestResult> {
    const { path: dirPath, branch } = payload;
    if (!branch) {
      return { pullRequest: null, status: 'ok' };
    }

    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr',
          'list',
          '--head',
          branch,
          '--state',
          'open',
          '--limit',
          '5',
          '--json',
          'number,url,title,state',
        ],
        { cwd: dirPath, timeout: 8000 },
      );
      const parsed = JSON.parse(stdout.trim() || '[]') as Array<{
        number: number;
        state: string;
        title: string;
        url: string;
      }>;
      if (parsed.length === 0) {
        return { pullRequest: null, status: 'ok' };
      }
      const [primary, ...rest] = parsed;
      return {
        extraCount: rest.length,
        pullRequest: primary,
        status: 'ok',
      };
    } catch (error: any) {
      const code = error?.code;
      const stderr: string = error?.stderr ?? '';
      // `gh` binary not on PATH
      if (code === 'ENOENT') {
        return { pullRequest: null, status: 'gh-missing' };
      }
      // gh reports auth issues via stderr; treat as a soft-fail
      if (/auth\s+login|not\s+logged\s+in|authentication/i.test(stderr)) {
        return { pullRequest: null, status: 'gh-missing' };
      }
      logger.debug('[getLinkedPullRequest] failed', { branch, code, stderr });
      return { pullRequest: null, status: 'error' };
    }
  }

  /**
   * List local git branches ordered by most recent commit.
   * `current` is true for the checked-out branch.
   */
  @IpcMethod()
  async listGitBranches(dirPath: string): Promise<GitBranchListItem[]> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync(
        'git',
        [
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(HEAD)%09%(refname:short)%09%(upstream:short)',
          'refs/heads',
        ],
        { cwd: dirPath, timeout: 5000 },
      );
      return stdout
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          // Line format: "<HEAD-marker>\t<branch>\t<upstream>" where HEAD-marker is '*' or ' '
          const [head, name, upstream] = line.split('\t');
          return {
            current: head === '*',
            name: name ?? '',
            upstream: upstream || undefined,
          };
        })
        .filter((b) => b.name);
    } catch (error: any) {
      logger.warn('[listGitBranches] git command failed', {
        code: error?.code,
        cwd: dirPath,
        message: error?.message,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      return [];
    }
  }

  /**
   * List remote branches under `refs/remotes/origin/*`, ordered by most
   * recent commit. The `HEAD` symref is filtered out and the resolved
   * default branch is flagged via `isDefault` so the UI can render it
   * with a marker. Used by the Review panel's branch-compare picker.
   */
  @IpcMethod()
  async listGitRemoteBranches(dirPath: string): Promise<GitRemoteBranchListItem[]> {
    const execFileAsync = promisify(execFile);
    let defaultRef: string | undefined;
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: dirPath, timeout: 5000 },
      );
      defaultRef = stdout.trim() || undefined;
    } catch {
      defaultRef = undefined;
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        [
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(refname:short)',
          'refs/remotes/origin',
        ],
        { cwd: dirPath, timeout: 5000 },
      );
      return stdout
        .replaceAll('\r', '')
        .split('\n')
        .map((line) => line.trim())
        .filter((name) => name.length > 0 && name !== 'origin/HEAD' && !name.endsWith('/HEAD'))
        .map((name) => ({ isDefault: name === defaultRef, name }));
    } catch (error: any) {
      logger.warn('[listGitRemoteBranches] git command failed', {
        code: error?.code,
        cwd: dirPath,
        message: error?.message,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      return [];
    }
  }

  /**
   * Bucket dirty files into added / modified / deleted via `git status --porcelain -z`.
   * Each file is counted once: untracked (`??`) and staged-add (`A`) → added,
   * any `D` in index or working tree → deleted, everything else (`M`/`R`/`C`/`T`/`U`) → modified.
   *
   * Uses `-z` so paths are NUL-terminated (no C-style quoting, no `\n` splitting bugs).
   * Rename/copy entries (`R`/`C`) emit two NUL-separated tokens — dest path then source
   * path — so the source token must be consumed to keep counts correct.
   */
  @IpcMethod()
  async getGitWorkingTreeStatus(dirPath: string): Promise<GitWorkingTreeStatus> {
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
        cwd: dirPath,
        timeout: 5000,
      });
      const tokens = stdout.split('\0');
      let added = 0;
      let modified = 0;
      let deleted = 0;
      let i = 0;
      while (i < tokens.length) {
        const entry = tokens[i];
        i++;
        if (entry.length < 2) continue;
        const x = entry[0];
        const y = entry[1];
        // R/C entries carry an extra source-path token we must consume.
        if (x === 'R' || x === 'C') i++;
        if (x === '?' && y === '?') {
          added++;
        } else if (x === '!' && y === '!') {
          // ignored — skip
        } else if (x === 'D' || y === 'D') {
          deleted++;
        } else if (x === 'A' || y === 'A') {
          added++;
        } else {
          modified++;
        }
      }
      const total = added + modified + deleted;
      return { added, clean: total === 0, deleted, modified, total };
    } catch {
      return { added: 0, clean: true, deleted: 0, modified: 0, total: 0 };
    }
  }

  /**
   * Return dirty file paths bucketed into added / modified / deleted.
   * Same classification as getGitWorkingTreeStatus, but with per-file paths.
   *
   * Uses `git status --porcelain -z` so paths are NUL-terminated and never C-quoted,
   * which avoids misparsing filenames that legitimately contain ` -> `, quote chars,
   * or newlines. For R/C entries the two NUL-separated tokens are `DEST\0SRC`; we
   * report DEST (the current working-tree path) and discard SRC.
   */
  @IpcMethod()
  async getGitWorkingTreeFiles(dirPath: string): Promise<GitWorkingTreeFiles> {
    const execFileAsync = promisify(execFile);
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
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
        // R/C entries carry an extra source-path token we must consume.
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
  }

  /**
   * Pull every dirty file's unified diff in one shot — one IPC call returns
   * the patches the renderer needs to render `<PatchDiff />` per file.
   *
   * Tracked changes (modified / deleted / staged-A) all come from a *single*
   * `git diff HEAD --` invocation that we split per-file in JS — fork-bombing
   * the main process with N parallel `git diff` subprocesses was costing us
   * ~5–10ms × N in fork overhead plus `.git/index` lock contention, and the
   * libuv worker pool stayed busy while other IPC handlers queued. One
   * subprocess instead of N keeps the freeze invisible.
   *
   * Untracked files are read directly with `fs.readFile` and a synthetic
   * `--- /dev/null / +++ b/<path>` patch is built in Node — no `git diff`
   * subprocess at all.
   *
   * Per-file patches are capped at 256 KB; oversized or binary entries get an
   * empty `patch` string and a flag the renderer can use for a placeholder.
   */
  @IpcMethod()
  async getGitWorkingTreePatches(dirPath: string): Promise<GitWorkingTreePatches> {
    const MAX_PATCH_BYTES = 256 * 1024;
    const execFileAsync = promisify(execFile);

    interface Entry {
      filePath: string;
      isUntracked: boolean;
      status: GitFileDiffStatus;
    }

    // Step 1 — classify every dirty path. Mirrors getGitWorkingTreeFiles but
    // also distinguishes untracked (`??`) from staged-add (`A`) so we can pick
    // the right path (git diff vs raw read) per entry.
    const entries: Entry[] = [];
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
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
        // R/C entries carry an extra source-path token we must consume.
        if (x === 'R' || x === 'C') i++;
        if (!filePath) continue;
        if (x === '?' && y === '?') {
          entries.push({ filePath, isUntracked: true, status: 'added' });
        } else if (x === '!' && y === '!') {
          // ignored
        } else if (x === 'D' || y === 'D') {
          entries.push({ filePath, isUntracked: false, status: 'deleted' });
        } else if (x === 'A' || y === 'A') {
          entries.push({ filePath, isUntracked: false, status: 'added' });
        } else {
          entries.push({ filePath, isUntracked: false, status: 'modified' });
        }
      }
    } catch (error: any) {
      logger.warn('[getGitWorkingTreePatches] status failed', {
        cwd: dirPath,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      return { patches: [] };
    }

    // Step 2a — single bulk `git diff HEAD` for every tracked dirty path,
    // then split per-file in JS. We pass paths explicitly (not all) so a
    // huge unrelated working tree doesn't pull extra patches into the
    // stream. Output is streamed via spawn so there's no maxBuffer ceiling
    // — even a multi-hundred-MB combined diff lands intact, and any partial
    // output recovered from a failed run still feeds the per-file fallback.
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
        logger.warn('[getGitWorkingTreePatches] bulk diff failed; per-file fallback', {
          cwd: dirPath,
          stderr: error?.stderr?.toString?.() ?? error?.stderr,
        });
        // Salvage any patches that did stream through before the failure —
        // the per-file fallback below only retries the stragglers.
        if (typeof error?.partialStdout === 'string') bulkDiff = error.partialStdout;
      }
      for (const block of splitBulkDiff(bulkDiff)) {
        const entry = trackedByPath.get(block.path);
        if (!entry) continue;
        trackedPatches.set(entry.filePath, buildTrackedPatch(entry, block, MAX_PATCH_BYTES));
      }
      // Anything the bulk diff didn't cover (bulk crashed, race-with-write,
      // or git emitted no patch for a path status flagged dirty) gets a
      // per-file retry. Concurrency-capped to avoid the original fork storm.
      const stragglers = trackedEntries.filter((e) => !trackedPatches.has(e.filePath));
      if (stragglers.length > 0) {
        const recovered = await mapWithConcurrency(stragglers, 8, (entry) =>
          fetchTrackedPatchPerFile(dirPath, entry, MAX_PATCH_BYTES),
        );
        for (const patch of recovered) trackedPatches.set(patch.filePath, patch);
      }
    }

    // Step 2b — read untracked files directly in Node. fs.readFile is bounded
    // by libuv's thread pool (4 by default) so unbounded Promise.all is fine.
    const untrackedEntries = entries.filter((e) => e.isUntracked);
    const untrackedPatches = await Promise.all(
      untrackedEntries.map((entry) => readUntrackedAsPatch(dirPath, entry, MAX_PATCH_BYTES)),
    );

    // Step 3 — combine + sort to match the working-tree popover order.
    const order: Record<GitFileDiffStatus, number> = { added: 0, modified: 1, deleted: 2 };
    const allPatches: GitWorkingTreePatch[] = [...trackedPatches.values(), ...untrackedPatches];
    allPatches.sort((a, b) => order[a.status] - order[b.status]);

    return { patches: allPatches };
  }

  /**
   * Diff every changed file between the current HEAD and the remote default
   * branch (resolved via `refs/remotes/origin/HEAD` — typically `origin/main`
   * or `origin/canary`). Uses `<base>...HEAD` so the result is "what this
   * branch added since it forked", ignoring upstream-only commits.
   *
   * Best-effort `git fetch` first so the comparison reflects the latest
   * remote state; fetch failures (offline / no creds / no `origin`) are
   * swallowed and we fall back to whatever cached refs exist. Returns
   * `baseRef: undefined` + empty patches when no remote default is set —
   * the renderer surfaces a "noBaseRef" hint in that case.
   *
   * Patch parsing reuses the same bulk-split + size-cap path as the working
   * tree variant; status comes from each diff block's preamble (no `git
   * status` cross-reference needed since every block is from history).
   */
  @IpcMethod()
  async getGitBranchDiff(payload: GetGitBranchDiffPayload): Promise<GitBranchDiffPatches> {
    const { path: dirPath, baseRef: baseRefOverride } = payload;
    const MAX_PATCH_BYTES = 256 * 1024;
    const execFileAsync = promisify(execFile);

    // Step 1 — best-effort fetch so origin/<default> reflects remote HEAD.
    try {
      await execFileAsync('git', ['fetch', '--no-tags', '--quiet', 'origin'], {
        cwd: dirPath,
        timeout: 10_000,
      });
    } catch {
      // swallow — fall through to cached refs
    }

    // Step 2 — pick the comparison base. When the caller passes an explicit
    // override (e.g. user picked a non-default branch in the UI) we trust it;
    // otherwise we resolve `refs/remotes/origin/HEAD`. The default may be
    // missing on repos cloned with --no-checkout or after a remote rename —
    // surface a "noBaseRef" empty state in that case so the user can run
    // `git remote set-head origin --auto` themselves.
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

    // headRef populated even when baseRef is missing so the UI can still
    // surface "fix/foo ← ?" instead of going completely blank.
    const headRef = (await this.getGitBranch(dirPath)).branch;

    if (!baseRef) {
      return { headRef, patches: [] };
    }

    // Step 3 — single bulk diff against the merge base. Three-dot semantics
    // (`base...HEAD`) ignore commits added to base after the branch forked,
    // matching what users expect from "compare branch" UI on GitHub. Stream
    // capture mirrors the working-tree path so multi-MB diffs land intact.
    let bulkDiff = '';
    try {
      bulkDiff = await runGitCaptureStream(
        dirPath,
        ['-c', 'core.quotepath=off', 'diff', '--no-color', `${baseRef}...HEAD`],
        30_000,
      );
    } catch (error: any) {
      logger.warn('[getGitBranchDiff] diff failed', {
        baseRef,
        cwd: dirPath,
        stderr: error?.stderr?.toString?.() ?? error?.stderr,
      });
      if (typeof error?.partialStdout === 'string') bulkDiff = error.partialStdout;
    }

    // Step 4 — split + classify per-file from the diff preamble alone.
    const patches: GitWorkingTreePatch[] = [];
    for (const block of splitBulkDiff(bulkDiff)) {
      const status = detectDiffBlockStatus(block.patch);
      patches.push(buildTrackedPatch({ filePath: block.path, status }, block, MAX_PATCH_BYTES));
    }

    const order: Record<GitFileDiffStatus, number> = { added: 0, modified: 1, deleted: 2 };
    patches.sort((a, b) => order[a.status] - order[b.status]);

    return { baseRef, headRef, patches };
  }

  /**
   * Count commits HEAD is ahead/behind its upstream tracking ref.
   * Returns `hasUpstream: false` when the branch has no upstream configured
   * (e.g. local-only branches, or after the remote branch is deleted).
   *
   * Does a best-effort `git fetch` first so the result reflects what's
   * actually on the remote — the renderer calls this via SWR with
   * `revalidateOnFocus`, so the fetch piggybacks on window re-focus. Fetch
   * failures (offline, no credentials, no `origin` remote) are swallowed so
   * we still return whatever can be computed against the cached refs.
   */
  @IpcMethod()
  async getGitAheadBehind(dirPath: string): Promise<GitAheadBehind> {
    const execFileAsync = promisify(execFile);
    try {
      await execFileAsync('git', ['fetch', '--no-tags', '--quiet', 'origin'], {
        cwd: dirPath,
        timeout: 10_000,
      });
    } catch {
      // swallow — fall through to compute against cached refs
    }
    try {
      const { stdout: upstreamOut } = await execFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        { cwd: dirPath, timeout: 5000 },
      );
      const upstream = upstreamOut.trim();
      if (!upstream) return { ahead: 0, behind: 0, hasUpstream: false };

      const { stdout } = await execFileAsync(
        'git',
        ['rev-list', '--left-right', '--count', `${upstream}...HEAD`],
        { cwd: dirPath, timeout: 5000 },
      );
      const [behindStr, aheadStr] = stdout.trim().split(/\s+/);
      const behind = Number.parseInt(behindStr ?? '0', 10) || 0;
      const ahead = Number.parseInt(aheadStr ?? '0', 10) || 0;

      // `git push -u origin HEAD` always targets origin/<current-branch-name>,
      // which may differ from upstream (the branched-off-canary case).
      let pushTarget: string | undefined;
      let pushTargetExists = false;
      try {
        const { stdout: branchOut } = await execFileAsync(
          'git',
          ['symbolic-ref', '--short', 'HEAD'],
          { cwd: dirPath, timeout: 5000 },
        );
        const branch = branchOut.trim();
        if (branch) {
          pushTarget = `origin/${branch}`;
          try {
            await execFileAsync(
              'git',
              ['rev-parse', '--verify', '--quiet', `refs/remotes/${pushTarget}`],
              { cwd: dirPath, timeout: 5000 },
            );
            pushTargetExists = true;
          } catch {
            pushTargetExists = false;
          }
        }
      } catch {
        // detached HEAD — leave pushTarget undefined
      }

      return { ahead, behind, hasUpstream: true, pushTarget, pushTargetExists, upstream };
    } catch {
      // No upstream configured, detached HEAD, or git error — all treated as "no upstream"
      return { ahead: 0, behind: 0, hasUpstream: false };
    }
  }

  /**
   * Check out (or create + check out) a branch.
   * Relies on git itself to reject unsafe checkouts (dirty tree, non-fast-forward, etc.)
   * and surfaces git's stderr so the UI can display a meaningful error.
   */
  @IpcMethod()
  async checkoutGitBranch(payload: {
    branch: string;
    create?: boolean;
    path: string;
  }): Promise<GitCheckoutResult> {
    const { path: dirPath, branch, create } = payload;
    if (!branch?.trim()) {
      return { error: 'Branch name is required', success: false };
    }
    // Reject obviously invalid refs early to avoid a confusing git error
    if (/[\s~^:?*[\\]/.test(branch) || branch.startsWith('-') || branch.includes('..')) {
      return { error: `Invalid branch name: ${branch}`, success: false };
    }

    const execFileAsync = promisify(execFile);
    const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
    try {
      await execFileAsync('git', args, { cwd: dirPath, timeout: 10_000 });
      return { success: true };
    } catch (error: any) {
      const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
      logger.debug('[checkoutGitBranch] failed', { args, stderr });
      return { error: stderr || 'git checkout failed', success: false };
    }
  }

  /**
   * Pull the current branch's upstream via fast-forward only.
   *
   * `--ff-only` avoids creating accidental merge commits when the local branch
   * has diverged — in that case the user should resolve merge/rebase in their
   * own terminal. For the common "just behind" case this is a safe one-click.
   */
  @IpcMethod()
  async pullGitBranch(payload: { path: string }): Promise<GitPullResult> {
    const { path: dirPath } = payload;
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('git', ['pull', '--ff-only'], {
        cwd: dirPath,
        timeout: 60_000,
      });
      const noop = /Already up to date/i.test(stdout);
      return { noop, success: true };
    } catch (error: any) {
      const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
      logger.debug('[pullGitBranch] failed', { stderr });
      return { error: stderr || 'git pull failed', success: false };
    }
  }

  /**
   * Push the current branch to its same-named remote on `origin`.
   *
   * Uses `git push -u origin HEAD` instead of plain `git push` so the action
   * works even when local branch name differs from the configured upstream
   */
  @IpcMethod()
  async pushGitBranch(payload: { path: string }): Promise<GitPushResult> {
    const { path: dirPath } = payload;
    const execFileAsync = promisify(execFile);
    try {
      const { stderr } = await execFileAsync('git', ['push', '-u', 'origin', 'HEAD'], {
        cwd: dirPath,
        timeout: 60_000,
      });
      // git push writes progress/status to stderr even on success
      const noop = /Everything up-to-date/i.test(stderr);
      return { noop, success: true };
    } catch (error: any) {
      const stderr: string = (error?.stderr ?? error?.message ?? '').toString().trim();
      logger.debug('[pushGitBranch] failed', { stderr });
      return { error: stderr || 'git push failed', success: false };
    }
  }
}
