// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelJobs, channels, workspaces } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-deletion-safety');
const executions = new ChannelExecutionRepository(db);
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel writer identity survives deletion attempts', () => {
  it.each(['channel', 'workspace'] as const)(
    'blocks deleting an active writer through %s, then permits deletion after confirmed release',
    async (target) => {
      const { asOwner, channel } = await fixture.createTeamChannel();
      await fixture.addAgent(channel.id, 'Writer');
      const message = await asOwner.send(channel.id, {
        content: 'Work',
        requestKey: target,
        routing: 'fallback',
      });
      const [job] = await jobsOf(db, message.id);
      const claim = await executions.claim(channel.id, job.id, lease);
      const remove = () => {
        switch (target) {
          case 'channel': {
            return db.delete(channels).where(eq(channels.id, channel.id));
          }
          case 'workspace': {
            return db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
          }
        }
      };
      await expect(remove()).rejects.toThrow();
      const [retained] = await db.select().from(channelJobs).where(eq(channelJobs.id, job.id));
      expect(retained).toMatchObject({
        operationId: claim!.job.operationId,
        topicId: claim!.topic.id,
        writerHeld: true,
      });
      await executions.releaseWriter(channel.id, job.id);
      await expect(remove()).resolves.toBeDefined();
    },
  );
});
