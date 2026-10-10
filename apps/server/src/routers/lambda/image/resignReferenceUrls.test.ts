import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resignOwnStorageReferenceUrls } from './resignReferenceUrls';

// The helper only reads `files.url` through a db select chain and resolves
// keys/urls through FileService, so mock those two seams; keep drizzle-orm
// itself real (the schemas module needs `relations` at import time).
const mockDbWhere = vi.hoisted(() => vi.fn(async () => [] as Array<{ url: string }>));
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn().mockReturnThis(),
    where: mockDbWhere,
  })),
}));

vi.mock('@/database/utils/workspace', () => ({
  buildWorkspaceWhere: vi.fn((ctx: unknown, cols: unknown) => ({ ctx, cols })),
}));

// Spy on the access-scope predicate: the unit under test must forward the
// caller's scope into the ownership query. The predicate's own semantics
// (ordinary callers never see share files) are covered in the database package.
const fileVisibilityMocks = vi.hoisted(() => ({
  fileMatchesAccessScope: vi.fn((metadata: unknown, scope: unknown) => ({ metadata, scope })),
}));
vi.mock('@/database/utils/fileVisibility', () => fileVisibilityMocks);

const createFileService = (
  overrides: {
    createPreSignedUrlForPreview?: (key: string) => Promise<string>;
    getKeyFromFullUrl?: (url: string) => Promise<string | null>;
  } = {},
) => ({
  createPreSignedUrlForPreview:
    overrides.createPreSignedUrlForPreview ??
    (async (key: string) => `https://storage.example.com/${key}?fresh=signature`),
  getKeyFromFullUrl: overrides.getKeyFromFullUrl ?? (async (_url: string) => null),
});

const ctx = (overrides: Record<string, unknown> = {}) => ({
  db: mockDb as never,
  fileService: createFileService() as never,
  userId: 'user-1',
  workspaceId: undefined,
  ...overrides,
});

const PRESIGNED =
  'https://bucket.example.com/files/496970/8a932b61.png?X-Amz-Credential=f6ccfc7b3525564c0e473abfda403fe7&X-Amz-Signature=280b';

describe('resignOwnStorageReferenceUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbWhere.mockReset();
    mockDbWhere.mockResolvedValue([]);
    fileVisibilityMocks.fileMatchesAccessScope.mockClear();
  });

  it('returns urls unchanged when none resolve to a storage key', async () => {
    const fileService = createFileService({ getKeyFromFullUrl: async () => null });
    const urls = ['https://cdn.example.com/a.png?v=1', 'files/plain-key.png'];

    const result = await resignOwnStorageReferenceUrls(urls, ctx({ fileService }));

    expect(result).toEqual(urls);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('re-signs urls whose key belongs to an accessible file record', async () => {
    const fileService = createFileService({
      getKeyFromFullUrl: async (url) =>
        url.startsWith('https://bucket.example.com/') ? 'files/496970/8a932b61.png' : null,
    });
    mockDbWhere.mockResolvedValue([{ url: 'files/496970/8a932b61.png' }]);

    const result = await resignOwnStorageReferenceUrls([PRESIGNED], ctx({ fileService }));

    expect(result).toEqual([
      'https://storage.example.com/files/496970/8a932b61.png?fresh=signature',
    ]);
  });

  it('keeps the original url when the key has no accessible file record', async () => {
    const signSpy = vi.fn(
      async (key: string) => `https://storage.example.com/${key}?fresh=signature`,
    );
    const fileService = createFileService({
      createPreSignedUrlForPreview: signSpy,
      getKeyFromFullUrl: async () => 'files/496970/other.png',
    });

    const result = await resignOwnStorageReferenceUrls([PRESIGNED], ctx({ fileService }));

    expect(result).toEqual([PRESIGNED]);
    expect(signSpy).not.toHaveBeenCalled();
  });

  it('handles a mixed list, preserving order', async () => {
    const fileService = createFileService({
      getKeyFromFullUrl: async (url) =>
        url.startsWith('https://own.example.com/')
          ? `own-key-${url.includes('one') ? '1' : '2'}.png`
          : null,
    });
    mockDbWhere.mockResolvedValue([{ url: 'own-key-1.png' }]);

    const result = await resignOwnStorageReferenceUrls(
      [
        'https://own.example.com/one.png?sig=aaa',
        'https://external.example.com/b.png',
        'https://own.example.com/two.png?sig=broken',
      ],
      ctx({ fileService }),
    );

    expect(result).toEqual([
      'https://storage.example.com/own-key-1.png?fresh=signature',
      'https://external.example.com/b.png',
      'https://own.example.com/two.png?sig=broken',
    ]);
  });

  it('keeps the original url when re-signing throws', async () => {
    const fileService = createFileService({
      createPreSignedUrlForPreview: async () => {
        throw new Error('s3 down');
      },
      getKeyFromFullUrl: async () => 'files/496970/8a932b61.png',
    });
    mockDbWhere.mockResolvedValue([{ url: 'files/496970/8a932b61.png' }]);

    const result = await resignOwnStorageReferenceUrls([PRESIGNED], ctx({ fileService }));

    expect(result).toEqual([PRESIGNED]);
  });

  it('keeps the original url when key extraction throws', async () => {
    const fileService = createFileService({
      getKeyFromFullUrl: async () => {
        throw new Error('boom');
      },
    });

    const result = await resignOwnStorageReferenceUrls([PRESIGNED], ctx({ fileService }));

    expect(result).toEqual([PRESIGNED]);
  });

  it('returns an empty list untouched', async () => {
    const result = await resignOwnStorageReferenceUrls([], ctx());
    expect(result).toEqual([]);
  });

  it('scopes the ownership query with the caller fileAccessScope when present', async () => {
    const fileService = createFileService({
      getKeyFromFullUrl: async () => 'files/496970/8a932b61.png',
    });
    mockDbWhere.mockResolvedValue([{ url: 'files/496970/8a932b61.png' }]);
    const scope = { shareId: 'share-1', type: 'agentShare', visitorUserId: 'visitor-1' } as const;

    const result = await resignOwnStorageReferenceUrls(
      [PRESIGNED],
      ctx({ fileAccessScope: scope, fileService }),
    );

    expect(fileVisibilityMocks.fileMatchesAccessScope).toHaveBeenCalledWith(
      expect.anything(),
      scope,
    );
    expect(result).toEqual([
      'https://storage.example.com/files/496970/8a932b61.png?fresh=signature',
    ]);
  });

  it('defaults to the ordinary scope so share files are never re-signed for regular callers', async () => {
    const fileService = createFileService({
      getKeyFromFullUrl: async () => 'files/496970/8a932b61.png',
    });
    mockDbWhere.mockResolvedValue([{ url: 'files/496970/8a932b61.png' }]);

    await resignOwnStorageReferenceUrls([PRESIGNED], ctx({ fileService }));

    expect(fileVisibilityMocks.fileMatchesAccessScope).toHaveBeenCalledWith(expect.anything(), {
      type: 'ordinary',
    });
  });
});
