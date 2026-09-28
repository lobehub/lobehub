import { describe, expect, it, vi } from 'vitest';

import config from './tsdown.config';

const resolveInputOptions = async () => {
  const { inputOptions } = config as {
    inputOptions: (options: Record<string, any>, ...rest: any[]) => Promise<any> | any;
  };

  const options: Record<string, any> = {};
  await inputOptions(options, 'esm', { cjsDts: false });

  return options;
};

describe('CLI build configuration', () => {
  it('bundles ws so the desktop-embedded CLI runs without node_modules', () => {
    expect(config).toEqual(
      expect.objectContaining({
        deps: expect.objectContaining({ alwaysBundle: expect.arrayContaining(['ws']) }),
      }),
    );
  });

  it('fails the build instead of externalizing an unresolved import', async () => {
    const { onLog } = await resolveInputOptions();

    expect(() =>
      onLog(
        'warn',
        {
          code: 'UNRESOLVED_IMPORT',
          message: `Could not resolve '@lobechat/device-control' in src/commands/connect.ts`,
        },
        vi.fn(),
      ),
    ).toThrow('@lobechat/device-control');
  });

  it('forwards every other log to the default handler', async () => {
    const { onLog } = await resolveInputOptions();
    const defaultHandler = vi.fn();
    const log = { code: 'INEFFECTIVE_DYNAMIC_IMPORT', message: 'dynamic import will not move' };

    onLog('warn', log, defaultHandler);

    expect(defaultHandler).toHaveBeenCalledWith('warn', log);
  });
});
