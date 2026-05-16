import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDetectionCache, getCachedDetection } from '../cache';
import { detectAllApps } from '../detectors';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../detectors', () => ({
  detectAllApps: vi.fn(),
}));

const mockedDetectAll = vi.mocked(detectAllApps);

beforeEach(() => {
  vi.clearAllMocks();
  clearDetectionCache();
});

describe('getCachedDetection', () => {
  it('invokes detection on first call', async () => {
    mockedDetectAll.mockResolvedValueOnce([
      { displayName: 'VS Code', id: 'vscode', installed: true },
    ]);

    const result = await getCachedDetection('darwin');

    expect(result).toEqual([{ displayName: 'VS Code', id: 'vscode', installed: true }]);
    expect(mockedDetectAll).toHaveBeenCalledTimes(1);
  });

  it('concurrent callers share a single inflight promise', async () => {
    let resolveFn: (value: any) => void = () => {};
    const inflight = new Promise<any>((resolve) => {
      resolveFn = resolve;
    });
    mockedDetectAll.mockReturnValueOnce(inflight);

    const p1 = getCachedDetection('darwin');
    const p2 = getCachedDetection('darwin');
    const p3 = getCachedDetection('darwin');

    expect(mockedDetectAll).toHaveBeenCalledTimes(1);

    resolveFn([{ displayName: 'VS Code', id: 'vscode', installed: true }]);
    const results = await Promise.all([p1, p2, p3]);

    // all three share the same resolved value
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    expect(mockedDetectAll).toHaveBeenCalledTimes(1);
  });

  it('subsequent serial calls reuse the cached promise', async () => {
    mockedDetectAll.mockResolvedValueOnce([
      { displayName: 'VS Code', id: 'vscode', installed: true },
    ]);

    await getCachedDetection('darwin');
    await getCachedDetection('darwin');
    await getCachedDetection('darwin');

    expect(mockedDetectAll).toHaveBeenCalledTimes(1);
  });

  it('re-invokes detection after clearDetectionCache', async () => {
    mockedDetectAll.mockResolvedValueOnce([
      { displayName: 'VS Code', id: 'vscode', installed: true },
    ]);
    await getCachedDetection('darwin');
    expect(mockedDetectAll).toHaveBeenCalledTimes(1);

    clearDetectionCache();
    mockedDetectAll.mockResolvedValueOnce([
      { displayName: 'VS Code', id: 'vscode', installed: false },
    ]);
    await getCachedDetection('darwin');

    expect(mockedDetectAll).toHaveBeenCalledTimes(2);
  });
});
