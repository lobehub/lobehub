import debug from 'debug';

const log = debug('lobe-chat:module:github');

export interface GitHubRepoInfo {
  branch: string;
  owner: string;
  /**
   * Subdirectory path within the repository (e.g., 'skills/skill-creator')
   * Extracted from URLs like: https://github.com/owner/repo/tree/branch/path/to/dir
   */
  path?: string;
  repo: string;
}

export interface GitHubRawFileInfo extends GitHubRepoInfo {
  filePath: string;
}

/**
 * A single blob (file) entry within a repository subtree.
 * `path` is repository-relative (e.g. `skills/ppt-master/SKILL.md`).
 */
export interface GitHubTreeFile {
  path: string;
  size?: number;
}

/**
 * Strip leading and trailing slashes from a path segment.
 *
 * Linear scan instead of a regex like `/^\/+|\/+$/g`: the path originates from a
 * user-supplied GitHub URL, and the regex variant is polynomial-time on inputs
 * with many repeated slashes (ReDoS, flagged by CodeQL).
 */
export const stripSlashes = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 47 /* '/' */) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return value.slice(start, end);
};

export class GitHub {
  private readonly userAgent: string;
  private readonly tokens: string[];
  private cursor = 0;

  /**
   * @param options.token - Single token (back-compat).
   * @param options.tokens - Explicit token list (takes precedence).
   * When neither is given, tokens are read from `GITHUB_TOKENS` (comma-separated)
   * and `GITHUB_TOKEN`. Multiple tokens are used round-robin with automatic
   * fallback to the next token on rate-limit, lifting the REST limit from 60/h
   * (unauthenticated) to 5000/h per token — which matters because all Vercel
   * instances share an egress IP.
   */
  constructor(options?: { token?: string; tokens?: string[]; userAgent?: string }) {
    this.userAgent = options?.userAgent || 'LobeHub';
    this.tokens = GitHub.resolveTokens(options);
  }

  /** Whether at least one token is configured. */
  isAuthenticated(): boolean {
    return this.tokens.length > 0;
  }

  private static resolveTokens(options?: { token?: string; tokens?: string[] }): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (value?: string) => {
      const trimmed = value?.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    };

    // An explicit `tokens` array (even empty) takes precedence and disables the
    // env fallback — `tokens: []` forces unauthenticated (used in tests).
    if (options?.tokens) {
      options.tokens.forEach(add);
      return out;
    }
    if (options?.token) {
      add(options.token);
      return out;
    }
    (process.env.GITHUB_TOKENS || '').split(',').forEach(add);
    add(process.env.GITHUB_TOKEN);
    return out;
  }

  /**
   * Authenticated fetch with round-robin token selection and automatic fallback
   * to the next token when one is rate-limited. Used for all api.github.com and
   * archive requests. (Raw CDN file fetches stay unauthenticated — see
   * {@link fetchFileContent}.)
   */
  private async apiFetch(url: string, extraHeaders?: Record<string, string>): Promise<Response> {
    const order = this.attemptOrder();
    for (let index = 0; index < order.length; index += 1) {
      const token = order[index];
      const headers: Record<string, string> = { 'User-Agent': this.userAgent, ...extraHeaders };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(url, { headers });
      const hasNext = index < order.length - 1;
      if (hasNext && this.isRateLimited(response)) {
        await response.arrayBuffer().catch(() => {}); // drain before retrying with next token
        continue;
      }
      return response;
    }
    throw new GitHubDownloadError('GitHub request attempts exhausted');
  }

  /** Token order for one request: round-robin start, then the rest as fallbacks. */
  private attemptOrder(): Array<string | undefined> {
    if (this.tokens.length === 0) return [undefined];
    const start = this.cursor % this.tokens.length;
    this.cursor = (this.cursor + 1) % this.tokens.length;
    return this.tokens.map((_, offset) => this.tokens[(start + offset) % this.tokens.length]);
  }

  private isRateLimited(response: Response): boolean {
    if (response.status === 429) return true;
    if (response.status !== 403) return false;
    return response.headers.get('x-ratelimit-remaining') === '0';
  }

  /**
   * Parse GitHub URL to extract owner, repo, branch, and optional path
   * Supports multiple formats:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo/tree/branch
   * - https://github.com/owner/repo/tree/branch/path/to/dir
   * - https://github.com/owner/repo/blob/branch/path/to/file.md
   * - github.com/owner/repo
   * - owner/repo (shorthand)
   * - https://github.com/owner/repo.git
   *
   * When a /blob/ URL pointing to a file is provided, the file name is stripped
   * and the parent directory is used as the path.
   */
  parseRepoUrl(url: string, defaultBranch = 'main'): GitHubRepoInfo {
    log('parseRepoUrl: input url=%s, defaultBranch=%s', url, defaultBranch);

    // Handle shorthand format: owner/repo
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
      const [owner, repo] = url.split('/');
      const result = { branch: defaultBranch, owner, repo };
      log('parseRepoUrl: matched shorthand format, result=%o', result);
      return result;
    }

    // Handle full URL formats
    // Capture: owner, repo, type (tree/blob), branch, and optional path after branch
    const match = url.match(
      /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)(?:\/(tree|blob)\/([^/]+)(?:\/(.+))?)?$/,
    );

    if (!match) {
      log('parseRepoUrl: failed to parse url=%s', url);
      throw new GitHubParseError(`Invalid GitHub URL format: ${url}`);
    }

    const [, owner, repo, urlType, branch, rawPath] = match;
    const result: GitHubRepoInfo = {
      branch: branch || defaultBranch,
      owner,
      repo: repo.replace(/\.git$/, ''),
    };

    // Process path: for /blob/ URLs pointing to a file, strip the file name to get the directory
    if (rawPath) {
      let path = rawPath;
      if (urlType === 'blob') {
        // Strip trailing file name (e.g. "skills/json-canvas/SKILL.md" -> "skills/json-canvas")
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash > 0) {
          path = path.slice(0, lastSlash);
        } else {
          // The path is just a file at the repo root, no subdirectory
          path = '';
        }
      }
      if (path) {
        result.path = path;
      }
    }

    log('parseRepoUrl: matched full URL format, result=%o', result);
    return result;
  }

  /**
   * Generate skill identifier from repo info
   *
   * Format: {owner}-{repo}-{skillName}
   * The skill name is the last segment of the path (directory name).
   * All parts are lowercased and joined with hyphens.
   *
   * @param info - Repository information
   * @returns Skill identifier string
   */
  generateIdentifier(info: GitHubRepoInfo): string {
    const parts = [
      this.normalizeIdentifierPart(info.owner),
      this.normalizeIdentifierPart(info.repo),
    ];

    if (info.path) {
      const lastSegment = info.path.split('/').findLast(Boolean);
      if (lastSegment) {
        parts.push(this.normalizeIdentifierPart(lastSegment));
      }
    }

    return parts.join('-').toLowerCase();
  }

  /**
   * Normalize a string for use as part of a skill identifier.
   * Replaces non-alphanumeric characters (except hyphens) with hyphens,
   * collapses consecutive hyphens, and trims leading/trailing hyphens.
   */
  private normalizeIdentifierPart(part: string): string {
    return part
      .replaceAll(/[^\w-]/g, '-')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-|-$/g, '');
  }

  /**
   * Build the ZIP download URL for a GitHub repository
   */
  buildRepoZipUrl(info: GitHubRepoInfo): string {
    return `https://github.com/${info.owner}/${info.repo}/archive/refs/heads/${info.branch}.zip`;
  }

  /**
   * Build the raw file URL for a GitHub repository.
   *
   * Each path segment is URL-encoded so files with spaces or non-ASCII names
   * (e.g. CJK paths like `templates/中国电信/右上角 logo.png`) resolve correctly
   * instead of failing with `400 Bad Request`. Slashes are preserved as
   * path separators.
   */
  buildRawFileUrl(info: GitHubRawFileInfo): string {
    const encodedPath = info.filePath.split('/').map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${encodedPath}`;
  }

  /**
   * Download repository as ZIP buffer.
   *
   * @param options.maxBytes - Optional hard cap. The body is read as a stream
   *   and aborted once the cap is exceeded, so an unexpectedly large archive
   *   fails fast with a clear error instead of buffering until the function
   *   runs out of memory. Acts as a backstop for the size-based routing in the
   *   importer (e.g. when the repo-size probe is unavailable due to rate limits).
   */
  async downloadRepoZip(info: GitHubRepoInfo, options?: { maxBytes?: number }): Promise<Buffer> {
    const zipUrl = this.buildRepoZipUrl(info);
    log('downloadRepoZip: fetching url=%s', zipUrl);

    const response = await this.apiFetch(zipUrl);

    log('downloadRepoZip: response status=%d, ok=%s', response.status, response.ok);

    if (!response.ok) {
      if (response.status === 404) {
        log('downloadRepoZip: repository not found');
        throw new GitHubNotFoundError(
          `Repository not found: ${info.owner}/${info.repo}@${info.branch}`,
        );
      }
      log('downloadRepoZip: download failed with status=%d', response.status);
      throw new GitHubDownloadError(
        `Failed to download repository: ${response.status} ${response.statusText}`,
      );
    }

    const { maxBytes } = options ?? {};

    // No cap requested, or no readable stream available (e.g. mocked responses):
    // fall back to buffering the whole body at once.
    if (!maxBytes || !response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (maxBytes && buffer.length > maxBytes) {
        throw new GitHubDownloadError(
          `Repository archive exceeds size limit (${buffer.length} > ${maxBytes} bytes)`,
        );
      }
      log('downloadRepoZip: downloaded %d bytes', buffer.length);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new GitHubDownloadError(
            `Repository archive exceeds size limit (> ${maxBytes} bytes)`,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }

    const buffer = Buffer.concat(chunks);
    log('downloadRepoZip: downloaded %d bytes', buffer.length);
    return buffer;
  }

  /**
   * Open the repository archive as a readable byte stream (does not buffer).
   *
   * Used to stream-extract only the skill subdirectory from a large repository
   * without holding the whole archive in memory. The caller is responsible for
   * consuming/cancelling the stream.
   */
  async openRepoZipStream(info: GitHubRepoInfo): Promise<ReadableStream<Uint8Array>> {
    const zipUrl = this.buildRepoZipUrl(info);
    log('openRepoZipStream: fetching url=%s', zipUrl);

    const response = await this.apiFetch(zipUrl);

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Repository not found: ${info.owner}/${info.repo}@${info.branch}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download repository: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new GitHubDownloadError('Repository archive response has no body stream');
    }

    return response.body;
  }

  /**
   * Probe the repository working-tree size (in KB) via the REST API.
   *
   * Used to decide between the cheap "download whole archive" path (small repos)
   * and the memory-bounded "fetch only the skill subdirectory" path (large
   * repos / monorepos). One lightweight JSON call — much cheaper than committing
   * to a full archive download just to discover it is huge.
   */
  async getRepoSizeKb(info: Pick<GitHubRepoInfo, 'owner' | 'repo'>): Promise<number> {
    const url = `https://api.github.com/repos/${info.owner}/${info.repo}`;
    log('getRepoSizeKb: fetching url=%s', url);

    const response = await this.apiFetch(url, { Accept: 'application/vnd.github+json' });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(`Repository not found: ${info.owner}/${info.repo}`);
      }
      throw new GitHubDownloadError(
        `Failed to fetch repository metadata: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { size?: number };
    const sizeKb = typeof data.size === 'number' ? data.size : 0;
    log('getRepoSizeKb: size=%d KB', sizeKb);
    return sizeKb;
  }

  /**
   * List blob (file) entries under a subdirectory of the repository.
   *
   * Primary strategy: the Git Trees API with `recursive=1` — a single call
   * returns the whole tree, which is then filtered to the requested subpath.
   * For very large repos the Trees response can be `truncated`, in which case
   * we fall back to walking only the target subdirectory via the Contents API
   * (bounded by the subdirectory size, not the whole repo).
   *
   * @param subPath - Repository-relative directory, normalized (no leading or
   *   trailing slash). Empty string lists the repository root.
   * @returns File entries whose `path` is repository-relative.
   */
  async listSubtree(info: GitHubRepoInfo, subPath: string): Promise<GitHubTreeFile[]> {
    const normalized = stripSlashes(subPath);
    const url = `https://api.github.com/repos/${info.owner}/${info.repo}/git/trees/${info.branch}?recursive=1`;
    log('listSubtree: fetching url=%s, subPath=%s', url, normalized);

    const response = await this.apiFetch(url, { Accept: 'application/vnd.github+json' });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Repository tree not found: ${info.owner}/${info.repo}@${info.branch}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to fetch repository tree: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      tree?: Array<{ path: string; size?: number; type: string }>;
      truncated?: boolean;
    };

    if (data.truncated) {
      log('listSubtree: tree truncated, falling back to Contents API for subPath=%s', normalized);
      return this.listSubtreeViaContents(info, normalized);
    }

    const prefix = normalized ? `${normalized}/` : '';
    const files = (data.tree ?? [])
      .filter((entry) => entry.type === 'blob' && (!prefix || entry.path.startsWith(prefix)))
      .map((entry) => ({ path: entry.path, size: entry.size }));

    log('listSubtree: found %d files under %s', files.length, normalized || '<root>');
    return files;
  }

  /**
   * Recursively list files under a subdirectory using the Contents API.
   * Fallback for when the Trees API response is truncated. Scoped to the target
   * subdirectory, so the number of calls is bounded by the subdir, not the repo.
   */
  private async listSubtreeViaContents(
    info: GitHubRepoInfo,
    dirPath: string,
  ): Promise<GitHubTreeFile[]> {
    const url = `https://api.github.com/repos/${info.owner}/${info.repo}/contents/${dirPath}?ref=${info.branch}`;
    const response = await this.apiFetch(url, { Accept: 'application/vnd.github+json' });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Path not found: ${info.owner}/${info.repo}@${info.branch}/${dirPath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to list directory: ${response.status} ${response.statusText}`,
      );
    }

    const entries = (await response.json()) as Array<{ path: string; size?: number; type: string }>;
    const files: GitHubTreeFile[] = [];
    for (const entry of entries) {
      if (entry.type === 'file') {
        files.push({ path: entry.path, size: entry.size });
      } else if (entry.type === 'dir') {
        const nested = await this.listSubtreeViaContents(info, entry.path);
        files.push(...nested);
      }
    }
    return files;
  }

  /**
   * Download a single file from GitHub (decoded as UTF-8 text).
   */
  async downloadRawFile(info: GitHubRawFileInfo): Promise<string> {
    const buffer = await this.fetchFileContent(info);
    return buffer.toString('utf8');
  }

  /**
   * Download a single file from GitHub as a Buffer.
   */
  async downloadRawFileBuffer(info: GitHubRawFileInfo): Promise<Buffer> {
    return this.fetchFileContent(info);
  }

  /**
   * Fetch a single file's bytes with retries.
   *
   * Each attempt tries the raw CDN first, then the authenticated Contents API
   * (see {@link fetchFileContentOnce}). Transient failures (network errors like
   * ECONNRESET, or 5xx from both endpoints) are retried with backoff — importing
   * a large repository issues thousands of requests, so an occasional transient
   * blip is expected and must not fail the whole import. A genuine `404` is
   * terminal and never retried.
   */
  private async fetchFileContent(info: GitHubRawFileInfo, attempts = 3): Promise<Buffer> {
    let lastError: Error = new GitHubDownloadError(`Failed to download file: ${info.filePath}`);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.fetchFileContentOnce(info);
      } catch (error) {
        if (error instanceof GitHubNotFoundError) throw error; // file genuinely absent
        lastError = error as Error;
        if (attempt < attempts) await this.backoff(attempt);
      }
    }
    throw lastError;
  }

  /**
   * One fetch attempt: raw CDN first, then authenticated Contents API.
   *
   * 1. Try raw.githubusercontent.com — fast, unauthenticated, no rate limit.
   * 2. On any non-404 failure, fall back to the authenticated GitHub Contents
   *    API (`/contents/{path}` with `Accept: application/vnd.github.raw+json`).
   *    raw.githubusercontent.com intermittently returns `400 Bad Request` under
   *    heavy concurrent load even for valid files; the authenticated API does
   *    not, so this fallback makes bulk downloads (thousands of files) reliable.
   *    The Contents API needs a token for its 5000/h limit — which is why
   *    GITHUB_TOKEN(S) matters for importing large repositories.
   */
  private async fetchFileContentOnce(info: GitHubRawFileInfo): Promise<Buffer> {
    try {
      const rawUrl = this.buildRawFileUrl(info);
      const response = await fetch(rawUrl, { headers: { 'User-Agent': this.userAgent } });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      await response.arrayBuffer().catch(() => {}); // drain before fallback
      log('fetchFileContent: raw %d for %s, falling back to Contents API', response.status, info.filePath);
    } catch (error) {
      if (error instanceof GitHubNotFoundError) throw error;
      log(
        'fetchFileContent: raw error for %s (%s), falling back to Contents API',
        info.filePath,
        (error as Error).message,
      );
    }

    return this.fetchFileViaContentsApi(info);
  }

  /** Exponential backoff with jitter: ~200ms, 400ms, ... */
  private backoff(attempt: number): Promise<void> {
    const ms = 200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Authenticated per-file fallback via the GitHub Contents API.
   */
  private async fetchFileViaContentsApi(info: GitHubRawFileInfo): Promise<Buffer> {
    const encodedPath = info.filePath.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${info.owner}/${info.repo}/contents/${encodedPath}?ref=${encodeURIComponent(info.branch)}`;
    const response = await this.apiFetch(url, { Accept: 'application/vnd.github.raw+json' });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new GitHubDownloadError(
          'GitHub API rate limit exceeded. Configure GITHUB_TOKEN(S) to raise the limit.',
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubParseError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubParseError';
  }
}

export class GitHubNotFoundError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubDownloadError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubDownloadError';
  }
}

export const github = new GitHub();
