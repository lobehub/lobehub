// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agentDocuments, agents, documents, files } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentModel } from '@/database/models/agentDocuments';

import { fileRouter } from '../../file';
import { cleanupTestUser, createTestUser } from './setup';

// Moving / renaming never touches object storage; avoid S3 initialization.
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const context = (userId: string) => ({ jwtPayload: { userId }, userId });

const createFolder = async (db: LobeChatDatabase, userId: string, title: string) => {
  const [folder] = await db
    .insert(documents)
    .values({
      fileType: 'custom/folder',
      filename: title,
      source: `folder-${title}-${userId}`,
      sourceType: 'api',
      title,
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    })
    .returning();
  return folder;
};

/** A knowledge-base file: the `files` row plus its mirror `documents` row. */
const createFileWithDocument = async (
  db: LobeChatDatabase,
  userId: string,
  name: string,
  parentId: string,
) => {
  const [file] = await db
    .insert(files)
    .values({
      fileType: 'application/pdf',
      name,
      parentId,
      size: 1024,
      url: `files/${name}`,
      userId,
    })
    .returning();
  const [document] = await db
    .insert(documents)
    .values({
      fileId: file.id,
      fileType: 'application/pdf',
      filename: name,
      parentId,
      source: `files/${name}`,
      sourceType: 'file',
      title: name,
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    })
    .returning();
  return { document, file };
};

const readDocument = async (db: LobeChatDatabase, id: string) => {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row;
};

describe('fileRouter.updateFile integration', () => {
  let db: LobeChatDatabase;
  let userId: string;
  let otherUserId: string;

  // The first getTestDB() call runs the migrations, which can exceed the default hook timeout.
  beforeAll(async () => {
    db = await getTestDB();
    testDB = db;
  }, 60_000);

  beforeEach(async () => {
    [userId, otherUserId] = await Promise.all([createTestUser(db), createTestUser(db)]);
  });

  afterEach(async () => {
    await Promise.all([userId, otherUserId].map((id) => cleanupTestUser(db, id)));
  });

  it('moves the backing knowledge-base document together with the file', async () => {
    const oldFolder = await createFolder(db, userId, 'nf5bak');
    const newFolder = await createFolder(db, userId, 'archive');
    const { document, file } = await createFileWithDocument(db, userId, 'report.pdf', oldFolder.id);

    await fileRouter.createCaller(context(userId)).updateFile({
      id: file.id,
      parentId: newFolder.id,
    });

    const [movedFile] = await db.select().from(files).where(eq(files.id, file.id));
    expect(movedFile.parentId).toBe(newFolder.id);
    // The KB tree is rendered from documents.parent_id — it must follow the file,
    // otherwise deleting the old folder cascades into the "moved" file.
    expect((await readDocument(db, document.id)).parentId).toBe(newFolder.id);
  });

  it('moves the backing document to the root when parentId is null', async () => {
    const folder = await createFolder(db, userId, 'nf5bak');
    const { document, file } = await createFileWithDocument(db, userId, 'notes.pdf', folder.id);

    await fileRouter.createCaller(context(userId)).updateFile({ id: file.id, parentId: null });

    expect((await readDocument(db, document.id)).parentId).toBeNull();
  });

  it('renames the backing document together with the file', async () => {
    const folder = await createFolder(db, userId, 'nf5bak');
    const { document, file } = await createFileWithDocument(db, userId, 'draft.pdf', folder.id);

    await fileRouter.createCaller(context(userId)).updateFile({ id: file.id, name: 'final.pdf' });

    const renamed = await readDocument(db, document.id);
    expect(renamed.title).toBe('final.pdf');
    expect(renamed.filename).toBe('final.pdf');
    expect(renamed.parentId).toBe(folder.id);
  });

  /** The row AgentDocumentsService.importFile creates: document + binding in one transaction. */
  const importIntoAgent = async (
    file: typeof files.$inferSelect,
    filename: string,
    parentId: string,
  ) => {
    const [agent] = await db.insert(agents).values({ userId }).returning();
    return new AgentDocumentModel(db, userId).create(agent.id, filename, '', {
      fileId: file.id,
      fileType: file.fileType,
      parentId,
      source: file.url,
      sourceType: 'file',
      title: file.name,
    });
  };

  it.each([
    ['an uploaded file', 'application/pdf'],
    // DocumentService.createDocument gives a knowledge-base page's backing file this type.
    ['a knowledge-base page backing file', 'custom/document'],
  ])("leaves an agent's imported copy of %s in its agent folder", async (_label, fileType) => {
    const kbFolder = await createFolder(db, userId, 'nf5bak');
    const newKbFolder = await createFolder(db, userId, 'archive');
    const agentFolder = await createFolder(db, userId, 'agent-notes');
    const { document: mirror, file } = await createFileWithDocument(
      db,
      userId,
      'spec.pdf',
      kbFolder.id,
    );
    await db.update(files).set({ fileType }).where(eq(files.id, file.id));
    const agentCopy = await importIntoAgent({ ...file, fileType }, 'spec 2.pdf', agentFolder.id);

    await fileRouter
      .createCaller(context(userId))
      .updateFile({ id: file.id, name: 'spec-final.pdf', parentId: newKbFolder.id });

    const movedMirror = await readDocument(db, mirror.id);
    expect(movedMirror.parentId).toBe(newKbFolder.id);
    expect(movedMirror.filename).toBe('spec-final.pdf');
    const untouched = await readDocument(db, agentCopy.documentId);
    expect(untouched.parentId).toBe(agentFolder.id);
    expect(untouched.filename).toBe('spec 2.pdf');
    expect(untouched.title).toBe('spec.pdf');
  });

  it('still moves a knowledge-base parse row that an agent has merely associated', async () => {
    // agentDocument.associateDocument binds a pre-existing document (see
    // agentDocumentsOwnership.ts); it stays the KB mirror and must follow the file, or
    // deleting the old folder would take the file with it again.
    const oldFolder = await createFolder(db, userId, 'nf5bak');
    const newFolder = await createFolder(db, userId, 'archive');
    const [file] = await db
      .insert(files)
      .values({
        fileType: 'text/markdown',
        name: 'engine.md',
        parentId: oldFolder.id,
        size: 64,
        url: 'files/engine.md',
        userId,
      })
      .returning();
    const [parseRow] = await db
      .insert(documents)
      .values({
        content: '# Chapter engine',
        fileId: file.id,
        fileType: 'custom/document',
        filename: 'engine.md',
        parentId: oldFolder.id,
        source: 'files/engine.md',
        sourceType: 'file',
        title: 'engine.md',
        totalCharCount: 16,
        totalLineCount: 1,
        userId,
      })
      .returning();
    const [agent] = await db.insert(agents).values({ userId }).returning();
    await db.insert(agentDocuments).values({ agentId: agent.id, documentId: parseRow.id, userId });

    await fileRouter
      .createCaller(context(userId))
      .updateFile({ id: file.id, parentId: newFolder.id });

    expect((await readDocument(db, parseRow.id)).parentId).toBe(newFolder.id);
  });

  it("does not touch another user's document that references the same file", async () => {
    const oldFolder = await createFolder(db, userId, 'nf5bak');
    const newFolder = await createFolder(db, userId, 'archive');
    const foreignFolder = await createFolder(db, otherUserId, 'foreign');
    const { file } = await createFileWithDocument(db, userId, 'shared.pdf', oldFolder.id);
    const [foreignDocument] = await db
      .insert(documents)
      .values({
        fileId: file.id,
        fileType: 'application/pdf',
        parentId: foreignFolder.id,
        source: 'files/shared.pdf',
        sourceType: 'file',
        title: 'shared.pdf',
        totalCharCount: 0,
        totalLineCount: 0,
        userId: otherUserId,
      })
      .returning();

    await fileRouter.createCaller(context(userId)).updateFile({
      id: file.id,
      parentId: newFolder.id,
    });

    expect((await readDocument(db, foreignDocument.id)).parentId).toBe(foreignFolder.id);
  });
});
