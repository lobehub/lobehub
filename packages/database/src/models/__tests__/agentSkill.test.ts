// @vitest-environment node
import type { AgentPluginEntry, SkillManifest } from '@lobechat/types';
import { getPluginMode } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, agentSkills, agentsToSessions, sessions, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';
import { AgentSkillModel } from '../agentSkill';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-skill-model-test-user-id';
const agentSkillModel = new AgentSkillModel(serverDB, userId);

// Helper to create valid manifest for tests
const createManifest = (overrides?: Partial<SkillManifest>): SkillManifest => ({
  description: 'Test skill description',
  name: 'Test Skill',
  ...overrides,
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AgentSkillModel', () => {
  describe('create', () => {
    it('should create a new agent skill', async () => {
      const params = {
        name: 'Test Skill',
        description: 'A test skill',
        identifier: 'test.skill',
        source: 'user' as const,
        manifest: createManifest({ version: '1.0.0' }),
        content: '# Test Skill Content',
      };

      const skill = await agentSkillModel.create(params);

      expect(skill).toMatchObject(params);
      expect(skill.id).toBeDefined();
    });

    it('defaults a new skill to auto for inbox and disabled for every other agent', async () => {
      await serverDB.insert(agents).values([
        {
          id: 'skill-default-inbox',
          plugins: ['existing-inbox-plugin'],
          slug: 'inbox',
          userId,
          virtual: true,
        },
        {
          id: 'skill-default-agent',
          plugins: ['existing-agent-plugin'],
          slug: 'custom-agent',
          userId,
        },
        {
          id: 'skill-default-virtual-agent',
          slug: 'virtual-agent',
          userId,
          virtual: true,
        },
        {
          id: 'skill-default-explicit-agent',
          plugins: [{ identifier: 'new-custom-skill', mode: 'pinned' }] as unknown as string[],
          slug: 'explicit-agent',
          userId,
        },
      ]);

      await agentSkillModel.create({
        content: '# New custom skill',
        description: 'A newly added custom skill',
        identifier: 'new-custom-skill',
        manifest: createManifest(),
        name: 'New Custom Skill',
        source: 'user',
      });

      const configuredAgents = await serverDB.query.agents.findMany({
        where: eq(agents.userId, userId),
      });
      const pluginsByAgentId = new Map(
        configuredAgents.map((agent) => [agent.id, agent.plugins as AgentPluginEntry[] | null]),
      );

      expect(
        getPluginMode(pluginsByAgentId.get('skill-default-inbox') ?? undefined, 'new-custom-skill'),
      ).toBe('auto');
      expect(
        getPluginMode(pluginsByAgentId.get('skill-default-agent') ?? undefined, 'new-custom-skill'),
      ).toBe('disabled');
      expect(
        getPluginMode(
          pluginsByAgentId.get('skill-default-virtual-agent') ?? undefined,
          'new-custom-skill',
        ),
      ).toBe('disabled');
      expect(
        getPluginMode(
          pluginsByAgentId.get('skill-default-explicit-agent') ?? undefined,
          'new-custom-skill',
        ),
      ).toBe('pinned');
      expect(pluginsByAgentId.get('skill-default-inbox')).toEqual(['existing-inbox-plugin']);
      expect(pluginsByAgentId.get('skill-default-agent')).toContain('existing-agent-plugin');
    });

    it('keeps a legacy session-linked inbox on the implicit auto default', async () => {
      await serverDB.insert(agents).values({
        id: 'legacy-inbox-agent',
        plugins: ['existing-inbox-plugin'],
        slug: null,
        userId,
      });
      await serverDB.insert(sessions).values({ id: 'legacy-inbox-session', slug: 'inbox', userId });
      await serverDB.insert(agentsToSessions).values({
        agentId: 'legacy-inbox-agent',
        sessionId: 'legacy-inbox-session',
        userId,
      });

      await agentSkillModel.create({
        description: 'A newly added custom skill',
        identifier: 'legacy-inbox-custom-skill',
        manifest: createManifest(),
        name: 'Legacy Inbox Custom Skill',
        source: 'user',
      });

      const inbox = await serverDB.query.agents.findFirst({
        where: eq(agents.id, 'legacy-inbox-agent'),
      });
      expect(inbox?.plugins).toEqual(['existing-inbox-plugin']);
      expect(
        getPluginMode(
          inbox?.plugins as AgentPluginEntry[] | undefined,
          'legacy-inbox-custom-skill',
        ),
      ).toBe('auto');
    });

    it('initializes a large agent set without dropping any agent', async () => {
      const agentCount = 100;
      await serverDB.insert(agents).values(
        Array.from({ length: agentCount }, (_, index) => ({
          id: `large-agent-set-${index}`,
          slug: `large-agent-${index}`,
          userId,
        })),
      );

      await agentSkillModel.create({
        description: 'A skill shared with many agents',
        identifier: 'large-agent-set-skill',
        manifest: createManifest(),
        name: 'Large Agent Set Skill',
        source: 'user',
      });

      const configuredAgents = await serverDB.query.agents.findMany({
        where: eq(agents.userId, userId),
      });
      expect(configuredAgents).toHaveLength(agentCount);
      expect(
        configuredAgents.every(
          ({ plugins }) =>
            getPluginMode(plugins as AgentPluginEntry[] | undefined, 'large-agent-set-skill') ===
            'disabled',
        ),
      ).toBe(true);
    });

    it('initializes every non-inbox agent in a shared workspace', async () => {
      const workspaceMemberId = 'agent-skill-workspace-member';
      await serverDB.insert(users).values({ id: workspaceMemberId });
      const [workspace] = await serverDB
        .insert(workspaces)
        .values({
          name: 'Agent Skill Workspace',
          primaryOwnerId: userId,
          slug: 'agent-skill-workspace',
        })
        .returning();
      await serverDB.insert(agents).values([
        {
          id: 'workspace-owner-agent',
          userId,
          visibility: 'private',
          workspaceId: workspace.id,
        },
        {
          id: 'workspace-member-agent',
          userId: workspaceMemberId,
          visibility: 'private',
          workspaceId: workspace.id,
        },
      ]);

      const workspaceSkillModel = new AgentSkillModel(serverDB, userId, workspace.id);
      await workspaceSkillModel.create({
        description: 'A workspace custom skill',
        identifier: 'workspace-shared-skill',
        manifest: createManifest(),
        name: 'Workspace Shared Skill',
        source: 'user',
      });

      const workspaceAgents = await serverDB.query.agents.findMany({
        where: eq(agents.workspaceId, workspace.id),
      });
      expect(workspaceAgents).toHaveLength(2);
      expect(
        workspaceAgents.every(
          ({ plugins }) =>
            getPluginMode(plugins as AgentPluginEntry[] | undefined, 'workspace-shared-skill') ===
            'disabled',
        ),
      ).toBe(true);
    });

    it('preserves both entries when two skills are created concurrently', async () => {
      await serverDB.insert(agents).values({ id: 'concurrent-skill-agent', userId });

      await Promise.all([
        agentSkillModel.create({
          description: 'Concurrent skill A',
          identifier: 'concurrent-skill-a',
          manifest: createManifest(),
          name: 'Concurrent Skill A',
          source: 'user',
        }),
        agentSkillModel.create({
          description: 'Concurrent skill B',
          identifier: 'concurrent-skill-b',
          manifest: createManifest(),
          name: 'Concurrent Skill B',
          source: 'user',
        }),
      ]);

      const agent = await serverDB.query.agents.findFirst({
        where: eq(agents.id, 'concurrent-skill-agent'),
      });
      const plugins = agent?.plugins as AgentPluginEntry[] | undefined;

      expect(getPluginMode(plugins, 'concurrent-skill-a')).toBe('disabled');
      expect(getPluginMode(plugins, 'concurrent-skill-b')).toBe('disabled');
    });

    it('defaults to disabled when a skill and regular agent are created concurrently', async () => {
      const concurrentAgentModel = new AgentModel(serverDB, userId);

      const [, agent] = await Promise.all([
        agentSkillModel.create({
          description: 'Skill created alongside an agent',
          identifier: 'skill-created-with-agent',
          manifest: createManifest(),
          name: 'Skill Created With Agent',
          source: 'user',
        }),
        concurrentAgentModel.create({ title: 'Agent Created With Skill' }),
      ]);

      expect(
        getPluginMode(agent.plugins as AgentPluginEntry[] | undefined, 'skill-created-with-agent'),
      ).toBe('disabled');
    });
  });

  describe('delete', () => {
    it('removes agent policies before the identifier is reused by another skill', async () => {
      const identifier = 'reused-deleted-skill';
      const originalUpdatedAt = new Date('2024-01-02T03:04:05.000Z');
      await serverDB.insert(agents).values({
        id: 'deleted-skill-policy-agent',
        plugins: [{ identifier, mode: 'auto' }, 'kept-plugin'] as unknown as string[],
        updatedAt: originalUpdatedAt,
        userId,
      });
      const { id } = await serverDB
        .insert(agentSkills)
        .values({
          description: 'Skill whose identifier will be reused',
          identifier,
          manifest: createManifest(),
          name: 'To Delete',
          source: 'user',
          userId,
        })
        .returning()
        .then((res) => res[0]);

      const result = await agentSkillModel.delete(id);

      const skill = await serverDB.query.agentSkills.findFirst({
        where: eq(agentSkills.id, id),
      });
      const agentAfterDelete = await serverDB.query.agents.findFirst({
        where: eq(agents.id, 'deleted-skill-policy-agent'),
      });
      expect(result).toEqual({ success: true });
      expect(skill).toBeUndefined();
      expect(agentAfterDelete?.plugins).toEqual(['kept-plugin']);
      expect(agentAfterDelete?.updatedAt).toEqual(originalUpdatedAt);

      await agentSkillModel.create({
        description: 'Replacement skill with the reused identifier',
        identifier,
        manifest: createManifest(),
        name: 'Replacement Skill',
        source: 'user',
      });

      const agentAfterReuse = await serverDB.query.agents.findFirst({
        where: eq(agents.id, 'deleted-skill-policy-agent'),
      });
      expect(
        getPluginMode(agentAfterReuse?.plugins as AgentPluginEntry[] | undefined, identifier),
      ).toBe('disabled');
    });
  });

  describe('findById', () => {
    it('should find an agent skill by id', async () => {
      const { id } = await serverDB
        .insert(agentSkills)
        .values({
          name: 'Find Me',
          description: 'Find me skill',
          identifier: 'find.me',
          source: 'user',
          manifest: createManifest(),
          userId,
        })
        .returning()
        .then((res) => res[0]);

      const skill = await agentSkillModel.findById(id);
      expect(skill).toBeDefined();
      expect(skill?.id).toBe(id);
    });

    it('should return undefined for non-existent id', async () => {
      const skill = await agentSkillModel.findById('non-existent-id');
      expect(skill).toBeUndefined();
    });
  });

  describe('findByIdentifier', () => {
    it('should find an agent skill by identifier', async () => {
      await serverDB.insert(agentSkills).values({
        name: 'By Identifier',
        description: 'By identifier skill',
        identifier: 'by.identifier',
        source: 'user',
        manifest: createManifest(),
        userId,
      });

      const skill = await agentSkillModel.findByIdentifier('by.identifier');
      expect(skill).toBeDefined();
      expect(skill?.identifier).toBe('by.identifier');
    });
  });

  describe('findAll', () => {
    it('should find all agent skills for user', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'Skill 1',
          description: 'Skill 1 description',
          identifier: 'skill.1',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Skill 2',
          description: 'Skill 2 description',
          identifier: 'skill.2',
          source: 'market',
          manifest: createManifest(),
          userId,
        },
      ]);

      const skills = await agentSkillModel.findAll();
      expect(skills.data).toHaveLength(2);
      expect(skills.total).toBe(2);
    });
  });

  describe('findByIds', () => {
    it('should find agent skills by ids', async () => {
      const inserted = await serverDB
        .insert(agentSkills)
        .values([
          {
            name: 'Skill A',
            description: 'Skill A description',
            identifier: 'skill.a',
            source: 'user',
            manifest: createManifest(),
            userId,
          },
          {
            name: 'Skill B',
            description: 'Skill B description',
            identifier: 'skill.b',
            source: 'user',
            manifest: createManifest(),
            userId,
          },
          {
            name: 'Skill C',
            description: 'Skill C description',
            identifier: 'skill.c',
            source: 'user',
            manifest: createManifest(),
            userId,
          },
        ])
        .returning();

      const ids = [inserted[0].id, inserted[2].id];
      const skills = await agentSkillModel.findByIds(ids);

      expect(skills).toHaveLength(2);
    });

    it('should return empty array for empty ids', async () => {
      const skills = await agentSkillModel.findByIds([]);
      expect(skills).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update an agent skill', async () => {
      const { id } = await serverDB
        .insert(agentSkills)
        .values({
          name: 'Original Name',
          description: 'Original description',
          identifier: 'original',
          source: 'user',
          manifest: createManifest(),
          userId,
        })
        .returning()
        .then((res) => res[0]);

      await agentSkillModel.update(id, { name: 'Updated Name' });

      const updated = await serverDB.query.agentSkills.findFirst({
        where: eq(agentSkills.id, id),
      });
      expect(updated?.name).toBe('Updated Name');
    });
  });

  describe('listBySource', () => {
    it('should list agent skills by source', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'User Skill',
          description: 'User skill description',
          identifier: 'user.skill',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Market Skill',
          description: 'Market skill description',
          identifier: 'market.skill',
          source: 'market',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Builtin Skill',
          description: 'Builtin skill description',
          identifier: 'builtin.skill',
          source: 'builtin',
          manifest: createManifest(),
          userId,
        },
      ]);

      const userSkills = await agentSkillModel.listBySource('user');
      expect(userSkills.data).toHaveLength(1);
      expect(userSkills.data[0].source).toBe('user');

      const marketSkills = await agentSkillModel.listBySource('market');
      expect(marketSkills.data).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('should search agent skills by name', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'Coding Wizard',
          description: 'Coding wizard skill',
          identifier: 'coding',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Writing Helper',
          description: 'Writing helper skill',
          identifier: 'writing',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
      ]);

      const results = await agentSkillModel.search('Coding');
      expect(results.data).toHaveLength(1);
      expect(results.data[0].name).toBe('Coding Wizard');
    });

    it('should search agent skills by description', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'Skill A',
          description: 'Helps with coding tasks',
          identifier: 'a',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
        {
          name: 'Skill B',
          description: 'Helps with writing',
          identifier: 'b',
          source: 'user',
          manifest: createManifest(),
          userId,
        },
      ]);

      const results = await agentSkillModel.search('coding');
      expect(results.data).toHaveLength(1);
      expect(results.total).toBe(1);
    });
  });

  describe('findByName', () => {
    it('should find a skill by name', async () => {
      await serverDB.insert(agentSkills).values({
        name: 'Unique Skill Name',
        description: 'A unique skill',
        identifier: 'unique-skill',
        source: 'user',
        manifest: createManifest(),
        userId,
      });

      const result = await agentSkillModel.findByName('Unique Skill Name');
      expect(result).toBeDefined();
      expect(result?.name).toBe('Unique Skill Name');
    });

    it('should return undefined for non-existent name', async () => {
      const result = await agentSkillModel.findByName('Non Existent');
      expect(result).toBeUndefined();
    });

    it('should not find skills from other users', async () => {
      const otherUserId = 'other-skill-user';
      await serverDB.insert(users).values({ id: otherUserId });
      await serverDB.insert(agentSkills).values({
        name: 'Other Skill',
        description: 'Other skill desc',
        identifier: 'other-skill',
        source: 'user',
        manifest: createManifest(),
        userId: otherUserId,
      });

      const result = await agentSkillModel.findByName('Other Skill');
      expect(result).toBeUndefined();
    });

    it('matches case-insensitively so model casing drift still resolves', async () => {
      await serverDB.insert(agentSkills).values({
        name: 'agent-browser',
        description: 'browser CLI',
        identifier: 'lobe-agent-browser',
        source: 'user',
        manifest: createManifest(),
        userId,
      });

      for (const query of ['agent-browser', 'Agent-Browser', 'AGENT-BROWSER']) {
        const result = await agentSkillModel.findByName(query);
        expect(result?.name).toBe('agent-browser');
      }
    });
  });
});
