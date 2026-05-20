// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import {
  cleanupTestUser,
  createTestAgent,
  createTestUser,
} from '../../../../../../routers/lambda/__tests__/integration/setup';
import { runSkillManagementAction } from '../skillManagement';

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn().mockImplementation(() => ({
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockRejectedValue(new Error('Resource not found')),
    storeResources: vi.fn().mockResolvedValue({}),
  })),
}));

describe('runSkillManagementAction integration', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let agentId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    userId = await createTestUser(serverDB);
    agentId = await createTestAgent(serverDB, userId);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  const createManagedSkill = async (skillName: string, bodyMarkdown: string) => {
    return new SkillManagementDocumentService(serverDB, userId).createSkill({
      agentId,
      bodyMarkdown,
      description: `${skillName} description`,
      name: skillName,
      title: skillName,
    });
  };

  const readSkillIndex = async (skillName: string) => {
    return (
      await new AgentDocumentVfsService(serverDB, userId).read(
        `./lobe/skills/agent/skills/${skillName}/SKILL.md`,
        { agentId },
      )
    ).content;
  };

  /**
   * @example
   * Refine reads and writes the selected managed skill through the document-backed service.
   */
  it('refines a real managed skill through document-backed replacement', async () => {
    const skill = await createManagedSkill('review-skill', '# Review Skill');

    const result = await runSkillManagementAction(
      {
        agentId,
        message: 'Refine the review skill.',
      },
      {
        db: serverDB,
        selfIterationEnabled: true,
        skillMaintainerRunner: async ({ targetSkills }) => {
          expect(targetSkills).toEqual([
            expect.objectContaining({
              content:
                '---\ndescription: review-skill description\nname: review-skill\n---\n# Review Skill',
              id: skill.bundle.agentDocumentId,
              name: 'review-skill',
            }),
          ]);

          return {
            bodyMarkdown: '# Review Skill\n\n## Procedure\n- Check failed assertions first.',
            reason: 'refined review skill',
          };
        },
        userId,
      },
      {
        action: 'refine',
        reason: 'update existing review skill',
        targetSkillRefs: [skill.bundle.agentDocumentId],
      },
    );

    expect(result).toMatchObject({
      detail: 'refined review skill',
      status: 'applied',
    });
    expect(await readSkillIndex('review-skill')).toBe(
      '---\ndescription: review-skill description\nname: review-skill\n---\n# Review Skill\n\n## Procedure\n- Check failed assertions first.',
    );
  });

  /**
   * @example
   * Consolidate updates an allowed target skill and leaves other skills untouched.
   */
  it('consolidates real managed skills without deleting source skills automatically', async () => {
    const reviewSkill = await createManagedSkill('review-skill', '# Review Skill');
    const checklistSkill = await createManagedSkill('review-checklist', '# Review Checklist');

    const result = await runSkillManagementAction(
      {
        agentId,
        message: 'Consolidate overlapping review skills.',
      },
      {
        db: serverDB,
        selfIterationEnabled: true,
        skillMaintainerRunner: async ({ targetSkills }) => {
          expect(targetSkills).toEqual([
            expect.objectContaining({
              content:
                '---\ndescription: review-skill description\nname: review-skill\n---\n# Review Skill',
              id: reviewSkill.bundle.agentDocumentId,
              name: 'review-skill',
            }),
            expect.objectContaining({
              content:
                '---\ndescription: review-checklist description\nname: review-checklist\n---\n# Review Checklist',
              id: checklistSkill.bundle.agentDocumentId,
              name: 'review-checklist',
            }),
          ]);

          return {
            bodyMarkdown: '# Review Skill\n\n## Procedure\n- Use one consolidated checklist.',
            reason: 'consolidated review skills',
          };
        },
        userId,
      },
      {
        action: 'consolidate',
        reason: 'overlapping review skills',
        targetSkillRefs: [
          reviewSkill.bundle.agentDocumentId,
          checklistSkill.bundle.agentDocumentId,
        ],
      },
    );

    expect(result).toMatchObject({
      detail: 'consolidated review skills',
      status: 'applied',
    });
    expect(await readSkillIndex('review-skill')).toBe(
      '---\ndescription: review-skill description\nname: review-skill\n---\n# Review Skill\n\n## Procedure\n- Use one consolidated checklist.',
    );
    expect(await readSkillIndex('review-checklist')).toBe(
      '---\ndescription: review-checklist description\nname: review-checklist\n---\n# Review Checklist',
    );
  });
});
