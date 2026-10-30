// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { FileModel } from '../../../models/file';
import { files, users } from '../../../schemas';
import { workspaces } from '../../../schemas/workspace';
import type { LobeChatDatabase } from '../../../type';
import { KnowledgeRepo } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const uploaderId = 'chat-attachment-uploader';
const memberId = 'chat-attachment-member';
const workspaceId = 'chat-attachment-workspace';
const name = 'shared-notes.pdf';

describe('conversation attachments in the library', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: uploaderId }, { id: memberId }]);
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Chat Attachment Workspace',
      primaryOwnerId: uploaderId,
      slug: workspaceId,
    });
    await serverDB.insert(files).values({
      fileType: 'application/pdf',
      name,
      size: 1024,
      source: FileSource.ChatAttachment,
      url: 'shared-notes-url',
      userId: uploaderId,
      visibility: 'public',
      workspaceId,
    });
  });

  it('lists an attachment for its uploader so they can unshare it', async () => {
    const items = await new KnowledgeRepo(serverDB, uploaderId, workspaceId).query();
    const rows = await new FileModel(serverDB, uploaderId, workspaceId).query();

    expect(items.map((item) => item.name)).toContain(name);
    expect(rows.map((row) => row.name)).toContain(name);
  });

  it('keeps it out of every other member library', async () => {
    const items = await new KnowledgeRepo(serverDB, memberId, workspaceId).query();
    const rows = await new FileModel(serverDB, memberId, workspaceId).query();

    expect(items.map((item) => item.name)).not.toContain(name);
    expect(rows.map((row) => row.name)).not.toContain(name);
  });
});
