// @vitest-environment node
import type { UnderstandingAnalysis } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  lockUserPersonaOwner,
  upsertUserPersonaInTransaction,
  UserPersonaModel,
} from '../../models/userMemory/persona';
import {
  messages,
  threads,
  topics,
  userPersonaDocumentHistories,
  userPersonaDocuments,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UnderstandingConfirmationRepository } from './confirmation';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-confirmation-user';
const otherUserId = 'understanding-confirmation-other-user';

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [{ description: 'Builds agent systems', salience: 96, title: 'Engineer' }],
    interests: [],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'Agent infrastructure engineer',
    reasoning: 'Repeated source signals',
    tagline: 'Builds reliable agents',
  },
  profile: {
    description: 'Works on agent infrastructure',
    domains: ['AI infrastructure'],
    name: 'Neko',
    pronoun: 'non-specific',
    roles: ['engineer'],
    summary: 'Agent infrastructure engineer',
    tagline: 'Builds reliable agents',
  },
};

const session = {
  id: 'session-1',
  mergeRun: {
    assistantMessageId: 'merge-message-1',
    diagnostics: { evidenceCount: 5, failedCount: 1, succeededCount: 4 },
    resultId: 'merge-result-1',
    status: 'completed' as const,
    threadId: 'merge-thread-1',
  },
  runs: [
    {
      assistantMessageId: 'source-message-1',
      diagnostics: { evidenceCount: 5, failedCount: 1, succeededCount: 4 },
      source: {
        displayName: 'Primary GitHub',
        externalAccountId: 'account-1',
        id: 'github:account-1',
        provider: 'github',
      },
      status: 'completed' as const,
      threadId: 'source-thread-1',
    },
    {
      assistantMessageId: 'source-message-2',
      diagnostics: { evidenceCount: 0, failedCount: 1, succeededCount: 0 },
      source: {
        displayName: 'Primary Gmail',
        externalAccountId: 'account-2',
        id: 'gmail:account-2',
        provider: 'gmail',
      },
      status: 'failed' as const,
      threadId: 'source-thread-2',
    },
  ],
  status: 'partial' as const,
};

const input = { resultId: 'merge-result-1', sessionId: 'session-1', topicId: 'topic-1' };

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

const installResult = async (workspaceId?: string) => {
  await db.insert(topics).values({
    id: input.topicId,
    metadata: {
      onboardingSession: {
        lastActiveAt: '2026-07-15T00:00:00.000Z',
        phase: 'summary',
        startedAt: '2026-07-15T00:00:00.000Z',
        understanding: session,
        version: 1,
      },
    },
    userId,
    workspaceId,
  });
  await db.insert(threads).values({
    id: session.mergeRun.threadId,
    metadata: {
      onboardingUnderstanding: { kind: 'merged' },
    },
    status: 'completed',
    topicId: input.topicId,
    type: 'isolation',
    userId,
    workspaceId,
  });
  await db.insert(messages).values({
    id: session.mergeRun.assistantMessageId,
    metadata: {
      onboardingUnderstanding: {
        analysis,
        diagnostics: {
          errors: [
            {
              code: 'SOURCE_PROCESSING_FAILED',
              message: 'github processing failed',
              operation: 'processing',
              provider: 'github',
              retryable: true,
            },
          ],
          evidenceCount: 5,
          failedCount: 1,
          succeededCount: 4,
        },
        inputThreadIds: ['source-thread-1'],
        kind: 'merged',
        resultId: input.resultId,
      },
    },
    role: 'assistant',
    threadId: session.mergeRun.threadId,
    topicId: input.topicId,
    userId,
    workspaceId,
  });
};

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('UnderstandingConfirmationRepository', () => {
  it('atomically applies the active personal merged result and preserves metadata', async () => {
    await installResult();
    await new UserPersonaModel(db, userId).upsertPersona({
      metadata: { customField: 'keep' },
      persona: 'old persona',
    });

    const result = await new UnderstandingConfirmationRepository(db, userId).confirm(input);

    expect(result.document).toMatchObject({
      persona: analysis.personaProposal.content,
      tagline: analysis.personaProposal.tagline,
    });
    expect(result.document.metadata).toEqual({
      customField: 'keep',
      onboardingUnderstanding: {
        composition: analysis.composition,
        diagnostics: {
          evidenceCount: 5,
          failedCount: 1,
          succeededCount: 4,
        },
        mergeThreadId: session.mergeRun.threadId,
        profile: analysis.profile,
        sessionId: session.id,
        sources: [session.runs[0].source],
        topicId: input.topicId,
      },
    });
    expect(JSON.stringify(result.document.metadata)).not.toContain('SOURCE_PROCESSING_FAILED');
    expect(JSON.stringify(result.document.metadata)).not.toContain('github processing failed');
    expect(JSON.stringify(result.document.metadata)).not.toContain('secret provider failure');
    expect(JSON.stringify(result.document.metadata)).not.toContain('schemaVersion');
  });

  it('serializes concurrent confirmation into exactly one persona update and history row', async () => {
    await installResult();
    const repository = new UnderstandingConfirmationRepository(db, userId);
    const [left, right] = await Promise.all([repository.confirm(input), repository.confirm(input)]);

    expect(left.document.id).toBe(right.document.id);
    const [documents, histories] = await Promise.all([
      db.select().from(userPersonaDocuments).where(eq(userPersonaDocuments.userId, userId)),
      db
        .select()
        .from(userPersonaDocumentHistories)
        .where(eq(userPersonaDocumentHistories.userId, userId)),
    ]);
    expect(documents).toHaveLength(1);
    expect(documents[0].version).toBe(1);
    expect(histories).toHaveLength(1);
  });

  it('does not overwrite metadata from a concurrent persona edit', async () => {
    await installResult();
    const repository = new UnderstandingConfirmationRepository(db, userId);
    const persona = new UserPersonaModel(db, userId);
    const editLocked = deferred();
    const releaseEdit = deferred();
    let confirmationSettled = false;

    const editPromise = db.transaction(async (tx) => {
      await lockUserPersonaOwner(tx, userId);
      await upsertUserPersonaInTransaction(tx, userId, {
        metadata: { concurrentField: 'keep' },
        persona: 'manual edit',
      });
      editLocked.resolve();
      await releaseEdit.promise;
    });
    await editLocked.promise;
    const confirmationPromise = repository.confirm(input).finally(() => {
      confirmationSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(confirmationSettled).toBe(false);
    releaseEdit.resolve();
    await Promise.all([editPromise, confirmationPromise]);

    const current = await persona.getLatestPersonaDocument();
    expect(current?.metadata).toMatchObject({
      concurrentField: 'keep',
      onboardingUnderstanding: {
        mergeThreadId: session.mergeRun.threadId,
        sessionId: session.id,
      },
    });
  });

  it('rejects a workspace-owned result without writing the global persona', async () => {
    await db.insert(workspaces).values({
      id: 'understanding-confirmation-workspace',
      name: 'Private workspace',
      primaryOwnerId: userId,
      slug: 'understanding-confirmation-workspace',
    });
    await installResult('understanding-confirmation-workspace');

    await expect(
      new UnderstandingConfirmationRepository(db, userId).confirm(input),
    ).rejects.toThrow();
    await expect(new UserPersonaModel(db, userId).getLatestPersonaDocument()).resolves.toBeFalsy();
  });

  it('rejects pending, stale, mismatched, and finished confirmations', async () => {
    await installResult();
    const repository = new UnderstandingConfirmationRepository(db, userId);

    await db
      .update(topics)
      .set({
        metadata: {
          onboardingSession: {
            lastActiveAt: '2026-07-15T00:00:00.000Z',
            phase: 'summary',
            startedAt: '2026-07-15T00:00:00.000Z',
            understanding: {
              ...session,
              mergeRun: { ...session.mergeRun, resultId: undefined, status: 'processing' },
              status: 'merging',
            },
            version: 1,
          },
        },
      })
      .where(eq(topics.id, input.topicId));
    await expect(repository.confirm(input)).rejects.toThrow();
    await db
      .update(topics)
      .set({
        metadata: {
          onboardingSession: {
            lastActiveAt: '2026-07-15T00:00:00.000Z',
            phase: 'summary',
            startedAt: '2026-07-15T00:00:00.000Z',
            understanding: session,
            version: 1,
          },
        },
      })
      .where(eq(topics.id, input.topicId));
    await expect(repository.confirm({ ...input, sessionId: 'stale-session' })).rejects.toThrow();
    await expect(repository.confirm({ ...input, resultId: 'source-result' })).rejects.toThrow();

    await db
      .update(topics)
      .set({
        metadata: {
          onboardingSession: {
            finishedAt: '2026-07-15T01:00:00.000Z',
            lastActiveAt: '2026-07-15T00:00:00.000Z',
            phase: 'summary',
            startedAt: '2026-07-15T00:00:00.000Z',
            understanding: session,
            version: 1,
          },
        },
      })
      .where(eq(topics.id, input.topicId));
    await expect(repository.confirm(input)).rejects.toThrow();
    await expect(new UserPersonaModel(db, userId).getLatestPersonaDocument()).resolves.toBeFalsy();
  });

  it('rejects a cross-user result before reading or writing persona state', async () => {
    await installResult();

    await expect(
      new UnderstandingConfirmationRepository(db, otherUserId).confirm(input),
    ).rejects.toThrow();
    await expect(
      new UserPersonaModel(db, otherUserId).getLatestPersonaDocument(),
    ).resolves.toBeFalsy();
  });

  it('rejects a merged message whose input thread IDs do not match completed source runs', async () => {
    await installResult();
    await db
      .update(messages)
      .set({
        metadata: {
          onboardingUnderstanding: {
            analysis,
            diagnostics: { errors: [], evidenceCount: 5, failedCount: 1, succeededCount: 4 },
            inputThreadIds: ['different-source-thread'],
            kind: 'merged',
            resultId: input.resultId,
          },
        },
      })
      .where(eq(messages.id, session.mergeRun.assistantMessageId));

    await expect(
      new UnderstandingConfirmationRepository(db, userId).confirm(input),
    ).rejects.toThrow();
    await expect(new UserPersonaModel(db, userId).getLatestPersonaDocument()).resolves.toBeFalsy();
  });

  it('rejects when the completed source set changes after the merged result was produced', async () => {
    await installResult();
    await db
      .update(topics)
      .set({
        metadata: {
          onboardingSession: {
            lastActiveAt: '2026-07-15T00:00:00.000Z',
            phase: 'summary',
            startedAt: '2026-07-15T00:00:00.000Z',
            understanding: {
              ...session,
              runs: session.runs.map((run) => ({ ...run, status: 'completed' as const })),
            },
            version: 1,
          },
        },
      })
      .where(eq(topics.id, input.topicId));

    await expect(
      new UnderstandingConfirmationRepository(db, userId).confirm(input),
    ).rejects.toThrow();
    await expect(new UserPersonaModel(db, userId).getLatestPersonaDocument()).resolves.toBeFalsy();
  });
});
