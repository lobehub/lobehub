import { describe, expect, it } from 'vitest';

import { ManualInstallationChecker } from './ManualInstallationChecker';

describe('ManualInstallationChecker', () => {
  let checker: ManualInstallationChecker;

  beforeEach(() => {
    checker = new ManualInstallationChecker();
  });

  describe('checkPackageInstalled', () => {
    it('should always return not installed for manual packages', async () => {
      const result = await checker.checkPackageInstalled({ packageName: 'manual-package' });

      expect(result).toEqual({
        installed: false,
        packageName: 'manual-package',
      });
    });

    it('should handle packageName with repository URL', async () => {
      const result = await checker.checkPackageInstalled({
        packageName: 'my-custom-tool',
        repositoryUrlToClone: 'https://github.com/user/repo.git',
      });

      expect(result.installed).toBe(false);
      expect(result.packageName).toBe('my-custom-tool');
    });

    it('should use repositoryUrlToClone as packageName when packageName is not provided', async () => {
      const result = await checker.checkPackageInstalled({
        repositoryUrlToClone: 'https://github.com/user/custom-tool.git',
      });

      expect(result).toEqual({
        installed: false,
        packageName: 'https://github.com/user/custom-tool.git',
      });
    });

    it('should return empty packageName when neither packageName nor repositoryUrlToClone provided', async () => {
      const result = await checker.checkPackageInstalled({});

      expect(result).toEqual({
        installed: false,
        packageName: '',
      });
    });

    it('should handle undefined packageName', async () => {
      const result = await checker.checkPackageInstalled({ packageName: undefined });

      expect(result).toEqual({
        installed: false,
        packageName: '',
      });
    });

    it('should handle empty string packageName', async () => {
      const result = await checker.checkPackageInstalled({ packageName: '' });

      expect(result).toEqual({
        installed: false,
        packageName: '',
      });
    });

    it('should handle empty string repositoryUrlToClone as fallback', async () => {
      const result = await checker.checkPackageInstalled({
        packageName: '',
        repositoryUrlToClone: '',
      });

      expect(result).toEqual({
        installed: false,
        packageName: '',
      });
    });

    it('should prioritize packageName over repositoryUrlToClone', async () => {
      const result = await checker.checkPackageInstalled({
        packageName: 'my-tool',
        repositoryUrlToClone: 'https://github.com/user/repo.git',
      });

      expect(result.packageName).toBe('my-tool');
      expect(result.installed).toBe(false);
    });

    it('should handle complex package names', async () => {
      const result = await checker.checkPackageInstalled({
        packageName: '@scope/package-name-with-special.chars_123',
      });

      expect(result).toEqual({
        installed: false,
        packageName: '@scope/package-name-with-special.chars_123',
      });
    });

    it('should handle SSH repository URLs', async () => {
      const result = await checker.checkPackageInstalled({
        repositoryUrlToClone: 'git@github.com:user/repo.git',
      });

      expect(result).toEqual({
        installed: false,
        packageName: 'git@github.com:user/repo.git',
      });
    });

    it('should handle local file paths', async () => {
      const result = await checker.checkPackageInstalled({
        packageName: '/usr/local/custom-tool',
      });

      expect(result).toEqual({
        installed: false,
        packageName: '/usr/local/custom-tool',
      });
    });

    it('should handle Windows-style paths', async () => {
      const result = await checker.checkPackageInstalled({
        packageName: 'C:\\Program Files\\CustomTool',
      });

      expect(result).toEqual({
        installed: false,
        packageName: 'C:\\Program Files\\CustomTool',
      });
    });

    it('should handle package names with unicode characters', async () => {
      const result = await checker.checkPackageInstalled({
        packageName: 'my-tool-日本語',
      });

      expect(result).toEqual({
        installed: false,
        packageName: 'my-tool-日本語',
      });
    });

    it('should always return false for installed regardless of input', async () => {
      const testCases = [
        { packageName: 'package1' },
        { packageName: 'package2', repositoryUrlToClone: 'https://example.com/repo.git' },
        { repositoryUrlToClone: 'https://example.com/repo2.git' },
        {},
        { packageName: '' },
      ];

      for (const testCase of testCases) {
        const result = await checker.checkPackageInstalled(testCase);
        expect(result.installed).toBe(false);
      }
    });
  });
});
