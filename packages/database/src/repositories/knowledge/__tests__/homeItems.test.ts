// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, files, knowledgeBaseFiles, knowledgeBases } from '../../../schemas/file';
import { users } from '../../../schemas/user';
import { workspaces } from '../../../schemas/workspace';
import type { LobeChatDatabase } from '../../../type';
import { KnowledgeRepo } from '../index';

const me = 'home-items-me';
const mate = 'home-items-mate';

const serverDB: LobeChatDatabase = await getTestDB();

let workspaceId = '';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: me }, { id: mate }]);
  const [ws] = await serverDB
    .insert(workspaces)
    .values({ name: 'home-items', primaryOwnerId: me, slug: 'home-items' })
    .returning();
  workspaceId = ws.id;

  await serverDB.insert(knowledgeBases).values([
    { id: 'home-kb', name: 'KB', userId: me, visibility: 'public', workspaceId },
    {
      id: 'home-kb-restricted',
      name: 'Restricted',
      userId: mate,
      visibility: 'public',
      workspaceId,
    },
  ]);

  await serverDB.insert(files).values([
    {
      fileType: 'application/pdf',
      id: 'home-file-mine',
      name: 'mine.pdf',
      size: 1,
      updatedAt: minutesAgo(1),
      url: 'u1',
      userId: me,
      workspaceId,
    },
    {
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      id: 'home-file-mate',
      name: 'mate.docx',
      size: 1,
      updatedAt: minutesAgo(4),
      url: 'u2',
      userId: mate,
      workspaceId,
    },
    {
      fileType: 'text/plain',
      id: 'home-file-restricted',
      name: 'restricted.txt',
      size: 1,
      updatedAt: minutesAgo(2),
      url: 'u3',
      userId: mate,
      workspaceId,
    },
    // Newest rows, yet not documents: media and raw data never reach the list.
    ...[
      ['home-file-image', 'image/png'],
      ['home-file-video', 'video/mp4'],
      ['home-file-zip', 'application/zip'],
    ].map(([id, fileType]) => ({
      fileType,
      id,
      name: id,
      size: 1,
      updatedAt: new Date(),
      url: id,
      userId: me,
      workspaceId,
    })),
  ]);
  await serverDB.insert(knowledgeBaseFiles).values([
    { fileId: 'home-file-mine', knowledgeBaseId: 'home-kb', userId: me, workspaceId },
    {
      fileId: 'home-file-restricted',
      knowledgeBaseId: 'home-kb-restricted',
      userId: mate,
      workspaceId,
    },
  ]);

  const page = (params: {
    fileType?: string;
    id: string;
    knowledgeBaseId?: string;
    minutes: number;
    userId: string;
    visibility?: 'private' | 'public';
  }) => ({
    fileType: params.fileType ?? 'custom/document',
    filename: params.id,
    id: params.id,
    knowledgeBaseId: params.knowledgeBaseId ?? null,
    source: 'document',
    sourceType: 'api' as const,
    title: params.id,
    totalCharCount: 1,
    totalLineCount: 1,
    updatedAt: minutesAgo(params.minutes),
    userId: params.userId,
    visibility: params.visibility ?? 'public',
    workspaceId,
  });

  await serverDB
    .insert(documents)
    .values([
      page({ id: 'home-page-mine', minutes: 3, userId: me }),
      page({ id: 'home-page-kb', knowledgeBaseId: 'home-kb', minutes: 5, userId: me }),
      page({ id: 'home-page-mate', minutes: 6, userId: mate }),
      page({ id: 'home-page-mate-private', minutes: 0, userId: mate, visibility: 'private' }),
      page({ fileType: 'custom/folder', id: 'home-folder', minutes: 0, userId: me }),
      page({ fileType: 'custom/html', id: 'home-artifact-mine', minutes: 3.5, userId: me }),
    ]);
});

const ids = async (params: Parameters<KnowledgeRepo['queryHomeItems']>[0]) =>
  (await new KnowledgeRepo(serverDB, me, workspaceId).queryHomeItems(params)).map(
    (item) => item.id,
  );

describe('KnowledgeRepo.queryHomeItems', () => {
  it('mixes pages and files, newest update first, without folders or private rows of others', async () => {
    expect(await ids({})).toEqual([
      'home-file-mine',
      'home-file-restricted',
      'home-page-mine',
      'home-artifact-mine',
      'home-file-mate',
      'home-page-kb',
      'home-page-mate',
    ]);
  });

  it('keeps only document files, not images, videos or raw data', async () => {
    const result = await ids({});
    expect(result).not.toContain('home-file-image');
    expect(result).not.toContain('home-file-video');
    expect(result).not.toContain('home-file-zip');
    expect(result).toEqual(expect.arrayContaining(['home-file-mine', 'home-file-mate']));
  });

  it("narrows to the caller's own rows", async () => {
    expect(await ids({ creator: 'self' })).toEqual([
      'home-file-mine',
      'home-page-mine',
      'home-artifact-mine',
      'home-page-kb',
    ]);
  });

  it('narrows to rows other members shared', async () => {
    expect(await ids({ creator: 'others' })).toEqual([
      'home-file-restricted',
      'home-file-mate',
      'home-page-mate',
    ]);
  });

  it('drops rows of restricted knowledge bases and reports each row location', async () => {
    const items = await new KnowledgeRepo(serverDB, me, workspaceId).queryHomeItems({
      excludeKnowledgeBaseIds: ['home-kb-restricted'],
    });

    expect(items.map((item) => item.id)).not.toContain('home-file-restricted');
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId['home-file-mine'].knowledgeBaseIds).toEqual(['home-kb']);
    expect(byId['home-page-kb'].knowledgeBaseIds).toEqual(['home-kb']);
    expect(byId['home-page-mine'].knowledgeBaseIds).toEqual([]);
  });

  it('honours the limit', async () => {
    expect(await ids({ limit: 2 })).toEqual(['home-file-mine', 'home-file-restricted']);
  });
});
