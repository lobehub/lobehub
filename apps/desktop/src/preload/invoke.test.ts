import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron module
const mockIpcRendererInvoke = vi.fn();

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mockIpcRendererInvoke,
  },
}));

const { invoke } = await import('./invoke');

describe('invoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should invoke ipcRenderer with correct event name and no data', async () => {
    const expectedResult = { success: true };
    mockIpcRendererInvoke.mockResolvedValue(expectedResult);

    const result = await invoke('system.getAppVersion');

    expect(mockIpcRendererInvoke).toHaveBeenCalledWith('system.getAppVersion');
    expect(mockIpcRendererInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expectedResult);
  });

  it('should invoke ipcRenderer with event name and single data parameter', async () => {
    const eventData = { path: '/settings' };
    const expectedResult = { navigated: true };
    mockIpcRendererInvoke.mockResolvedValue(expectedResult);

    const result = await invoke('windows.interceptRoute', eventData);

    expect(mockIpcRendererInvoke).toHaveBeenCalledWith('windows.interceptRoute', eventData);
    expect(mockIpcRendererInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expectedResult);
  });

  it('should invoke ipcRenderer with event name and multiple data parameters', async () => {
    const param1 = 'test-param-1';
    const param2 = { value: 42 };
    const param3 = [1, 2, 3];
    const expectedResult = { processed: true };
    mockIpcRendererInvoke.mockResolvedValue(expectedResult);

    // Use 'as any' to bypass type checking for testing multiple parameters
    const result = await (invoke as any)('someEvent', param1, param2, param3);

    expect(mockIpcRendererInvoke).toHaveBeenCalledWith('someEvent', param1, param2, param3);
    expect(mockIpcRendererInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expectedResult);
  });

  it('should handle ipcRenderer invoke rejection', async () => {
    const error = new Error('IPC communication failed');
    mockIpcRendererInvoke.mockRejectedValue(error);

    await expect(invoke('system.getAppVersion')).rejects.toThrow('IPC communication failed');
    expect(mockIpcRendererInvoke).toHaveBeenCalledWith('system.getAppVersion');
  });

  it('should handle ipcRenderer returning undefined', async () => {
    mockIpcRendererInvoke.mockResolvedValue(undefined);

    const result = await invoke('someEvent');

    expect(mockIpcRendererInvoke).toHaveBeenCalledWith('someEvent');
    expect(result).toBeUndefined();
  });

  it('should handle ipcRenderer returning null', async () => {
    mockIpcRendererInvoke.mockResolvedValue(null);

    const result = await invoke('someEvent');

    expect(mockIpcRendererInvoke).toHaveBeenCalledWith('someEvent');
    expect(result).toBeNull();
  });

  it('should preserve complex data structures', async () => {
    const complexData = {
      array: [1, 2, 3],
      nested: {
        bool: true,
        null: null,
        string: 'test',
        undefined: undefined,
      },
      number: 42,
    };
    mockIpcRendererInvoke.mockResolvedValue(complexData);

    const result = await invoke('getData');

    expect(result).toEqual(complexData);
  });

  it('should maintain type safety with generic return type', async () => {
    interface TestResponse {
      message: string;
      status: number;
    }

    const expectedResponse: TestResponse = { message: 'success', status: 200 };
    mockIpcRendererInvoke.mockResolvedValue(expectedResponse);

    // Use 'as any' to bypass type checking for testing with mock event
    const result = (await (invoke as any)('testEvent')) as TestResponse;

    expect(result).toEqual(expectedResponse);
    expect(typeof result.message).toBe('string');
    expect(typeof result.status).toBe('number');
  });

  it('should handle concurrent invocations correctly', async () => {
    mockIpcRendererInvoke
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 3 });

    const [result1, result2, result3] = await Promise.all([
      invoke('event1'),
      invoke('event2'),
      invoke('event3'),
    ]);

    expect(result1).toEqual({ id: 1 });
    expect(result2).toEqual({ id: 2 });
    expect(result3).toEqual({ id: 3 });
    expect(mockIpcRendererInvoke).toHaveBeenCalledTimes(3);
  });

  it('should handle empty string as data parameter', async () => {
    mockIpcRendererInvoke.mockResolvedValue({ received: '' });

    const result = await invoke('sendData', '');

    expect(mockIpcRendererInvoke).toHaveBeenCalledWith('sendData', '');
    expect(result).toEqual({ received: '' });
  });
});
