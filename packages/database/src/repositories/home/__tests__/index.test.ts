import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import * as Schema from '../../../schemas';
import { HomeRepository } from '../index';

const clientDB = await getTestDB();

const userId = 'test-user-id';
const otherUserId = 'other-user-id';
let homeRepo: HomeRepository;

beforeEach(async () => {
  await clientDB.delete(Schema.users);

  // Create test users
  await clientDB.transaction(async (tx) => {
    await tx.insert(Schema.users).values([{ id: userId }, { id: otherUserId }]);
  });

  homeRepo = new HomeRepository(clientDB, userId);
});

afterEach(async () => {
  await clientDB.delete(Schema.users);
});

describe('HomeRepository', () => {
  describe('getSidebarAgentList', () => {
    it('should return empty lists when no agents exist', async () => {
      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toEqual([]);
      expect(result.ungrouped).toEqual([]);
      expect(result.groups).toEqual([]);
    });

    it('should return non-virtual agents without agentsToSessions relationship', async () => {
      // Create an agent without session relationship (e.g., duplicated agent)
      const agentId = 'standalone-agent';

      await clientDB.insert(Schema.agents).values({
        id: agentId,
        userId,
        title: 'Standalone Agent',
        description: 'Agent without session',
        pinned: false,
        virtual: false,
      });

      const result = await homeRepo.getSidebarAgentList();

      // Agent should appear in ungrouped list even without agentsToSessions
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].id).toBe(agentId);
      expect(result.ungrouped[0].title).toBe('Standalone Agent');
    });

    it('should return pinned non-virtual agents without agentsToSessions relationship', async () => {
      // Create a pinned agent without session relationship
      const agentId = 'pinned-standalone';

      await clientDB.insert(Schema.agents).values({
        id: agentId,
        userId,
        title: 'Pinned Standalone Agent',
        pinned: true,
        virtual: false,
      });

      const result = await homeRepo.getSidebarAgentList();

      // Agent should appear in pinned list
      expect(result.pinned).toHaveLength(1);
      expect(result.pinned[0].id).toBe(agentId);
      expect(result.pinned[0].pinned).toBe(true);
    });

    it('should return mixed agents with and without session relationships', async () => {
      // Agent with session
      await clientDB.transaction(async (tx) => {
        await tx.insert(Schema.agents).values({
          id: 'with-session',
          userId,
          title: 'Agent With Session',
          pinned: false,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: 'session-1',
          slug: 'session-1',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'with-session',
          sessionId: 'session-1',
          userId,
        });
      });

      // Agent without session (e.g., duplicated)
      await clientDB.insert(Schema.agents).values({
        id: 'without-session',
        userId,
        title: 'Agent Without Session',
        pinned: false,
        virtual: false,
      });

      const result = await homeRepo.getSidebarAgentList();

      // Both agents should appear
      expect(result.ungrouped).toHaveLength(2);
      expect(result.ungrouped.map((a) => a.id)).toContain('with-session');
      expect(result.ungrouped.map((a) => a.id)).toContain('without-session');
    });

    it('should return agents with pinned status from agents table', async () => {
      // Create an agent with pinned=true
      const agentId = 'agent-1';
      const sessionId = 'session-1';

      await clientDB.transaction(async (tx) => {
        await tx.insert(Schema.agents).values({
          id: agentId,
          userId,
          title: 'Pinned Agent',
          pinned: true,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: sessionId,
          slug: 'session-1',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId,
          sessionId,
          userId,
        });
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toHaveLength(1);
      expect(result.pinned[0].id).toBe(agentId);
      expect(result.pinned[0].pinned).toBe(true);
      expect(result.pinned[0].title).toBe('Pinned Agent');
      expect(result.ungrouped).toHaveLength(0);
    });

    it('should return unpinned agents in ungrouped list', async () => {
      // Create an agent with pinned=false
      const agentId = 'agent-2';
      const sessionId = 'session-2';

      await clientDB.transaction(async (tx) => {
        await tx.insert(Schema.agents).values({
          id: agentId,
          userId,
          title: 'Unpinned Agent',
          pinned: false,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: sessionId,
          slug: 'session-2',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId,
          sessionId,
          userId,
        });
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].id).toBe(agentId);
      expect(result.ungrouped[0].pinned).toBe(false);
      expect(result.pinned).toHaveLength(0);
    });

    it('should not include virtual agents', async () => {
      const agentId = 'virtual-agent';
      const sessionId = 'virtual-session';

      await clientDB.transaction(async (tx) => {
        await tx.insert(Schema.agents).values({
          id: agentId,
          userId,
          title: 'Virtual Agent',
          pinned: false,
          virtual: true, // virtual agent
        });
        await tx.insert(Schema.sessions).values({
          id: sessionId,
          slug: 'virtual-session',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId,
          sessionId,
          userId,
        });
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(0);
    });

    it('should correctly categorize multiple agents by pinned status', async () => {
      // Create multiple agents with different pinned status
      await clientDB.transaction(async (tx) => {
        // Pinned agent 1
        await tx.insert(Schema.agents).values({
          id: 'pinned-1',
          userId,
          title: 'Pinned 1',
          pinned: true,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: 'session-pinned-1',
          slug: 'session-pinned-1',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'pinned-1',
          sessionId: 'session-pinned-1',
          userId,
        });

        // Pinned agent 2
        await tx.insert(Schema.agents).values({
          id: 'pinned-2',
          userId,
          title: 'Pinned 2',
          pinned: true,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: 'session-pinned-2',
          slug: 'session-pinned-2',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'pinned-2',
          sessionId: 'session-pinned-2',
          userId,
        });

        // Unpinned agent
        await tx.insert(Schema.agents).values({
          id: 'unpinned-1',
          userId,
          title: 'Unpinned 1',
          pinned: false,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: 'session-unpinned-1',
          slug: 'session-unpinned-1',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'unpinned-1',
          sessionId: 'session-unpinned-1',
          userId,
        });
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toHaveLength(2);
      expect(result.ungrouped).toHaveLength(1);
      expect(result.pinned.map((a) => a.id)).toContain('pinned-1');
      expect(result.pinned.map((a) => a.id)).toContain('pinned-2');
      expect(result.ungrouped[0].id).toBe('unpinned-1');
    });

    it('should not return agents from other users', async () => {
      // Create agent for other user
      await clientDB.transaction(async (tx) => {
        await tx.insert(Schema.agents).values({
          id: 'other-agent',
          userId: otherUserId,
          title: 'Other User Agent',
          pinned: true,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: 'other-session',
          slug: 'other-session',
          userId: otherUserId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'other-agent',
          sessionId: 'other-session',
          userId: otherUserId,
        });
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toHaveLength(0);
      expect(result.ungrouped).toHaveLength(0);
    });

    describe('backward compatibility - fallback to sessions.pinned', () => {
      it('should fallback to sessions.pinned when agents.pinned is undefined (legacy data)', async () => {
        // Simulate legacy data: agents.pinned is null, but sessions.pinned is true
        const agentId = 'legacy-agent';
        const sessionId = 'legacy-session';

        await clientDB.transaction(async (tx) => {
          await tx.insert(Schema.agents).values({
            id: agentId,
            userId,
            title: 'Legacy Agent',
            virtual: false,
          });
          await tx.insert(Schema.sessions).values({
            id: sessionId,
            slug: 'legacy-session',
            userId,
            pinned: true, // Legacy: pinned was stored on session
          });
          await tx.insert(Schema.agentsToSessions).values({
            agentId,
            sessionId,
            userId,
          });
        });

        const result = await homeRepo.getSidebarAgentList();

        // Should fallback to sessions.pinned = true
        expect(result.pinned).toHaveLength(1);
        expect(result.pinned[0].id).toBe(agentId);
        expect(result.pinned[0].pinned).toBe(true);
        expect(result.ungrouped).toHaveLength(0);
      });

      it('should use agents.pinned when both agents.pinned and sessions.pinned exist (agents.pinned takes priority)', async () => {
        // agents.pinned = false, sessions.pinned = true
        // agents.pinned should take priority
        const agentId = 'priority-agent';
        const sessionId = 'priority-session';

        await clientDB.transaction(async (tx) => {
          await tx.insert(Schema.agents).values({
            id: agentId,
            userId,
            title: 'Priority Agent',
            pinned: false, // Agent says not pinned
            virtual: false,
          });
          await tx.insert(Schema.sessions).values({
            id: sessionId,
            slug: 'priority-session',
            userId,
            pinned: true, // Session says pinned (legacy)
          });
          await tx.insert(Schema.agentsToSessions).values({
            agentId,
            sessionId,
            userId,
          });
        });

        const result = await homeRepo.getSidebarAgentList();

        // agents.pinned = false should take priority
        expect(result.pinned).toHaveLength(0);
        expect(result.ungrouped).toHaveLength(1);
        expect(result.ungrouped[0].id).toBe(agentId);
        expect(result.ungrouped[0].pinned).toBe(false);
      });

      it('should return pinned=false when both agents.pinned and sessions.pinned are null', async () => {
        const agentId = 'both-null-agent';
        const sessionId = 'both-null-session';

        await clientDB.transaction(async (tx) => {
          await tx.insert(Schema.agents).values({
            id: agentId,
            userId,
            title: 'Both Null Agent',
            pinned: null,
            virtual: false,
          });
          await tx.insert(Schema.sessions).values({
            id: sessionId,
            slug: 'both-null-session',
            userId,
            pinned: null,
          });
          await tx.insert(Schema.agentsToSessions).values({
            agentId,
            sessionId,
            userId,
          });
        });

        const result = await homeRepo.getSidebarAgentList();

        // Both null should default to false
        expect(result.pinned).toHaveLength(0);
        expect(result.ungrouped).toHaveLength(1);
        expect(result.ungrouped[0].pinned).toBe(false);
      });
    });
  });

  describe('searchAgents', () => {
    beforeEach(async () => {
      // Create test agents for search
      await clientDB.transaction(async (tx) => {
        // Pinned agent
        await tx.insert(Schema.agents).values({
          id: 'search-pinned',
          userId,
          title: 'Searchable Pinned Agent',
          description: 'A pinned agent for testing',
          pinned: true,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: 'session-search-pinned',
          slug: 'session-search-pinned',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'search-pinned',
          sessionId: 'session-search-pinned',
          userId,
        });

        // Unpinned agent
        await tx.insert(Schema.agents).values({
          id: 'search-unpinned',
          userId,
          title: 'Searchable Unpinned Agent',
          description: 'An unpinned agent for testing',
          pinned: false,
          virtual: false,
        });
        await tx.insert(Schema.sessions).values({
          id: 'session-search-unpinned',
          slug: 'session-search-unpinned',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'search-unpinned',
          sessionId: 'session-search-unpinned',
          userId,
        });

        // Agent without session (e.g., duplicated agent)
        await tx.insert(Schema.agents).values({
          id: 'search-standalone',
          userId,
          title: 'Standalone Searchable Agent',
          description: 'A standalone agent without session',
          pinned: false,
          virtual: false,
        });
      });
    });

    it('should return empty array for empty keyword', async () => {
      const result = await homeRepo.searchAgents('');
      expect(result).toEqual([]);
    });

    it('should search agents without agentsToSessions relationship', async () => {
      const result = await homeRepo.searchAgents('Standalone');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('search-standalone');
      expect(result[0].title).toBe('Standalone Searchable Agent');
    });

    it('should search and return mixed agents with and without session relationships', async () => {
      // Search for "Searchable" should return all 3 agents
      const result = await homeRepo.searchAgents('Searchable');

      expect(result).toHaveLength(3);
      expect(result.map((a) => a.id)).toContain('search-pinned');
      expect(result.map((a) => a.id)).toContain('search-unpinned');
      expect(result.map((a) => a.id)).toContain('search-standalone');
    });

    it('should search agents by title and return correct pinned status', async () => {
      const result = await homeRepo.searchAgents('Searchable Pinned');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('search-pinned');
      expect(result[0].pinned).toBe(true);
    });

    it('should search agents by description', async () => {
      const result = await homeRepo.searchAgents('unpinned agent for testing');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('search-unpinned');
      expect(result[0].pinned).toBe(false);
    });

    it('should return multiple matching agents with correct pinned status', async () => {
      const result = await homeRepo.searchAgents('Searchable');

      // 3 agents: search-pinned, search-unpinned, search-standalone
      expect(result).toHaveLength(3);

      const pinnedAgent = result.find((a) => a.id === 'search-pinned');
      const unpinnedAgent = result.find((a) => a.id === 'search-unpinned');
      const standaloneAgent = result.find((a) => a.id === 'search-standalone');

      expect(pinnedAgent).toBeDefined();
      expect(pinnedAgent!.pinned).toBe(true);
      expect(unpinnedAgent).toBeDefined();
      expect(unpinnedAgent!.pinned).toBe(false);
      expect(standaloneAgent).toBeDefined();
      expect(standaloneAgent!.pinned).toBe(false);
    });

    it('should not return virtual agents in search', async () => {
      // Add a virtual agent
      await clientDB.transaction(async (tx) => {
        await tx.insert(Schema.agents).values({
          id: 'virtual-search',
          userId,
          title: 'Searchable Virtual Agent',
          pinned: false,
          virtual: true,
        });
        await tx.insert(Schema.sessions).values({
          id: 'session-virtual-search',
          slug: 'session-virtual-search',
          userId,
        });
        await tx.insert(Schema.agentsToSessions).values({
          agentId: 'virtual-search',
          sessionId: 'session-virtual-search',
          userId,
        });
      });

      const result = await homeRepo.searchAgents('Virtual');

      expect(result).toHaveLength(0);
    });

    describe('backward compatibility - fallback to sessions.pinned', () => {
      it('should fallback to sessions.pinned when agents.pinned is null in search results', async () => {
        // Create legacy agent with pinned on session only
        await clientDB.transaction(async (tx) => {
          await tx.insert(Schema.agents).values({
            id: 'legacy-search',
            userId,
            title: 'Legacy Searchable Agent',
            description: 'A legacy agent',
            pinned: null, // No pinned on agent
            virtual: false,
          });
          await tx.insert(Schema.sessions).values({
            id: 'session-legacy-search',
            slug: 'session-legacy-search',
            userId,
            pinned: true, // Pinned on session (legacy)
          });
          await tx.insert(Schema.agentsToSessions).values({
            agentId: 'legacy-search',
            sessionId: 'session-legacy-search',
            userId,
          });
        });

        const result = await homeRepo.searchAgents('Legacy Searchable');

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('legacy-search');
        expect(result[0].pinned).toBe(true); // Should fallback to sessions.pinned
      });

      it('should prioritize agents.pinned over sessions.pinned in search results', async () => {
        // Create agent where agents.pinned differs from sessions.pinned
        await clientDB.transaction(async (tx) => {
          await tx.insert(Schema.agents).values({
            id: 'priority-search',
            userId,
            title: 'Priority Searchable Agent',
            pinned: false, // Agent says not pinned
            virtual: false,
          });
          await tx.insert(Schema.sessions).values({
            id: 'session-priority-search',
            slug: 'session-priority-search',
            userId,
            pinned: true, // Session says pinned
          });
          await tx.insert(Schema.agentsToSessions).values({
            agentId: 'priority-search',
            sessionId: 'session-priority-search',
            userId,
          });
        });

        const result = await homeRepo.searchAgents('Priority Searchable');

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('priority-search');
        expect(result[0].pinned).toBe(false); // agents.pinned should take priority
      });
    });
  });
});
