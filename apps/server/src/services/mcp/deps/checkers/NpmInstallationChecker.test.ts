import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NpmInstallationChecker } from './NpmInstallationChecker';

// Hoist the mock to ensure it's available in the factory
const { mockExecPromise } = vi.hoisted(() => {
  return {
    mockExecPromise: vi.fn(),
  };
});

// Mock node:child_process
vi.mock('node:child_process');

// Mock node:util to return our hoisted mock when promisify is called
vi.mock('node:util', () => ({
  default: {
    promisify: () => mockExecPromise,
  },
  promisify: () => mockExecPromise,
}));

describe('NpmInstallationChecker', () => {
  let checker: NpmInstallationChecker;

  beforeEach(() => {
    vi.clearAllMocks();
    checker = new NpmInstallationChecker();
  });

  describe('checkPackageInstalled', () => {
    describe('validation', () => {
      it('should return error when packageName is not provided', async () => {
        const result = await checker.checkPackageInstalled({});

        expect(result).toEqual({
          error: 'Package name not provided',
          installed: false,
          packageName: '',
        });
        expect(mockExecPromise).not.toHaveBeenCalled();
      });

      it('should return error when packageName is undefined', async () => {
        const result = await checker.checkPackageInstalled({ packageName: undefined });

        expect(result).toEqual({
          error: 'Package name not provided',
          installed: false,
          packageName: '',
        });
      });

      it('should return error when packageName is empty string', async () => {
        const result = await checker.checkPackageInstalled({ packageName: '' });

        expect(result).toEqual({
          error: 'Package name not provided',
          installed: false,
          packageName: '',
        });
      });
    });

    describe('global package detection', () => {
      it('should detect globally installed package', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── typescript@5.0.4\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'typescript' });

        expect(mockExecPromise).toHaveBeenCalledWith('npm list -g typescript --depth=0');
        expect(result).toEqual({
          installed: true,
          packageName: 'typescript',
        });
      });

      it('should detect globally installed package with @scope', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── @angular/cli@16.0.0\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: '@angular/cli' });

        expect(mockExecPromise).toHaveBeenCalledWith('npm list -g @angular/cli --depth=0');
        expect(result.installed).toBe(true);
      });

      it('should detect package with different version format', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── eslint@8.41.0 (deduped)\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'eslint' });

        expect(result.installed).toBe(true);
      });

      it('should handle npm list output with multiple packages', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n├── package1@1.0.0\n├── react@18.2.0\n└── package2@2.0.0\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'react' });

        expect(result.installed).toBe(true);
      });
    });

    describe('npm list empty detection', () => {
      it('should fallback to npx when npm list returns (empty)', async () => {
        mockExecPromise
          .mockResolvedValueOnce({
            stdout: '/usr/local/lib\n(empty)\n',
            stderr: '',
          })
          .mockResolvedValueOnce({
            stdout: '1.0.0\n',
            stderr: '',
          });

        const result = await checker.checkPackageInstalled({ packageName: 'create-react-app' });

        expect(mockExecPromise).toHaveBeenNthCalledWith(
          1,
          'npm list -g create-react-app --depth=0',
        );
        expect(mockExecPromise).toHaveBeenNthCalledWith(2, 'npx -y create-react-app --version');
        expect(result).toEqual({
          installed: true,
          packageName: 'create-react-app',
        });
      });

      it('should fallback to npx when package not in global list', async () => {
        mockExecPromise
          .mockResolvedValueOnce({
            stdout: '/usr/local/lib\n└── other-package@1.0.0\n',
            stderr: '',
          })
          .mockResolvedValueOnce({
            stdout: '2.3.1\n',
            stderr: '',
          });

        const result = await checker.checkPackageInstalled({ packageName: 'cowsay' });

        expect(mockExecPromise).toHaveBeenNthCalledWith(2, 'npx -y cowsay --version');
        expect(result.installed).toBe(true);
      });
    });

    describe('npx fallback mechanism', () => {
      it('should use npx -y flag to auto-install if needed', async () => {
        mockExecPromise
          .mockResolvedValueOnce({
            stdout: '(empty)\n',
            stderr: '',
          })
          .mockResolvedValueOnce({
            stdout: '5.1.0\n',
            stderr: '',
          });

        await checker.checkPackageInstalled({ packageName: 'prettier' });

        expect(mockExecPromise).toHaveBeenCalledWith('npx -y prettier --version');
      });

      it('should succeed if npx can execute package', async () => {
        mockExecPromise
          .mockResolvedValueOnce({
            stdout: '(empty)\n',
            stderr: '',
          })
          .mockResolvedValueOnce({
            stdout: '3.2.1\n',
            stderr: '',
          });

        const result = await checker.checkPackageInstalled({ packageName: 'http-server' });

        expect(result.installed).toBe(true);
        expect(result.packageName).toBe('http-server');
      });

      it('should handle npx with @scope packages', async () => {
        mockExecPromise
          .mockResolvedValueOnce({
            stdout: '(empty)\n',
            stderr: '',
          })
          .mockResolvedValueOnce({
            stdout: '7.0.0\n',
            stderr: '',
          });

        await checker.checkPackageInstalled({ packageName: '@vue/cli' });

        expect(mockExecPromise).toHaveBeenNthCalledWith(2, 'npx -y @vue/cli --version');
      });
    });

    describe('package not found scenarios', () => {
      it('should return not installed when npm list fails and npx fails', async () => {
        mockExecPromise
          .mockResolvedValueOnce({
            stdout: '(empty)\n',
            stderr: '',
          })
          .mockRejectedValueOnce(new Error('command not found'));

        const result = await checker.checkPackageInstalled({ packageName: 'nonexistent-pkg' });

        expect(result).toEqual({
          error: 'command not found',
          installed: false,
          packageName: 'nonexistent-pkg',
        });
      });

      it('should return not installed when both checks fail', async () => {
        mockExecPromise.mockRejectedValue(new Error('Network error'));

        const result = await checker.checkPackageInstalled({ packageName: 'some-package' });

        expect(result.installed).toBe(false);
        expect(result.error).toBe('Network error');
      });
    });

    describe('error handling', () => {
      it('should handle npm not installed error', async () => {
        mockExecPromise.mockRejectedValueOnce(new Error('npm: command not found'));

        const result = await checker.checkPackageInstalled({ packageName: 'es-toolkit' });

        expect(result).toEqual({
          error: 'npm: command not found',
          installed: false,
          packageName: 'es-toolkit',
        });
      });

      it('should handle permission errors', async () => {
        mockExecPromise.mockRejectedValueOnce(new Error('EACCES: permission denied'));

        const result = await checker.checkPackageInstalled({ packageName: 'webpack' });

        expect(result.installed).toBe(false);
        expect(result.error).toContain('EACCES');
      });

      it('should handle non-Error exceptions', async () => {
        mockExecPromise.mockRejectedValueOnce('string error');

        const result = await checker.checkPackageInstalled({ packageName: 'babel' });

        expect(result).toEqual({
          error: 'Unknown error',
          installed: false,
          packageName: 'babel',
        });
      });

      it('should handle npm registry timeout', async () => {
        mockExecPromise.mockRejectedValueOnce(new Error('ETIMEDOUT: connection timeout'));

        const result = await checker.checkPackageInstalled({ packageName: 'axios' });

        expect(result.installed).toBe(false);
        expect(result.error).toBe('ETIMEDOUT: connection timeout');
      });
    });

    describe('edge cases', () => {
      it('should handle package names with hyphens', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── create-next-app@13.4.0\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'create-next-app' });

        expect(result.installed).toBe(true);
      });

      it('should handle package names with dots', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── package.name@1.0.0\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'package.name' });

        expect(result.installed).toBe(true);
      });

      it('should handle npm list with warnings in stderr', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── typescript@5.0.4\n',
          stderr: 'npm WARN deprecated package@1.0.0\n',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'typescript' });

        expect(result.installed).toBe(true);
      });

      it('should handle npm list with extra whitespace', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '  /usr/local/lib  \n  └── jest@29.5.0  \n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'jest' });

        expect(result.installed).toBe(true);
      });

      it('should handle case-sensitive package names', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── MyPackage@1.0.0\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'MyPackage' });

        expect(result.installed).toBe(true);
      });

      it('should handle npm list output with symlink info', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── react@18.2.0 -> /custom/path/react\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'react' });

        expect(result.installed).toBe(true);
      });

      it('should handle npm list with peer dependency warnings', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── UNMET PEER DEPENDENCY eslint@8.0.0\n└── webpack@5.88.0\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'webpack' });

        expect(result.installed).toBe(true);
      });

      it('should match substring package names in global list', async () => {
        mockExecPromise.mockResolvedValueOnce({
          stdout: '/usr/local/lib\n└── react-native@0.72.0\n',
          stderr: '',
        });

        const result = await checker.checkPackageInstalled({ packageName: 'react' });

        // Note: The implementation uses includes(), so 'react' will match 'react-native'
        // This is intentional behavior - grep would also match substring
        expect(result.installed).toBe(true);
      });
    });
  });
});
