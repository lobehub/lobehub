// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents } from '../../schemas';
import type { NewAgent } from '../../schemas/agent';
import { agents } from '../../schemas/agent';
import type { NewFile } from '../../schemas/file';
import { files } from '../../schemas/file';
import { messages } from '../../schemas/message';
import type { NewTopic } from '../../schemas/topic';
import { topics } from '../../schemas/topic';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { SearchRepo } from './index';

const userId = 'search-test-user';
const otherUserId = 'other-search-user';

let searchRepo: SearchRepo;

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize repo
  searchRepo = new SearchRepo(serverDB, userId);
});

describe('SearchRepo', () => {
  describe('search - empty query', () => {
    it('should return empty array for empty query', async () => {
      const results = await searchRepo.search({ query: '' });
      expect(results).toEqual([]);
    });

    it('should return empty array for whitespace query', async () => {
      const results = await searchRepo.search({ query: '   ' });
      expect(results).toEqual([]);
    });
  });

  describe('search - basic search', () => {
    beforeEach(async () => {
      // Create test agents
      const testAgents: NewAgent[] = [
        {
          description: 'A helpful React coding assistant',
          slug: 'react-helper',
          tags: ['react', 'frontend', 'coding'],
          title: 'React Helper',
          userId,
        },
        {
          description: 'Python development assistant',
          slug: 'python-dev',
          tags: ['python', 'backend'],
          title: 'Python Developer',
          userId,
        },
      ];
      await serverDB.insert(agents).values(testAgents);

      // Create test topics
      const testTopics: NewTopic[] = [
        {
          content: 'Discussion about React hooks and best practices',
          title: 'React Hooks Guide',
          userId,
        },
        {
          content: 'Notes on Python async programming',
          title: 'Python Async Notes',
          userId,
        },
      ];
      await serverDB.insert(topics).values(testTopics);

      // Create test files
      const testFiles: NewFile[] = [
        {
          fileType: 'application/javascript',
          name: 'react-component.jsx',
          size: 1024,
          url: 'file://react-component.jsx',
          userId,
        },
        {
          fileType: 'text/python',
          name: 'python-script.py',
          size: 2048,
          url: 'file://python-script.py',
          userId,
        },
      ];
      await serverDB.insert(files).values(testFiles);
    });

    it('should find agents by title', async () => {
      const results = await searchRepo.search({ query: 'React Helper' });

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults).toHaveLength(1);
      expect(agentResults[0].title).toBe('React Helper');
    });

    it('should find topics by title', async () => {
      const results = await searchRepo.search({ query: 'React Hooks' });

      const topicResults = results.filter((r) => r.type === 'topic');
      expect(topicResults).toHaveLength(1);
      expect(topicResults[0].title).toBe('React Hooks Guide');
    });

    it('should find files by name', async () => {
      const results = await searchRepo.search({ query: 'react-component' });

      const fileResults = results.filter((r) => r.type === 'file');
      expect(fileResults).toHaveLength(1);
      expect(fileResults[0].title).toBe('react-component.jsx');
    });

    it('should find results across all types', async () => {
      const results = await searchRepo.search({ query: 'react' });

      // Should find: 1 agent, 1 topic, 1 file
      expect(results.length).toBeGreaterThanOrEqual(3);

      const types = new Set(results.map((r) => r.type));
      expect(types.has('agent')).toBe(true);
      expect(types.has('topic')).toBe(true);
      expect(types.has('file')).toBe(true);
    });

    it('should search in agent description', async () => {
      const results = await searchRepo.search({ query: 'coding assistant' });

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults.length).toBeGreaterThanOrEqual(1);
      expect(agentResults[0].description).toContain('coding');
    });

    it('should search in topic content', async () => {
      const results = await searchRepo.search({ query: 'async programming' });

      const topicResults = results.filter((r) => r.type === 'topic');
      expect(topicResults.length).toBeGreaterThanOrEqual(1);
      expect(topicResults[0].description).toContain('async');
    });

    it('should search in agent tags', async () => {
      const results = await searchRepo.search({ query: 'frontend' });

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults.length).toBeGreaterThanOrEqual(1);
      expect(agentResults[0].tags).toContain('frontend');
    });
  });

  describe('search - relevance ranking', () => {
    beforeEach(async () => {
      const testAgents: NewAgent[] = [
        {
          slug: 'exact',
          title: 'test',
          userId,
        },
        {
          slug: 'prefix',
          title: 'testing',
          userId,
        },
        {
          slug: 'contains',
          title: 'my test agent',
          userId,
        },
      ];
      await serverDB.insert(agents).values(testAgents);
    });

    it('should prioritize exact match (relevance=1)', async () => {
      const results = await searchRepo.search({ query: 'test' });

      const exactMatch = results.find((r) => r.type === 'agent' && r.slug === 'exact');
      expect(exactMatch).toBeDefined();
      expect(exactMatch?.relevance).toBe(1);
    });

    it('should rank prefix match second (relevance=2)', async () => {
      const results = await searchRepo.search({ query: 'test' });

      const prefixMatch = results.find((r) => r.type === 'agent' && r.slug === 'prefix');
      expect(prefixMatch).toBeDefined();
      expect(prefixMatch?.relevance).toBe(2);
    });

    it('should rank contains match third (relevance=3)', async () => {
      const results = await searchRepo.search({ query: 'test' });

      const containsMatch = results.find((r) => r.type === 'agent' && r.slug === 'contains');
      expect(containsMatch).toBeDefined();
      expect(containsMatch?.relevance).toBe(3);
    });

    it('should order results by relevance', async () => {
      const results = await searchRepo.search({ query: 'test' });

      const agentResults = results.filter((r) => r.type === 'agent');

      // Exact match should come first
      expect(agentResults[0].slug).toBe('exact');
      expect(agentResults[0].relevance).toBe(1);

      // Prefix match should come second
      expect(agentResults[1].slug).toBe('prefix');
      expect(agentResults[1].relevance).toBe(2);

      // Contains match should come third
      expect(agentResults[2].slug).toBe('contains');
      expect(agentResults[2].relevance).toBe(3);
    });
  });

  describe('search - user isolation', () => {
    beforeEach(async () => {
      // Create agent for current user
      await serverDB.insert(agents).values({
        slug: 'user-agent',
        title: 'User Agent',
        userId,
      });

      // Create agent for other user
      await serverDB.insert(agents).values({
        slug: 'other-agent',
        title: 'Other Agent',
        userId: otherUserId,
      });

      // Create topic for current user
      await serverDB.insert(topics).values({
        title: 'User Topic',
        userId,
      });

      // Create topic for other user
      await serverDB.insert(topics).values({
        title: 'Other Topic',
        userId: otherUserId,
      });

      // Create file for current user
      await serverDB.insert(files).values({
        fileType: 'text/plain',
        name: 'user-file.txt',
        size: 100,
        url: 'file://user-file.txt',
        userId,
      });

      // Create file for other user
      await serverDB.insert(files).values({
        fileType: 'text/plain',
        name: 'other-file.txt',
        size: 100,
        url: 'file://other-file.txt',
        userId: otherUserId,
      });
    });

    it('should only return current user results', async () => {
      const results = await searchRepo.search({ query: 'agent' });

      expect(results.length).toBeGreaterThan(0);

      // All results should be from current user
      results.forEach((result) => {
        expect(result.title).not.toContain('Other');
      });
    });

    it('should not return other user agents', async () => {
      const results = await searchRepo.search({ query: 'agent' });

      const otherAgent = results.find((r) => r.title === 'Other Agent');
      expect(otherAgent).toBeUndefined();
    });

    it('should not return other user topics', async () => {
      const results = await searchRepo.search({ query: 'topic' });

      const otherTopic = results.find((r) => r.title === 'Other Topic');
      expect(otherTopic).toBeUndefined();
    });

    it('should not return other user files', async () => {
      const results = await searchRepo.search({ query: 'file' });

      const otherFile = results.find((r) => r.title === 'other-file.txt');
      expect(otherFile).toBeUndefined();
    });
  });

  describe('search - type filtering', () => {
    beforeEach(async () => {
      await serverDB.insert(agents).values({
        slug: 'test-agent',
        title: 'Test Agent',
        userId,
      });

      await serverDB.insert(topics).values({
        title: 'Test Topic',
        userId,
      });

      await serverDB.insert(files).values({
        fileType: 'text/plain',
        name: 'test-file.txt',
        size: 100,
        url: 'file://test-file.txt',
        userId,
      });
    });

    it('should filter by agent type', async () => {
      const results = await searchRepo.search({ query: 'test', type: 'agent' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.type).toBe('agent');
      });
    });

    it('should filter by topic type', async () => {
      const results = await searchRepo.search({ query: 'test', type: 'topic' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.type).toBe('topic');
      });
    });

    it('should filter by file type', async () => {
      const results = await searchRepo.search({ query: 'test', type: 'file' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.type).toBe('file');
      });
    });
  });

  describe('search - limit per type', () => {
    beforeEach(async () => {
      // Create 10 agents
      const testAgents: NewAgent[] = Array.from({ length: 10 }, (_, i) => ({
        slug: `agent-${i}`,
        title: `Test Agent ${i}`,
        userId,
      }));
      await serverDB.insert(agents).values(testAgents);
    });

    it('should respect default limit of 5 per type', async () => {
      const results = await searchRepo.search({ query: 'test' });

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults.length).toBeLessThanOrEqual(5);
    });

    it('should respect custom limit per type', async () => {
      const results = await searchRepo.search({ limitPerType: 3, query: 'test' });

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults.length).toBeLessThanOrEqual(3);
    });
  });

  describe('search - case insensitivity', () => {
    beforeEach(async () => {
      await serverDB.insert(agents).values({
        description: 'React Development Assistant',
        slug: 'react-agent',
        title: 'React Agent',
        userId,
      });
    });

    it('should search case-insensitively', async () => {
      const upperResults = await searchRepo.search({ query: 'REACT' });
      const lowerResults = await searchRepo.search({ query: 'react' });
      const mixedResults = await searchRepo.search({ query: 'ReAcT' });

      expect(upperResults.length).toBeGreaterThan(0);
      expect(lowerResults.length).toBeGreaterThan(0);
      expect(mixedResults.length).toBeGreaterThan(0);

      // All should return the same agent
      expect(upperResults[0].id).toBe(lowerResults[0].id);
      expect(lowerResults[0].id).toBe(mixedResults[0].id);
    });
  });

  describe('search - result structure', () => {
    beforeEach(async () => {
      await serverDB.insert(agents).values({
        avatar: 'avatar-url',
        backgroundColor: '#ff0000',
        description: 'Test description',
        slug: 'test-agent',
        tags: ['tag1', 'tag2'],
        title: 'Test Agent',
        userId,
      });

      await serverDB.insert(topics).values({
        content: 'Test content',
        favorite: true,
        title: 'Test Topic',
        userId,
      });

      await serverDB.insert(files).values({
        fileType: 'text/plain',
        name: 'test.txt',
        size: 100,
        url: 'file://test.txt',
        userId,
      });
    });

    it('should return correct agent result structure', async () => {
      const results = await searchRepo.search({ query: 'test', type: 'agent' });

      expect(results.length).toBeGreaterThan(0);
      const agent = results[0];

      expect(agent.type).toBe('agent');
      expect(agent.id).toBeDefined();
      expect(agent.title).toBeDefined();
      expect(agent.relevance).toBeGreaterThan(0);
      expect(agent.createdAt).toBeInstanceOf(Date);
      expect(agent.updatedAt).toBeInstanceOf(Date);

      if (agent.type === 'agent') {
        expect(agent.slug).toBeDefined();
        expect(agent.tags).toBeInstanceOf(Array);
      }
    });

    it('should return correct topic result structure', async () => {
      const results = await searchRepo.search({ query: 'test', type: 'topic' });

      expect(results.length).toBeGreaterThan(0);
      const topic = results[0];

      expect(topic.type).toBe('topic');
      expect(topic.id).toBeDefined();
      expect(topic.title).toBeDefined();
      expect(topic.relevance).toBeGreaterThan(0);
      expect(topic.createdAt).toBeInstanceOf(Date);
      expect(topic.updatedAt).toBeInstanceOf(Date);

      if (topic.type === 'topic') {
        expect(topic.favorite).toBeDefined();
      }
    });

    it('should return correct file result structure', async () => {
      const results = await searchRepo.search({ query: 'test', type: 'file' });

      expect(results.length).toBeGreaterThan(0);
      const file = results[0];

      expect(file.type).toBe('file');
      expect(file.id).toBeDefined();
      expect(file.title).toBeDefined();
      expect(file.relevance).toBeGreaterThan(0);
      expect(file.createdAt).toBeInstanceOf(Date);
      expect(file.updatedAt).toBeInstanceOf(Date);

      if (file.type === 'file') {
        expect(file.name).toBeDefined();
        expect(file.fileType).toBeDefined();
        expect(file.size).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('search - agent context awareness', () => {
    let testAgentId: string;
    let otherAgentId: string;

    beforeEach(async () => {
      // Create test agents
      const [agent1, agent2] = await serverDB
        .insert(agents)
        .values([
          {
            slug: 'test-agent',
            title: 'Test Agent',
            userId,
          },
          {
            slug: 'other-agent',
            title: 'Other Agent',
            userId,
          },
        ])
        .returning();

      testAgentId = agent1.id;
      otherAgentId = agent2.id;

      // Create topics for test agent
      await serverDB.insert(topics).values([
        {
          agentId: testAgentId,
          title: 'React Testing Guide',
          userId,
        },
        {
          agentId: testAgentId,
          title: 'Testing Best Practices',
          userId,
        },
      ]);

      // Create topics for other agent
      await serverDB.insert(topics).values([
        {
          agentId: otherAgentId,
          title: 'Testing Strategies',
          userId,
        },
      ]);

      // Create topic without agent
      await serverDB.insert(topics).values([
        {
          agentId: null,
          title: 'General Testing Tips',
          userId,
        },
      ]);
    });

    it('should boost current agent topics in relevance', async () => {
      const results = await searchRepo.search({
        agentId: testAgentId,
        query: 'testing',
      });

      const topicResults = results.filter((r) => r.type === 'topic');

      // Current agent's topics should have better relevance (0.5-0.7)
      const currentAgentTopics = topicResults.filter(
        (t) => t.type === 'topic' && t.agentId === testAgentId,
      );
      const otherTopics = topicResults.filter(
        (t) => t.type === 'topic' && t.agentId !== testAgentId,
      );

      expect(currentAgentTopics.length).toBeGreaterThan(0);
      expect(otherTopics.length).toBeGreaterThan(0);

      // Current agent topics should have lower relevance scores (higher priority)
      currentAgentTopics.forEach((topic) => {
        expect(topic.relevance).toBeLessThan(1);
      });

      otherTopics.forEach((topic) => {
        expect(topic.relevance).toBeGreaterThanOrEqual(1);
      });
    });

    it('should show all user topics but rank current agent topics first', async () => {
      const results = await searchRepo.search({
        agentId: testAgentId,
        query: 'testing',
      });

      const topicResults = results.filter((r) => r.type === 'topic');

      // Should include topics from all agents (current, other, and no agent)
      const agentIds = new Set(topicResults.map((t) => (t.type === 'topic' ? t.agentId : null)));
      expect(agentIds.has(testAgentId)).toBe(true);
      expect(agentIds.has(otherAgentId)).toBe(true);
      expect(agentIds.has(null)).toBe(true);

      // First results should be from current agent
      expect(topicResults[0].type).toBe('topic');
      if (topicResults[0].type === 'topic') {
        expect(topicResults[0].agentId).toBe(testAgentId);
      }
    });

    it('should return 6 topics in agent context', async () => {
      // Create additional topics to test limit
      await serverDB.insert(topics).values(
        Array.from({ length: 12 }, (_, i) => ({
          agentId: i < 6 ? testAgentId : otherAgentId,
          title: `Test Topic ${i}`,
          userId,
        })),
      );

      const results = await searchRepo.search({
        agentId: testAgentId,
        query: 'test',
      });

      const topicResults = results.filter((r) => r.type === 'topic');
      expect(topicResults.length).toBe(6);
    });

    it('should return 3 agents and 3 files in agent context', async () => {
      // Create test agents
      await serverDB.insert(agents).values(
        Array.from({ length: 5 }, (_, i) => ({
          slug: `agent-${i}`,
          title: `Test Agent ${i}`,
          userId,
        })),
      );

      // Create test files
      await serverDB.insert(files).values(
        Array.from({ length: 5 }, (_, i) => ({
          fileType: 'text/plain',
          name: `test-file-${i}.txt`,
          size: 100,
          url: `file://test-file-${i}.txt`,
          userId,
        })),
      );

      const results = await searchRepo.search({
        agentId: testAgentId,
        query: 'test',
      });

      const agentResults = results.filter((r) => r.type === 'agent');
      const fileResults = results.filter((r) => r.type === 'file');

      expect(agentResults.length).toBeLessThanOrEqual(3);
      expect(fileResults.length).toBeLessThanOrEqual(3);
    });

    it('should use normal limits without agent context', async () => {
      const results = await searchRepo.search({
        query: 'testing',
      });

      const topicResults = results.filter((r) => r.type === 'topic');

      // Should use default limit of 3 per type
      expect(topicResults.length).toBeLessThanOrEqual(3);
    });

    it('should not boost topics when agentId is not provided', async () => {
      const results = await searchRepo.search({
        query: 'testing',
      });

      const topicResults = results.filter((r) => r.type === 'topic');

      // All topics should have normal relevance (1-3)
      topicResults.forEach((topic) => {
        expect(topic.relevance).toBeGreaterThanOrEqual(1);
        expect(topic.relevance).toBeLessThanOrEqual(3);
      });
    });
  });

  describe('search - folder search', () => {
    beforeEach(async () => {
      // Create test folders (documents with file_type='custom/folder')
      await serverDB.insert(documents).values([
        {
          description: 'My project files',
          fileType: 'custom/folder',
          filename: 'project-folder',
          slug: 'project-folder-slug',
          source: 'internal://folder-1',
          sourceType: 'file',
          title: 'Project Documents',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        },
        {
          description: 'Archive folder for old files',
          fileType: 'custom/folder',
          filename: 'archive',
          slug: 'archive-slug',
          source: 'internal://folder-2',
          sourceType: 'file',
          title: 'Archive Folder',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        },
      ]);
    });

    it('should find folders by title', async () => {
      const results = await searchRepo.search({ query: 'Project', type: 'folder' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.type).toBe('folder');
      });
    });

    it('should find folders by description', async () => {
      const results = await searchRepo.search({ query: 'archive', type: 'folder' });

      expect(results.length).toBeGreaterThan(0);
      const folder = results[0];
      if (folder.type === 'folder') {
        expect(folder.title.toLowerCase()).toContain('archive');
      }
    });

    it('should return correct folder structure', async () => {
      const results = await searchRepo.search({ query: 'project', type: 'folder' });

      expect(results.length).toBeGreaterThan(0);
      const folder = results[0];

      expect(folder.type).toBe('folder');
      expect(folder.id).toBeDefined();
      expect(folder.title).toBeDefined();
      expect(folder.relevance).toBeGreaterThan(0);
      expect(folder.createdAt).toBeInstanceOf(Date);
      expect(folder.updatedAt).toBeInstanceOf(Date);

      if (folder.type === 'folder') {
        expect(folder.slug).toBeDefined();
      }
    });
  });

  describe('search - page search', () => {
    beforeEach(async () => {
      // Create test pages (documents with file_type='custom/document')
      await serverDB.insert(documents).values([
        {
          content: 'This is the content of my notes page',
          fileType: 'custom/document',
          filename: 'my-notes.md',
          source: 'internal://page-1',
          sourceType: 'file',
          title: 'My Notes Page',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
        },
        {
          content: 'Documentation for the project',
          fileType: 'custom/document',
          filename: 'readme.md',
          source: 'internal://page-2',
          sourceType: 'file',
          title: 'Project README',
          totalCharCount: 200,
          totalLineCount: 20,
          userId,
        },
      ]);
    });

    it('should find pages by title', async () => {
      const results = await searchRepo.search({ query: 'Notes', type: 'page' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.type).toBe('page');
      });
    });

    it('should find pages by filename', async () => {
      const results = await searchRepo.search({ query: 'readme', type: 'page' });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].type).toBe('page');
    });

    it('should return correct page structure', async () => {
      const results = await searchRepo.search({ query: 'notes', type: 'page' });

      expect(results.length).toBeGreaterThan(0);
      const page = results[0];

      expect(page.type).toBe('page');
      expect(page.id).toBeDefined();
      expect(page.title).toBeDefined();
      expect(page.relevance).toBeGreaterThan(0);
      expect(page.createdAt).toBeInstanceOf(Date);
      expect(page.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('search - context types', () => {
    beforeEach(async () => {
      // Create test data for context testing
      await serverDB.insert(agents).values(
        Array.from({ length: 5 }, (_, i) => ({
          slug: `ctx-agent-${i}`,
          title: `Context Test Agent ${i}`,
          userId,
        })),
      );

      await serverDB.insert(topics).values(
        Array.from({ length: 5 }, (_, i) => ({
          title: `Context Test Topic ${i}`,
          userId,
        })),
      );

      await serverDB.insert(files).values(
        Array.from({ length: 8 }, (_, i) => ({
          fileType: 'text/plain',
          name: `context-test-file-${i}.txt`,
          size: 100,
          url: `file://context-test-file-${i}.txt`,
          userId,
        })),
      );

      await serverDB.insert(documents).values([
        ...Array.from({ length: 8 }, (_, i) => ({
          fileType: 'custom/folder',
          filename: `context-test-folder-${i}`,
          source: `internal://ctx-folder-${i}`,
          sourceType: 'file' as const,
          title: `Context Test Folder ${i}`,
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          fileType: 'custom/document',
          filename: `context-test-page-${i}.md`,
          source: `internal://ctx-page-${i}`,
          sourceType: 'file' as const,
          title: `Context Test Page ${i}`,
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
        })),
      ]);
    });

    it('should expand pages to 6 in page context', async () => {
      const results = await searchRepo.search({
        contextType: 'page',
        query: 'context test',
      });

      const pageResults = results.filter((r) => r.type === 'page');
      expect(pageResults.length).toBe(6);
    });

    it('should limit other types to 3 in page context', async () => {
      const results = await searchRepo.search({
        contextType: 'page',
        query: 'context test',
      });

      const agentResults = results.filter((r) => r.type === 'agent');
      const topicResults = results.filter((r) => r.type === 'topic');
      const fileResults = results.filter((r) => r.type === 'file');
      const folderResults = results.filter((r) => r.type === 'folder');

      expect(agentResults.length).toBeLessThanOrEqual(3);
      expect(topicResults.length).toBeLessThanOrEqual(3);
      expect(fileResults.length).toBeLessThanOrEqual(3);
      expect(folderResults.length).toBeLessThanOrEqual(3);
    });

    it('should expand files and folders to 6 in resource context', async () => {
      const results = await searchRepo.search({
        contextType: 'resource',
        query: 'context-test',
      });

      const fileResults = results.filter((r) => r.type === 'file');
      const folderResults = results.filter((r) => r.type === 'folder');

      expect(fileResults.length).toBe(6);
      expect(folderResults.length).toBe(6);
    });

    it('should limit other types to 3 in resource context', async () => {
      const results = await searchRepo.search({
        contextType: 'resource',
        query: 'context test',
      });

      const agentResults = results.filter((r) => r.type === 'agent');
      const topicResults = results.filter((r) => r.type === 'topic');
      const pageResults = results.filter((r) => r.type === 'page');

      expect(agentResults.length).toBeLessThanOrEqual(3);
      expect(topicResults.length).toBeLessThanOrEqual(3);
      expect(pageResults.length).toBeLessThanOrEqual(3);
    });

    it('should use agent context limits with contextType=agent', async () => {
      const results = await searchRepo.search({
        contextType: 'agent',
        query: 'context test',
      });

      const topicResults = results.filter((r) => r.type === 'topic');
      expect(topicResults.length).toBeLessThanOrEqual(6);

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults.length).toBeLessThanOrEqual(3);
    });
  });

  describe('search - message search', () => {
    beforeEach(async () => {
      // Create test messages with different roles
      await serverDB.insert(messages).values([
        {
          content: 'Hello, I need help with React hooks',
          role: 'user',
          userId,
        },
        {
          content: 'Sure, I can help you with React hooks and state management',
          role: 'assistant',
          userId,
        },
        {
          content: 'Tool call result for React documentation lookup',
          role: 'tool',
          userId,
        },
        {
          content: 'Another tool message about hooks',
          role: 'tool',
          userId,
        },
      ]);
    });

    it('should find messages by content', async () => {
      const results = await searchRepo.search({ query: 'React hooks', type: 'message' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.type).toBe('message');
      });
    });

    it('should filter out messages with role=tool', async () => {
      const results = await searchRepo.search({ query: 'tool', type: 'message' });

      // Should not find any tool messages even though they contain "tool" in content
      const toolMessages = results.filter((r) => r.type === 'message' && r.role === 'tool');
      expect(toolMessages.length).toBe(0);
    });

    it('should return user and assistant messages but not tool messages', async () => {
      const results = await searchRepo.search({ query: 'hooks' });

      const messageResults = results.filter((r) => r.type === 'message');

      // Should find user and assistant messages
      expect(messageResults.length).toBeGreaterThan(0);

      // Verify all returned messages are not tool messages
      messageResults.forEach((msg) => {
        if (msg.type === 'message') {
          expect(msg.role).not.toBe('tool');
        }
      });
    });

    it('should return correct message structure', async () => {
      const results = await searchRepo.search({ query: 'help', type: 'message' });

      expect(results.length).toBeGreaterThan(0);
      const message = results[0];

      expect(message.type).toBe('message');
      expect(message.id).toBeDefined();
      expect(message.title).toBeDefined();
      expect(message.relevance).toBeGreaterThan(0);
      expect(message.createdAt).toBeInstanceOf(Date);
      expect(message.updatedAt).toBeInstanceOf(Date);

      if (message.type === 'message') {
        expect(message.content).toBeDefined();
        expect(message.role).toBeDefined();
        expect(['user', 'assistant']).toContain(message.role);
      }
    });
  });
});
