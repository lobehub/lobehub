import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { verifyFontListSignature } from '../verifyFontListSigning.mjs';

const createContext = (electronPlatformName) => ({
  appOutDir: path.join(path.sep, 'build', `${electronPlatformName}-unpacked`),
  electronPlatformName,
  packager: { appInfo: { productFilename: 'LobeHub' } },
});

describe('system font helper post-sign verification', () => {
  it('verifies the unpacked macOS helper without forwarding signing credentials', async () => {
    const resourcesPath = path.join(
      path.sep,
      'build',
      'darwin-unpacked',
      'LobeHub.app',
      'Contents',
      'Resources',
    );
    const execute = vi.fn();
    const logger = { info: vi.fn() };

    await expect(
      verifyFontListSignature(createContext('darwin'), {
        environment: {
          CSC_KEY_PASSWORD: 'password-that-must-not-be-forwarded',
          CSC_LINK: 'certificate-material-that-must-not-be-forwarded',
        },
        execute,
        logger,
      }),
    ).resolves.toEqual({ verified: true });

    expect(execute).toHaveBeenCalledOnce();
    const [executable, args, options] = execute.mock.calls[0];
    expect(executable).toBe('codesign');
    expect(args).toEqual([
      '--verify',
      '--strict',
      '--verbose=2',
      path.join(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'font-list',
        'libs',
        'darwin',
        'fontlist',
      ),
    ]);
    expect(options.env.CSC_KEY_PASSWORD).toBeUndefined();
    expect(options.env.CSC_LINK).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith('Verified system font helper code signature.');
  });

  it('skips unsigned macOS and unsupported platform builds', async () => {
    const execute = vi.fn();
    const logger = { info: vi.fn() };

    await expect(
      verifyFontListSignature(createContext('darwin'), {
        environment: {},
        execute,
        logger,
      }),
    ).resolves.toEqual({ verified: false });
    await expect(
      verifyFontListSignature(createContext('win32'), {
        environment: { CSC_LINK: 'configured' },
        execute,
        logger,
      }),
    ).resolves.toEqual({ verified: false });

    expect(execute).not.toHaveBeenCalled();
  });

  it('reports verification failure without exposing subprocess output', async () => {
    const subprocessError = new Error('sensitive subprocess output');

    await expect(
      verifyFontListSignature(createContext('darwin'), {
        environment: { CSC_LINK: 'configured' },
        execute: vi.fn(() => {
          throw subprocessError;
        }),
        logger: { info: vi.fn() },
      }),
    ).rejects.toMatchObject({
      cause: subprocessError,
      message: 'System font helper code-signature verification failed',
    });
  });
});
