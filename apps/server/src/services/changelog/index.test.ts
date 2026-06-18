// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChangelogIndexItem } from '@/types/changelog';

import { ChangelogService } from './index';

// Mock external dependencies
vi.mock('dayjs', () => ({
  default: (date: string) => ({
    format: vi.fn().mockReturnValue(date),
  }),
}));

vi.mock('gray-matter', () => ({
  default: vi.fn().mockImplementation((text) => ({
    data: { date: '2023-01-01' },
    content: text,
  })),
}));

vi.mock('@/utils/markdownToTxt', () => ({
  default: vi.fn().mockImplementation((text: string) => text),
  markdownToTxt: vi.fn().mockImplementation((text: string) => text),
}));

vi.mock('semver', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    rcompare: vi.fn().mockImplementation((a, b) => b.localeCompare(a)),
    lt: vi.fn().mockImplementation((a, b) => a < b),
    gt: vi.fn().mockImplementation((a, b) => a > b),
    parse: vi.fn().mockImplementation((v) => ({ toString: () => v })),
  };
});

// 模拟 process.env
const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('ChangelogService', () => {
  let service: ChangelogService;

  beforeEach(() => {
    service = new ChangelogService();
    // Mock fetch globally
    global.fetch = vi.fn();
  });

  describe('getLatestChangelogId', () => {
    it('should return the id of the first changelog item', async () => {
      const mockIndex = [{ id: 'latest' }, { id: 'older' }];
      vi.spyOn(service, 'getChangelogIndex').mockResolvedValue(mockIndex as ChangelogIndexItem[]);

      const result = await service.getLatestChangelogId();
      expect(result).toBe('latest');
    });

    it('should return undefined if the index is empty', async () => {
      vi.spyOn(service, 'getChangelogIndex').mockResolvedValue([]);

      const result = await service.getLatestChangelogId();
      expect(result).toBeUndefined();
    });
  });

  describe('getChangelogIndex', () => {
    it('should fetch and merge changelog data', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          cloud: [{ id: 'cloud1', date: '2023-01-01', versionRange: ['1.0.0'] }],
          community: [{ id: 'community1', date: '2023-01-02', versionRange: ['1.1.0'] }],
        }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await service.getChangelogIndex();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('community1');
      expect(result[1].id).toBe('cloud1');
    });

    it('should handle fetch errors', async () => {
      (global.fetch as any).mockRejectedValue(
        new Error('Fetch failed', { cause: { code: 'Timeout' } }),
      );

      const result = await service.getChangelogIndex();
      expect(result).toEqual([]);
    });

    it('should return only community items when config type is community', async () => {
      service.config.type = 'community';
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          cloud: [{ id: 'cloud1', date: '2023-01-01', versionRange: ['1.0.0'] }],
          community: [{ id: 'community1', date: '2023-01-02', versionRange: ['1.1.0'] }],
        }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await service.getChangelogIndex();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('community1');
    });
  });

  describe('getIndexItemById', () => {
    it('should return the correct item by id', async () => {
      const mockIndex = [
        { id: 'item1', date: '2023-01-01', versionRange: ['1.0.0'] },
        { id: 'item2', date: '2023-01-02', versionRange: ['1.1.0'] },
      ];
      vi.spyOn(service, 'getChangelogIndex').mockResolvedValue(mockIndex as ChangelogIndexItem[]);

      const result = await service.getIndexItemById('item2');
      expect(result).toEqual({ id: 'item2', date: '2023-01-02', versionRange: ['1.1.0'] });
    });

    it('should return undefined for non-existent id', async () => {
      vi.spyOn(service, 'getChangelogIndex').mockResolvedValue([]);

      const result = await service.getIndexItemById('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getPostById', () => {
    it('should fetch and parse post content', async () => {
      vi.spyOn(service, 'getIndexItemById').mockResolvedValue({
        id: 'post1',
        date: '2023-01-01',
        versionRange: ['1.0.0'],
      } as ChangelogIndexItem);

      const mockResponse = {
        text: vi.fn().mockResolvedValue('# Post Title\nPost content'),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await service.getPostById('post1');
      expect(result).toMatchObject({
        content: 'Post content',
        date: expect.any(String), // 改为期望字符串而不是 Date 对象
        description: 'Post content',
        image: undefined,
        rawTitle: 'Post Title',
        tags: ['changelog'],
        title: 'Post Title',
      });

      // 额外检查日期格式
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle fetch errors', async () => {
      vi.spyOn(service, 'getIndexItemById').mockResolvedValue({} as ChangelogIndexItem);
      (global.fetch as any).mockRejectedValue(new Error('Fetch failed'));

      const result = await service.getPostById('error');
      expect(result).toBe(false);
    });

    it('should use the correct locale for fetching content', async () => {
      vi.spyOn(service, 'getIndexItemById').mockResolvedValue({
        id: 'post1',
        date: '2023-01-01',
        versionRange: ['1.0.0'],
      } as ChangelogIndexItem);

      const mockResponse = {
        text: vi.fn().mockResolvedValue('# Chinese Title\n中文内容'),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await service.getPostById('post1', { locale: 'zh-CN' });
      expect(result).toEqual({
        content: '中文内容',
        date: '2023-01-01',
        description: '中文内容',
        image: undefined,
        rawTitle: 'Chinese Title',
        tags: ['changelog'],
        title: 'Chinese Title',
      });
    });
  });

  describe('private methods', () => {
    describe('mergeChangelogs', () => {
      it('should merge and sort changelogs correctly', () => {
        const cloud = [{ id: 'cloud1', date: '2023-01-01', versionRange: ['1.0.0'] }];
        const community = [{ id: 'community1', date: '2023-01-02', versionRange: ['1.1.0'] }];

        // @ts-ignore - accessing private method for testing
        const result = service.mergeChangelogs(cloud, community);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('community1');
        expect(result[1].id).toBe('cloud1');
      });

      it('should override community items with cloud items when ids match', () => {
        const cloud = [{ id: 'item1', date: '2023-01-01', versionRange: ['1.0.0'], type: 'cloud' }];
        const community = [
          { id: 'item1', date: '2023-01-01', versionRange: ['1.0.0'], type: 'community' },
        ];

        // @ts-ignore - accessing private method for testing
        const result = service.mergeChangelogs(cloud, community);
        expect(result).toHaveLength(1);
        // @ts-ignore
        expect(result[0].type).toBe('cloud');
      });
    });

    describe('formatVersionRange', () => {
      it('should format version range correctly', () => {
        // @ts-ignore - accessing private method for testing
        const result = service.formatVersionRange(['1.0.0', '1.1.0']);
        expect(result).toEqual(['1.0.0', '1.1.0']);
      });

      it('should return single version as is', () => {
        // @ts-ignore - accessing private method for testing
        const result = service.formatVersionRange(['1.0.0']);
        expect(result).toEqual(['1.0.0']);
      });
    });

    describe('genUrl', () => {
      it('should generate correct URL', () => {
        // @ts-ignore - accessing private method for testing
        const result = service.genUrl('test/path');
        expect(result).toBe('https://raw.githubusercontent.com/lobehub/lobe-chat/main/test/path');
      });
    });

    describe('extractHttpsLinks', () => {
      it('should extract HTTPS links from text', () => {
        const text = 'Text with https://example.com and https://test.com/image.jpg links';
        // @ts-ignore - accessing private method for testing
        const result = service.extractHttpsLinks(text);
        expect(result).toEqual(['https://example.com', 'https://test.com/image.jpg']);
      });
    });

    describe('cdnInit', () => {
      it('should initialize CDN URLs if docCdnPrefix is set', async () => {
        // 设置环境变量
        process.env.DOC_S3_PUBLIC_DOMAIN = 'https://cdn.example.com';

        // 重新导入模块以确保环境变量生效
        const { ChangelogService } = await import('./index');
        const service = new ChangelogService();

        const mockData = { 'https://example.com/image.jpg': 'image-hash.jpg' };
        const mockResponse = {
          json: vi.fn().mockResolvedValue(mockData),
        };
        global.fetch = vi.fn().mockResolvedValue(mockResponse);

        // @ts-ignore - accessing private method for testing
        await service.cdnInit();

        expect(service.cdnUrls).toEqual(mockData);
      });
    });

    describe('replaceCdnUrl', () => {
      it('should replace /blog URL with CDN URL', () => {
        // @ts-ignore - accessing private method for testing
        const result = service.replaceCdnUrl('/blog/image.jpg');

        expect(result).toBe('https://hub-apac-1.lobeobjects.space/blog/image.jpg');
      });

      it('should return original URL if not starting with /blog', () => {
        // @ts-ignore - accessing private method for testing
        const result = service.replaceCdnUrl('https://example.com/image.jpg');
        expect(result).toBe('https://example.com/image.jpg');
      });
    });
  });
});
