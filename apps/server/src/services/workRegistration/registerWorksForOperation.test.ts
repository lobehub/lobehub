import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redeployFileWork, registerWorksForOperation } from './registerWorksForOperation';
import { stateHasEntityFileEdits } from './stateHasEntityFileEdits';

const {
  mockFindById,
  mockListOperationTree,
  mockListPlugins,
  mockRegisterFile,
  mockRegisterShellGithubResult,
  mockFindFileVersionByToolCall,
  mockExportAndUploadFile,
  mockCreateSandboxService,
  mockUpdateMessage,
  mockFindMessageById,
} = vi.hoisted(() => ({
  mockCreateSandboxService: vi.fn(),
  mockExportAndUploadFile: vi.fn(),
  mockFindById: vi.fn(),
  mockFindFileVersionByToolCall: vi.fn(),
  mockFindMessageById: vi.fn(),
  mockListOperationTree: vi.fn(),
  mockListPlugins: vi.fn(),
  mockRegisterFile: vi.fn(),
  mockRegisterShellGithubResult: vi.fn(),
  mockUpdateMessage: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({
    findById: mockFindById,
    listOperationTree: mockListOperationTree,
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({
    findById: mockFindMessageById,
    listMessagePluginsForOperation: mockListPlugins,
    update: mockUpdateMessage,
  })),
}));

vi.mock('@/database/models/work', () => ({
  WorkModel: vi.fn(() => ({
    findFileVersionByToolCall: mockFindFileVersionByToolCall,
    registerFile: mockRegisterFile,
    registerShellGithubResult: mockRegisterShellGithubResult,
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

/** A successful sandbox exportFile plugin row for `path` (code-generated artifact flow). */
const exportRow = (id: string, path: string) => ({
  apiName: 'exportFile',
  arguments: JSON.stringify({ path }),
  createdAt: new Date(`2026-07-20T00:0${id.length}:00.000Z`),
  id,
  identifier: 'lobe-cloud-sandbox',
  state: { downloadUrl: `https://f/${id}`, filename: path.split('/').pop(), path },
  toolCallId: `tc-${id}`,
});

/** Last path segment — the export identity keys off the file, not the (mangled) upload name. */
const base = (path: string) => path.split('/').pop() ?? path;

/**
 * A successful skills-tool exportFile plugin row for `path` (skill-driven
 * artifact flow, e.g. the pptx skill). Its persisted state carries NO `path` —
 * only file identity fields — so the path must come from the call arguments.
 */
const skillsExportRow = (id: string, path: string) => ({
  apiName: 'exportFile',
  arguments: JSON.stringify({ filename: base(path), path }),
  createdAt: new Date(`2026-07-20T00:0${id.length}:00.000Z`),
  id,
  identifier: 'lobe-skills',
  state: { fileId: `file-${id}`, filename: base(path), url: `https://f/${id}` },
  toolCallId: `tc-${id}`,
});

/** A codex `command_execution` plugin row whose command may run `gh`. */
const codexCommandRow = (id: string, command: string, output: string, exitCode = 0) => ({
  apiName: 'command_execution',
  arguments: JSON.stringify({ command }),
  createdAt: new Date(`2026-07-20T00:0${id.length}:00.000Z`),
  id,
  identifier: 'codex',
  state: { exitCode, output, stdout: output, success: exitCode === 0 },
  toolCallId: `tc-${id}`,
});

/** A claude-code `Bash` plugin row — stdout rides the message CONTENT, no state. */
const claudeCodeBashRow = (id: string, command: string, content: string) => ({
  apiName: 'Bash',
  arguments: JSON.stringify({ command }),
  content,
  createdAt: new Date(`2026-07-20T00:0${id.length}:00.000Z`),
  id,
  identifier: 'claude-code',
  toolCallId: `tc-${id}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockListOperationTree.mockResolvedValue([rootOp]);
  // Default: no parent lookup needed (root ops). Sub-op tests override this.
  mockFindById.mockResolvedValue(null);
  // No pre-existing version by default, so every entity file exports + registers.
  mockFindFileVersionByToolCall.mockResolvedValue(null);
  mockRegisterShellGithubResult.mockResolvedValue({ id: 'work-github' });
  mockUpdateMessage.mockResolvedValue({ success: true });
  mockFindMessageById.mockResolvedValue(undefined);
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

describe('registerWorksForOperation', () => {
  it('registers one file Work version per edited entity file', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/deck.pptx'),
      writeRow('bb', '/mnt/data/sheet.xlsx'),
    ]);

    await registerWorksForOperation(baseParams);

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

  it('skips unexecuted human-intervention rows (pending / rejected approvals)', async () => {
    /** An approval-parked row: empty result, only `arguments` carries the path. */
    const parkedRow = (id: string, path: string, status: string) => ({
      apiName: 'writeFile',
      arguments: JSON.stringify({ path }),
      createdAt: new Date('2026-07-20T00:01:00.000Z'),
      id,
      identifier: 'lobe-cloud-sandbox',
      intervention: { status },
      state: undefined,
      toolCallId: `tc-${id}`,
    });
    mockListPlugins.mockResolvedValue([
      // Without the filter the scanner falls back from the missing `state.path`
      // to `arguments.path` and would export a file the user never approved.
      parkedRow('pending-1', '/mnt/data/parked.docx', 'pending'),
      parkedRow('rejected-1', '/mnt/data/refused.xlsx', 'rejected'),
      // Approved rows executed on resume and carry a real result state.
      { ...writeRow('a', '/mnt/data/deck.pptx'), intervention: { status: 'approved' } },
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/deck.pptx');
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

    await registerWorksForOperation(baseParams);

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

    const outcome = await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/ok.xlsx');
    // The outcome summary must report the failed export so the caller withholds
    // the `_fileWorksRegistered` marker and a later call retries it.
    expect(outcome).toEqual({ attempted: 2, failed: 1 });
  });

  it('reports a zero-failure outcome when every entity file registers', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/deck.pptx'),
      writeRow('bb', '/mnt/data/sheet.xlsx'),
    ]);

    const outcome = await registerWorksForOperation(baseParams);

    expect(outcome).toEqual({ attempted: 2, failed: 0 });
  });

  it('counts an idempotent probe skip as a success, not a failure', async () => {
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/deck.pptx')]);
    // The (op, file) version already exists from a previous attempt.
    mockFindFileVersionByToolCall.mockResolvedValue({ id: 'ver-existing' });

    const outcome = await registerWorksForOperation(baseParams);

    expect(mockExportAndUploadFile).not.toHaveBeenCalled();
    expect(mockRegisterFile).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 1, failed: 0 });
  });

  it('ignores non-entity files (html / other extensions)', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/page.html'),
      writeRow('bb', '/mnt/data/notes.txt'),
      writeRow('ccc', '/mnt/data/report.docx'),
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/report.docx');
  });

  it('skips entity files whose last edit is NOT sandbox-backed (hetero provenance)', async () => {
    // A codex (device-side) edit has no counterpart inside the topic's cloud
    // sandbox — exporting it would fail or pick up a stale same-path file.
    mockListPlugins.mockResolvedValue([
      {
        apiName: 'file_change',
        arguments: undefined,
        createdAt: new Date('2026-07-20T00:01:00.000Z'),
        id: 'hetero-1',
        identifier: 'codex',
        state: {
          changes: [{ kind: 'update', linesAdded: 3, linesDeleted: 1, path: '/x/report.xlsx' }],
        },
        toolCallId: 'tc-hetero-1',
      },
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockExportAndUploadFile).not.toHaveBeenCalled();
    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('registers sandbox-backed entities while skipping hetero-provenance ones in the same op', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/deck.pptx'),
      {
        apiName: 'file_change',
        arguments: undefined,
        createdAt: new Date('2026-07-20T00:02:00.000Z'),
        id: 'hetero-1',
        identifier: 'codex',
        state: {
          changes: [{ kind: 'update', linesAdded: 3, linesDeleted: 1, path: '/x/report.xlsx' }],
        },
        toolCallId: 'tc-hetero-1',
      },
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/deck.pptx');
  });

  it('prefers the terminal state totals over the (not-yet-persisted) op row', async () => {
    // Pre-snapshot registration runs BEFORE recordCompletion writes the op row's
    // cost/usage columns — the row still reads null on a first completion.
    mockListOperationTree.mockResolvedValue([
      { ...rootOp, cost: null, totalCost: null, usage: null },
    ]);
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/deck.pptx')]);

    await registerWorksForOperation({
      ...baseParams,
      finalCost: { total: 1.25 },
      finalUsage: { tokens: 42 },
    });

    const call = mockRegisterFile.mock.calls[0][0];
    expect(call.cumulativeCost).toBe(1.25);
    expect(call.cumulativeUsage).toMatchObject({ cost: { total: 1.25 }, usage: { tokens: 42 } });
  });

  it('rolls terminal child-op spend into the state-sourced cumulative cost', async () => {
    // Children complete before their root, so their rows already carry final
    // totals; the state-sourced figure must match the op row's rolled-up column.
    mockListOperationTree.mockResolvedValue([
      { ...rootOp, cost: null, totalCost: null, usage: null },
      { ...rootOp, id: 'child-1', parentOperationId: 'op-1', totalCost: 0.3 },
    ]);
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/deck.pptx')]);

    await registerWorksForOperation({
      ...baseParams,
      finalCost: { total: 1 },
      finalUsage: { tokens: 42 },
    });

    expect(mockRegisterFile.mock.calls[0][0].cumulativeCost).toBe(1.3);
  });

  it('registers a code-generated entity artifact from its exportFile record', async () => {
    // python-pptx / reportlab artifacts are produced by executeCode (a scanner
    // blind spot) — the exportFile call is the only record carrying the path.
    mockListPlugins.mockResolvedValue([
      {
        apiName: 'executeCode',
        arguments: JSON.stringify({ code: 'make_deck()' }),
        createdAt: new Date('2026-07-20T00:01:00.000Z'),
        id: 'exec-1',
        identifier: 'lobe-cloud-sandbox',
        state: { success: true },
        toolCallId: 'tc-exec-1',
      },
      exportRow('bb', '/workspace/deck.pptx'),
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    // Re-exported through the collision-proof pipeline, not the exportFile blob.
    expect(mockExportAndUploadFile.mock.calls[0][0]).toBe('/workspace/deck.pptx');
    expect(mockRegisterFile.mock.calls[0][0]).toMatchObject({
      filePath: '/workspace/deck.pptx',
      messageId: 'bb',
      title: 'deck.pptx',
      toolIdentifier: 'lobe-cloud-sandbox',
      toolName: 'exportFile',
    });
  });

  it('registers a skill-generated entity artifact from its lobe-skills exportFile record', async () => {
    // A skill flow (e.g. the pptx skill) routes generation through the skills
    // tool: execScript builds the deck, and the skills exportFile — whose
    // state carries no `path` — is the only record with the artifact's location.
    mockListPlugins.mockResolvedValue([
      {
        apiName: 'execScript',
        arguments: JSON.stringify({ script: 'node make_deck.mjs' }),
        createdAt: new Date('2026-07-20T00:01:00.000Z'),
        id: 'exec-1',
        identifier: 'lobe-skills',
        state: { exitCode: 0, success: true },
        toolCallId: 'tc-exec-1',
      },
      skillsExportRow('bb', '/workspace/deck.pptx'),
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    // Re-exported from the topic sandbox through the collision-proof pipeline.
    expect(mockExportAndUploadFile.mock.calls[0][0]).toBe('/workspace/deck.pptx');
    expect(mockRegisterFile.mock.calls[0][0]).toMatchObject({
      filePath: '/workspace/deck.pptx',
      messageId: 'bb',
      title: 'deck.pptx',
      toolIdentifier: 'lobe-skills',
      toolName: 'exportFile',
    });
  });

  it('ignores failed, stateless, and non-entity lobe-skills exportFile records', async () => {
    mockListPlugins.mockResolvedValue([
      skillsExportRow('a', '/workspace/notes.txt'),
      { ...skillsExportRow('bb', '/workspace/bad.pptx'), error: 'export boom' },
      // A failed skills export persists no state (success: false, content only).
      { ...skillsExportRow('ccc', '/workspace/failed.pptx'), state: undefined },
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).not.toHaveBeenCalled();
    expect(mockExportAndUploadFile).not.toHaveBeenCalled();
  });

  it('ignores non-entity, failed, and resultless exportFile records', async () => {
    mockListPlugins.mockResolvedValue([
      exportRow('a', '/workspace/notes.txt'),
      { ...exportRow('bb', '/workspace/bad.pptx'), error: 'export boom' },
      { ...exportRow('ccc', '/workspace/pending.pptx'), state: undefined },
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).not.toHaveBeenCalled();
    expect(mockExportAndUploadFile).not.toHaveBeenCalled();
  });

  it('does not double-register a path that was both edited and exported', async () => {
    mockListPlugins.mockResolvedValue([
      writeRow('a', '/mnt/data/data.csv'),
      exportRow('bb', '/mnt/data/data.csv'),
    ]);

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    // The edit-scan entry wins (richer provenance/line data).
    expect(mockRegisterFile.mock.calls[0][0]).toMatchObject({
      filePath: '/mnt/data/data.csv',
      toolName: 'writeFile',
    });
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

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).not.toHaveBeenCalled();
    expect(mockExportAndUploadFile).not.toHaveBeenCalled();
  });

  it('no-ops when the root operation has no topic', async () => {
    mockListOperationTree.mockResolvedValue([{ ...rootOp, topicId: null }]);

    await registerWorksForOperation(baseParams);

    expect(mockListPlugins).not.toHaveBeenCalled();
    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('no-ops for a sub-operation whose parent is still active (root will scan the tree)', async () => {
    // A normal sub-op completes while its parent is still running; the parent
    // scans the whole tree on its own completion, so registering here duplicates.
    mockListOperationTree.mockResolvedValue([{ ...rootOp, parentOperationId: 'parent-1' }]);
    mockFindById.mockResolvedValue({ status: 'running' });

    await registerWorksForOperation(baseParams);

    expect(mockFindById).toHaveBeenCalledWith('parent-1');
    expect(mockListPlugins).not.toHaveBeenCalled();
    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('no-ops for a sub-operation whose parent is parked (waiting_for_async_tool)', async () => {
    // Parked (waiting_for_human / waiting_for_async_tool) is NON-terminal: the
    // parent will resume, complete, and scan the whole subtree — so still a no-op.
    mockListOperationTree.mockResolvedValue([{ ...rootOp, parentOperationId: 'parent-1' }]);
    mockFindById.mockResolvedValue({ status: 'waiting_for_async_tool' });

    await registerWorksForOperation(baseParams);

    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('registers an auto-repair sub-op once its parent has already reached a terminal state', async () => {
    // A repair op is spawned AFTER the parent reached a terminal state and ran
    // its own tree scan; the parent will never re-scan, so the repair must
    // register its OWN edits (a legitimately new version).
    mockListOperationTree.mockResolvedValue([{ ...rootOp, parentOperationId: 'parent-1' }]);
    mockFindById.mockResolvedValue({ status: 'done' });
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/fix.xlsx')]);

    await registerWorksForOperation(baseParams);

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

    await registerWorksForOperation(baseParams);

    // Only the completing op's plugin window is queried — the child is skipped.
    expect(mockListPlugins).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile).toHaveBeenCalledTimes(1);
    expect(mockRegisterFile.mock.calls[0][0].filePath).toBe('/mnt/data/own.xlsx');
  });

  it('uploads under a collision-proof storage name while keeping a clean display filename', async () => {
    mockListPlugins.mockResolvedValue([writeRow('a', '/mnt/data/deck.pptx')]);

    await registerWorksForOperation(baseParams);

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

    await registerWorksForOperation({ ...baseParams, operationId: 'op_1784632944000_abc' });
    await registerWorksForOperation({ ...baseParams, operationId: 'op_1784632999000_def' });

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

    await registerWorksForOperation(baseParams);

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

    await registerWorksForOperation(baseParams);

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

describe('stateHasEntityFileEdits', () => {
  const sandboxCall = (id: string, apiName: string, args: unknown) => ({
    function: {
      arguments: JSON.stringify(args),
      name: `lobe-cloud-sandbox____${apiName}____builtin`,
    },
    id,
    type: 'function',
  });

  const stateWith = (toolCalls: unknown[]) => ({
    messages: [
      { content: 'make me a deck', role: 'user' },
      { content: '', role: 'assistant', tool_calls: toolCalls },
      { content: 'ok', role: 'tool', tool_call_id: 't1' },
    ],
  });

  it('detects an entity-format sandbox write', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([sandboxCall('t1', 'writeFile', { path: '/w/deck.pptx' })]),
      ),
    ).toBe(true);
  });

  it('ignores non-entity files (html / md)', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'writeFile', { path: '/w/index.html' }),
          sandboxCall('t2', 'editFile', { path: '/w/notes.md' }),
        ]),
      ),
    ).toBe(false);
  });

  it('ignores non-sandbox tool calls, even with entity-looking arguments', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          {
            function: {
              arguments: JSON.stringify({ file_path: '/w/deck.pptx' }),
              name: 'claude-code____Write____builtin',
            },
            id: 't1',
            type: 'function',
          },
        ]),
      ),
    ).toBe(false);
  });

  it('returns false for empty or malformed state', () => {
    expect(stateHasEntityFileEdits(undefined)).toBe(false);
    expect(stateHasEntityFileEdits({})).toBe(false);
    expect(stateHasEntityFileEdits({ messages: 'nope' })).toBe(false);
    expect(
      stateHasEntityFileEdits(
        stateWith([
          { function: { arguments: '{not json', name: 'lobe-cloud-sandbox____writeFile' } },
        ]),
      ),
    ).toBe(false);
  });

  it('detects a moveFiles rename onto an entity destination from its arguments', () => {
    // moveFiles is only classifiable from its tool RESULT, which the pure state
    // scan lacks — the predictor over-approximates from the requested
    // destinations instead (a failed/rejected move still counts).
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'moveFiles', {
            operations: [{ destination: '/w/deck.pptx', source: '/w/draft.tmp' }],
          }),
        ]),
      ),
    ).toBe(true);
  });

  it('ignores moveFiles calls with only non-entity destinations or malformed args', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'moveFiles', {
            operations: [{ destination: '/w/archive/notes.md', source: '/w/notes.md' }],
          }),
          {
            function: {
              arguments: '{not json',
              name: 'lobe-cloud-sandbox____moveFiles____builtin',
            },
            id: 't2',
            type: 'function',
          },
        ]),
      ),
    ).toBe(false);
  });

  it('detects entity edits inside conversation-flow grouped nodes (children[].tools)', () => {
    // After a tool batch the runtime re-queries state.messages with
    // `flatten: true`, folding this run's turn into an assistantGroup — the
    // sandbox calls then live on children[].tools, not message.tool_calls.
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'writeFile',
              arguments: JSON.stringify({ path: '/w/deck.pptx' }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
              result: { state: { path: '/w/deck.pptx', success: true } },
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'make a deck', role: 'user' }, grouped] }),
    ).toBe(true);
  });

  it('classifies a grouped moveFiles rename from its result state', () => {
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'moveFiles',
              arguments: JSON.stringify({
                operations: [{ destination: '/w/deck.pptx', source: '/w/draft.tmp' }],
              }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
              result: {
                state: {
                  results: [{ destination: '/w/deck.pptx', source: '/w/draft.tmp', success: true }],
                },
              },
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'rename it', role: 'user' }, grouped] }),
    ).toBe(true);
  });

  it('ignores entity edits from PREVIOUS turns (before the last user message)', () => {
    // A past run's entity edit already registered on its own completion —
    // counting it would permanently disable the early publish for the topic.
    const pastGroup = {
      children: [
        {
          tools: [
            {
              apiName: 'writeFile',
              arguments: JSON.stringify({ path: '/w/old-deck.pptx' }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
              result: { state: { path: '/w/old-deck.pptx', success: true } },
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({
        messages: [
          { content: 'make a deck', role: 'user' },
          pastGroup,
          { content: 'now just summarize it', role: 'user' },
          { content: 'summary...', role: 'assistant' },
        ],
      }),
    ).toBe(false);
  });

  it('detects an entity exportFile call from its arguments (raw and grouped shapes)', () => {
    // Raw tool_calls shape.
    expect(
      stateHasEntityFileEdits(
        stateWith([sandboxCall('t1', 'exportFile', { path: '/workspace/deck.pptx' })]),
      ),
    ).toBe(true);
    // Grouped (assistantGroup children[].tools) shape.
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'exportFile',
              arguments: JSON.stringify({ path: '/workspace/report.pdf' }),
              id: 't1',
              identifier: 'lobe-cloud-sandbox',
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'export it', role: 'user' }, grouped] }),
    ).toBe(true);
    // Non-entity export keeps the early publish.
    expect(
      stateHasEntityFileEdits(
        stateWith([sandboxCall('t1', 'exportFile', { path: '/workspace/notes.txt' })]),
      ),
    ).toBe(false);
  });

  it('detects an entity lobe-skills exportFile call (raw and grouped shapes)', () => {
    const skillsCall = (id: string, args: unknown) => ({
      function: { arguments: JSON.stringify(args), name: 'lobe-skills____exportFile____builtin' },
      id,
      type: 'function',
    });
    // Raw tool_calls shape.
    expect(
      stateHasEntityFileEdits(
        stateWith([skillsCall('t1', { filename: 'deck.pptx', path: '/workspace/deck.pptx' })]),
      ),
    ).toBe(true);
    // Grouped (assistantGroup children[].tools) shape.
    const grouped = {
      children: [
        {
          tools: [
            {
              apiName: 'exportFile',
              arguments: JSON.stringify({ filename: 'report.pdf', path: '/workspace/report.pdf' }),
              id: 't1',
              identifier: 'lobe-skills',
            },
          ],
        },
      ],
      role: 'assistantGroup',
    };
    expect(
      stateHasEntityFileEdits({ messages: [{ content: 'export it', role: 'user' }, grouped] }),
    ).toBe(true);
    // Non-entity skills export keeps the early publish.
    expect(
      stateHasEntityFileEdits(
        stateWith([skillsCall('t1', { filename: 'notes.txt', path: '/workspace/notes.txt' })]),
      ),
    ).toBe(false);
  });

  it('detects an entity edit mixed among non-entity edits', () => {
    expect(
      stateHasEntityFileEdits(
        stateWith([
          sandboxCall('t1', 'writeFile', { path: '/w/notes.md' }),
          sandboxCall('t2', 'writeFile', { path: '/w/report.xlsx' }),
        ]),
      ),
    ).toBe(true);
  });
});

describe('registerWorksForOperation · shell github works', () => {
  it('registers a github Work from a codex gh pr create and stamps the anchor', async () => {
    mockListPlugins.mockResolvedValue([
      codexCommandRow(
        'a',
        `git push && gh pr create --title 'Fix tray' --body 'Body'`,
        'https://github.com/lobehub/lobehub/pull/17654\n',
      ),
    ]);

    const outcome = await registerWorksForOperation({
      ...baseParams,
      assistantMessageId: 'msg-assistant',
    });

    expect(mockRegisterShellGithubResult).toHaveBeenCalledTimes(1);
    expect(mockRegisterShellGithubResult).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          command: `git push && gh pr create --title 'Fix tray' --body 'Body'`,
          exitCode: 0,
          output: 'https://github.com/lobehub/lobehub/pull/17654\n',
        }),
        messageId: 'a',
        rootOperationId: 'op-1',
        toolCallId: 'tc-a',
        toolIdentifier: 'codex',
        toolName: 'command_execution',
        topicId: 'topic-1',
      }),
    );
    // Hetero runs never pass callLlmFinalizer → the anchor is stamped here.
    expect(mockUpdateMessage).toHaveBeenCalledWith('msg-assistant', {
      metadata: { work: { rootOperationId: 'op-1' } },
    });
    expect(outcome).toEqual({ attempted: 1, failed: 0 });
  });

  it('counts a failed anchor stamp so the completion backstop retries', async () => {
    // messageModel.update never throws — DB errors / no-matched-row come back
    // as { success: false }. A silent stamp failure would let the caller mark
    // the round complete while the Work stays invisible.
    mockUpdateMessage.mockResolvedValue({ success: false });
    mockListPlugins.mockResolvedValue([
      codexCommandRow(
        'a',
        `gh pr create --title 'Fix tray'`,
        'https://github.com/lobehub/lobehub/pull/17654\n',
      ),
    ]);

    const outcome = await registerWorksForOperation({
      ...baseParams,
      assistantMessageId: 'msg-assistant',
    });

    expect(mockRegisterShellGithubResult).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ attempted: 1, failed: 1 });
  });

  it('reads claude-code Bash stdout from the message content', async () => {
    mockListPlugins.mockResolvedValue([
      claudeCodeBashRow(
        'b',
        `gh issue edit 952 --repo lobehub/lobehub --title 'Better'`,
        'https://github.com/lobehub/lobehub/issues/952',
      ),
    ]);

    await registerWorksForOperation({ ...baseParams, assistantMessageId: 'msg-assistant' });

    expect(mockRegisterShellGithubResult).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exitCode: undefined,
          output: 'https://github.com/lobehub/lobehub/issues/952',
        }),
        toolIdentifier: 'claude-code',
        toolName: 'Bash',
      }),
    );
  });

  it('skips failed shell records and never stamps the anchor without a registration', async () => {
    mockRegisterShellGithubResult.mockResolvedValue(null);
    mockListPlugins.mockResolvedValue([
      // Non-zero exit: excluded before the normalizer is even consulted? No —
      // exitCode rides the data blob; exclusion here is the state error signal.
      { ...codexCommandRow('c', `gh pr create --title 'x'`, 'boom', 1), state: { error: 'boom' } },
      // Passes the cheap `gh ` pre-filter but is read-only → normalizes to null.
      claudeCodeBashRow('d', 'gh pr view 17654', 'https://github.com/lobehub/lobehub/pull/17654'),
      // No `gh ` in the command at all → dropped before the model is consulted.
      claudeCodeBashRow('e', 'ls -la', 'README.md'),
    ]);

    const outcome = await registerWorksForOperation({
      ...baseParams,
      assistantMessageId: 'msg-assistant',
    });

    // Row `c` is dropped by its state error; row `d` reaches the model but
    // normalizes to null (not a gh create/edit) — neither registers.
    expect(mockRegisterShellGithubResult).toHaveBeenCalledTimes(1);
    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 0, failed: 0 });
  });

  it('counts a github registration failure so the completion marker is withheld', async () => {
    mockRegisterShellGithubResult.mockRejectedValue(new Error('db down'));
    mockListPlugins.mockResolvedValue([
      codexCommandRow(
        'e',
        `gh pr create --title 'Fix'`,
        'https://github.com/lobehub/lobehub/pull/1',
      ),
    ]);

    const outcome = await registerWorksForOperation({
      ...baseParams,
      assistantMessageId: 'msg-assistant',
    });

    expect(outcome).toEqual({ attempted: 1, failed: 1 });
    expect(mockUpdateMessage).not.toHaveBeenCalled();
  });

  it('falls back to the tool message parent as anchor when no assistantMessageId', async () => {
    // Hetero single-step runs persist neither heteroCurrentMsgId nor
    // runningOperation.assistantMessageId, so heteroFinish passes no pointer.
    // The scan anchors on the assistant owning the registered gh tool call.
    mockFindMessageById.mockResolvedValue({ id: 'f', parentId: 'msg-owner-assistant' });
    mockListPlugins.mockResolvedValue([
      codexCommandRow(
        'f',
        `gh pr create --title 'Fix'`,
        'https://github.com/lobehub/lobehub/pull/2',
      ),
    ]);

    const outcome = await registerWorksForOperation(baseParams);

    expect(mockFindMessageById).toHaveBeenCalledWith('f');
    expect(mockUpdateMessage).toHaveBeenCalledWith('msg-owner-assistant', {
      metadata: { work: { rootOperationId: 'op-1' } },
    });
    expect(outcome).toEqual({ attempted: 1, failed: 0 });
  });

  it('counts a missing anchor as failed so the completion marker is withheld', async () => {
    // No assistantMessageId and the fallback lookup resolves nothing → the
    // Work row exists but nothing would render it; the round must not be
    // marked complete.
    mockFindMessageById.mockResolvedValue(undefined);
    mockListPlugins.mockResolvedValue([
      codexCommandRow(
        'g',
        `gh pr create --title 'Fix'`,
        'https://github.com/lobehub/lobehub/pull/3',
      ),
    ]);

    const outcome = await registerWorksForOperation(baseParams);

    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 1, failed: 1 });
  });
});
