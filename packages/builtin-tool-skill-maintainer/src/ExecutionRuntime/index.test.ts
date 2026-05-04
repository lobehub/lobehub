// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { SkillMaintainerRuntimeService } from '.';
import { SkillMaintainerExecutionRuntime } from '.';

const createSkill = (name = 'release-writer') => ({
  bundle: {
    agentDocumentId: `bundle-${name}`,
    documentId: `document-bundle-${name}`,
    filename: name,
    title: 'Release Writer',
  },
  description: 'Writes release notes',
  frontmatter: { description: 'Writes release notes', name },
  index: {
    agentDocumentId: `index-${name}`,
    documentId: `document-index-${name}`,
    filename: 'SKILL.md',
    title: 'SKILL.md',
  },
  name,
  title: 'Release Writer',
});

const createRuntime = () => {
  const service: SkillMaintainerRuntimeService = {
    createSkill: vi.fn(async () => createSkill()),
    getSkill: vi.fn(async () => ({ ...createSkill(), content: '# Skill' })),
    listSkills: vi.fn(async () => [createSkill()]),
    renameSkill: vi.fn(async () => createSkill('renamed-skill')),
    replaceSkillIndex: vi.fn(async () => createSkill()),
  };

  return { runtime: new SkillMaintainerExecutionRuntime(service), service };
};

describe('SkillMaintainerExecutionRuntime', () => {
  /**
   * @example
   * Hidden worker calls fail closed without agent context.
   */
  it('requires agentId context for skill-management operations', async () => {
    const { runtime, service } = createRuntime();

    await expect(runtime.listSkills({})).resolves.toEqual({
      content: 'Cannot list managed skills without agentId context.',
      success: false,
    });
    expect(service.listSkills).not.toHaveBeenCalled();
  });

  /**
   * @example
   * Listing returns machine-readable state with stable document ids.
   */
  it('lists managed skills with state', async () => {
    const { runtime, service } = createRuntime();

    const result = await runtime.listSkills({}, { agentId: 'agent-1' });

    expect(service.listSkills).toHaveBeenCalledWith({ agentId: 'agent-1' });
    expect(result).toEqual(
      expect.objectContaining({
        state: { skills: [createSkill()] },
        success: true,
      }),
    );
  });

  /**
   * @example
   * Create forwards source agent document ids, not backing document ids.
   */
  it('creates a managed skill and preserves sourceAgentDocumentId input', async () => {
    const { runtime, service } = createRuntime();

    const result = await runtime.createSkill(
      {
        bodyMarkdown: '# Skill',
        description: 'Writes release notes',
        name: 'release-writer',
        sourceAgentDocumentId: 'agent-doc-source',
        title: 'Release Writer',
      },
      { agentId: 'agent-1' },
    );

    expect(service.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        sourceAgentDocumentId: 'agent-doc-source',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        state: { skill: createSkill() },
        success: true,
      }),
    );
  });

  /**
   * @example
   * Missing targets return a failed tool result instead of throwing.
   */
  it('returns a failed result when a target skill is not found', async () => {
    const { runtime, service } = createRuntime();
    vi.mocked(service.getSkill).mockResolvedValueOnce(undefined);

    await expect(runtime.getSkill({ name: 'missing' }, { agentId: 'agent-1' })).resolves.toEqual({
      content: 'Managed skill not found.',
      success: false,
    });
  });
});
