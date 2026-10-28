// @vitest-environment node
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMessageFiles, files } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-attachments');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const createFile = async (name: string) => {
  const [file] = await db
    .insert(files)
    .values({
      fileType: 'text/plain',
      name,
      size: 1,
      url: `files/${name}`,
      userId: fixture.memberId,
      workspaceId: fixture.workspaceId,
    })
    .returning();
  return file.id;
};

const attachmentsOf = async (messageId: string) => {
  const rows = await db
    .select({ fileId: channelMessageFiles.fileId })
    .from(channelMessageFiles)
    .where(eq(channelMessageFiles.messageId, messageId))
    .orderBy(asc(channelMessageFiles.sortOrder));
  return rows.map((row) => row.fileId);
};

describe('channel message attachments', () => {
  it('records attachments in the order sent and matches them on retry', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    const [first, second] = [await createFile('b.txt'), await createFile('a.txt')];
    const input = {
      content: 'Review these',
      fileIds: [first, second],
      mentions: [agent.id],
      requestKey: 'req-1',
      routing: 'jev' as const,
    };

    const message = await asMember.send(channel.id, input);

    expect(await attachmentsOf(message.id)).toEqual([first, second]);
    await expect(asMember.send(channel.id, input)).resolves.toMatchObject({ id: message.id });
    await expect(
      asMember.send(channel.id, { ...input, fileIds: [second, first] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await attachmentsOf(message.id)).toEqual([first, second]);
  });

  it('hands attachments to the claimed run, without files deleted since', async () => {
    const { asMember, channel } = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(channel.id, 'Coder');
    const [kept, deleted] = [await createFile('kept.txt'), await createFile('deleted.txt')];
    const message = await asMember.send(channel.id, {
      content: 'Review these',
      fileIds: [kept, deleted],
      mentions: [agent.id],
      requestKey: 'req-1',
      routing: 'jev',
    });
    await db.delete(files).where(eq(files.id, deleted));
    const [job] = await jobsOf(db, message.id);

    await execution.claim(channel.id, job.id, lease);

    expect(await execution.input(channel.id, job.id)).toEqual([
      expect.objectContaining({ fileIds: [kept], id: message.id }),
    ]);
  });
});
