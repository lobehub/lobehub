// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import {
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
  SKILL_INDEX_FILENAME,
} from '@/server/services/skillManagement';
import { createAgentDocument, createService } from '@/server/services/skillManagement/testUtils';

import { createResourceRuntimePrimitives } from '../tools/runtimePrimitives';
import { createReviewRuntimePrimitives } from './server';

/**
 * T-11861: nightly self-review read a `hintIsSkill` document through getManagedSkill, got no
 * snapshot back, and every refine path then failed with "Skill target snapshot is required".
 * These cases drive the real skill-management service through both runtimes.
 */

const HINTED_ID = 'hinted-adoc-1';
const HINTED_CONTENT = '# Weekly report\n\n1. Collect merged PRs.\n2. Summarize risks.';

const seedHintedDocument = (model: ReturnType<typeof createService>['agentDocumentModel']) => {
  model.documents.push(
    createAgentDocument({
      agentId: 'agent-1',
      content: HINTED_CONTENT,
      documentId: 'hinted-doc-1',
      filename: 'weekly-report.md',
      id: HINTED_ID,
      metadata: {
        agentSignal: { hintedByTool: 'lobe-agent-documents.createDocument', hintIsSkill: true },
      },
      title: 'Weekly Report',
    }),
  );
};

const createReviewRuntime = () => {
  const skill = createService();
  const writeDailyBrief = vi.fn(async () => ({ id: 'brief-1' }));
  const runtime = createReviewRuntimePrimitives({
    agentId: 'agent-1',
    briefModel: {} as never,
    db: {} as unknown as LobeChatDatabase,
    localDate: '2026-11-05',
    proposalBriefWriter: { writeDailyBrief } as never,
    reviewWindowEnd: '2026-11-05T14:00:00.000Z',
    reviewWindowStart: '2026-11-04T14:00:00.000Z',
    skillDocumentService: skill.service,
    sourceId: 'nightly-review:user-1:agent-1:2026-11-05',
    userId: 'user-1',
  });

  return { ...skill, runtime, writeDailyBrief };
};

type ReadResult = {
  baseSnapshot: Record<string, unknown>;
  content: string;
  hintedDocument: boolean;
};

describe('nightly review runtime with a hinted skill document', () => {
  it('returns the hinted document content with a complete base snapshot', async () => {
    const { agentDocumentModel, runtime } = createReviewRuntime();
    seedHintedDocument(agentDocumentModel);

    const read = (await runtime.getManagedSkill?.(
      { skillDocumentId: HINTED_ID },
      {},
    )) as ReadResult;

    expect(read).toMatchObject({
      agentDocumentId: HINTED_ID,
      content: HINTED_CONTENT,
      documentId: 'hinted-doc-1',
      hintedDocument: true,
    });
    expect(read.baseSnapshot).toMatchObject({
      agentDocumentId: HINTED_ID,
      contentHash: expect.stringMatching(/^sha256:[\da-f]{64}$/),
      documentId: 'hinted-doc-1',
      managed: true,
      targetType: 'skill',
      writable: true,
    });
  });

  it('creates a refine_skill proposal for the hinted document', async () => {
    const { agentDocumentModel, runtime, writeDailyBrief } = createReviewRuntime();
    seedHintedDocument(agentDocumentModel);

    const result = await runtime.createSelfReviewProposal?.(
      {
        actions: [
          {
            actionType: 'refine_skill',
            operation: {
              domain: 'skill',
              input: {
                bodyMarkdown: '# Weekly report\n\nRefined steps.',
                skillDocumentId: HINTED_ID,
              },
              operation: 'refine',
            },
            rationale: 'The weekly report procedure repeats across topics.',
            target: { skillDocumentId: HINTED_ID },
          },
        ],
        idempotencyKey: 'proposal-hinted-1',
        proposalKey: `skill:${HINTED_ID}`,
        summary: 'Refine the weekly report skill.',
        userId: 'user-1',
      },
      {},
    );

    expect(result).toMatchObject({ proposalId: 'brief-1' });
    expect(writeDailyBrief).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writeDailyBrief.mock.calls[0])).toContain(HINTED_ID);
  });

  it('promotes the hinted document when CAS receives the read snapshot unchanged', async () => {
    const { agentDocumentModel, documentService, runtime, service } = createReviewRuntime();
    seedHintedDocument(agentDocumentModel);
    const read = (await runtime.getManagedSkill?.(
      { skillDocumentId: HINTED_ID },
      {},
    )) as ReadResult;

    const result = await runtime.replaceSkillContentCAS?.(
      {
        baseSnapshot: read.baseSnapshot,
        bodyMarkdown: '# Weekly report\n\nRefined steps.',
        idempotencyKey: 'cas-hinted-1',
        skillDocumentId: HINTED_ID,
        userId: 'user-1',
      },
      {},
    );

    expect(result).toMatchObject({ documentId: 'hinted-doc-1', historyId: 'history-exact-1' });
    expect(result).not.toHaveProperty('status');
    expect(documentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
      'hinted-doc-1',
      'llm_call',
    );

    const promoted = agentDocumentModel.documents.find((doc) => doc.id === HINTED_ID);
    expect(promoted).toMatchObject({
      fileType: SKILL_INDEX_FILE_TYPE,
      filename: SKILL_INDEX_FILENAME,
    });
    expect(promoted?.content).toContain('Refined steps.');

    const skills = await service.listSkills({ agentId: 'agent-1' });
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      index: { agentDocumentId: HINTED_ID },
      name: 'weekly-report',
      title: 'Weekly Report',
    });
    expect(
      agentDocumentModel.documents.filter((doc) => doc.fileType === SKILL_BUNDLE_FILE_TYPE),
    ).toHaveLength(1);
  });

  it('rejects CAS as stale when the hinted document changed after the read', async () => {
    const { agentDocumentModel, runtime } = createReviewRuntime();
    seedHintedDocument(agentDocumentModel);
    const read = (await runtime.getManagedSkill?.(
      { skillDocumentId: HINTED_ID },
      {},
    )) as ReadResult;
    agentDocumentModel.documents[0]!.content = 'Edited by the user meanwhile.';

    const result = await runtime.replaceSkillContentCAS?.(
      {
        baseSnapshot: read.baseSnapshot,
        bodyMarkdown: 'Refined steps.',
        idempotencyKey: 'cas-hinted-stale',
        skillDocumentId: HINTED_ID,
        userId: 'user-1',
      },
      {},
    );

    expect(result).toMatchObject({ status: 'skipped_stale', summary: 'content_changed' });
    expect(agentDocumentModel.documents[0]?.fileType).toBe('agent/document');
  });

  it('accepts a snapshot read by SKILL.md index id when CAS targets the same index id', async () => {
    const { runtime, service } = createReviewRuntime();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: '# Release notes',
      description: 'Drafts release notes',
      name: 'release-notes',
      title: 'Release Notes',
    });
    const indexId = created.index.agentDocumentId;
    const read = (await runtime.getManagedSkill?.({ skillDocumentId: indexId }, {})) as ReadResult;

    const result = await runtime.replaceSkillContentCAS?.(
      {
        baseSnapshot: read.baseSnapshot,
        bodyMarkdown: '# Release notes\n\nRefined.',
        idempotencyKey: 'cas-index-1',
        skillDocumentId: indexId,
        userId: 'user-1',
      },
      {},
    );

    expect(read.hintedDocument).toBe(false);
    expect(result).toMatchObject({ resourceId: created.bundle.agentDocumentId });
    expect(result).not.toHaveProperty('status');
  });

  it('names the unresolved id when neither a managed skill nor a hinted document matches', async () => {
    const { agentDocumentModel, runtime } = createReviewRuntime();
    agentDocumentModel.documents.push(
      createAgentDocument({
        agentId: 'agent-1',
        content: 'Plain note.',
        documentId: 'plain-doc-1',
        id: 'plain-adoc-1',
      }),
    );

    await expect(runtime.getManagedSkill?.({ skillDocumentId: 'plain-adoc-1' }, {})).resolves.toBe(
      undefined,
    );
    await expect(
      runtime.replaceSkillContentCAS?.(
        {
          bodyMarkdown: 'Body.',
          idempotencyKey: 'cas-plain-1',
          skillDocumentId: 'plain-adoc-1',
          userId: 'user-1',
        },
        {},
      ),
    ).rejects.toThrow('skillDocumentId "plain-adoc-1" is neither a managed skill');
  });

  it('reads skills only in the reviewed agent scope, matching the write scope', async () => {
    const { runtime, service } = createReviewRuntime();
    const foreign = await service.createSkill({
      agentId: 'agent-2',
      bodyMarkdown: '# Foreign',
      description: 'Belongs to another agent',
      name: 'foreign-skill',
      title: 'Foreign Skill',
    });

    await expect(
      runtime.getManagedSkill?.(
        { agentId: 'agent-2', skillDocumentId: foreign.bundle.agentDocumentId },
        {},
      ),
    ).resolves.toBe(undefined);
    await expect(runtime.listManagedSkills?.({ agentId: 'agent-2' }, {})).resolves.toEqual([]);
  });
});

describe('skill-management runtime with a hinted skill document', () => {
  const createSkillManagementRuntime = () => {
    const skill = createService();
    const runtime = createResourceRuntimePrimitives({
      agentId: 'agent-1',
      db: {} as LobeChatDatabase,
      memoryReason: (count) => `reason ${count}`,
      skillDocumentService: skill.service,
      userId: 'user-1',
    });

    return { ...skill, runtime };
  };

  it('promotes the hinted document when CAS receives the read snapshot unchanged', async () => {
    const { agentDocumentModel, runtime } = createSkillManagementRuntime();
    seedHintedDocument(agentDocumentModel);
    const read = (await runtime.getManagedSkill?.(
      { skillDocumentId: HINTED_ID },
      {},
    )) as ReadResult;

    const result = await runtime.replaceSkillContentCAS?.(
      {
        baseSnapshot: read.baseSnapshot,
        bodyMarkdown: 'Refined steps.',
        idempotencyKey: 'sm-cas-hinted-1',
        skillDocumentId: HINTED_ID,
      },
      {},
    );

    expect(result).toMatchObject({ documentId: 'hinted-doc-1', summary: expect.any(String) });
    expect(result).not.toHaveProperty('status');
    expect(agentDocumentModel.documents.find((doc) => doc.id === HINTED_ID)?.fileType).toBe(
      SKILL_INDEX_FILE_TYPE,
    );
  });

  it('keeps the caller snapshot as the CAS base instead of recapturing it', async () => {
    const { agentDocumentModel, runtime } = createSkillManagementRuntime();
    seedHintedDocument(agentDocumentModel);
    const read = (await runtime.getManagedSkill?.(
      { skillDocumentId: HINTED_ID },
      {},
    )) as ReadResult;
    agentDocumentModel.documents[0]!.content = 'Edited by the user meanwhile.';

    const result = await runtime.replaceSkillContentCAS?.(
      {
        baseSnapshot: read.baseSnapshot,
        bodyMarkdown: 'Refined steps.',
        idempotencyKey: 'sm-cas-hinted-stale',
        skillDocumentId: HINTED_ID,
      },
      {},
    );

    expect(result).toMatchObject({ status: 'skipped_stale', summary: 'content_changed' });
  });
});
