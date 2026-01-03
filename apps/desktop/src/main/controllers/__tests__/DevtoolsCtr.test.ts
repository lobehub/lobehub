import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import DevtoolsCtr from '../DevtoolsCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// 模拟 App 及其依赖项
const mockShow = vi.fn();
const mockRetrieveByIdentifier = vi.fn(() => ({
  show: mockShow,
}));

// 创建一个足够模拟 App 行为的对象，以满足 DevtoolsCtr 的需求
const mockApp = {
  browserManager: {
    retrieveByIdentifier: mockRetrieveByIdentifier,
  },
  // 如果 DevtoolsCtr 或其基类在构造或方法调用中使用了 app 的其他属性/方法，
  // 也需要在这里添加相应的模拟
} as unknown as App; // 使用类型断言，因为我们只模拟了部分 App 结构

describe('DevtoolsCtr', () => {
  let devtoolsCtr: DevtoolsCtr;

  beforeEach(() => {
    vi.clearAllMocks(); // 只清除 vi.fn() 创建的模拟函数的记录，不影响 IoCContainer 状态
    ipcMainHandleMock.mockClear();

    // 实例化 DevtoolsCtr。其 @IpcMethod 装饰器会执行并与真实的 IoCContainer 交互。
    devtoolsCtr = new DevtoolsCtr(mockApp);
  });

  describe('openDevtools', () => {
    it('should retrieve the devtools browser window using app.browserManager and show it', async () => {
      await devtoolsCtr.openDevtools();

      // 验证 browserManager.retrieveByIdentifier 是否以 'devtools' 参数被调用
      expect(mockRetrieveByIdentifier).toHaveBeenCalledWith('devtools');
      // 验证返回对象的 show 方法是否被调用
      expect(mockShow).toHaveBeenCalled();
    });
  });
});
