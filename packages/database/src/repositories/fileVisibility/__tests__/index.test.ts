// @vitest-environment node
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '../../../models/document';
import { FileModel } from '../../../models/file';
import { FileVisibilityRepository } from '../index';

const { mockDocumentModel, mockFileModel } = vi.hoisted(() => ({
  mockDocumentModel: { setVisibilityByFileId: vi.fn() },
  mockFileModel: { setVisibility: vi.fn() },
}));

vi.mock('../../../models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('../../../models/file', () => ({ FileModel: vi.fn() }));

const makeDb = () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const trx = { execute };
  const db = { transaction: vi.fn(async (callback: any) => callback(trx)) };

  return { db: db as any, execute };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(DocumentModel).mockImplementation(function () {
    return mockDocumentModel as any;
  });
  vi.mocked(FileModel).mockImplementation(function () {
    return mockFileModel as any;
  });
});

describe('FileVisibilityRepository', () => {
  it('should take the per-file parse lock before it touches either aggregate', async () => {
    mockFileModel.setVisibility.mockResolvedValue([{ id: 'file-1' }]);
    const { db, execute } = makeDb();

    await new FileVisibilityRepository(db, 'user-1', 'ws-1').setVisibility('file-1', 'public');

    expect(execute).toHaveBeenCalledTimes(1);
    // Render the statement the way the driver receives it, so the assertion
    // covers the real SQL and its bound parameter.
    const lockStatement = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(lockStatement.sql).toContain('pg_advisory_xact_lock');
    // The key has to match `DocumentService.parseFile`, otherwise the two do not
    // exclude each other and the publish can still land mid-parse.
    expect(lockStatement.params).toEqual(['parseFile:file-1']);
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
      mockFileModel.setVisibility.mock.invocationCallOrder[0],
    );
    expect(mockDocumentModel.setVisibilityByFileId).toHaveBeenCalledWith('file-1', 'public');
  });

  it('should leave the documents alone when the file row did not change', async () => {
    // The visibility guard in `FileModel.setVisibility` matched nothing, so the
    // file is already in the requested state and there is nothing to mirror.
    mockFileModel.setVisibility.mockResolvedValue([]);
    const { db } = makeDb();

    const updated = await new FileVisibilityRepository(db, 'user-1', 'ws-1').setVisibility(
      'file-1',
      'public',
    );

    expect(updated).toEqual([]);
    expect(mockDocumentModel.setVisibilityByFileId).not.toHaveBeenCalled();
  });
});
