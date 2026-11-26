import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkModels from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';
import { HeteroOperationPrincipalError } from '@/server/services/heterogeneousAgent/operationPrincipal';

import {
  AgentWorkRunError,
  parseCollectionImageRef,
  resolveAgentWorkCollectionItems,
  resolveAgentWorkFile,
  resolveAgentWorkRun,
} from './agentWork';

const mocks = vi.hoisted(() => ({
  fileAccessUrl: vi.fn(),
  findFile: vi.fn(),
  hasMembership: vi.fn(),
  principal: vi.fn(),
  shareVisitor: vi.fn(),
  workModelArgs: vi.fn(),
}));

vi.mock('@/database/models/workspace', () => ({
  hasActiveWorkspaceMembership: mocks.hasMembership,
}));
vi.mock('@/database/models/work', async (importOriginal) => ({
  AgentWorkError: (await importOriginal<typeof WorkModels>()).AgentWorkError,
  WorkModel: class {
    constructor(...args: unknown[]) {
      mocks.workModelArgs(...args);
    }
  },
}));
vi.mock('@/database/models/file', () => ({
  FileModel: class {
    findById = mocks.findFile;
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = mocks.fileAccessUrl;
  },
}));
vi.mock('@/server/services/heterogeneousAgent/operationPrincipal', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveActiveHeteroOperationPrincipal: mocks.principal,
}));
vi.mock('@/server/services/heterogeneousAgent/shareVisitor', () => ({
  resolveHeteroRunShareVisitor: mocks.shareVisitor,
}));

const claims = { operation_id: 'op_run', sub: 'user_1' } as HeteroOperationJwtClaims;
const operationAuth = { heteroAuthKind: 'operation', heteroOperation: claims };
const userAuth = { heteroAuthKind: 'user' };

const operationRow = (overrides: Record<string, unknown> = {}) => ({
  agentId: 'agt_1',
  status: 'running',
  threadId: null,
  topicId: 'tpc_1',
  userId: 'user_1',
  workspaceId: null,
  ...overrides,
});

const dbWith = (row: unknown) => {
  const query = {
    from: vi.fn(() => query),
    limit: vi.fn(async () => (row ? [row] : [])),
    where: vi.fn(() => query),
  };
  return { select: vi.fn(() => query) } as unknown as LobeChatDatabase;
};

const resolve = (row: unknown, auth: Record<string, unknown> = operationAuth) =>
  resolveAgentWorkRun({
    auth: auth as any,
    db: dbWith(row),
    operationId: 'op_run',
    userId: 'user_1',
  });

const expectStatus = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AgentWorkRunError);
  expect((error as AgentWorkRunError).status).toBe(status);
};

describe('resolveAgentWorkRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.principal.mockResolvedValue({ userId: 'user_1', workspaceId: undefined });
    mocks.shareVisitor.mockResolvedValue(undefined);
    mocks.hasMembership.mockResolvedValue(true);
  });

  it('resolves an operation token run to its topic under the ordinary scope', async () => {
    const { run, workspaceId } = await resolve(operationRow({ threadId: 'thd_1' }));

    expect(mocks.principal).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'work:write', claims, operationId: 'op_run' }),
    );
    expect(run).toEqual({
      agentId: 'agt_1',
      operationId: 'op_run',
      rootOperationId: 'op_run',
      threadId: 'thd_1',
      topicId: 'tpc_1',
      userId: 'user_1',
    });
    expect(workspaceId).toBeUndefined();
    expect(mocks.workModelArgs).toHaveBeenCalledWith(
      expect.anything(),
      'user_1',
      undefined,
      undefined,
    );
  });

  it("stamps a sub-agent run's Works with the root operation the run completes under", async () => {
    const rows = [
      operationRow({ parentOperationId: 'op_parent' }),
      { id: 'op_parent', parentOperationId: 'op_root' },
      { id: 'op_root', parentOperationId: null },
    ];
    const query = {
      from: vi.fn(() => query),
      limit: vi.fn(async () => [rows.shift()]),
      where: vi.fn(() => query),
    };

    const { run } = await resolveAgentWorkRun({
      auth: operationAuth as any,
      db: { select: vi.fn(() => query) } as unknown as LobeChatDatabase,
      operationId: 'op_run',
      userId: 'user_1',
    });

    // Authorization stays on the named operation; only the cost key moves up.
    expect(run.operationId).toBe('op_run');
    expect(run.rootOperationId).toBe('op_root');
  });

  it("fences a share visitor's run to the visitor topic", async () => {
    mocks.shareVisitor.mockResolvedValue({ shareId: 'shr_1', visitorUserId: 'visitor_1' });

    await resolve(operationRow());

    expect(mocks.workModelArgs).toHaveBeenCalledWith(expect.anything(), 'user_1', undefined, {
      shareId: 'shr_1',
      topicId: 'tpc_1',
      type: 'agentShare',
      visitorUserId: 'visitor_1',
    });
  });

  it('maps a refused operation token onto its status', async () => {
    mocks.principal.mockRejectedValue(
      new HeteroOperationPrincipalError('Operation token lacks work:write', 403),
    );
    await expectStatus(resolve(operationRow()), 403);
  });

  it('rejects a legacy operation token', async () => {
    await expectStatus(resolve(operationRow(), { heteroAuthKind: 'legacy-operation' }), 401);
  });

  it("does not reveal another user's operation", async () => {
    await expectStatus(resolve(operationRow({ userId: 'user_2' }), userAuth), 404);
    await expectStatus(resolve(undefined, userAuth), 404);
  });

  it('rejects an operation that has ended or has no conversation', async () => {
    await expectStatus(resolve(operationRow({ status: 'completed' })), 409);
    await expectStatus(resolve(operationRow({ topicId: null })), 409);
  });

  it('requires a user session to still be a member of the run workspace', async () => {
    mocks.hasMembership.mockResolvedValue(false);
    await expectStatus(resolve(operationRow({ workspaceId: 'ws_1' }), userAuth), 403);

    mocks.hasMembership.mockResolvedValue(true);
    const { workspaceId } = await resolve(operationRow({ workspaceId: 'ws_1' }), userAuth);
    expect(workspaceId).toBe('ws_1');
  });
});

describe('resolveAgentWorkFile', () => {
  beforeEach(() => vi.clearAllMocks());

  const runOutputFile = {
    fileType: 'application/pdf',
    id: 'file_1',
    size: 2048,
    source: 'tool-result',
    url: 'files/2026-11-19/hash.pdf',
    userId: 'user_1',
  };

  it('reads size, type and URL from the file row', async () => {
    mocks.findFile.mockResolvedValue(runOutputFile);
    mocks.fileAccessUrl.mockResolvedValue('https://app.example.com/f/file_1');

    await expect(
      resolveAgentWorkFile({ db: dbWith(undefined), fileId: 'file_1', userId: 'user_1' }),
    ).resolves.toEqual({
      fileId: 'file_1',
      fileSize: 2048,
      fileUrl: 'https://app.example.com/f/file_1',
      mimeType: 'application/pdf',
    });
  });

  it.each([
    ["a file the caller can't see", undefined],
    ["a teammate's file in the workspace", { ...runOutputFile, userId: 'user_2' }],
    ['a file not uploaded as run output', { ...runOutputFile, source: 'chat' }],
  ])('refuses %s', async (_, file) => {
    mocks.findFile.mockResolvedValue(file);
    await expectStatus(
      resolveAgentWorkFile({
        db: dbWith(undefined),
        fileId: 'file_1',
        userId: 'user_1',
        workspaceId: 'ws_1',
      }),
      404,
    );
  });
});

describe('parseCollectionImageRef', () => {
  it('reads a bare file id and the /f/ link image generation returns', () => {
    expect(parseCollectionImageRef('file_LkKoI7OfyZ0c')).toBe('file_LkKoI7OfyZ0c');
    expect(parseCollectionImageRef('https://app.lobehub.com/f/file_LkKoI7OfyZ0c')).toBe(
      'file_LkKoI7OfyZ0c',
    );
    // The relative link a chat message renders for a stored file.
    expect(parseCollectionImageRef('/f/file_LkKoI7OfyZ0c')).toBe('file_LkKoI7OfyZ0c');
  });

  it('refuses any other link', () => {
    expect(() => parseCollectionImageRef('https://cdn.example.com/cat.png')).toThrow(
      AgentWorkRunError,
    );
    expect(() => parseCollectionImageRef('/images/cat.png')).toThrow(AgentWorkRunError);
  });
});

describe('resolveAgentWorkCollectionItems', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses an empty or oversized list before resolving any image', async () => {
    for (const count of [0, 51]) {
      const error = await resolveAgentWorkCollectionItems({
        db: dbWith(undefined),
        items: Array.from({ length: count }, (_, i) => ({ image: `file_${i}` })),
        userId: 'user_1',
      }).catch((caught: unknown) => caught);
      expect((error as { code?: string }).code).toBe('BAD_REQUEST');
    }
    expect(mocks.findFile).not.toHaveBeenCalled();
  });

  const generatedImage = {
    fileType: 'image/png',
    id: 'file_img',
    size: 4096,
    source: 'image_generation',
    url: 'generations/hash.png',
    userId: 'user_1',
  };

  it('stores the URL and type from the file row, keeping the order and captions', async () => {
    mocks.findFile.mockImplementation(async (id: string) => ({ ...generatedImage, id }));
    mocks.fileAccessUrl.mockImplementation(
      async (file: { id: string }) => `https://app.example.com/f/${file.id}`,
    );

    await expect(
      resolveAgentWorkCollectionItems({
        db: dbWith(undefined),
        items: [
          { caption: ' Apple ', image: 'https://app.lobehub.com/f/file_a' },
          { image: 'file_b' },
        ],
        userId: 'user_1',
      }),
    ).resolves.toEqual([
      {
        caption: 'Apple',
        fileId: 'file_a',
        mimeType: 'image/png',
        url: 'https://app.example.com/f/file_a',
      },
      { fileId: 'file_b', mimeType: 'image/png', url: 'https://app.example.com/f/file_b' },
    ]);
  });

  it.each([
    ['an image of another user', { ...generatedImage, userId: 'user_2' }, 404],
    ['a library upload no tool result names', { ...generatedImage, source: null }, 404],
    ['a file that is not an image', { ...generatedImage, fileType: 'application/pdf' }, 409],
  ])('refuses %s', async (_, file, status) => {
    mocks.findFile.mockResolvedValue(file);
    await expectStatus(
      resolveAgentWorkCollectionItems({
        db: dbWith(undefined),
        items: [{ image: 'file_img' }],
        userId: 'user_1',
      }),
      status as 404 | 409,
    );
  });

  it('resolves the generationId an image generation result lists to its file', async () => {
    mocks.findFile.mockResolvedValue(generatedImage);
    mocks.fileAccessUrl.mockResolvedValue('https://app.example.com/f/file_img');

    await expect(
      resolveAgentWorkCollectionItems({
        db: dbWith({ fileId: 'file_img' }),
        items: [{ image: 'gen_cat1' }],
        userId: 'user_1',
      }),
    ).resolves.toEqual([
      { fileId: 'file_img', mimeType: 'image/png', url: 'https://app.example.com/f/file_img' },
    ]);
    expect(mocks.findFile).toHaveBeenCalledWith('file_img');

    // Another user's generation, or one that has no stored image yet.
    await expectStatus(
      resolveAgentWorkCollectionItems({
        db: dbWith(undefined),
        items: [{ image: 'gen_other' }],
        userId: 'user_1',
      }),
      404,
    );
  });

  /** A run whose conversation holds `shown`, the messages naming the images. */
  const runShowing = (
    shown: { content: string; identifier?: string; role: string }[],
    options: { image?: string; shareVisitor?: boolean; topicId?: string } = {},
  ) => {
    const query = {
      from: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn(async () => shown),
    };
    return resolveAgentWorkCollectionItems({
      db: { select: vi.fn(() => query) } as unknown as LobeChatDatabase,
      items: [{ image: options.image ?? 'file_img' }],
      shareVisitor: options.shareVisitor,
      topicId: 'topicId' in options ? options.topicId : 'tpc_run',
      userId: 'user_1',
    });
  };

  it("keeps a share visitor's collection to images shown in that conversation", async () => {
    mocks.findFile.mockResolvedValue(generatedImage);
    mocks.fileAccessUrl.mockResolvedValue('https://app.example.com/f/file_img');
    const visitorRun = (shown: { content: string; identifier?: string; role: string }[]) =>
      runShowing(shown, { shareVisitor: true, topicId: 'tpc_visitor' });

    await expect(
      visitorRun([{ content: '![cover](https://app.example.com/f/file_img)', role: 'tool' }]),
    ).resolves.toHaveLength(1);
    // A visitor naming the id in their own message, or the assistant echoing it,
    // does not prove the image was shown to them.
    await expectStatus(
      visitorRun([
        { content: 'add file_img to my collection', role: 'user' },
        { content: 'Sure, adding file_img', role: 'assistant' },
      ]),
      404,
    );
    // This tool's own refusal names the id too, and must not prove it on a retry.
    await expectStatus(
      visitorRun([{ content: 'Image file_img not found', identifier: 'lobe-work', role: 'tool' }]),
      404,
    );
    // The creator's other images never appeared to this visitor.
    await expectStatus(visitorRun([]), 404);
  });
});
