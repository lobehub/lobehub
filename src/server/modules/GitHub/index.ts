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
   * - github.com/owner/repo
   * - owner/repo (shorthand)
   * - https://github.com/owner/repo.git
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
    // Capture: owner, repo, branch, and optional path after branch
    const match = url.match(
      /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/,
    );

    if (!match) {
      log('parseRepoUrl: failed to parse url=%s', url);
      throw new GitHubParseError(`Invalid GitHub URL format: ${url}`);
    }

    const [, owner, repo, branch, path] = match;
    const result: GitHubRepoInfo = {
      branch: branch || defaultBranch,
      owner,
      repo: repo.replace(/\.git$/, ''),
    };

    // Add path if it exists (subdirectory within the repo)
    if (path) {
      result.path = path;
    }

    log('parseRepoUrl: matched full URL format, result=%o', result);
    return result;
  }

  /**
   * Build the ZIP download URL for a GitHub repository
   */
  buildRepoZipUrl(info: GitHubRepoInfo): string {
    return `https://github.com/${info.owner}/${info.repo}/archive/refs/heads/${info.branch}.zip`;
  }

  /**
   * Build the raw file URL for a GitHub repository
   */
  buildRawFileUrl(info: GitHubRawFileInfo): string {
    return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${info.filePath}`;
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
