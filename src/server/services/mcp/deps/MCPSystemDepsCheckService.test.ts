import { type DeploymentOption, type SystemDependency } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mock setup
import { mcpSystemDepsCheckService } from './MCPSystemDepsCheckService';
import { type InstallationChecker } from './types';

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

describe('MCPSystemDepsCheckService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerChecker', () => {
    it('should register an installation checker', () => {
      const mockChecker: InstallationChecker = {
        checkPackageInstalled: vi.fn(),
      };

      mcpSystemDepsCheckService.registerChecker('npm', mockChecker);

      // Verify checker is registered by using it in checkDeployOption
      expect(() => mcpSystemDepsCheckService.registerChecker('npm', mockChecker)).not.toThrow();
    });
  });

  describe('checkSystemDependency', () => {
    it('should successfully check installed dependency without version requirement', async () => {
      const mockDependency: SystemDependency = {
        name: 'node',
        checkCommand: 'node --version',
      };

      mockExecPromise.mockResolvedValue({ stdout: 'v18.16.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result).toEqual({
        installed: true,
        meetRequirement: true,
        name: 'node',
        requiredVersion: undefined,
        version: 'v18.16.0',
        installInstructions: undefined,
      });
    });

    it('should parse version when versionParsingRequired is true', async () => {
      const mockDependency: SystemDependency = {
        name: 'python',
        checkCommand: 'python --version',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: 'Python 3.10.5\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.version).toBe('3.10.5');
      expect(result.installed).toBe(true);
    });

    it('should handle version with v prefix in parsing', async () => {
      const mockDependency: SystemDependency = {
        name: 'node',
        checkCommand: 'node --version',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: 'v20.1.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.version).toBe('v20.1.0');
      expect(result.installed).toBe(true);
    });

    it('should check version with >= operator', async () => {
      const mockDependency: SystemDependency = {
        name: 'node',
        checkCommand: 'node --version',
        requiredVersion: '>=18.0.0',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: 'v20.1.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.meetRequirement).toBe(true);
      expect(result.installed).toBe(true);
      expect(result.version).toBe('v20.1.0');
    });

    it('should fail version check with >= operator when version is lower', async () => {
      const mockDependency: SystemDependency = {
        name: 'node',
        checkCommand: 'node --version',
        requiredVersion: '>=20.0.0',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: 'v18.16.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.meetRequirement).toBe(false);
      expect(result.installed).toBe(true);
    });

    it('should check version with > operator', async () => {
      const mockDependency: SystemDependency = {
        name: 'python',
        checkCommand: 'python --version',
        requiredVersion: '>3.0.0',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: 'Python 3.10.5\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.meetRequirement).toBe(true);
    });

    it('should check version with <= operator', async () => {
      const mockDependency: SystemDependency = {
        name: 'tool',
        checkCommand: 'tool --version',
        requiredVersion: '<=2.0.0',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: '1.5.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.meetRequirement).toBe(true);
    });

    it('should check version with < operator', async () => {
      const mockDependency: SystemDependency = {
        name: 'tool',
        checkCommand: 'tool --version',
        requiredVersion: '<2.0.0',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: '2.5.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.meetRequirement).toBe(false);
    });

    it('should check version with = operator (default)', async () => {
      const mockDependency: SystemDependency = {
        name: 'tool',
        checkCommand: 'tool --version',
        requiredVersion: '3.0.0',
        versionParsingRequired: true,
      };

      mockExecPromise.mockResolvedValue({ stdout: '3.0.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.meetRequirement).toBe(true);
    });

    it('should use default check command when not provided', async () => {
      const mockDependency: SystemDependency = {
        name: 'git',
      };

      mockExecPromise.mockResolvedValue({ stdout: 'git version 2.39.0\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installed).toBe(true);
    });

    it('should handle stderr without stdout as error', async () => {
      const mockDependency: SystemDependency = {
        name: 'invalid-tool',
        checkCommand: 'invalid-tool --version',
      };

      mockExecPromise.mockResolvedValue({ stdout: '', stderr: 'command not found' });

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installed).toBe(false);
      expect(result.meetRequirement).toBe(false);
      expect(result.error).toBe('command not found');
    });

    it('should handle command execution error', async () => {
      const mockDependency: SystemDependency = {
        name: 'missing-tool',
        checkCommand: 'missing-tool --version',
      };

      mockExecPromise.mockRejectedValue(new Error('command not found'));

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installed).toBe(false);
      expect(result.meetRequirement).toBe(false);
      expect(result.error).toBe('command not found');
    });

    it('should handle unknown error types', async () => {
      const mockDependency: SystemDependency = {
        name: 'tool',
        checkCommand: 'tool --version',
      };

      mockExecPromise.mockRejectedValue('string error');

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installed).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should include install instructions on macOS', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      });

      const mockDependency: SystemDependency = {
        name: 'brew',
        checkCommand: 'brew --version',
        installInstructions: {
          macos: 'Install via Homebrew',
          linux: 'Use apt-get',
          manual: 'Download from website',
        },
      } as any;

      mockExecPromise.mockRejectedValue(new Error('not found'));

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installInstructions).toEqual({
        current: 'Install via Homebrew',
        manual: 'Download from website',
      });

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
    });

    it('should include install instructions on Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      });

      const mockDependency: SystemDependency = {
        name: 'tool',
        checkCommand: 'tool --version',
        installInstructions: {
          linux_debian: 'apt-get install tool',
          manual: 'Manual install',
        },
      } as any;

      mockExecPromise.mockRejectedValue(new Error('not found'));

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installInstructions).toEqual({
        current: 'apt-get install tool',
        manual: 'Manual install',
      });

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
    });

    it('should fallback to linux instruction when linux_debian is not available', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      });

      const mockDependency: SystemDependency = {
        name: 'tool',
        checkCommand: 'tool --version',
        installInstructions: {
          linux: 'Generic linux install',
          manual: 'Manual install',
        },
      } as any;

      mockExecPromise.mockRejectedValue(new Error('not found'));

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installInstructions?.current).toBe('Generic linux install');

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
    });

    it('should include install instructions on Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      });

      const mockDependency: SystemDependency = {
        name: 'tool',
        checkCommand: 'tool --version',
        installInstructions: {
          windows: 'Install via Chocolatey',
          manual: 'Download from website',
        },
      } as any;

      mockExecPromise.mockRejectedValue(new Error('not found'));

      const result = await mcpSystemDepsCheckService.checkSystemDependency(mockDependency);

      expect(result.installInstructions).toEqual({
        current: 'Install via Chocolatey',
        manual: 'Download from website',
      });

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
      });
    });
  });

  describe('checkDeployOption', () => {
    it('should use installation checker when available', async () => {
      const mockChecker: InstallationChecker = {
        checkPackageInstalled: vi.fn().mockResolvedValue({
          installed: true,
          packageName: 'test-package',
        }),
      };

      mcpSystemDepsCheckService.registerChecker('npm', mockChecker);

      const mockOption: DeploymentOption = {
        installationMethod: 'npm',
        installationDetails: { packageName: 'test-package' },
        connection: {
          command: 'node',
          args: ['index.js'],
        },
      } as any;

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(mockChecker.checkPackageInstalled).toHaveBeenCalledWith({
        packageName: 'test-package',
      });
      expect(result.packageInstalled).toBe(true);
    });

    it('should set connection type to http when url is provided', async () => {
      const mockOption: DeploymentOption = {
        installationMethod: 'manual',
        installationDetails: {},
        connection: {
          url: 'http://localhost:3000',
        },
      } as any;

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(result.connection.type).toBe('http');
      expect(result.connection.url).toBe('http://localhost:3000');
    });

    it('should detect configuration requirements from required array', async () => {
      const mockOption: DeploymentOption = {
        installationMethod: 'npm',
        installationDetails: { packageName: 'test-package' },
        connection: {
          command: 'node',
          args: ['index.js'],
          configSchema: {
            type: 'object',
            required: ['apiKey'],
            properties: {
              apiKey: { type: 'string' },
            },
          },
        },
      } as any;

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(result.needsConfig).toBe(true);
      expect(result.configSchema).toBeDefined();
    });

    it('should detect configuration requirements from property-level required flag', async () => {
      const mockOption: DeploymentOption = {
        installationMethod: 'npm',
        installationDetails: { packageName: 'test-package' },
        connection: {
          command: 'node',
          args: ['index.js'],
          configSchema: {
            type: 'object',
            properties: {
              apiKey: { type: 'string', required: true },
            },
          },
        },
      } as any;

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(result.needsConfig).toBe(true);
    });

    it('should not require config when schema has no required fields', async () => {
      const mockOption: DeploymentOption = {
        installationMethod: 'npm',
        installationDetails: { packageName: 'test-package' },
        connection: {
          command: 'node',
          args: ['index.js'],
          configSchema: {
            type: 'object',
            properties: {
              optional: { type: 'string' },
            },
          },
        },
      } as any;

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(result.needsConfig).toBe(false);
    });

    it('should not require config when schema has empty required array', async () => {
      const mockOption: DeploymentOption = {
        installationMethod: 'npm',
        installationDetails: { packageName: 'test-package' },
        connection: {
          command: 'node',
          args: ['index.js'],
          configSchema: {
            type: 'object',
            required: [],
            properties: {
              optional: { type: 'string' },
            },
          },
        },
      } as any;

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(result.needsConfig).toBe(false);
    });

    it('should include isRecommended flag from deployment option', async () => {
      const mockOption: DeploymentOption = {
        installationMethod: 'npm',
        installationDetails: { packageName: 'test-package' },
        isRecommended: true,
        connection: {
          command: 'node',
          args: ['index.js'],
        },
      } as any;

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(result.isRecommended).toBe(true);
    });

    it('should handle multiple system dependencies', async () => {
      const mockOption: DeploymentOption = {
        installationMethod: 'npm',
        installationDetails: { packageName: 'test-package' },
        systemDependencies: [
          {
            name: 'node',
            checkCommand: 'node --version',
            requiredVersion: '>=18.0.0',
            versionParsingRequired: true,
          },
          {
            name: 'python',
            checkCommand: 'python --version',
            requiredVersion: '>=3.0.0',
            versionParsingRequired: true,
          },
        ],
        connection: {
          command: 'node',
          args: ['index.js'],
        },
      } as any;

      mockExecPromise
        .mockResolvedValueOnce({ stdout: 'v20.1.0\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'Python 3.10.5\n', stderr: '' });

      const result = await mcpSystemDepsCheckService.checkDeployOption(mockOption);

      expect(result.systemDependencies).toHaveLength(2);
      expect(result.allDependenciesMet).toBe(true);
      expect(result.systemDependencies[0]!.name).toBe('node');
      expect(result.systemDependencies[1]!.name).toBe('python');
    });
  });
});
