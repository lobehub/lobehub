import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileService } from '@/server/services/file';

import { resolveRequestFileService } from './requestFileService';

vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));

const ctx = { serverDB: {} as never, userId: 'user-1', workspaceId: 'ws-1' };

beforeEach(() => {
  vi.mocked(FileService).mockReset();
});

describe('resolveRequestFileService', () => {
  it("builds the request user's file storage in their workspace", () => {
    vi.mocked(FileService).mockImplementation(function (this: object) {
      return this;
    } as never);

    expect(resolveRequestFileService(ctx)).toBeInstanceOf(FileService);
    expect(FileService).toHaveBeenCalledWith(ctx.serverDB, 'user-1', 'ws-1');
  });

  // An MCP call must still run where no file storage is configured
  it('resolves nothing when the storage cannot be built', () => {
    vi.mocked(FileService).mockImplementation(function () {
      throw new Error('S3 environment variables are not set completely, please check your env');
    } as never);

    expect(resolveRequestFileService(ctx)).toBeUndefined();
  });
});
