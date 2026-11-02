// @vitest-environment node
import type { QuickNoteRunDecision } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { QuickNoteModel } from '@/database/models/quickNote';
import { QuickNoteRepository } from '@/database/repositories/quickNote';
import { documents, topics, users, workspaceMembers, workspaces } from '@/database/schemas';

import { QuickNoteApplyError } from './executors';
import { QuickNoteProposalService } from './proposals';
import { renderQuickNoteSourceText as renderSourceText } from './sourceText';

// NOTICE:
// Route tests reuse the isolated migration-backed database instead of an application connection.
// Source: packages/trpc/src/lambda/middleware/serverDatabase.ts.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => getTestDB() }));
vi.mock('@/server/services/agentSignal', () => ({ enqueueAgentSignalSourceEvent: vi.fn() }));
vi.mock('@/server/services/quickNote/featureGate', () => ({ assertQuickNoteEnabled: vi.fn() }));

const db = await getTestDB();
const userId = 'quick-note-proposal-permission-member';
const ownerId = 'quick-note-proposal-permission-owner';
const workspaceId = 'quick-note-proposal-permission-ws';
const model = new QuickNoteModel(db, userId, workspaceId);
const repo = new QuickNoteRepository(db, userId, workspaceId);
const service = new QuickNoteProposalService(db, userId, workspaceId);
const { quickNoteRouter } = await import('@/server/routers/lambda/quickNote');
const caller = quickNoteRouter.createCaller({ userId, workspaceId });

const decision: QuickNoteRunDecision = {
  decisionMode: 'emulated',
  evidence: '"写成一页"',
  explicitGoalRequest: false,
  preset: 'write_document',
  presetScores: { discuss: 0, goal: 0, research: 0, write_document: 4 },
  primary: 'delegate',
  scores: { delegate: 3, enrich: 0, keep: 0, link: 0 },
};

/** Seeds a pending Proposal of `kind` in the workspace. */
const seedProposal = async (
  kind: 'tool_call' | 'topic',
  payload: Record<string, unknown>,
  preset: 'discuss' | 'write_document',
) => {
  const note = await repo.create({ content: 'moshi', editorData: { markdown: 'moshi' } });
  const run = await repo.claimRun(note.id, {
    kind: 'analyze',
    renderSourceText,
    trigger: 'manual',
  });
  await model.recordRunDecision(run!.id, decision);
  const output = await repo.completeRun(run!.id, { proposals: [{ kind, payload, preset }] });
  return { note, proposal: output!.proposals[0] };
};

const seedNewPageProposal = () =>
  seedProposal(
    'tool_call',
    {
      apiName: 'initPage',
      arguments: { markdown: '## Moshi\n\nFull duplex.' },
      identifier: 'lobe-page-agent',
      title: 'Permission check page',
    },
    'write_document',
  );

const seedTopicProposal = () =>
  seedProposal(
    'topic',
    { openingMessage: 'Let us discuss moshi', title: 'Permission check topic' },
    'discuss',
  );

/** Gives the member a role outside the built-in matrix, which expands to no grants. */
const restrictMember = () =>
  db
    .update(workspaceMembers)
    .set({ role: 'restricted' })
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));

const pagesTitled = (title: string) =>
  db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.title, title)));

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: ownerId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: ownerId, slug: workspaceId });
  await db.insert(workspaceMembers).values({ userId, workspaceId });
});

afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(inArray(users.id, [userId, ownerId]));
  vi.restoreAllMocks();
});

/** @example Applying a Proposal needs the same capability as creating its object directly. */
describe('Quick Note Proposal creation permissions', () => {
  // ROOT CAUSE:
  // Applying a Proposal is admitted by `agent:update` only, and `DocumentService.createDocument` /
  // `TopicModel.create` run no RBAC check, so a role denied `document:create` or `topic:create`
  // could still create a Page or a conversation through a (possibly auto-applied) Proposal.
  it('refuses to create a Page without document:create and leaves the Proposal pending', async () => {
    await restrictMember();
    const { note, proposal } = await seedNewPageProposal();

    const error = await service.apply(proposal.id).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(QuickNoteApplyError);
    expect((error as QuickNoteApplyError).code).toBe('forbidden');
    expect(await pagesTitled('Permission check page')).toEqual([]);
    expect((await model.queryProposals(note.id))[0].decisionStatus).toBe('pending');
  });

  it('refuses to create a conversation without topic:create', async () => {
    await restrictMember();
    const { note, proposal } = await seedTopicProposal();

    await expect(caller.applyProposal({ proposalId: proposal.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const created = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.workspaceId, workspaceId), eq(topics.title, 'Permission check topic')));
    expect(created).toEqual([]);
    expect((await model.queryProposals(note.id))[0].decisionStatus).toBe('pending');
  });

  it('still creates the Page for a member who holds document:create', async () => {
    const { note, proposal } = await seedNewPageProposal();

    const { applied } = await service.apply(proposal.id);

    expect(applied).toBe(true);
    expect(await pagesTitled('Permission check page')).toHaveLength(1);
    expect((await model.queryProposals(note.id))[0]).toMatchObject({
      decisionStatus: 'accepted',
      resultType: 'page',
    });
  });
});
