import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillResourceService } from './resource';

// Create mock functions that can be inspected
const mockCreateGlobalFile = vi.fn().mockResolvedValue({ fileHash: 'mock-file-hash' });
const mockGetFileContentByHash = vi.fn().mockResolvedValue('file content');
const mockGetFileByteArrayByHash = vi
  .fn()
  .mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
const mockUploadBuffer = vi.fn().mockResolvedValue({ key: 'mock-key' });

// Mock FileService only (no longer need FileModel)
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    createGlobalFile: mockCreateGlobalFile,
    getFileByteArrayByHash: mockGetFileByteArrayByHash,
    getFileContentByHash: mockGetFileContentByHash,
    uploadBuffer: mockUploadBuffer,
  })),
}));

describe('SkillResourceService', () => {
  describe('listResources (buildTree)', () => {
    it('should build flat file list', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = {
        'README.md': { fileHash: 'hash1', size: 100 },
        'config.json': { fileHash: 'hash2', size: 200 },
      };

      const tree = await service.listResources(resources);

      expect(tree).toHaveLength(2);
      expect(tree[0]).toEqual({
        children: undefined,
        name: 'README.md',
        path: 'README.md',
        type: 'file',
      });
      expect(tree[1]).toEqual({
        children: undefined,
        name: 'config.json',
        path: 'config.json',
        type: 'file',
      });
    });

    it('should build nested directory structure', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = {
        'lib/utils.ts': { fileHash: 'hash1', size: 100 },
        'lib/helpers.ts': { fileHash: 'hash2', size: 200 },
        'src/index.ts': { fileHash: 'hash3', size: 300 },
      };

      const tree = await service.listResources(resources);

      expect(tree).toHaveLength(2);

      // lib directory
      const libDir = tree.find((n) => n.name === 'lib');
      expect(libDir).toBeDefined();
      expect(libDir?.type).toBe('directory');
      expect(libDir?.children).toHaveLength(2);
      expect(libDir?.children?.map((c) => c.name).sort()).toEqual(['helpers.ts', 'utils.ts']);

      // src directory
      const srcDir = tree.find((n) => n.name === 'src');
      expect(srcDir).toBeDefined();
      expect(srcDir?.type).toBe('directory');
      expect(srcDir?.children).toHaveLength(1);
      expect(srcDir?.children?.[0].name).toBe('index.ts');
    });

    it('should build deeply nested structure', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = {
        'a/b/c/d.txt': { fileHash: 'hash1', size: 100 },
      };

      const tree = await service.listResources(resources);

      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('a');
      expect(tree[0].type).toBe('directory');
      expect(tree[0].children?.[0].name).toBe('b');
      expect(tree[0].children?.[0].children?.[0].name).toBe('c');
      expect(tree[0].children?.[0].children?.[0].children?.[0].name).toBe('d.txt');
      expect(tree[0].children?.[0].children?.[0].children?.[0].type).toBe('file');
    });

    it('should handle mixed files and directories', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = {
        'README.md': { fileHash: 'hash1', size: 100 },
        'lib/index.ts': { fileHash: 'hash2', size: 200 },
        'lib/utils/helper.ts': { fileHash: 'hash3', size: 300 },
      };

      const tree = await service.listResources(resources);

      expect(tree).toHaveLength(2);

      // README.md at root
      const readme = tree.find((n) => n.name === 'README.md');
      expect(readme?.type).toBe('file');

      // lib directory with nested utils
      const lib = tree.find((n) => n.name === 'lib');
      expect(lib?.type).toBe('directory');
      expect(lib?.children).toHaveLength(2);

      const utils = lib?.children?.find((n) => n.name === 'utils');
      expect(utils?.type).toBe('directory');
      expect(utils?.children?.[0].name).toBe('helper.ts');
    });

    it('should handle empty resources', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const tree = await service.listResources({});

      expect(tree).toEqual([]);
    });

    it('should sort paths alphabetically', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = {
        'z.txt': { fileHash: 'hash1', size: 100 },
        'a.txt': { fileHash: 'hash2', size: 200 },
        'm.txt': { fileHash: 'hash3', size: 300 },
      };

      const tree = await service.listResources(resources);

      expect(tree.map((n) => n.name)).toEqual(['a.txt', 'm.txt', 'z.txt']);
    });
  });

  describe('storeResources', () => {
    beforeEach(() => {
      mockCreateGlobalFile.mockClear();
      mockUploadBuffer.mockClear();
    });

    it('should store resources with zipHash prefix and return SkillResourceMeta', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = new Map([
        ['README.md', Buffer.from('# README')],
        ['lib/utils.ts', Buffer.from('export const util = 1')],
      ]);

      const result = await service.storeResources('abc123hash', resources);

      expect(Object.keys(result)).toHaveLength(2);
      // Result should be Record<VirtualPath, SkillResourceMeta>
      expect(result['README.md']).toHaveProperty('fileHash');
      expect(result['README.md'].fileHash).toHaveLength(64); // sha256 hash length
      expect(result['lib/utils.ts']).toHaveProperty('fileHash');
      expect(result['lib/utils.ts'].fileHash).toHaveLength(64);
    });

    it('should pass correct metadata to createGlobalFile', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = new Map([['docs/guide.md', Buffer.from('# Guide')]]);

      await service.storeResources('zip123', resources);

      expect(mockCreateGlobalFile).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: 'text/markdown',
          metadata: {
            dirname: 'skills/source_files/zip123/docs',
            filename: 'guide.md',
            path: 'skills/source_files/zip123/docs/guide.md',
          },
          url: 'skills/source_files/zip123/docs/guide.md',
        }),
      );
    });

    it('should pass correct metadata for root-level files', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = new Map([['README.md', Buffer.from('# README')]]);

      await service.storeResources('zip456', resources);

      expect(mockCreateGlobalFile).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            dirname: 'skills/source_files/zip456',
            filename: 'README.md',
            path: 'skills/source_files/zip456/README.md',
          },
        }),
      );
    });

    it('should handle empty resources', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = new Map<string, Buffer>();

      const result = await service.storeResources('abc123hash', resources);

      expect(result).toEqual({});
    });
  });

  describe('readResource', () => {
    it('should read text resource content with utf-8 encoding', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = { 'test.txt': { fileHash: 'abc123fileHash', size: 50 } };

      const result = await service.readResource(resources, 'test.txt');

      expect(result).toEqual({
        content: 'file content',
        encoding: 'utf-8',
        fileHash: 'abc123fileHash',
        fileType: 'text/plain',
        path: 'test.txt',
        size: Buffer.byteLength('file content', 'utf-8'),
      });
      expect(mockGetFileContentByHash).toHaveBeenCalledWith('abc123fileHash');
    });

    it('should read binary resource content with base64 encoding', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = { 'image.png': { fileHash: 'binaryFileHash', size: 1024 } };
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      mockGetFileByteArrayByHash.mockResolvedValue(binaryData);

      const result = await service.readResource(resources, 'image.png');

      expect(result).toEqual({
        content: Buffer.from(binaryData).toString('base64'),
        encoding: 'base64',
        fileHash: 'binaryFileHash',
        fileType: 'image/png',
        path: 'image.png',
        size: binaryData.length,
      });
      expect(mockGetFileByteArrayByHash).toHaveBeenCalledWith('binaryFileHash');
    });

    it('should throw error for non-existent path', async () => {
      const service = new SkillResourceService({} as any, 'user-1');
      const resources = { 'test.txt': { fileHash: 'abc123fileHash', size: 50 } };

      await expect(service.readResource(resources, 'non-existent.txt')).rejects.toThrow(
        'Resource not found: non-existent.txt',
      );
    });
  });
});
