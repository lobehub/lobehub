// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScmChangeRequestModel } from '@/database/models/scm';
import { acceptances, users, verifyRuns, workspaceMembers, workspaces } from '@/database/schemas';

import { parseChangeRequestUrl } from '../changeRequestUrl';
import { bindHandLinkedChangeRequest, unbindHandLinkedChangeRequest } from '../handLink';

const mocks = vi.hoisted(() => ({ postComment: vi.fn(), updateComment: vi.fn() }));

vi.mock('../github/app', () => ({
  fetchGitHubJobLogTail: vi.fn(),
  fetchGitHubReviewFeedback: vi.fn(),
  postGitHubPullRequestComment: mocks.postComment,
  updateGitHubPullRequestComment: mocks.updateComment,
}));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({ set: vi.fn(async () => 'OK') }),
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.test/' } }));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn(async () => {}) },
}));

const serverDB = await getTestDB();
const author = 'scm-hand-link-author';
const bot = 'scm-hand-link-bot';
const pr = parseChangeRequestUrl('https://github.com/lobehub/lobehub/pull/21560')!;

let workspaceId: string;

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: author }, { id: bot }]);
  const [workspace] = await serverDB
    .insert(workspaces)
    .values({ name: 'ws', primaryOwnerId: bot, slug: 'scm-hand-link-ws' })
    .returning();
  workspaceId = workspace.id;
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: bot, workspaceId },
    { role: 'member', userId: author, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

/** A private delivery the bot owns, with one round still waiting on a verdict. */
const botAcceptance = async (subjectId = 's') => {
  const [acceptance] = await serverDB
    .insert(acceptances)
    .values({
      status: 'delivered',
      subjectId,
      subjectType: 'standalone',
      userId: bot,
      visibility: 'private',
      workspaceId,
    })
    .returning();
  await serverDB
    .insert(verifyRuns)
    .values({ acceptanceId: acceptance.id, roundIndex: 1, userId: bot, workspaceId });
  return acceptance;
};

/** The provider row for the PR, routed to its author as the webhook does. */
const authorRow = (state: 'merged' | 'open', rowWorkspaceId: string | null = workspaceId) =>
  ScmChangeRequestModel.upsert(serverDB, {
    metadata: { routedBy: 'author' },
    number: pr.number,
    provider: 'github',
    repoFullName: pr.repoFullName,
    state,
    url: pr.url,
    userId: author,
    workspaceId: rowWorkspaceId,
  });

const statusOf = async (id: string) =>
  (await serverDB.select().from(acceptances).where(eq(acceptances.id, id)))[0].status;

describe('bindHandLinkedChangeRequest', () => {
  it("accepts a teammate's delivery when its PR was merged before the link", async () => {
    const acceptance = await botAcceptance();
    const row = await authorRow('merged');

    const bound = await bindHandLinkedChangeRequest(serverDB, acceptance, pr);

    expect(bound?.acceptanceId).toBe(acceptance.id);
    expect(await statusOf(acceptance.id)).toBe('accepted');
    const [run] = await serverDB
      .select()
      .from(verifyRuns)
      .where(eq(verifyRuns.acceptanceId, acceptance.id));
    expect(run.userDecision).toBe('accept');
    expect(run.decisionDetail).toMatchObject({ decidedBy: author, source: 'scm_merge' });
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.acceptanceId).toBe(
      acceptance.id,
    );
  });

  it('binds an open PR so its later merge accepts, and unlinking undoes it', async () => {
    const acceptance = await botAcceptance();
    const row = await authorRow('open');

    await bindHandLinkedChangeRequest(serverDB, acceptance, pr);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.acceptanceId).toBe(
      acceptance.id,
    );
    expect(await statusOf(acceptance.id)).toBe('delivered');

    await unbindHandLinkedChangeRequest(serverDB, acceptance, pr);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.acceptanceId).toBeNull();
  });

  it('matches the row whatever casing the pasted URL uses', async () => {
    const acceptance = await botAcceptance();
    const row = await authorRow('open');
    const shouted = parseChangeRequestUrl('https://github.com/LobeHub/LobeHub/pull/21560')!;

    await bindHandLinkedChangeRequest(serverDB, acceptance, shouted);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.acceptanceId).toBe(
      acceptance.id,
    );

    await unbindHandLinkedChangeRequest(serverDB, acceptance, shouted);
    expect((await ScmChangeRequestModel.findById(serverDB, row.id))?.acceptanceId).toBeNull();
  });

  it('never claims a row in another tenant or one that names another acceptance', async () => {
    const acceptance = await botAcceptance();

    // Routed to the author's personal scope: not the acceptance's workspace.
    const personal = await authorRow('merged', null);
    expect(await bindHandLinkedChangeRequest(serverDB, acceptance, pr)).toBeNull();
    expect((await ScmChangeRequestModel.findById(serverDB, personal.id))?.acceptanceId).toBeNull();

    // Back in the workspace, but already delivering a different acceptance.
    const other = await botAcceptance('s-2');
    await ScmChangeRequestModel.upsert(serverDB, {
      links: { acceptanceId: other.id },
      number: pr.number,
      provider: 'github',
      repoFullName: pr.repoFullName,
      state: 'merged',
      url: pr.url,
      userId: author,
      workspaceId,
    });
    expect(await bindHandLinkedChangeRequest(serverDB, acceptance, pr)).toBeNull();
    expect(await statusOf(acceptance.id)).toBe('delivered');
  });

  it('does nothing for a PR the provider has not reported yet', async () => {
    const acceptance = await botAcceptance();
    expect(await bindHandLinkedChangeRequest(serverDB, acceptance, pr)).toBeNull();
  });
});
