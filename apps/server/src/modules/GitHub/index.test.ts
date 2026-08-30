// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GitHub,
  github,
  GitHubDownloadError,
  GitHubNotFoundError,
  GitHubParseError,
  stripSlashes,
} from './index';

describe('GitHub', () => {
  // Tokens are resolved from env when not passed explicitly; clear them so the
  // default `new GitHub()` instances in these tests are deterministically
  // unauthenticated regardless of the local .env.
  const origTokens = process.env.GITHUB_TOKENS;
  const origToken = process.env.GITHUB_TOKEN;
  beforeEach(() => {
    delete process.env.GITHUB_TOKENS;
    delete process.env.GITHUB_TOKEN;
  });
  afterAll(() => {
    if (origTokens !== undefined) process.env.GITHUB_TOKENS = origTokens;
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
  });
  describe('parseRepoUrl', () => {
    const gh = new GitHub();

    it('should parse standard GitHub URL', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
    });

    it('should parse GitHub URL with tree/branch', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat/tree/develop');
      expect(result).toEqual({
        branch: 'develop',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
    });

    it('should parse GitHub URL with tree/branch and path', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/lobehub/lobe-chat/tree/feature/new-ui/src/components',
      );
      expect(result).toEqual({
        branch: 'feature',
        owner: 'lobehub',
        path: 'new-ui/src/components',
        repo: 'lobe-chat',
      });
    });

    // When URL contains subdirectory path like /tree/main/skills/skill-creator,
    // the path should be captured and returned
    it('should capture subdirectory path from GitHub URL', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/openclaw/openclaw/tree/main/skills/skill-creator',
      );
      expect(result).toEqual({
        branch: 'main',
        owner: 'openclaw',
        path: 'skills/skill-creator',
        repo: 'openclaw',
      });
    });

    it('should capture nested subdirectory path from GitHub URL', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/lobehub/skills/tree/develop/agents/coding/python-expert',
      );
      expect(result).toEqual({
        branch: 'develop',
        owner: 'lobehub',
        path: 'agents/coding/python-expert',
        repo: 'skills',
      });
    });

    it('should not have path when URL has no subdirectory', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat/tree/main');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(result.path).toBeUndefined();
    });

    it('should parse /blob/ URL and strip file name to get directory path', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/kepano/obsidian-skills/blob/main/skills/json-canvas/SKILL.md',
      );
      expect(result).toEqual({
        branch: 'main',
        owner: 'kepano',
        path: 'skills/json-canvas',
        repo: 'obsidian-skills',
      });
    });

    it('should parse /blob/ URL pointing to a file at repo root (no subdirectory)', () => {
      const result = gh.parseRepoUrl('https://github.com/owner/repo/blob/main/SKILL.md');
      expect(result).toEqual({
        branch: 'main',
        owner: 'owner',
        repo: 'repo',
      });
      expect(result.path).toBeUndefined();
    });

    it('should parse /blob/ URL with nested path', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md',
      );
      expect(result).toEqual({
        branch: 'main',
        owner: 'anthropics',
        path: 'skills/pptx',
        repo: 'skills',
      });
    });

    it('should parse GitHub URL without protocol', () => {
      const result = gh.parseRepoUrl('github.com/lobehub/lobe-chat');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
    });

    it('should parse GitHub URL with .git suffix', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat.git');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
    });

    it('should parse shorthand format (owner/repo)', () => {
      const result = gh.parseRepoUrl('lobehub/lobe-chat');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
    });

    it('should use custom default branch', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat', 'dev');
      expect(result).toEqual({
        branch: 'dev',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
    });

    it('should handle repo names with dots and hyphens', () => {
      const result = gh.parseRepoUrl('https://github.com/owner-name/repo.name-v2');
      expect(result).toEqual({
        branch: 'main',
        owner: 'owner-name',
        repo: 'repo.name-v2',
      });
    });

    it('should throw GitHubParseError for invalid URL', () => {
      expect(() => gh.parseRepoUrl('https://gitlab.com/owner/repo')).toThrow(GitHubParseError);
      expect(() => gh.parseRepoUrl('invalid-url')).toThrow(GitHubParseError);
      expect(() => gh.parseRepoUrl('https://github.com/')).toThrow(GitHubParseError);
    });
  });

  describe('buildRepoZipUrl', () => {
    const gh = new GitHub();

    it('should build correct ZIP URL', () => {
      const url = gh.buildRepoZipUrl({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe('https://github.com/lobehub/lobe-chat/archive/refs/heads/main.zip');
    });

    it('should handle different branches', () => {
      const url = gh.buildRepoZipUrl({
        branch: 'feature/new-ui',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe(
        'https://github.com/lobehub/lobe-chat/archive/refs/heads/feature/new-ui.zip',
      );
    });
  });

  describe('buildRawFileUrl', () => {
    const gh = new GitHub();

    it('should build correct raw file URL', () => {
      const url = gh.buildRawFileUrl({
        branch: 'main',
        filePath: 'README.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe('https://raw.githubusercontent.com/lobehub/lobe-chat/main/README.md');
    });

    it('should handle nested file paths', () => {
      const url = gh.buildRawFileUrl({
        branch: 'develop',
        filePath: 'src/components/Button/index.tsx',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe(
        'https://raw.githubusercontent.com/lobehub/lobe-chat/develop/src/components/Button/index.tsx',
      );
    });

    it('should URL-encode spaces and non-ASCII path segments (avoids 400)', () => {
      const url = gh.buildRawFileUrl({
        branch: 'main',
        filePath: 'templates/中国电信/右上角 logo.png',
        owner: 'hugohe3',
        repo: 'ppt-master',
      });
      expect(url).toBe(
        'https://raw.githubusercontent.com/hugohe3/ppt-master/main/templates/' +
          '%E4%B8%AD%E5%9B%BD%E7%94%B5%E4%BF%A1/%E5%8F%B3%E4%B8%8A%E8%A7%92%20logo.png',
      );
      // Slashes remain separators; segments are encoded.
      expect(url).not.toContain('右上角');
      expect(url).toContain('%20');
    });
  });

  describe('downloadRepoZip', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should download repository ZIP successfully', async () => {
      const mockBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockBuffer),
        ok: true,
      });

      const result = await gh.downloadRepoZip({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.com/lobehub/lobe-chat/archive/refs/heads/main.zip',
        {
          headers: {
            'User-Agent': 'LobeHub',
          },
        },
      );
    });

    it('should throw GitHubNotFoundError for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        gh.downloadRepoZip({
          branch: 'main',
          owner: 'lobehub',
          repo: 'non-existent',
        }),
      ).rejects.toThrow(GitHubNotFoundError);
    });

    it('should throw GitHubDownloadError for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        gh.downloadRepoZip({
          branch: 'main',
          owner: 'lobehub',
          repo: 'lobe-chat',
        }),
      ).rejects.toThrow(GitHubDownloadError);
    });

    it('should use custom user agent', async () => {
      const customGh = new GitHub({ userAgent: 'CustomAgent/1.0' });
      const mockBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockBuffer),
        ok: true,
      });

      await customGh.downloadRepoZip({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {
        headers: {
          'User-Agent': 'CustomAgent/1.0',
        },
      });
    });
  });

  describe('downloadRawFile', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      mockFetch.mockReset();
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const arrayBufferOf = (text: string) => {
      const u8 = new TextEncoder().encode(text);
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    };

    it('should download raw file successfully from the CDN', async () => {
      const mockContent = '# README\n\nThis is a test.';
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(arrayBufferOf(mockContent)),
        ok: true,
      });

      const result = await gh.downloadRawFile({
        branch: 'main',
        filePath: 'README.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBe(mockContent);
      // Raw CDN fetch is unauthenticated (User-Agent only).
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/lobehub/lobe-chat/main/README.md',
        { headers: { 'User-Agent': 'LobeHub' } },
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw GitHubNotFoundError when the raw CDN returns 404 (no fallback)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        gh.downloadRawFile({
          branch: 'main',
          filePath: 'non-existent.md',
          owner: 'lobehub',
          repo: 'lobe-chat',
        }),
      ).rejects.toThrow(GitHubNotFoundError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should fall back to the Contents API when the raw CDN returns a transient 400', async () => {
      mockFetch
        // 1. raw CDN 400 (transient anti-abuse)
        .mockResolvedValueOnce({
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        })
        // 2. authenticated Contents API succeeds
        .mockResolvedValueOnce({
          arrayBuffer: () => Promise.resolve(arrayBufferOf('recovered')),
          ok: true,
        });

      const result = await gh.downloadRawFile({
        branch: 'main',
        filePath: 'flaky.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBe('recovered');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call is the Contents API.
      expect(mockFetch.mock.calls[1][0]).toContain('api.github.com/repos/lobehub/lobe-chat/contents/');
    });

    it('should fall back to the Contents API when the raw CDN throws (network error)', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({
          arrayBuffer: () => Promise.resolve(arrayBufferOf('via-api')),
          ok: true,
        });

      const result = await gh.downloadRawFile({
        branch: 'main',
        filePath: 'reset.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBe('via-api');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry a transient network error and then succeed', async () => {
      mockFetch
        // attempt 1: raw throws, Contents API throws
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        // attempt 2: raw succeeds
        .mockResolvedValueOnce({
          arrayBuffer: () => Promise.resolve(arrayBufferOf('after-retry')),
          ok: true,
        });

      const result = await gh.downloadRawFile({
        branch: 'main',
        filePath: 'flaky-net.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBe('after-retry');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw GitHubDownloadError when both endpoints fail across all retries', async () => {
      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        gh.downloadRawFile({
          branch: 'main',
          filePath: 'down.md',
          owner: 'lobehub',
          repo: 'lobe-chat',
        }),
      ).rejects.toThrow(GitHubDownloadError);
      // (raw + Contents API) x 3 attempts.
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });
  });

  describe('downloadRawFileBuffer', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should download raw file as buffer successfully', async () => {
      const mockBuffer = new ArrayBuffer(50);
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockBuffer),
        ok: true,
      });

      const result = await gh.downloadRawFileBuffer({
        branch: 'main',
        filePath: 'image.png',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('auth headers & token pool', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      mockFetch.mockReset();
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should attach Authorization on authenticated API calls when a token is provided', async () => {
      const gh = new GitHub({ token: 'ghp_secret' });
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ size: 1 }), ok: true });

      await gh.getRepoSizeKb({ owner: 'lobehub', repo: 'lobe-chat' });

      const headers = mockFetch.mock.calls.at(-1)![1].headers;
      expect(headers.Authorization).toBe('Bearer ghp_secret');
      expect(gh.isAuthenticated()).toBe(true);
    });

    it('should omit Authorization when no token is configured', async () => {
      const gh = new GitHub({ tokens: [] });
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ size: 1 }), ok: true });

      await gh.getRepoSizeKb({ owner: 'lobehub', repo: 'lobe-chat' });

      const headers = mockFetch.mock.calls.at(-1)![1].headers;
      expect(headers).not.toHaveProperty('Authorization');
      expect(gh.isAuthenticated()).toBe(false);
    });

    it('should resolve a comma-separated GITHUB_TOKENS env var', () => {
      process.env.GITHUB_TOKENS = 'tok_a, tok_b ,tok_a';
      const gh = new GitHub();
      expect(gh.isAuthenticated()).toBe(true);
    });

    it('should fall back to the next token when one is rate-limited', async () => {
      const gh = new GitHub({ tokens: ['tok_a', 'tok_b'] });
      mockFetch
        // first token: rate-limited
        .mockResolvedValueOnce({
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          headers: { get: (k: string) => (k === 'x-ratelimit-remaining' ? '0' : null) },
          ok: false,
          status: 403,
        })
        // second token: succeeds
        .mockResolvedValueOnce({ json: () => Promise.resolve({ size: 7 }), ok: true });

      const size = await gh.getRepoSizeKb({ owner: 'lobehub', repo: 'lobe-chat' });

      expect(size).toBe(7);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok_a');
      expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok_b');
    });
  });

  describe('getRepoSizeKb', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return the repo size in KB', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ size: 12_345 }),
        ok: true,
      });

      const size = await gh.getRepoSizeKb({ owner: 'lobehub', repo: 'lobe-chat' });
      expect(size).toBe(12_345);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/lobehub/lobe-chat',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }),
        }),
      );
    });

    it('should default to 0 when size is missing', async () => {
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({}), ok: true });
      const size = await gh.getRepoSizeKb({ owner: 'lobehub', repo: 'lobe-chat' });
      expect(size).toBe(0);
    });

    it('should throw GitHubNotFoundError for 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
      await expect(gh.getRepoSizeKb({ owner: 'lobehub', repo: 'nope' })).rejects.toThrow(
        GitHubNotFoundError,
      );
    });
  });

  describe('listSubtree', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();
    const repoInfo = { branch: 'main', owner: 'lobehub', repo: 'skills' };

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should list blob files under the subpath via the Trees API', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            tree: [
              { path: 'skills/foo', type: 'tree' },
              { path: 'skills/foo/SKILL.md', size: 10, type: 'blob' },
              { path: 'skills/foo/assets/a.png', size: 20, type: 'blob' },
              { path: 'skills/other/SKILL.md', size: 5, type: 'blob' },
              { path: 'README.md', size: 3, type: 'blob' },
            ],
            truncated: false,
          }),
        ok: true,
      });

      const files = await gh.listSubtree(repoInfo, 'skills/foo');
      expect(files.map((f) => f.path)).toEqual(['skills/foo/SKILL.md', 'skills/foo/assets/a.png']);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/lobehub/skills/git/trees/main?recursive=1',
        expect.any(Object),
      );
    });

    it('should fall back to the Contents API when the tree is truncated', async () => {
      mockFetch
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ tree: [], truncated: true }),
          ok: true,
        })
        // contents of skills/foo
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve([
              { path: 'skills/foo/SKILL.md', size: 10, type: 'file' },
              { path: 'skills/foo/assets', type: 'dir' },
            ]),
          ok: true,
        })
        // contents of skills/foo/assets
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve([{ path: 'skills/foo/assets/a.png', size: 20, type: 'file' }]),
          ok: true,
        });

      const files = await gh.listSubtree(repoInfo, 'skills/foo');
      expect(files.map((f) => f.path).sort()).toEqual([
        'skills/foo/SKILL.md',
        'skills/foo/assets/a.png',
      ]);
    });

    it('should throw GitHubNotFoundError for 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
      await expect(gh.listSubtree(repoInfo, 'skills/foo')).rejects.toThrow(GitHubNotFoundError);
    });
  });

  describe('downloadRepoZip with size cap', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const makeStreamResponse = (chunks: Uint8Array[]) => {
      let i = 0;
      return {
        body: {
          getReader: () => ({
            cancel: () => Promise.resolve(),
            read: () =>
              i < chunks.length
                ? Promise.resolve({ done: false, value: chunks[i++] })
                : Promise.resolve({ done: true, value: undefined }),
            releaseLock: () => {},
          }),
        },
        ok: true,
      };
    };

    it('should throw when the streamed archive exceeds maxBytes', async () => {
      mockFetch.mockResolvedValueOnce(makeStreamResponse([new Uint8Array(60), new Uint8Array(60)]));

      await expect(
        gh.downloadRepoZip({ branch: 'main', owner: 'lobehub', repo: 'big' }, { maxBytes: 100 }),
      ).rejects.toThrow(GitHubDownloadError);
    });

    it('should return the buffer when under maxBytes', async () => {
      mockFetch.mockResolvedValueOnce(makeStreamResponse([new Uint8Array(10), new Uint8Array(10)]));

      const result = await gh.downloadRepoZip(
        { branch: 'main', owner: 'lobehub', repo: 'small' },
        { maxBytes: 100 },
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(20);
    });

    it('should enforce maxBytes even without a streamable body', async () => {
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(200)),
        ok: true,
      });

      await expect(
        gh.downloadRepoZip({ branch: 'main', owner: 'lobehub', repo: 'big' }, { maxBytes: 100 }),
      ).rejects.toThrow(GitHubDownloadError);
    });
  });

  describe('stripSlashes', () => {
    it('should strip leading and trailing slashes', () => {
      expect(stripSlashes('/skills/foo/')).toBe('skills/foo');
      expect(stripSlashes('skills/foo')).toBe('skills/foo');
      expect(stripSlashes('///skills/foo///')).toBe('skills/foo');
      expect(stripSlashes('')).toBe('');
      expect(stripSlashes('/')).toBe('');
      expect(stripSlashes('////')).toBe('');
    });

    it('should not preserve interior slashes incorrectly', () => {
      expect(stripSlashes('/a//b/')).toBe('a//b');
    });

    it('should handle adversarial all-slash input quickly (no ReDoS)', () => {
      const input = '/'.repeat(200_000);
      expect(stripSlashes(input)).toBe('');
    });
  });

  describe('github singleton', () => {
    it('should be an instance of GitHub', () => {
      expect(github).toBeInstanceOf(GitHub);
    });
  });
});
