// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { NewAgent, agents } from '../../schemas/agent';
import { NewChatGroup, chatGroups, chatGroupsAgents } from '../../schemas/chatGroup';
import { agentsToSessions } from '../../schemas/relations';
import { NewSession, NewSessionGroup, sessionGroups, sessions } from '../../schemas/session';
import { users } from '../../schemas/user';
import { LobeChatDatabase } from '../../type';
import { HomeRepository } from './index';

const userId = 'home-test-user';
const otherUserId = 'other-home-user';

let homeRepo: HomeRepository;

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize repo
  homeRepo = new HomeRepository(serverDB, userId);
});

describe('HomeRepository', () => {
  describe('getSidebarAgentList - empty state', () => {
    it('should return empty arrays when no data exists', async () => {
      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toEqual([]);
      expect(result.groups).toEqual([]);
      expect(result.ungrouped).toEqual([]);
    });
  });

  describe('getSidebarAgentList - agents', () => {
    it('should return agents with their session info', async () => {
      // Create agent
      const [agent] = await serverDB
        .insert(agents)
        .values({
          avatar: 'agent-avatar',
          description: 'Test agent description',
          title: 'Test Agent',
          userId,
          virtual: false,
        })
        .returning();

      // Create session
      const [session] = await serverDB
        .insert(sessions)
        .values({
          pinned: false,
          userId,
        })
        .returning();

      // Link agent to session
      await serverDB.insert(agentsToSessions).values({
        agentId: agent.id,
        sessionId: session.id,
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0]).toMatchObject({
        avatar: 'agent-avatar',
        description: 'Test agent description',
        id: agent.id,
        pinned: false,
        sessionId: session.id,
        title: 'Test Agent',
        type: 'agent',
      });
    });

    it('should exclude virtual agents (like inbox)', async () => {
      // Create virtual agent
      const [virtualAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Inbox',
          userId,
          virtual: true,
        })
        .returning();

      // Create session for virtual agent
      const [session] = await serverDB
        .insert(sessions)
        .values({
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: virtualAgent.id,
        sessionId: session.id,
        userId,
      });

      // Create non-virtual agent
      const [normalAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Normal Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [normalSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: normalAgent.id,
        sessionId: normalSession.id,
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      // Should only have the normal agent
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].title).toBe('Normal Agent');
    });
  });

  describe('getSidebarAgentList - chat groups', () => {
    it('should return chat groups (group chats)', async () => {
      await serverDB.insert(chatGroups).values({
        description: 'Group chat description',
        pinned: false,
        title: 'My Group Chat',
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0]).toMatchObject({
        description: 'Group chat description',
        pinned: false,
        title: 'My Group Chat',
        type: 'group',
      });
    });

    it('should return custom avatar when chat group has one set', async () => {
      const [group] = await serverDB
        .insert(chatGroups)
        .values({
          avatar: '🚀',
          backgroundColor: '#ff5500',
          pinned: false,
          title: 'Custom Avatar Group',
          userId,
        })
        .returning();

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0]).toMatchObject({
        avatar: '🚀',
        backgroundColor: '#ff5500',
        title: 'Custom Avatar Group',
        type: 'group',
      });
    });

    it('should return member avatars when chat group has no custom avatar', async () => {
      // Create chat group without custom avatar
      const [group] = await serverDB
        .insert(chatGroups)
        .values({
          pinned: false,
          title: 'No Custom Avatar Group',
          userId,
        })
        .returning();

      // Create member agents
      const [agent1] = await serverDB
        .insert(agents)
        .values({
          avatar: '🤖',
          backgroundColor: '#0000ff',
          title: 'Agent 1',
          userId,
          virtual: true,
        })
        .returning();

      const [agent2] = await serverDB
        .insert(agents)
        .values({
          avatar: '🧑‍💻',
          backgroundColor: '#00ff00',
          title: 'Agent 2',
          userId,
          virtual: true,
        })
        .returning();

      // Link agents to group
      await serverDB.insert(chatGroupsAgents).values([
        { agentId: agent1.id, chatGroupId: group.id, order: 0, userId },
        { agentId: agent2.id, chatGroupId: group.id, order: 1, userId },
      ]);

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      const groupItem = result.ungrouped[0];
      expect(groupItem.type).toBe('group');
      // Avatar should be an array of member avatars
      expect(Array.isArray(groupItem.avatar)).toBe(true);
      const avatarArray = groupItem.avatar as Array<{ avatar: string; background?: string }>;
      expect(avatarArray).toHaveLength(2);
      expect(avatarArray[0]).toMatchObject({ avatar: '🤖', background: '#0000ff' });
      expect(avatarArray[1]).toMatchObject({ avatar: '🧑‍💻', background: '#00ff00' });
      // backgroundColor should not be set when using member avatars
      expect(groupItem.backgroundColor).toBeUndefined();
    });

    it('should prioritize custom avatar over member avatars', async () => {
      // Create chat group WITH custom avatar
      const [group] = await serverDB
        .insert(chatGroups)
        .values({
          avatar: '🎯',
          backgroundColor: '#ff0000',
          pinned: false,
          title: 'Group With Both',
          userId,
        })
        .returning();

      // Create member agent
      const [agent] = await serverDB
        .insert(agents)
        .values({
          avatar: '🤖',
          backgroundColor: '#0000ff',
          title: 'Member Agent',
          userId,
          virtual: true,
        })
        .returning();

      // Link agent to group
      await serverDB.insert(chatGroupsAgents).values({
        agentId: agent.id,
        chatGroupId: group.id,
        order: 0,
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      const groupItem = result.ungrouped[0];
      // Should use custom avatar (string), not member avatars (array)
      expect(groupItem.avatar).toBe('🎯');
      expect(groupItem.backgroundColor).toBe('#ff0000');
    });
  });

  describe('getSidebarAgentList - pinned items', () => {
    it('should separate pinned agents', async () => {
      // Create pinned agent
      const [pinnedAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Pinned Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [pinnedSession] = await serverDB
        .insert(sessions)
        .values({
          pinned: true,
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: pinnedAgent.id,
        sessionId: pinnedSession.id,
        userId,
      });

      // Create unpinned agent
      const [unpinnedAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Unpinned Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [unpinnedSession] = await serverDB
        .insert(sessions)
        .values({
          pinned: false,
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: unpinnedAgent.id,
        sessionId: unpinnedSession.id,
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toHaveLength(1);
      expect(result.pinned[0].title).toBe('Pinned Agent');
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].title).toBe('Unpinned Agent');
    });

    it('should separate pinned chat groups', async () => {
      await serverDB.insert(chatGroups).values([
        { pinned: true, title: 'Pinned Group', userId },
        { pinned: false, title: 'Unpinned Group', userId },
      ]);

      const result = await homeRepo.getSidebarAgentList();

      expect(result.pinned).toHaveLength(1);
      expect(result.pinned[0].title).toBe('Pinned Group');
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].title).toBe('Unpinned Group');
    });
  });

  describe('getSidebarAgentList - session groups (folders)', () => {
    it('should organize agents into session groups', async () => {
      // Create session group (folder)
      const [group] = await serverDB
        .insert(sessionGroups)
        .values({
          name: 'Work Agents',
          sort: 1,
          userId,
        })
        .returning();

      // Create agent in group
      const [agent] = await serverDB
        .insert(agents)
        .values({
          title: 'Work Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [session] = await serverDB
        .insert(sessions)
        .values({
          groupId: group.id,
          pinned: false,
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: agent.id,
        sessionId: session.id,
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Work Agents');
      expect(result.groups[0].items).toHaveLength(1);
      expect(result.groups[0].items[0].title).toBe('Work Agent');
      expect(result.ungrouped).toHaveLength(0);
    });

    it('should organize chat groups into session groups', async () => {
      // Create session group (folder)
      const [group] = await serverDB
        .insert(sessionGroups)
        .values({
          name: 'Team Chats',
          sort: 1,
          userId,
        })
        .returning();

      // Create chat group in session group
      await serverDB.insert(chatGroups).values({
        groupId: group.id,
        pinned: false,
        title: 'Team Chat',
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Team Chats');
      expect(result.groups[0].items).toHaveLength(1);
      expect(result.groups[0].items[0].title).toBe('Team Chat');
      expect(result.groups[0].items[0].type).toBe('group');
    });

    it('should return empty groups when no items assigned', async () => {
      await serverDB.insert(sessionGroups).values({
        name: 'Empty Group',
        sort: 1,
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Empty Group');
      expect(result.groups[0].items).toHaveLength(0);
    });

    it('should order groups by sort field', async () => {
      await serverDB.insert(sessionGroups).values([
        { name: 'Group C', sort: 3, userId },
        { name: 'Group A', sort: 1, userId },
        { name: 'Group B', sort: 2, userId },
      ]);

      const result = await homeRepo.getSidebarAgentList();

      expect(result.groups).toHaveLength(3);
      expect(result.groups[0].name).toBe('Group A');
      expect(result.groups[1].name).toBe('Group B');
      expect(result.groups[2].name).toBe('Group C');
    });
  });

  describe('getSidebarAgentList - user isolation', () => {
    it('should only return current user agents', async () => {
      // Create agent for current user
      const [userAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'User Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [userSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: userAgent.id,
        sessionId: userSession.id,
        userId,
      });

      // Create agent for other user
      const [otherAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Other User Agent',
          userId: otherUserId,
          virtual: false,
        })
        .returning();

      const [otherSession] = await serverDB
        .insert(sessions)
        .values({
          userId: otherUserId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: otherAgent.id,
        sessionId: otherSession.id,
        userId: otherUserId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].title).toBe('User Agent');
    });

    it('should only return current user chat groups', async () => {
      await serverDB.insert(chatGroups).values([
        { title: 'User Group', userId },
        { title: 'Other User Group', userId: otherUserId },
      ]);

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].title).toBe('User Group');
    });

    it('should only return current user session groups', async () => {
      await serverDB.insert(sessionGroups).values([
        { name: 'User Folder', sort: 1, userId },
        { name: 'Other User Folder', sort: 1, userId: otherUserId },
      ]);

      const result = await homeRepo.getSidebarAgentList();

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('User Folder');
    });
  });

  describe('getSidebarAgentList - sorting', () => {
    it('should sort items by updatedAt descending', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Create agents with different updatedAt
      const [oldAgent] = await serverDB
        .insert(agents)
        .values({
          createdAt: twoDaysAgo,
          title: 'Old Agent',
          updatedAt: twoDaysAgo,
          userId,
          virtual: false,
        })
        .returning();

      const [oldSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: oldAgent.id,
        sessionId: oldSession.id,
        userId,
      });

      const [newAgent] = await serverDB
        .insert(agents)
        .values({
          createdAt: now,
          title: 'New Agent',
          updatedAt: now,
          userId,
          virtual: false,
        })
        .returning();

      const [newSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: newAgent.id,
        sessionId: newSession.id,
        userId,
      });

      const [midAgent] = await serverDB
        .insert(agents)
        .values({
          createdAt: yesterday,
          title: 'Mid Agent',
          updatedAt: yesterday,
          userId,
          virtual: false,
        })
        .returning();

      const [midSession] = await serverDB
        .insert(sessions)
        .values({
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: midAgent.id,
        sessionId: midSession.id,
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      expect(result.ungrouped).toHaveLength(3);
      expect(result.ungrouped[0].title).toBe('New Agent');
      expect(result.ungrouped[1].title).toBe('Mid Agent');
      expect(result.ungrouped[2].title).toBe('Old Agent');
    });
  });

  describe('getSidebarAgentList - mixed items', () => {
    it('should return both agents and chat groups in correct categories', async () => {
      // Create session group
      const [folder] = await serverDB
        .insert(sessionGroups)
        .values({
          name: 'My Folder',
          sort: 1,
          userId,
        })
        .returning();

      // Create pinned agent
      const [pinnedAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Pinned Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [pinnedSession] = await serverDB
        .insert(sessions)
        .values({
          pinned: true,
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: pinnedAgent.id,
        sessionId: pinnedSession.id,
        userId,
      });

      // Create grouped agent
      const [groupedAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Grouped Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [groupedSession] = await serverDB
        .insert(sessions)
        .values({
          groupId: folder.id,
          pinned: false,
          userId,
        })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: groupedAgent.id,
        sessionId: groupedSession.id,
        userId,
      });

      // Create ungrouped chat group
      await serverDB.insert(chatGroups).values({
        pinned: false,
        title: 'Ungrouped Chat',
        userId,
      });

      // Create pinned chat group
      await serverDB.insert(chatGroups).values({
        pinned: true,
        title: 'Pinned Chat',
        userId,
      });

      const result = await homeRepo.getSidebarAgentList();

      // Verify pinned items
      expect(result.pinned).toHaveLength(2);
      const pinnedTitles = result.pinned.map((p) => p.title);
      expect(pinnedTitles).toContain('Pinned Agent');
      expect(pinnedTitles).toContain('Pinned Chat');

      // Verify grouped items
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].items).toHaveLength(1);
      expect(result.groups[0].items[0].title).toBe('Grouped Agent');

      // Verify ungrouped items
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].title).toBe('Ungrouped Chat');
    });
  });

  describe('searchAgents', () => {
    it('should return empty array for empty keyword', async () => {
      const result = await homeRepo.searchAgents('');
      expect(result).toEqual([]);

      const resultWhitespace = await homeRepo.searchAgents('   ');
      expect(resultWhitespace).toEqual([]);
    });

    it('should search agents by title', async () => {
      // Create agents
      const [agent1] = await serverDB
        .insert(agents)
        .values({
          title: 'Coding Assistant',
          userId,
          virtual: false,
        })
        .returning();

      const [session1] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: agent1.id,
        sessionId: session1.id,
        userId,
      });

      const [agent2] = await serverDB
        .insert(agents)
        .values({
          title: 'Writing Helper',
          userId,
          virtual: false,
        })
        .returning();

      const [session2] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: agent2.id,
        sessionId: session2.id,
        userId,
      });

      const result = await homeRepo.searchAgents('coding');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Coding Assistant');
      expect(result[0].type).toBe('agent');
    });

    it('should search agents by description', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          description: 'Helps with Python programming',
          title: 'Code Helper',
          userId,
          virtual: false,
        })
        .returning();

      const [session] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: agent.id,
        sessionId: session.id,
        userId,
      });

      const result = await homeRepo.searchAgents('python');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Code Helper');
    });

    it('should search chat groups by title', async () => {
      await serverDB.insert(chatGroups).values({
        title: 'Team Discussion',
        userId,
      });

      await serverDB.insert(chatGroups).values({
        title: 'Project Meeting',
        userId,
      });

      const result = await homeRepo.searchAgents('discussion');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Team Discussion');
      expect(result[0].type).toBe('group');
    });

    it('should search chat groups by description', async () => {
      await serverDB.insert(chatGroups).values({
        description: 'Weekly sync about frontend tasks',
        title: 'Frontend Team',
        userId,
      });

      const result = await homeRepo.searchAgents('frontend');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Frontend Team');
    });

    it('should return both agents and chat groups matching the keyword', async () => {
      // Create agent with 'dev' in title
      const [agent] = await serverDB
        .insert(agents)
        .values({
          title: 'Dev Assistant',
          userId,
          virtual: false,
        })
        .returning();

      const [session] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: agent.id,
        sessionId: session.id,
        userId,
      });

      // Create chat group with 'dev' in title
      await serverDB.insert(chatGroups).values({
        title: 'Dev Team Chat',
        userId,
      });

      const result = await homeRepo.searchAgents('dev');

      expect(result).toHaveLength(2);
      const titles = result.map((r) => r.title);
      expect(titles).toContain('Dev Assistant');
      expect(titles).toContain('Dev Team Chat');
    });

    it('should be case insensitive', async () => {
      const [agent] = await serverDB
        .insert(agents)
        .values({
          title: 'JavaScript Expert',
          userId,
          virtual: false,
        })
        .returning();

      const [session] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: agent.id,
        sessionId: session.id,
        userId,
      });

      const resultLower = await homeRepo.searchAgents('javascript');
      const resultUpper = await homeRepo.searchAgents('JAVASCRIPT');
      const resultMixed = await homeRepo.searchAgents('JavaScript');

      expect(resultLower).toHaveLength(1);
      expect(resultUpper).toHaveLength(1);
      expect(resultMixed).toHaveLength(1);
    });

    it('should exclude virtual agents', async () => {
      const [virtualAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Inbox Agent',
          userId,
          virtual: true,
        })
        .returning();

      const [session] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: virtualAgent.id,
        sessionId: session.id,
        userId,
      });

      const result = await homeRepo.searchAgents('inbox');

      expect(result).toHaveLength(0);
    });

    it('should only return current user items', async () => {
      // Create agent for current user
      const [userAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Search Test Agent',
          userId,
          virtual: false,
        })
        .returning();

      const [userSession] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: userAgent.id,
        sessionId: userSession.id,
        userId,
      });

      // Create agent for other user with same title
      const [otherAgent] = await serverDB
        .insert(agents)
        .values({
          title: 'Search Test Agent',
          userId: otherUserId,
          virtual: false,
        })
        .returning();

      const [otherSession] = await serverDB
        .insert(sessions)
        .values({ userId: otherUserId })
        .returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: otherAgent.id,
        sessionId: otherSession.id,
        userId: otherUserId,
      });

      const result = await homeRepo.searchAgents('search test');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(userAgent.id);
    });

    it('should sort results by updatedAt descending', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [oldAgent] = await serverDB
        .insert(agents)
        .values({
          createdAt: yesterday,
          title: 'Old Search Agent',
          updatedAt: yesterday,
          userId,
          virtual: false,
        })
        .returning();

      const [oldSession] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: oldAgent.id,
        sessionId: oldSession.id,
        userId,
      });

      const [newAgent] = await serverDB
        .insert(agents)
        .values({
          createdAt: now,
          title: 'New Search Agent',
          updatedAt: now,
          userId,
          virtual: false,
        })
        .returning();

      const [newSession] = await serverDB.insert(sessions).values({ userId }).returning();

      await serverDB.insert(agentsToSessions).values({
        agentId: newAgent.id,
        sessionId: newSession.id,
        userId,
      });

      const result = await homeRepo.searchAgents('search agent');

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('New Search Agent');
      expect(result[1].title).toBe('Old Search Agent');
    });

    it('should return custom avatar for chat groups with custom avatar in search', async () => {
      await serverDB.insert(chatGroups).values({
        avatar: '🎨',
        backgroundColor: '#abcdef',
        title: 'Searchable Custom Avatar Group',
        userId,
      });

      const result = await homeRepo.searchAgents('Searchable Custom');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        avatar: '🎨',
        backgroundColor: '#abcdef',
        title: 'Searchable Custom Avatar Group',
        type: 'group',
      });
    });

    it('should return member avatars for chat groups without custom avatar in search', async () => {
      // Create chat group without custom avatar
      const [group] = await serverDB
        .insert(chatGroups)
        .values({
          title: 'Searchable Member Avatar Group',
          userId,
        })
        .returning();

      // Create member agent
      const [agent] = await serverDB
        .insert(agents)
        .values({
          avatar: '🤖',
          backgroundColor: '#112233',
          title: 'Search Member',
          userId,
          virtual: true,
        })
        .returning();

      await serverDB.insert(chatGroupsAgents).values({
        agentId: agent.id,
        chatGroupId: group.id,
        order: 0,
        userId,
      });

      const result = await homeRepo.searchAgents('Searchable Member Avatar');

      expect(result).toHaveLength(1);
      const groupItem = result[0];
      expect(groupItem.type).toBe('group');
      expect(Array.isArray(groupItem.avatar)).toBe(true);
      const avatarArray = groupItem.avatar as Array<{ avatar: string; background?: string }>;
      expect(avatarArray).toHaveLength(1);
      expect(avatarArray[0]).toMatchObject({ avatar: '🤖', background: '#112233' });
      expect(groupItem.backgroundColor).toBeUndefined();
    });

    it('should prioritize custom avatar over member avatars in search', async () => {
      // Create chat group WITH custom avatar and members
      const [group] = await serverDB
        .insert(chatGroups)
        .values({
          avatar: '🏆',
          backgroundColor: '#gold00',
          title: 'Searchable Priority Group',
          userId,
        })
        .returning();

      const [agent] = await serverDB
        .insert(agents)
        .values({
          avatar: '🤖',
          title: 'Priority Member',
          userId,
          virtual: true,
        })
        .returning();

      await serverDB.insert(chatGroupsAgents).values({
        agentId: agent.id,
        chatGroupId: group.id,
        order: 0,
        userId,
      });

      const result = await homeRepo.searchAgents('Searchable Priority');

      expect(result).toHaveLength(1);
      expect(result[0].avatar).toBe('🏆');
      expect(result[0].backgroundColor).toBe('#gold00');
    });
  });
});
