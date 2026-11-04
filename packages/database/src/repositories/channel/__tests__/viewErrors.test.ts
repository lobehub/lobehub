// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, channelJobs } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-view-errors');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

describe('Channel failure receipts', () => {
  it('exposes the concrete failure reason but never the private error payload or execution config', async () => {
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Broken model');
    const message = await asOwner.send(channel.id, {
      content: 'Reply',
      requestKey: 'error',
      routing: 'fallback',
    });
    const [job] = await jobsOf(db, message.id);
    const execution = new ChannelExecutionRepository(db);
    await execution.claim(channel.id, job.id, lease);
    const [claimed] = await db.select().from(channelJobs).where(eq(channelJobs.id, job.id));
    await db
      .update(agentOperations)
      .set({
        status: 'error',
        error: {
          message: 'Unsupported model: invalid-model',
          stack: 'private-stack',
          request: 'private-request',
        },
      })
      .where(eq(agentOperations.id, claimed.operationId!));
    await execution.fail(channel.id, job.id, { message: 'Agent execution ended without a reply' });
    const view = await asOwner.detail(channel.id);
    expect(view.jobs[0].errorMessage).toBe('Unsupported model: invalid-model');
    expect(JSON.stringify(view)).not.toMatch(
      /private-stack|private-request|executionConfig|operationId/,
    );
    await db.update(channelJobs).set({ status: 'completed' }).where(eq(channelJobs.id, job.id));
    expect((await asOwner.detail(channel.id)).jobs[0].errorMessage).toBeNull();
  });
});
