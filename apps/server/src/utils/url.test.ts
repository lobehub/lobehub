// @vitest-environment node
import urlJoin from 'url-join';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 模拟 urlJoin 函数
vi.mock('url-join', () => ({
  default: vi.fn((...args) => args.join('/')),
}));

describe('getCanonicalUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 在每个测试前重置 process.env
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // 在每个测试后恢复原始的 process.env
    process.env = originalEnv;
  });

  it('should return correct URL for production environment', async () => {
    process.env.VERCEL = undefined;
    process.env.VERCEL_ENV = undefined;

    const { getCanonicalUrl } = await import('./url'); // 动态导入以获取最新的环境变量状态
    const result = getCanonicalUrl('path', 'to', 'page');
    expect(result).toBe('https://lobechat.com/path/to/page');
    expect(urlJoin).toHaveBeenCalledWith('https://lobechat.com', 'path', 'to', 'page');
  });

  it('should return correct URL for Vercel preview environment', async () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'preview-url.vercel.app';

    const { getCanonicalUrl } = await import('./url'); // 动态导入
    const result = getCanonicalUrl('path', 'to', 'page');
    expect(result).toBe('https://preview-url.vercel.app/path/to/page');
    expect(urlJoin).toHaveBeenCalledWith('https://preview-url.vercel.app', 'path', 'to', 'page');
  });

  it('should return production URL when VERCEL is set but VERCEL_ENV is production', async () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'production';

    const { getCanonicalUrl } = await import('./url'); // 动态导入
    const result = getCanonicalUrl('path', 'to', 'page');
    expect(result).toBe('https://lobechat.com/path/to/page');
    expect(urlJoin).toHaveBeenCalledWith('https://lobechat.com', 'path', 'to', 'page');
  });

  it('should work correctly without additional path arguments', async () => {
    const { getCanonicalUrl } = await import('./url'); // 动态导入
    const result = getCanonicalUrl();
    expect(result).toBe('https://lobechat.com');
    expect(urlJoin).toHaveBeenCalledWith('https://lobechat.com');
  });
});
