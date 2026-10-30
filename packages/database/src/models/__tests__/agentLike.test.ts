// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentLikes, agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AGENT_LIKE_AGENT_NOT_FOUND,
  AGENT_LIKE_WORKSPACE_REQUIRED,
  AgentLikeModel,
} from '../agentLike';

const serverDB: LobeChatDatabase = await getTestDB();

const authorId = 'agent-like-author';
const memberId = 'agent-like-member';
const outsiderId = 'agent-like-outsider';
const workspaceId = 'agent-like-workspace';
const otherWorkspaceId = 'agent-like-other-workspace';
const agentId = 'agent-like-agent';
const privateAgentId = 'agent-like-private-agent';
const foreignAgentId = 'agent-like-foreign-agent';

const authorModel = new AgentLikeModel(serverDB, authorId, workspaceId);
const memberModel = new AgentLikeModel(serverDB, memberId, workspaceId);
const outsiderModel = new AgentLikeModel(serverDB, outsiderId, otherWorkspaceId);

const cleanup = async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: authorId }, { id: memberId }, { id: outsiderId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Likes', primaryOwnerId: authorId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'Other', primaryOwnerId: outsiderId, slug: otherWorkspaceId },
  ]);
  await serverDB.insert(agents).values([
    { id: agentId, userId: authorId, workspaceId },
    { id: privateAgentId, userId: authorId, visibility: 'private', workspaceId },
    { id: foreignAgentId, userId: outsiderId, workspaceId: otherWorkspaceId },
  ]);
});

afterEach(cleanup);

describe('AgentLikeModel', () => {
  it('requires workspace scope and rejects agents outside the current workspace', async () => {
    const personalModel = new AgentLikeModel(serverDB, memberId);
    await expect(personalModel.like(agentId)).rejects.toThrow(AGENT_LIKE_WORKSPACE_REQUIRED);
    await expect(personalModel.summaries()).rejects.toThrow(AGENT_LIKE_WORKSPACE_REQUIRED);
    await expect(outsiderModel.like(agentId)).rejects.toThrow(AGENT_LIKE_AGENT_NOT_FOUND);
    await expect(memberModel.unlike(foreignAgentId)).rejects.toThrow(AGENT_LIKE_AGENT_NOT_FOUND);
    await expect(memberModel.like('missing-agent')).rejects.toThrow(AGENT_LIKE_AGENT_NOT_FOUND);
  });

  it('likes idempotently and stamps the workspace', async () => {
    await expect(memberModel.like(agentId)).resolves.toEqual({ liked: true, total: 1 });
    await expect(memberModel.like(agentId)).resolves.toEqual({ liked: true, total: 1 });
    await expect(authorModel.like(agentId)).resolves.toEqual({ liked: true, total: 2 });

    const rows = await serverDB.select().from(agentLikes).where(eq(agentLikes.agentId, agentId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.workspaceId === workspaceId)).toBe(true);
  });

  it('unlikes idempotently', async () => {
    await memberModel.like(agentId);
    await authorModel.like(agentId);

    await expect(memberModel.unlike(agentId)).resolves.toEqual({ liked: false, total: 1 });
    await expect(memberModel.unlike(agentId)).resolves.toEqual({ liked: false, total: 1 });
  });

  it('summarizes visible agents with the caller liked state', async () => {
    await memberModel.like(agentId);
    await authorModel.like(agentId);
    await authorModel.like(privateAgentId);
    await outsiderModel.like(foreignAgentId);

    await expect(memberModel.summaries()).resolves.toEqual({
      [agentId]: { liked: true, total: 2 },
    });
    await expect(authorModel.summaries()).resolves.toEqual({
      [agentId]: { liked: true, total: 2 },
      [privateAgentId]: { liked: true, total: 1 },
    });

    await memberModel.unlike(agentId);
    await expect(memberModel.summaries()).resolves.toEqual({
      [agentId]: { liked: false, total: 1 },
    });
  });

  it('stops counting likes from before a transfer and re-homes them on a new like', async () => {
    await memberModel.like(agentId);
    await authorModel.like(agentId);
    await serverDB
      .update(agents)
      .set({ workspaceId: otherWorkspaceId })
      .where(eq(agents.id, agentId));

    await expect(memberModel.summaries()).resolves.toEqual({});
    await expect(outsiderModel.summaries()).resolves.toEqual({});

    const transferredModel = new AgentLikeModel(serverDB, memberId, otherWorkspaceId);
    await expect(transferredModel.like(agentId)).resolves.toEqual({ liked: true, total: 1 });
    await expect(outsiderModel.summaries()).resolves.toEqual({
      [agentId]: { liked: false, total: 1 },
    });
  });
});
