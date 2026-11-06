// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SKILL_BUNDLE_FILE_TYPE, SKILL_INDEX_FILE_TYPE } from './constants';
import { createAgentDocument, createService } from './testUtils';

const hintedMetadata = { agentSignal: { hintIsSkill: true } };

describe('SkillManagementDocumentService hinted skill documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('snapshots a hinted document by its own ids and content hash', async () => {
    const { agentDocumentModel, service } = createService();
    agentDocumentModel.documents.push(
      createAgentDocument({
        agentId: 'agent-1',
        content: 'Steps.',
        documentId: 'doc-hinted',
        id: 'adoc-hinted',
        metadata: hintedMetadata,
        title: 'Deploy Checklist',
      }),
    );

    const snapshot = await service.readSkillTargetSnapshot({
      agentDocumentId: 'adoc-hinted',
      agentId: 'agent-1',
    });

    expect(snapshot).toEqual({
      agentDocumentId: 'adoc-hinted',
      contentHash: expect.stringMatching(/^sha256:/),
      documentId: 'doc-hinted',
      hintedDocument: true,
      managed: true,
      targetTitle: 'Deploy Checklist',
      writable: true,
    });
  });

  it('ignores ordinary documents and hinted documents of another agent', async () => {
    const { agentDocumentModel, service } = createService();
    agentDocumentModel.documents.push(
      createAgentDocument({
        agentId: 'agent-1',
        documentId: 'doc-plain',
        id: 'adoc-plain',
      }),
      createAgentDocument({
        agentId: 'agent-2',
        documentId: 'doc-foreign',
        id: 'adoc-foreign',
        metadata: hintedMetadata,
      }),
    );

    for (const agentDocumentId of ['adoc-plain', 'adoc-foreign']) {
      await expect(
        service.readSkillTargetSnapshot({ agentDocumentId, agentId: 'agent-1' }),
      ).resolves.toBeUndefined();
      await expect(
        service.replaceSkillIndex({ agentDocumentId, agentId: 'agent-1', bodyMarkdown: 'x' }),
      ).resolves.toBeUndefined();
    }
    expect(agentDocumentModel.documents.map((doc) => doc.fileType)).toEqual([
      'agent/document',
      'agent/document',
    ]);
  });

  it('suffixes the promoted skill name when the derived name is already taken', async () => {
    const { agentDocumentModel, service } = createService();
    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: '# Existing',
      description: 'Existing skill',
      name: 'deploy-checklist',
      title: 'Deploy Checklist',
    });
    agentDocumentModel.documents.push(
      createAgentDocument({
        agentId: 'agent-1',
        content: 'Steps.',
        documentId: 'doc-hinted',
        filename: 'Deploy Checklist.md',
        id: 'adoc-hinted',
        metadata: hintedMetadata,
        title: 'Deploy Checklist',
      }),
    );

    const promoted = await service.replaceSkillIndex({
      agentDocumentId: 'adoc-hinted',
      agentId: 'agent-1',
      bodyMarkdown: 'Refined steps.',
    });

    expect(promoted).toMatchObject({
      index: { agentDocumentId: 'adoc-hinted', documentId: 'doc-hinted' },
      name: 'deploy-checklist-adochint',
    });
    expect(
      agentDocumentModel.documents.filter((doc) => doc.fileType === SKILL_BUNDLE_FILE_TYPE),
    ).toHaveLength(2);
  });

  it('prefers a frontmatter name and description carried by the hinted document', async () => {
    const { agentDocumentModel, service } = createService();
    agentDocumentModel.documents.push(
      createAgentDocument({
        agentId: 'agent-1',
        content: '---\ndescription: Runs the on-call handoff\nname: oncall-handoff\n---\nSteps.',
        documentId: 'doc-hinted',
        id: 'adoc-hinted',
        metadata: hintedMetadata,
        title: '交接流程',
      }),
    );

    const promoted = await service.replaceSkillIndex({
      agentDocumentId: 'adoc-hinted',
      agentId: 'agent-1',
      bodyMarkdown: 'Refined steps.',
    });

    expect(promoted).toMatchObject({
      description: 'Runs the on-call handoff',
      name: 'oncall-handoff',
      title: '交接流程',
    });
  });

  it('falls back to an id-based name for an untitled non-Latin hinted document', async () => {
    const { agentDocumentModel, service } = createService();
    agentDocumentModel.documents.push(
      createAgentDocument({
        agentId: 'agent-1',
        content: '步骤。',
        documentId: 'doc-hinted',
        filename: '周报',
        id: 'adoc-hinted',
        metadata: hintedMetadata,
        title: '周报',
      }),
    );

    const promoted = await service.replaceSkillIndex({
      agentDocumentId: 'adoc-hinted',
      agentId: 'agent-1',
      bodyMarkdown: '新步骤。',
    });

    expect(promoted?.name).toBe('skill-adochint');
    expect(agentDocumentModel.documents.find((doc) => doc.id === 'adoc-hinted')?.fileType).toBe(
      SKILL_INDEX_FILE_TYPE,
    );
  });
});
