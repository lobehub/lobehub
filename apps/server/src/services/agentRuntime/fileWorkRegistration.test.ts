import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redeployFileWork, registerFileWorksForOperation } from './fileWorkRegistration';

const {
  mockFindById,
  mockListOperationTree,
  mockListPlugins,
  mockRegisterFile,
  mockFindFileVersionByToolCall,
  mockExportAndUploadFile,
  mockCreateSandboxService,
} = vi.hoisted(() => ({
  mockCreateSandboxService: vi.fn(),
  mockExportAndUploadFile: vi.fn(),
  mockFindById: vi.fn(),
  mockFindFileVersionByToolCall: vi.fn(),
  mockListOperationTree: vi.fn(),
  mockListPlugins: vi.fn(),
  mockRegisterFile: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({
    findById: mockFindById,
    listOperationTree: mockListOperationTree,
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({ listMessagePluginsForOperation: mockListPlugins })),
}));

vi.mock('@/database/models/work', () => ({
  WorkModel: vi.fn(() => ({
    findFileVersionByToolCall: mockFindFileVersionByToolCall,
    registerFile: mockRegisterFile,
  })),
}));

vi.mock('@/server/services/file', () => ({ FileService: vi.fn(() => ({})) }));
vi.mock('@/server/services/market', () => ({ MarketService: vi.fn(() => ({})) }));
vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: mockCreateSandboxService,
}));

const serverDB = {} as any;
const baseParams = { operationId: 'op-1', serverDB, userId: 'user-1', workspaceId: undefined };

const rootOp = {
  agentId: 'agent-1',
  completedAt: new Date('2026-07-20T00:05:00.000Z'),
  cost: { total: 0.5 },
  id: 'op-1',
  startedAt: new Date('2026-07-20T00:00:00.000Z'),
  threadId: 'thread-1',
  topicId: 'topic-1',
  totalCost: 0.5,
  usage: { tokens: 10 },
};

/** A sandbox writeFile plugin row for `path`. */
const writeRow = (id: string, path: string) => ({
  apiName: 'writeFile',
  arguments: JSON.stringify({ path }),
  createdAt: new Date(`2026-07-20T00:0${id.length}:00.000Z`),
  id,
  identifier: 'lobe-cloud-sandbox',
  state: { path, success: true },
  toolCallId: `tc-${id}`,
});

/** Last path segment — the export identity keys off the file, not the (mangled) upload name. */
const base = (path: string) => path.split('/').pop() ?? path;

beforeEach(() => {
  vi.clearAllMocks();
  mockListOperationTree.mockResolvedValue([rootOp]);
  // Default: no parent lookup needed (root ops). Sub-op tests override this.
  mockFindById.mockResolvedValue(null);
  // No pre-existing version by default, so every entity file exports + registers.
  mockFindFileVersionByToolCall.mockResolvedValue(null);
  mockCreateSandboxService.mockReturnValue({ exportAndUploadFile: mockExportAndUploadFile });
  mockRegisterFile.mockImplementation(async (params: any) => ({
    currentVersionId: `ver-${params.filePath}`,
    id: `work-${params.filePath}`,
  }));
  // Key the exported identity off the source path's basename (not the upload
  // filename, which is now prefixed with the op id + a path hash for object-key
  // uniqueness) so the assertions below stay stable.
  mockExportAndUploadFile.mockImplementation(async (path: string) => {
    const filename = base(path);
    return {
      fileId: `file-${filename}`,
      filename,
      mimeType: 'application/vnd.openxmlformats',
      size: 2048,
      success: true,
      url: `s3://exports/${filename}`,
    };
  });
});

describe('registerFileWorksForOperation', () => {
  it('registers one file Work version per edited entity file', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/deck.pptx'),
      writeRow('bb', '/mnt/data/sheet.xlsx'),
    ]);

    await registerFileWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(2);
    const deck = mockRegisterFile.mock.calls.find(
      (c) => c[0].filePath === '/mnt/data/deck.pptx',
    )![0];
    expect(deck).toMatchObject({
      agentId: 'agent-1',
      cumulativeCost: 0.5,
      filePath: '/mnt/data/deck.pptx',
      messageId: 'a',
      rootOperationId: 'op-1',
      threadId: 'thread-1',
      title: 'deck.pptx',
      // Stable dedup key → one version per operation (DB enforces idempotency).
      toolCallId: 'op:op-1',
      toolIdentifier: 'lobe-cloud-sandbox',
      toolName: 'writeFile',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(deck.metadata).toMatchObject({
      fileId: 'file-deck.pptx',
      filePath: '/mnt/data/deck.pptx',
      fileSize: 2048,
      fileUrl: 's3://exports/deck.pptx',
      linesAdded: 0,
      linesDeleted: 0,
      mimeType: 'application/vnd.openxmlformats',
    });
    expect(deck.cumulativeUsage).toMatchObject({ cost: { total: 0.5 }, usage: { tokens: 10 } });
  });

  it('collapses multiple edits of the same file into a single version', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/deck.pptx'),
      {
        apiName: 'editFile',
        arguments: JSON.stringify({ path: '/mnt/data/deck.pptx' }),
        createdAt: new Date('2026-07-20T00:02:00.000Z'),
        id: 'edit-2',
        identifier: 'lobe-cloud-sandbox',
        state: { linesAdded: 3, linesDeleted: 1, path: '/mnt/data/deck.pptx' },
        toolCallId: 'tc-edit-2',
      },
    ]);

    await registerFileWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    const call = mockRegisterFile.mock.calls[0][0];
    // Provenance points at the LAST edit of the file.
    expect(call).toMatchObject({ messageId: 'edit-2', toolName: 'editFile' });
    expect(call.metadata).toMatchObject({ linesAdded: 3, linesDeleted: 1 });
  });

  it('skips a file whose sandbox export fails and continues with the rest', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/broken.pptx'),
      writeRow('bb', '/mnt/data/ok.xlsx'),
    ]);
    mockExportAndUploadFile.mockImplementation(async (path: string) => {
      const filename = base(path);
      if (filename === 'broken.pptx') {
        return { error: { message: 'export boom' }, filename, success: false };
      }
      return {
        fileId: `file-${filename}`,
        filename,
        mimeType: 'application/vnd.ms-excel',
        size: 1024,
        success: true,
        url: `s3://exports/${filename}`,
      };
    });

    await registerFileWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/ok.xlsx');
  });

  it('ignores non-entity files (html / other extensions)', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/page.html'),
      writeRow('bb', '/mnt/data/notes.txt'),
      writeRow('ccc', '/mnt/data/report.docx'),
    ]);

    await registerFileWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/report.docx');
  });

  it('does not register a deleted entity file', async () => {
    mockListPlugins.mockResolvedValue([
      {
        apiName: 'file_change',
        arguments: undefined,
        createdAt: new Date('2026-07-20T00:01:00.000Z'),
        id: 'del-1',
        identifier: 'codex',
        state: {
          changes: [{ kind: 'delete', linesAdded: 0, linesDeleted: 5, path: '/x/old.pptx' }],
        },
        toolCallId: 'tc-del-1',
      },
    ]);

    await registerFileWorksForOperation(baseParams);

    expect(mockRegisterFile).not.toHaveBeenCalled();
    expect(mockExportAndUploadFile).not.toHaveBeenCalled();
  });

  it('no-ops when the root operation has no topic', async () => {
    mockListOperationTree.mockResolvedValue([{ ...rootOp, topicId: null }]);

    await registerFileWorksForOperation(baseParams);

    expect(mockListPlugins).not.toHaveBeenCalled();
    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('no-ops for a sub-operation whose parent is still active (root will scan the tree)', async () => {
    // A normal sub-op completes while its parent is still running; the parent
    // scans the whole tree on its own completion, so registering here duplicates.
    mockListOperationTree.mockResolvedValue([{ ...rootOp, parentOperationId: 'parent-1' }]);
    mockFindById.mockResolvedValue({ status: 'running' });

    await registerFileWorksForOperation(baseParams);

    expect(mockFindById).toHaveBeenCalledWith('parent-1');
    expect(mockListPlugins).not.toHaveBeenCalled();
    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('no-ops for a sub-operation whose parent is parked (waiting_for_async_tool)', async () => {
    // Parked (waiting_for_human / waiting_for_async_tool) is NON-terminal: the
    // parent will resume, complete, and scan the whole subtree — so still a no-op.
    mockListOperationTree.mockResolvedValue([{ ...rootOp, parentOperationId: 'parent-1' }]);
    mockFindById.mockResolvedValue({ status: 'waiting_for_async_tool' });

    await registerFileWorksForOperation(baseParams);

    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('registers an auto-repair sub-op once its parent has already reached a terminal state', async () => {
    // A repair op is spawned AFTER the parent reached a terminal state and ran
    // its own tree scan; the parent will never re-scan, so the repair must
    // register its OWN edits (a legitimately new version).
    mockListOperationTree.mockResolvedValue([{ ...rootOp, parentOperationId: 'parent-1' }]);
    mockFindById.mockResolvedValue({ status: 'done' });
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/fix.xlsx')]);

    await registerFileWorksForOperation(baseParams);

    expect(mockFindById).toHaveBeenCalledWith('parent-1');
    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0]).toMatchObject({
      filePath: '/mnt/data/fix.xlsx',
      // Dedup key is this op's OWN id — the repair produces a new version.
      toolCallId: 'op:op-1',
    });
  });

  it("scans ONLY the terminal-parent repair op's own records, never the tree", async () => {
    // The tree also holds a child of the completing op; a terminal-parent repair
    // path must scan only the completing op's records (tree scanning is reserved
    // for the root), so the child's edits are NOT swept in.
    mockListOperationTree.mockResolvedValue([
      { ...rootOp, parentOperationId: 'parent-1' },
      { ...rootOp, id: 'child-1', parentOperationId: 'op-1' },
    ]);
    mockFindById.mockResolvedValue({ status: 'error' });
    mockListPlugins.mockImplementation(async ({ operationId }: { operationId: string }) =>
      operationId === 'op-1'
        ? [writeRow('a', '/mnt/data/own.xlsx')]
        : [writeRow('bb', '/mnt/data/child.xlsx')],
    );

    await registerFileWorksForOperation(baseParams);

    // Only the completing op's plugin window is queried — the child is skipped.
    expect(mockListPlugins).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/own.xlsx');
  });

  it('uploads under a collision-proof storage name while keeping a clean display filename', async () => {
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/deck.pptx')]);

    await registerFileWorksForOperation(baseParams);

    const [path, filename, options] = mockExportAndUploadFile.mock.calls[0];
    expect(path).toBe('/mnt/data/deck.pptx');
    // Display/download filename stays the clean basename...
    expect(filename).toBe('deck.pptx');
    // ...while the storage key is `${sha1(`${op}:${path}`).slice(0, 16)}-${basename}`.
    expect(options?.storageName).toMatch(/^[\da-f]{16}-deck\.pptx$/);
  });

  it('derives distinct storage names for two same-day operations editing the same path', async () => {
    // Real operationIds share an `op_${Date.now()}` prefix whose first 8 chars
    // only roll over every ~27.8h — hashing the FULL id (not a prefix) is what
    // keeps two same-day ops from clobbering each other's uploaded object.
    mockListOperationTree.mockImplementation(async (opId: string) => [{ ...rootOp, id: opId }]);
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/report.xlsx')]);

    await registerFileWorksForOperation({ ...baseParams, operationId: 'op_1784632944000_abc' });
    await registerFileWorksForOperation({ ...baseParams, operationId: 'op_1784632999000_def' });

    const first = mockExportAndUploadFile.mock.calls[0][2].storageName;
    const second = mockExportAndUploadFile.mock.calls[1][2].storageName;
    expect(first).not.toBe(second);
    // Both still end in the clean basename.
    expect(first).toMatch(/^[\da-f]{16}-report\.xlsx$/);
    expect(second).toMatch(/^[\da-f]{16}-report\.xlsx$/);
  });

  it('skips export + registration when the version was already registered (retry idempotency)', async () => {
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/deck.pptx')]);
    mockFindFileVersionByToolCall.mockResolvedValue({ id: 'existing-version' });

    await registerFileWorksForOperation(baseParams);

    expect(mockFindFileVersionByToolCall).toHaveBeenCalledWith({
      filePath: '/mnt/data/deck.pptx',
      toolCallId: 'op:op-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(mockExportAndUploadFile).not.toHaveBeenCalled();
    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('gathers tool calls across the operation tree (root + sub-op)', async () => {
    const subOp = {
      ...rootOp,
      completedAt: new Date('2026-07-20T00:04:00.000Z'),
      id: 'sub-1',
      startedAt: new Date('2026-07-20T00:02:00.000Z'),
    };
    mockListOperationTree.mockResolvedValue([rootOp, subOp]);
    mockListPlugins.mockImplementation(async ({ operationId }: { operationId: string }) =>
      operationId === 'op-1'
        ? [writeRow('a', '/mnt/data/root.pptx')]
        : [writeRow('bb', '/mnt/data/sub.xlsx')],
    );

    await registerFileWorksForOperation(baseParams);

    expect(mockListPlugins).toHaveBeenCalledTimes(2);
    expect(mockRegisterFile).toHaveBeenCalledTimes(2);
    expect(mockRegisterFile.mock.calls.map((c) => c[0].filePath).sort()).toEqual([
      '/mnt/data/root.pptx',
      '/mnt/data/sub.xlsx',
    ]);
  });
});

describe('redeployFileWork', () => {
  it('is a resolved no-op integration seam', async () => {
    await expect(
      redeployFileWork({ filePath: '/x/a.pptx', versionId: 'v1', workId: 'w1' }),
    ).resolves.toBeUndefined();
  });
});
