// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PolicyLoad } from '@/database/models/agentDocuments';

import {
  AGENT_SKILL_TEMPLATE_ID,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
  SKILL_INDEX_FILENAME,
  SKILL_MANAGEMENT_SOURCE,
  SKILL_MANAGEMENT_SOURCE_TYPE,
} from './constants';
import { backingDocumentUpdatedAt, createService, expectedEditorData, now } from './testUtils';

const skillContent = (name: string, description: string, body = '# Skill') =>
  `---\ndescription: ${description}\nname: ${name}\n---\n${body}`;

const skillBody = (body = '# Skill') => body;

describe('SkillManagementDocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates, lists, and gets managed skills without leaking list content', async () => {
    const { agentDocumentModel, service } = createService();

    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Writes release notes',
      name: 'release-writer',
      title: 'Release Writer',
    });
    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Reviews changes',
      name: 'code-reviewer',
      title: 'Code Reviewer',
    });

    const list = await service.listSkills({ agentId: 'agent-1' });
    expect(list.map((item) => item.name)).toEqual(['code-reviewer', 'release-writer']);
    expect(list[0]).not.toHaveProperty('content');
    expect(agentDocumentModel.createCalls[0]).toEqual(
      expect.objectContaining({
        content: '',
        filename: 'release-writer',
        params: expect.objectContaining({
          fileType: SKILL_BUNDLE_FILE_TYPE,
          policyLoad: PolicyLoad.DISABLED,
          source: SKILL_MANAGEMENT_SOURCE,
          sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
          templateId: AGENT_SKILL_TEMPLATE_ID,
        }),
      }),
    );
    expect(agentDocumentModel.createCalls[1]).toEqual(
      expect.objectContaining({
        content: skillContent('release-writer', 'Writes release notes'),
        filename: SKILL_INDEX_FILENAME,
        params: expect.objectContaining({
          editorData: expectedEditorData(skillContent('release-writer', 'Writes release notes')),
          fileType: SKILL_INDEX_FILE_TYPE,
          parentId: 'document-1',
          policyLoad: PolicyLoad.DISABLED,
        }),
      }),
    );

    const detail = await service.getSkill({
      agentId: 'agent-1',
      includeContent: true,
      name: 'release-writer',
    });

    expect(detail).toEqual(
      expect.objectContaining({
        content: skillContent('release-writer', 'Writes release notes'),
        frontmatter: { description: 'Writes release notes', name: 'release-writer' },
        name: 'release-writer',
      }),
    );
    expect(detail?.bundle.agentDocumentId).toBe('agent-doc-1');
    expect(detail?.bundle.documentId).toBe('document-1');
    expect(detail?.index.agentDocumentId).toBe('agent-doc-2');
    expect(detail?.index.documentId).toBe('document-2');
  });

  it('strips frontmatter pasted into bodyMarkdown instead of failing the save', async () => {
    const { service } = createService();

    const detail = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown:
        '---\nname: stale-name\ndescription: Stale description\n---\n\n# Skill\n\n- Step one.',
      description: 'Canonical description',
      name: 'release-writer',
      title: 'Release Writer',
    });

    expect(detail.content).toBe(
      skillContent('release-writer', 'Canonical description', '# Skill\n\n- Step one.'),
    );
    expect(detail.frontmatter).toEqual({
      description: 'Canonical description',
      name: 'release-writer',
    });
  });

  it('converts a hinted source document into the index while preserving ids', async () => {
    const { agentDocumentModel, service } = createService();
    const source = await agentDocumentModel.create('agent-1', 'draft-skill', '# Draft', {
      metadata: { agentSignal: { hintIsSkill: true } },
      title: 'Draft Skill',
    });

    const detail = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody('# Draft'),
      description: 'Draft helper',
      name: 'draft-skill',
      sourceAgentDocumentId: source.id,
      title: 'Draft Skill',
    });

    expect(detail.index.agentDocumentId).toBe(source.id);
    expect(detail.index.documentId).toBe(source.documentId);
    expect(detail.content).toBe(skillContent('draft-skill', 'Draft helper', '# Draft'));
    expect(agentDocumentModel.documents).toHaveLength(2);
    expect(agentDocumentModel.documents.find((doc) => doc.id === source.id)).toEqual(
      expect.objectContaining({
        editorData: expectedEditorData(skillContent('draft-skill', 'Draft helper', '# Draft')),
        fileType: SKILL_INDEX_FILE_TYPE,
        filename: SKILL_INDEX_FILENAME,
        parentId: detail.bundle.documentId,
        policyLoad: PolicyLoad.DISABLED,
        source: SKILL_MANAGEMENT_SOURCE,
        sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
      }),
    );
  });

  it('rejects duplicate skill names before creating another bundle', async () => {
    const { agentDocumentModel, service } = createService();
    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Review helper',
      name: 'review-skill',
      title: 'Review Skill',
    });
    agentDocumentModel.createCalls = [];

    await expect(
      service.createSkill({
        agentId: 'agent-1',
        bodyMarkdown: skillBody(),
        description: 'Review helper',
        name: 'review-skill',
        title: 'Review Skill',
      }),
    ).rejects.toThrow('Skill already exists');

    expect(agentDocumentModel.createCalls).toEqual([]);
  });

  it('does not create a bundle when source document conversion cannot start', async () => {
    const { agentDocumentModel, service } = createService();

    await expect(
      service.createSkill({
        agentId: 'agent-1',
        bodyMarkdown: skillBody(),
        description: 'Missing source',
        name: 'missing-skill',
        sourceAgentDocumentId: 'missing-source',
        title: 'Missing Skill',
      }),
    ).rejects.toThrow('Source agent document not found: missing-source');

    expect(agentDocumentModel.createCalls).toEqual([]);
    expect(await service.listSkills({ agentId: 'agent-1' })).toEqual([]);
  });

  it('rejects source documents owned by another agent before creating a bundle', async () => {
    const { agentDocumentModel, service } = createService();
    const otherAgentSource = await agentDocumentModel.create('agent-2', 'draft-skill', '# Draft', {
      metadata: { agentSignal: { hintIsSkill: true } },
      title: 'Draft Skill',
    });

    await expect(
      service.createSkill({
        agentId: 'agent-1',
        bodyMarkdown: skillBody(),
        description: 'Draft helper',
        name: 'draft-skill',
        sourceAgentDocumentId: otherAgentSource.id,
        title: 'Draft Skill',
      }),
    ).rejects.toThrow('Source agent document does not belong to agent agent-1');

    expect(agentDocumentModel.createCalls).toHaveLength(1);
    expect(await service.listSkills({ agentId: 'agent-1' })).toEqual([]);
  });

  it('replaces the skill index and saves history with the backing document id', async () => {
    const { agentDocumentModel, documentService, service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Researches APIs',
      name: 'researcher',
      title: 'Researcher',
    });

    const detail = await service.replaceSkillIndex({
      agentId: 'agent-1',
      bodyMarkdown: skillBody('# Better'),
      description: 'Researches docs better',
      name: 'researcher',
    });

    expect(documentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
      created.index.documentId,
      'llm_call',
    );
    expect(detail?.preMutationHistoryId).toBe('history-exact-1');
    expect(detail?.expectedCurrentDocumentUpdatedAt).toBe(backingDocumentUpdatedAt.toISOString());
    expect(detail?.expectedCurrentDocumentUpdatedAt).not.toBe(now.toISOString());
    expect(detail?.content).toBe(skillContent('researcher', 'Researches docs better', '# Better'));
    expect(detail?.frontmatter).toEqual({
      description: 'Researches docs better',
      name: 'researcher',
    });
    expect(agentDocumentModel.updateCalls.at(-1)).toEqual(
      expect.objectContaining({
        agentDocumentId: created.index.agentDocumentId,
        params: expect.objectContaining({
          editorData: expectedEditorData(
            skillContent('researcher', 'Researches docs better', '# Better'),
          ),
          metadata: {
            skill: { frontmatter: { description: 'Researches docs better', name: 'researcher' } },
          },
          policyLoad: PolicyLoad.DISABLED,
        }),
      }),
    );
    expect(agentDocumentModel.identityUpdateCalls.at(-1)).toEqual(
      expect.objectContaining({
        agentDocumentId: created.bundle.agentDocumentId,
        params: {
          metadata: {
            skill: { frontmatter: { description: 'Researches docs better', name: 'researcher' } },
          },
        },
      }),
    );
  });

  it('strips pasted frontmatter when replacing the skill index', async () => {
    const { service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Researches APIs',
      name: 'researcher',
      title: 'Researcher',
    });

    const detail = await service.replaceSkillIndex({
      agentId: 'agent-1',
      bodyMarkdown: '---\nname: other\ndescription: Stale\n---\n\n# Better\n\nBody.',
      name: 'researcher',
    });

    expect(detail?.content).toBe(
      skillContent('researcher', 'Researches APIs', '# Better\n\nBody.'),
    );
    expect(detail?.frontmatter).toEqual({ description: 'Researches APIs', name: 'researcher' });
    expect(created.index.agentDocumentId).toBe(detail?.index.agentDocumentId);
  });

  it('resolves a target skill from either the bundle or index agent document id', async () => {
    const { service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Portable lookup',
      name: 'portable-skill',
      title: 'Portable Skill',
    });

    await expect(
      service.getSkill({
        agentDocumentId: created.index.agentDocumentId,
        agentId: 'agent-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        bundle: created.bundle,
        index: created.index,
        name: 'portable-skill',
      }),
    );
  });

  it('falls back to the name selector when a mistyped agent document id is also given (T-507)', async () => {
    const { service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Name fallback lookup',
      name: 'dual-gate-review',
      title: 'Dual Gate Review',
    });

    // Reproduces the SATO incident: the model passes both selectors but copies
    // one id character wrong; the stable name selector must still resolve.
    await expect(
      service.getSkill({
        agentDocumentId: '30b88ca8-5c56-4e09-96b9-4610e39c0add',
        agentId: 'agent-1',
        includeContent: true,
        name: 'dual-gate-review',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        bundle: created.bundle,
        index: created.index,
        name: 'dual-gate-review',
      }),
    );
  });

  it('stays not-found when the mistyped id has no name selector to fall back on', async () => {
    const { service } = createService();
    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Id only lookup',
      name: 'id-only-skill',
      title: 'Id Only Skill',
    });

    await expect(
      service.getSkill({
        agentDocumentId: '30b88ca8-5c56-4e09-96b9-4610e39c0add',
        agentId: 'agent-1',
        name: undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it('renames bundle identity and synchronizes index frontmatter content', async () => {
    const { agentDocumentModel, documentService, service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Old description',
      name: 'old-skill',
      title: 'Old Skill',
    });

    const detail = await service.renameSkill({
      agentDocumentId: created.bundle.agentDocumentId,
      agentId: 'agent-1',
      newName: 'new-skill',
      newTitle: 'New Skill',
    });

    expect(detail).toEqual(
      expect.objectContaining({
        content: skillContent('new-skill', 'Old description'),
        frontmatter: { description: 'Old description', name: 'new-skill' },
        name: 'new-skill',
        title: 'New Skill',
      }),
    );
    expect(agentDocumentModel.identityUpdateCalls).toEqual([
      expect.objectContaining({
        agentDocumentId: created.bundle.agentDocumentId,
        params: expect.objectContaining({
          filename: 'new-skill',
          title: 'New Skill',
        }),
      }),
      expect.objectContaining({
        agentDocumentId: created.index.agentDocumentId,
        params: expect.objectContaining({
          filename: SKILL_INDEX_FILENAME,
          title: SKILL_INDEX_FILENAME,
        }),
      }),
    ]);
    expect(documentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
      created.index.documentId,
      'llm_call',
    );
    expect(agentDocumentModel.updateCalls.at(-1)).toEqual(
      expect.objectContaining({
        agentDocumentId: created.index.agentDocumentId,
        params: expect.objectContaining({
          editorData: expectedEditorData(skillContent('new-skill', 'Old description')),
        }),
      }),
    );
  });

  it('throws loudly when a bundle has no matching index document', async () => {
    const { agentDocumentModel, service } = createService();
    await agentDocumentModel.create('agent-1', 'broken-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Broken Skill',
    });

    await expect(service.listSkills({ agentId: 'agent-1' })).rejects.toThrow(
      'expected one SKILL.md index, found 0',
    );
  });

  it('throws loudly when a bundle has multiple matching index documents', async () => {
    const { agentDocumentModel, service } = createService();
    const bundle = await agentDocumentModel.create('agent-1', 'broken-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Broken Skill',
    });

    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('broken-skill', 'One'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: bundle.documentId,
      },
    );
    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('broken-skill', 'Two'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: bundle.documentId,
      },
    );

    await expect(service.getSkill({ agentId: 'agent-1', name: 'broken-skill' })).rejects.toThrow(
      'expected one SKILL.md index, found 2',
    );
  });

  it('throws loudly when duplicate root bundles share the same skill name', async () => {
    const { agentDocumentModel, service } = createService();
    const firstBundle = await agentDocumentModel.create('agent-1', 'duplicate-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Duplicate Skill',
    });
    const secondBundle = await agentDocumentModel.create('agent-1', 'duplicate-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Duplicate Skill Copy',
    });

    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('duplicate-skill', 'One'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: firstBundle.documentId,
      },
    );
    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('duplicate-skill', 'Two'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: secondBundle.documentId,
      },
    );

    await expect(service.listSkills({ agentId: 'agent-1' })).rejects.toThrow(
      'duplicate bundle names duplicate-skill',
    );
  });
});
