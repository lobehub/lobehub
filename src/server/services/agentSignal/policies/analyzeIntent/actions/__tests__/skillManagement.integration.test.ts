// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { createMarkdownEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import { createSkillTree } from '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';

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

  const createManagedSkill = async (skillName: string, content: string) => {
    const snapshot = await createMarkdownEditorSnapshot(content);

    await createSkillTree({
      agentDocumentModel: new AgentDocumentModel(serverDB, userId),
      agentId,
      content: snapshot.content,
      editorData: snapshot.editorData,
      namespace: 'agent',
      skillName,
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
   * Refine reads and writes the selected managed skill through the real resolver and VFS adapter.
   */
  it('refines a real managed skill through resolver and VFS-backed maintainer operations', async () => {
    await createManagedSkill('review-skill', '# Review Skill');

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
            {
              content: '# Review Skill\n',
              id: 'review-skill',
              metadata: {},
            },
          ]);

          return {
            operations: [
              {
                arguments: {
                  content: '# Review Skill\n\n## Procedure\n- Check failed assertions first.',
                  path: 'SKILL.md',
                  skillRef: 'review-skill',
                },
                name: 'updateSkill',
              },
            ],
            reason: 'refined review skill',
          };
        },
        userId,
      },
      {
        action: 'refine',
        reason: 'update existing review skill',
        targetSkillIds: ['review-skill'],
      },
    );

    expect(result).toMatchObject({
      detail: 'refined review skill',
      status: 'applied',
    });
    expect(await readSkillIndex('review-skill')).toBe(
      '# Review Skill\n\n## Procedure\n\n- Check failed assertions first.\n',
    );
  });

  /**
   * @example
   * Consolidate updates an allowed target skill and does not apply lifecycle proposals.
   */
  it('consolidates real managed skills without applying lifecycle proposals automatically', async () => {
    await createManagedSkill('review-skill', '# Review Skill');
    await createManagedSkill('review-checklist', '# Review Checklist');

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
            {
              content: '# Review Skill\n',
              id: 'review-skill',
              metadata: {},
            },
            {
              content: '# Review Checklist\n',
              id: 'review-checklist',
              metadata: {},
            },
          ]);

          return {
            operations: [
              {
                arguments: {
                  content: '# Review Skill\n\n## Procedure\n- Use one consolidated checklist.',
                  path: 'SKILL.md',
                  skillRef: 'review-skill',
                },
                name: 'updateSkill',
              },
            ],
            proposedLifecycleActions: [
              {
                action: 'archive',
                reason: 'merged into review-skill',
                skillRef: 'review-checklist',
              },
            ],
            reason: 'consolidated review skills',
          };
        },
        userId,
      },
      {
        action: 'consolidate',
        reason: 'overlapping review skills',
        targetSkillIds: ['review-skill', 'review-checklist'],
      },
    );

    expect(result).toMatchObject({
      detail: 'consolidated review skills',
      status: 'applied',
    });
    expect(await readSkillIndex('review-skill')).toBe(
      '# Review Skill\n\n## Procedure\n\n- Use one consolidated checklist.\n',
    );
    expect(await readSkillIndex('review-checklist')).toBe('# Review Checklist\n');
  });
});
