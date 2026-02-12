// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GitHub,
  GitHubDownloadError,
  GitHubNotFoundError,
  GitHubParseError,
  github,
} from './index';

describe('GitHub', () => {
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
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should download raw file successfully', async () => {
      const mockContent = '# README\n\nThis is a test.';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockContent),
      });

      const result = await gh.downloadRawFile({
        branch: 'main',
        filePath: 'README.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBe(mockContent);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/lobehub/lobe-chat/main/README.md',
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
        gh.downloadRawFile({
          branch: 'main',
          filePath: 'non-existent.md',
          owner: 'lobehub',
          repo: 'lobe-chat',
        }),
      ).rejects.toThrow(GitHubNotFoundError);
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

  describe('github singleton', () => {
    it('should be an instance of GitHub', () => {
      expect(github).toBeInstanceOf(GitHub);
    });
  });
});
