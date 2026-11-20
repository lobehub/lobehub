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

export class GitHub {
  private readonly userAgent: string;

  constructor(options?: { userAgent?: string }) {
    this.userAgent = options?.userAgent || 'LobeHub';
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
        try {
          result.path = decodeURIComponent(path).replace(/\/+$/, '');
        } catch {
          throw new GitHubParseError('Invalid GitHub path encoding');
        }
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
    const ref =
      info.branch === 'HEAD' || /^[a-f0-9]{40}$/.test(info.branch)
        ? info.branch
        : 'refs/heads/' + info.branch;
    return `https://github.com/${info.owner}/${info.repo}/archive/${ref}.zip`;
  }

  /**
   * Build the raw file URL for a GitHub repository
   */
  buildRawFileUrl(info: GitHubRawFileInfo): string {
    return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${info.filePath}`;
  }

  async resolveCommit(info: GitHubRepoInfo) {
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}`;
    const response = await fetch(`${repoUrl}/commits/${encodeURIComponent(info.branch)}`, {
      headers: { 'Accept': 'application/vnd.github.sha', 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(15_000),
    });
    // A missing repository answers 404, a missing ref answers 422.
    if (response.status === 404 || response.status === 422)
      throw new GitHubNotFoundError('GitHub repository or ref not found', response.status);
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.has('retry-after') ||
          response.headers.get('x-ratelimit-remaining') === '0'))
    )
      throw new GitHubRateLimitError('GitHub rate limit reached');
    if (response.status === 403)
      throw new GitHubNotFoundError('GitHub repository is inaccessible', 403);
    if (!response.ok)
      throw new GitHubDownloadError(`Could not resolve GitHub revision (HTTP ${response.status})`);
    const commit = (await response.text()).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new GitHubDownloadError('Invalid GitHub revision');
    return commit;
  }

  async downloadCommitZip(info: GitHubRepoInfo, commit: string) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new GitHubParseError('Invalid commit SHA');
    const url = `https://codeload.github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/zip/${commit}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404 || response.status === 403)
      throw new GitHubNotFoundError('GitHub repository or commit is inaccessible');
    return this.readArchive(response);
  }

  /**
   * Download a ref's archive and read the commit it was cut from out of the ZIP
   * comment. Uses no REST API quota, so it still works when `resolveCommit` is
   * rate limited.
   */
  async downloadRefZip(info: GitHubRepoInfo) {
    const response = await fetch(this.buildRepoZipUrl(info), {
      headers: { 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404)
      throw new GitHubNotFoundError('GitHub repository or ref not found');
    const buffer = await this.readArchive(response);
    const commit = zipComment(buffer);
    if (!/^[a-f0-9]{40}$/.test(commit))
      throw new GitHubDownloadError('GitHub archive does not name its commit');
    return { buffer, commit };
  }

  /** A private commit's signed archive URL is short-lived and must never be logged. */
  async downloadSnapshotZip(location: string) {
    const signal = AbortSignal.timeout(30_000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const url = new URL(location);
      if (
        !['https://github.com', 'https://api.github.com', 'https://codeload.github.com'].includes(
          url.origin,
        ) ||
        url.username ||
        url.password
      )
        throw new GitHubDownloadError('Invalid GitHub archive location');
      const response = await fetch(url.href, { redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const next = response.headers.get('location');
        if (!next) throw new GitHubDownloadError('Missing GitHub archive location');
        location = new URL(next, url).href;
        continue;
      }
      return this.readArchive(response);
    }
    throw new GitHubDownloadError('Too many GitHub archive redirects');
  }

  private async readArchive(response: Response) {
    if (!response.ok || !response.body)
      throw new GitHubDownloadError(`Could not download repository (HTTP ${response.status})`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024 * 1024) {
        await reader.cancel();
        throw new GitHubDownloadError('Repository exceeds the 32 MiB download limit');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  }

  /**
   * Download repository as ZIP buffer
   */
  async downloadRepoZip(info: GitHubRepoInfo): Promise<Buffer> {
    const zipUrl = this.buildRepoZipUrl(info);
    log('downloadRepoZip: fetching url=%s', zipUrl);

    const response = await fetch(zipUrl, {
      headers: {
        'User-Agent': this.userAgent,
      },
    });

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

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    log('downloadRepoZip: downloaded %d bytes', buffer.length);
    return buffer;
  }

  /**
   * Download a single raw file from GitHub
   */
  async downloadRawFile(info: GitHubRawFileInfo): Promise<string> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: {
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    return response.text();
  }

  /**
   * Download a single raw file as buffer from GitHub
   */
  async downloadRawFileBuffer(info: GitHubRawFileInfo): Promise<Buffer> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: {
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
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
  constructor(
    message: string,
    readonly status?: number,
  ) {
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

export class GitHubRateLimitError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubRateLimitError';
  }
}

/** The archive comment sits after the end-of-central-directory record that closes a ZIP. */
const zipComment = (zip: Buffer) => {
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xff_ff); at--) {
    if (
      zip.readUInt32LE(at) === 0x06_05_4b_50 &&
      at + 22 + zip.readUInt16LE(at + 20) === zip.length
    )
      return zip.toString('latin1', at + 22);
  }
  return '';
};

export const github = new GitHub();
