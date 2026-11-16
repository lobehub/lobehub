import { exportJSONFile } from '@lobechat/utils/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCacheScope } from '@/libs/swr/useCacheScope';

import { configService } from '../config';
import { exportService } from '../export';

vi.mock('@lobechat/utils/client', () => ({
  downloadFile: vi.fn(),
  exportJSONFile: vi.fn(),
}));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: vi.fn(() => 'user_1:personal'),
}));

vi.mock('../export', () => ({
  exportService: { exportData: vi.fn() },
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const exportResult = { data: {}, schemaHash: 'hash' } as any;

describe('configService.exportAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCacheScope).mockReturnValue('user_1:personal');
  });

  it('shares one running export between repeated calls', async () => {
    const pending = deferred<any>();
    vi.mocked(exportService.exportData).mockReturnValue(pending.promise);

    const first = configService.exportAll();
    const second = configService.exportAll();
    const third = configService.exportAll();

    pending.resolve(exportResult);
    await Promise.all([first, second, third]);

    expect(exportService.exportData).toHaveBeenCalledTimes(1);
    expect(exportJSONFile).toHaveBeenCalledTimes(1);
  });

  it('starts a new export once the previous one has settled', async () => {
    vi.mocked(exportService.exportData).mockResolvedValue(exportResult);

    await configService.exportAll();
    await configService.exportAll();

    expect(exportService.exportData).toHaveBeenCalledTimes(2);
  });

  it('allows a retry after a failed export', async () => {
    vi.mocked(exportService.exportData)
      .mockRejectedValueOnce(new Error('Invalid string length'))
      .mockResolvedValueOnce(exportResult);

    await expect(configService.exportAll()).rejects.toThrow('Invalid string length');
    await configService.exportAll();

    expect(exportService.exportData).toHaveBeenCalledTimes(2);
    expect(exportJSONFile).toHaveBeenCalledTimes(1);
  });

  it('does not merge exports of different workspaces', async () => {
    const workspaceExport = deferred<any>();
    vi.mocked(exportService.exportData)
      .mockReturnValueOnce(workspaceExport.promise)
      .mockResolvedValueOnce(exportResult);

    vi.mocked(getCacheScope).mockReturnValue('user_1:ws_a');
    const fromWorkspace = configService.exportAll();

    vi.mocked(getCacheScope).mockReturnValue('user_1:personal');
    await configService.exportAll();

    expect(exportService.exportData).toHaveBeenCalledTimes(2);

    workspaceExport.resolve(exportResult);
    await fromWorkspace;
    expect(exportJSONFile).toHaveBeenCalledTimes(2);
  });
});
