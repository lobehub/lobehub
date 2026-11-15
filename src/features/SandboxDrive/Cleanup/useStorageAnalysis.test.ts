import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStorageAnalysis } from './useStorageAnalysis';

const service = vi.hoisted(() => ({ analyzeStorage: vi.fn(), deleteFiles: vi.fn() }));
const refreshDrive = vi.hoisted(() => vi.fn());

vi.mock('@/services/sandboxStorage', () => ({ sandboxStorageService: service }));
vi.mock('../useDriveData', () => ({ useRefreshDrive: () => refreshDrive }));

const items = [
  {
    bytes: 500,
    category: 'dependencies',
    isDirectory: true,
    path: 'app/node_modules',
    regenerable: true,
  },
  { bytes: 300, category: 'other', isDirectory: false, path: 'app/data.bin', regenerable: false },
] as const;

const done = {
  result: {
    categories: [
      { bytes: 500, category: 'dependencies', items: 1 },
      { bytes: 300, category: 'other', items: 1 },
    ],
    items: [...items],
    largestDirectories: [],
    largestFiles: [],
    totalBytes: 800,
  },
  scannedBytes: 800,
  status: 'done',
};

beforeEach(() => {
  service.analyzeStorage.mockReset();
  service.deleteFiles.mockReset();
  refreshDrive.mockReset().mockResolvedValue(undefined);
});

describe('useStorageAnalysis', () => {
  it('should step a large drive until the scan is done, showing progress meanwhile', async () => {
    service.analyzeStorage
      .mockResolvedValueOnce({ ...done, scannedBytes: 100, status: 'scanning' })
      .mockResolvedValueOnce(done);

    const { result } = renderHook(() => useStorageAnalysis('personal'));

    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(service.analyzeStorage).toHaveBeenCalledTimes(2);
    expect(service.analyzeStorage.mock.calls[0][0]).toEqual({
      drive: 'personal',
      restart: false,
      top: 50,
    });
    expect(result.current.analysis?.status).toBe('done');
  });

  it('should restart only the first call of a rescan', async () => {
    service.analyzeStorage.mockResolvedValue(done);
    const { result } = renderHook(() => useStorageAnalysis('public'));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    service.analyzeStorage
      .mockReset()
      .mockResolvedValueOnce({ ...done, status: 'scanning' })
      .mockResolvedValueOnce(done);
    await act(() => result.current.rescan());

    expect(service.analyzeStorage.mock.calls.map((call) => call[0].restart)).toEqual([true, false]);
  });

  it('should keep the error of a scan that failed', async () => {
    service.analyzeStorage.mockRejectedValue(new Error('storage_analysis_unavailable'));
    const { result } = renderHook(() => useStorageAnalysis('personal'));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.scanning).toBe(false);
  });

  it('should keep deleting what ran out of time, then take it off the figures', async () => {
    service.analyzeStorage.mockResolvedValue(done);
    service.deleteFiles
      .mockResolvedValueOnce({
        deleted: ['app/node_modules'],
        done: false,
        freedBytes: 100,
        missing: [],
        pending: ['app/data.bin'],
      })
      .mockResolvedValueOnce({
        deleted: ['app/data.bin'],
        done: true,
        freedBytes: 200,
        missing: [],
        pending: [],
      });
    const { result } = renderHook(() => useStorageAnalysis('personal'));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.remove>> | undefined;
    await act(async () => {
      outcome = await result.current.remove([...items]);
    });

    expect(service.deleteFiles.mock.calls.map((call) => call[0].paths)).toEqual([
      ['app/node_modules', 'app/data.bin'],
      ['app/data.bin'],
    ]);
    expect(outcome).toEqual({ failed: [], freedBytes: 300, pending: [] });
    expect(result.current.analysis?.result?.items).toEqual([]);
    expect(result.current.analysis?.result?.totalBytes).toBe(0);
    // The usage figure and listings reload to show the space coming back.
    expect(refreshDrive).toHaveBeenCalled();
  });

  it('should leave in the figures what could not be deleted in time', async () => {
    service.analyzeStorage.mockResolvedValue(done);
    service.deleteFiles.mockResolvedValue({
      deleted: [],
      done: false,
      freedBytes: 0,
      missing: [],
      pending: ['app/data.bin'],
    });
    const { result } = renderHook(() => useStorageAnalysis('personal'));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.remove>> | undefined;
    await act(async () => {
      outcome = await result.current.remove([items[1]]);
    });

    expect(outcome?.pending).toEqual(['app/data.bin']);
    expect(result.current.analysis?.result?.items.map((item) => item.path)).toContain(
      'app/data.bin',
    );
  });
});

describe('useStorageAnalysis failures', () => {
  it('should keep in the figures what the volume refused to remove', async () => {
    service.analyzeStorage.mockResolvedValue(done);
    service.deleteFiles.mockResolvedValue({
      deleted: ['app/node_modules'],
      done: true,
      failed: [{ message: 'busy', path: 'app/data.bin' }],
      freedBytes: 500,
      missing: [],
      pending: [],
    });
    const { result } = renderHook(() => useStorageAnalysis('personal'));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.remove>> | undefined;
    await act(async () => {
      outcome = await result.current.remove([...items]);
    });

    expect(outcome?.failed).toEqual(['app/data.bin']);
    expect(result.current.analysis?.result?.items.map((item) => item.path)).toEqual([
      'app/data.bin',
    ]);
  });

  it('should keep the figures on screen while another call advances the scan', async () => {
    service.analyzeStorage
      .mockResolvedValueOnce({ ...done, scannedBytes: 400, status: 'scanning' })
      .mockResolvedValueOnce({ scannedBytes: 0, status: 'running' })
      .mockResolvedValueOnce(done);
    const { result } = renderHook(() => useStorageAnalysis('personal'));

    await waitFor(() => expect(result.current.analysis?.status).toBe('running'));
    expect(result.current.analysis?.result).toBeDefined();
    expect(result.current.analysis?.scannedBytes).toBe(400);
    await waitFor(() => expect(result.current.scanning).toBe(false), { timeout: 5000 });
  });
});

describe('useStorageAnalysis large selections', () => {
  it('should send a selection over the server ceiling in batches of 100', async () => {
    const many = Array.from({ length: 230 }, (_, index) => ({
      bytes: 1,
      category: 'other' as const,
      isDirectory: false,
      path: `f/${index}.bin`,
      regenerable: false,
    }));
    service.analyzeStorage.mockResolvedValue({
      ...done,
      result: { ...done.result, items: many, totalBytes: 230 },
    });
    service.deleteFiles.mockImplementation(async ({ paths }: { paths: string[] }) => ({
      deleted: paths,
      done: true,
      failed: [],
      freedBytes: paths.length,
      missing: [],
      pending: [],
    }));
    const { result } = renderHook(() => useStorageAnalysis('personal'));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.remove>> | undefined;
    await act(async () => {
      outcome = await result.current.remove(many);
    });

    expect(service.deleteFiles.mock.calls.map((call) => call[0].paths.length)).toEqual([
      100, 100, 30,
    ]);
    expect(outcome).toEqual({ failed: [], freedBytes: 230, pending: [] });
    expect(result.current.analysis?.result?.items).toEqual([]);
  });
});

describe('useStorageAnalysis partial failure', () => {
  it('should reconcile what earlier batches deleted when a later batch fails', async () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      bytes: 1,
      category: 'other' as const,
      isDirectory: false,
      path: `f/${index}.bin`,
      regenerable: false,
    }));
    service.analyzeStorage.mockResolvedValue({
      ...done,
      result: { ...done.result, items: many, totalBytes: 150 },
    });
    service.deleteFiles
      .mockImplementationOnce(async ({ paths }: { paths: string[] }) => ({
        deleted: paths,
        done: true,
        failed: [],
        freedBytes: paths.length,
        missing: [],
        pending: [],
      }))
      .mockRejectedValueOnce(new Error('BAD_GATEWAY'));
    const { result } = renderHook(() => useStorageAnalysis('personal'));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    await act(async () => {
      await expect(result.current.remove(many)).rejects.toThrow('BAD_GATEWAY');
    });

    expect(result.current.analysis?.result?.items).toHaveLength(50);
    expect(refreshDrive).toHaveBeenCalled();
  });
});

describe('useStorageAnalysis estimates', () => {
  it('should mark the figures an estimate when the freed bytes differ from the scan', async () => {
    service.analyzeStorage.mockResolvedValue(done);
    service.deleteFiles.mockResolvedValue({
      deleted: ['app/data.bin'],
      done: true,
      failed: [],
      freedBytes: 999,
      missing: [],
      pending: [],
    });
    const { result } = renderHook(() => useStorageAnalysis('personal'));
    await waitFor(() => expect(result.current.scanning).toBe(false));

    await act(async () => {
      await result.current.remove([items[1]]);
    });

    expect(result.current.analysis?.result?.stale).toBe(true);
  });
});
