// @vitest-environment node
import { eq } from 'drizzle-orm';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { Pool as NodePool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import * as schema from '../../schemas';
import { chatGroups, documents, workspaces } from '../../schemas';
import type { NewAgent } from '../../schemas/agent';
import { agents } from '../../schemas/agent';
import type { NewFile } from '../../schemas/file';
import {
  DOCUMENT_FOLDER_TYPE,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
} from '../../schemas/file';
import { messages } from '../../schemas/message';
import type { NewTopic } from '../../schemas/topic';
import { topics } from '../../schemas/topic';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import type { SearchResult } from './index';
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

// BM25 search requires pg_search extension (ParadeDB), not available in PGlite
const isServerDB = process.env.TEST_SERVER_DB === '1';

/**
 * Result types produced by the eight search methods whose BM25 scan was split
 * into an inner subquery. `memory` is absent on purpose — `searchMemories` is
 * user-scoped with no join, so it was left on its original single-level shape.
 */
const REWRITTEN_RESULT_TYPES = [
  'agent',
  'chatGroup',
  'file',
  'folder',
  'knowledgeBase',
  'message',
  'page',
  'topic',
] as const;

/** Subquery alias each rewritten method gives its isolated BM25 scan. */
const SCAN_ALIASES = [
  'agent_hits',
  'chat_group_hits',
  'file_hits',
  'folder_hits',
  'knowledge_base_hits',
  'message_hits',
  'page_hits',
  'topic_hits',
];

describe.skipIf(!isServerDB)('SearchRepo', () => {
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

    // Note: ICU tokenizer treats "react-component.jsx" as a single token,
    // so we search by prefix "react" which matches via BM25
    it('should find files by name', async () => {
      const results = await searchRepo.search({ query: 'react' });

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

    it('should assign relevance values in valid range', async () => {
      const results = await searchRepo.search({ query: 'test' });

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults.length).toBe(3);

      // All relevance values should be in [1, 3] range
      for (const result of agentResults) {
        expect(result.relevance).toBeGreaterThanOrEqual(1);
        expect(result.relevance).toBeLessThanOrEqual(3);
      }
    });

    it('should rank results by BM25 relevance (lower = better)', async () => {
      const results = await searchRepo.search({ query: 'test' });

      const agentResults = results.filter((r) => r.type === 'agent');
      expect(agentResults.length).toBe(3);

      // Best match should have lowest relevance value
      expect(agentResults[0].relevance).toBeLessThanOrEqual(agentResults[1].relevance);
      expect(agentResults[1].relevance).toBeLessThanOrEqual(agentResults[2].relevance);
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
        name: 'test report',
        size: 100,
        url: 'file://test-report',
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

    it('should only return topics of the current agent when agentId is provided', async () => {
      const results = await searchRepo.search({
        agentId: testAgentId,
        query: 'testing',
      });

      const topicResults = results.filter((r) => r.type === 'topic');

      expect(topicResults.length).toBeGreaterThan(0);
      topicResults.forEach((topic) => {
        if (topic.type === 'topic') {
          expect(topic.agentId).toBe(testAgentId);
        }
      });
    });

    it('should include topics from all agents when agentId is not provided', async () => {
      const results = await searchRepo.search({
        query: 'testing',
      });

      const topicResults = results.filter((r) => r.type === 'topic');
      const agentIds = new Set(topicResults.map((t) => (t.type === 'topic' ? t.agentId : null)));

      expect(agentIds.has(testAgentId)).toBe(true);
      expect(agentIds.has(otherAgentId)).toBe(true);
    });

    it('should populate agent metadata on topic results', async () => {
      // Add avatar/background to an existing agent so we can assert join output
      const [decoratedAgent] = await serverDB
        .insert(agents)
        .values({
          avatar: '🤖',
          backgroundColor: '#123456',
          slug: 'decorated-agent',
          title: 'Decorated Agent',
          userId,
        })
        .returning();

      await serverDB.insert(topics).values({
        agentId: decoratedAgent.id,
        title: 'Testing Decorated Agent',
        userId,
      });

      const results = await searchRepo.search({ query: 'decorated' });
      const topicResults = results.filter((r) => r.type === 'topic');
      const decoratedTopic = topicResults.find(
        (t) => t.type === 'topic' && t.agentId === decoratedAgent.id,
      );

      expect(decoratedTopic).toBeDefined();
      if (decoratedTopic && decoratedTopic.type === 'topic') {
        expect(decoratedTopic.agent).toEqual({
          avatar: '🤖',
          backgroundColor: '#123456',
          title: 'Decorated Agent',
        });
      }

      // Topic without an agent should have a null agent field
      const orphanTopic = topicResults.find((t) => t.type === 'topic' && t.agentId === null);
      if (orphanTopic && orphanTopic.type === 'topic') {
        expect(orphanTopic.agent).toBeNull();
      }
    });

    it('should not leak agent metadata when topic.agentId points to another user', async () => {
      // Foreign agent owned by a different user
      const [foreignAgent] = await serverDB
        .insert(agents)
        .values({
          avatar: '🕵️',
          backgroundColor: '#abcdef',
          slug: 'foreign-agent',
          title: 'Foreign Agent',
          userId: otherUserId,
        })
        .returning();

      // Topic owned by the current user but carrying the foreign agent id —
      // simulates state reachable via crafted/migrated rows (e.g. topic
      // creation persists input.agentId even when resolveContext fails).
      await serverDB.insert(topics).values({
        agentId: foreignAgent.id,
        title: 'Cross-tenant probe',
        userId,
      });

      const results = await searchRepo.search({ query: 'cross-tenant' });
      const topicResults = results.filter((r) => r.type === 'topic');
      const probeTopic = topicResults.find(
        (t) => t.type === 'topic' && t.title === 'Cross-tenant probe',
      );

      expect(probeTopic).toBeDefined();
      if (probeTopic && probeTopic.type === 'topic') {
        // The raw agentId is preserved (used for navigation), but no
        // foreign agent metadata is surfaced to the renderer.
        expect(probeTopic.agentId).toBe(foreignAgent.id);
        expect(probeTopic.agent).toBeNull();
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

    it('should return topics with normal relevance range (1-3) when agentId is not provided', async () => {
      const results = await searchRepo.search({
        query: 'testing',
      });

      const topicResults = results.filter((r) => r.type === 'topic');

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

  describe('searchKnowledgeBaseDocuments', () => {
    const kbA = 'kb-search-a';
    const kbB = 'kb-search-b';

    beforeEach(async () => {
      // Create two KBs for the test user + one for the other user
      await serverDB.insert(knowledgeBases).values([
        { id: kbA, name: 'Knowledge Base A', userId },
        { id: kbB, name: 'Knowledge Base B', userId },
        { id: 'kb-other-1', name: 'Other User KB', userId: otherUserId },
      ]);

      // Documents in KB-A
      await serverDB.insert(documents).values([
        {
          content:
            'Machine learning algorithms can be supervised, unsupervised, or reinforcement-based. ' +
            'Common supervised methods include linear regression, decision trees, and neural networks.',
          fileType: 'custom/document',
          filename: 'ml-overview.md',
          knowledgeBaseId: kbA,
          source: 'internal://document/placeholder',
          sourceType: 'api',
          title: 'Machine Learning Overview',
          totalCharCount: 200,
          totalLineCount: 5,
          userId,
        },
        {
          content: 'Documentation about cooking — completely unrelated topic.',
          fileType: 'custom/document',
          filename: 'cooking.md',
          knowledgeBaseId: kbA,
          source: 'internal://document/placeholder',
          sourceType: 'api',
          title: 'Cooking Notes',
          totalCharCount: 50,
          totalLineCount: 2,
          userId,
        },
        // Document in KB-B (must NOT be returned when searching KB-A)
        {
          content:
            'This document is in a different knowledge base and should not match KB-A scope.',
          fileType: 'custom/document',
          filename: 'ml-other-kb.md',
          knowledgeBaseId: kbB,
          source: 'internal://document/placeholder',
          sourceType: 'api',
          title: 'Machine Learning in KB-B',
          totalCharCount: 100,
          totalLineCount: 3,
          userId,
        },
        // Document for other user (cross-user isolation check)
        {
          content: 'Machine learning notes from another user.',
          fileType: 'custom/document',
          filename: 'ml-other-user.md',
          knowledgeBaseId: 'kb-other-1',
          source: 'internal://document/placeholder',
          sourceType: 'api',
          title: 'Other user ML notes',
          totalCharCount: 50,
          totalLineCount: 2,
          userId: otherUserId,
        },
      ]);
    });

    it('should return [] for empty query', async () => {
      const results = await searchRepo.searchKnowledgeBaseDocuments('', [kbA]);
      expect(results).toEqual([]);
    });

    it('should return [] when no knowledgeBaseIds provided', async () => {
      const results = await searchRepo.searchKnowledgeBaseDocuments('machine learning', []);
      expect(results).toEqual([]);
    });

    it('should match documents within KB scope by content', async () => {
      const results = await searchRepo.searchKnowledgeBaseDocuments('machine learning', [kbA]);
      expect(results.length).toBeGreaterThan(0);
      // Should hit ML overview, not cooking
      expect(results.some((r) => r.title === 'Machine Learning Overview')).toBe(true);
      expect(results.every((r) => r.knowledgeBaseId === kbA)).toBe(true);
    });

    it('should respect KB scope (KB-A query does not return KB-B docs)', async () => {
      const results = await searchRepo.searchKnowledgeBaseDocuments('machine learning', [kbA]);
      expect(results.every((r) => r.title !== 'Machine Learning in KB-B')).toBe(true);
    });

    it('should isolate across users', async () => {
      // Searching with otherUserId's KB should not leak to current user
      const results = await searchRepo.searchKnowledgeBaseDocuments('machine learning', [
        'kb-other-1',
      ]);
      // Current user (`userId`) does not own kb-other-1, so query against it returns []
      expect(results).toEqual([]);
    });

    it('should produce snippet ≤ 300 characters', async () => {
      const results = await searchRepo.searchKnowledgeBaseDocuments('machine learning', [kbA]);
      results.forEach((r) => {
        expect(r.snippet.length).toBeLessThanOrEqual(303); // 300 + '...' suffix
      });
    });

    it('should produce relevance in [1, 3] range', async () => {
      const results = await searchRepo.searchKnowledgeBaseDocuments('machine learning', [kbA]);
      results.forEach((r) => {
        expect(r.relevance).toBeGreaterThanOrEqual(1);
        expect(r.relevance).toBeLessThanOrEqual(3);
      });
    });

    describe('file-backed documents (PDF / parsed files)', () => {
      const pdfFileId = 'file-bm25-pdf-1';
      const pdfDocId = 'docs-bm25-pdf-1';
      const folderDocId = 'docs-bm25-folder-1';
      const otherUserFileId = 'file-bm25-other-1';
      const otherUserDocId = 'docs-bm25-other-1';

      beforeEach(async () => {
        await serverDB.insert(files).values([
          {
            fileType: 'application/pdf',
            id: pdfFileId,
            name: 'transformers-paper.pdf',
            size: 2048,
            url: 's3://bucket/transformers-paper.pdf',
            userId,
          },
          {
            fileType: 'application/pdf',
            id: otherUserFileId,
            name: 'leak-check.pdf',
            size: 2048,
            url: 's3://bucket/leak-check.pdf',
            userId: otherUserId,
          },
        ]);

        await serverDB.insert(knowledgeBaseFiles).values([
          { fileId: pdfFileId, knowledgeBaseId: kbA, userId },
          { fileId: otherUserFileId, knowledgeBaseId: 'kb-other-1', userId: otherUserId },
        ]);

        await serverDB.insert(documents).values([
          {
            content:
              'Attention is all you need. The Transformer architecture relies on self-attention ' +
              'and replaces recurrence with parallel multi-head attention layers.',
            fileId: pdfFileId,
            fileType: 'application/pdf',
            filename: 'transformers-paper.pdf',
            id: pdfDocId,
            source: 's3://bucket/transformers-paper.pdf',
            sourceType: 'file',
            title: 'Attention Is All You Need',
            totalCharCount: 200,
            totalLineCount: 5,
            userId,
          },
          {
            content: '',
            fileType: 'custom/folder',
            filename: 'a folder',
            id: folderDocId,
            knowledgeBaseId: kbA,
            source: 'internal://folder/placeholder',
            sourceType: 'api',
            title: 'Transformer Folder',
            totalCharCount: 0,
            totalLineCount: 0,
            userId,
          },
          {
            content:
              'Attention paper in another user knowledge base — must never surface for current user.',
            fileId: otherUserFileId,
            fileType: 'application/pdf',
            filename: 'leak-check.pdf',
            id: otherUserDocId,
            source: 's3://bucket/leak-check.pdf',
            sourceType: 'file',
            title: 'Attention Leak Check',
            totalCharCount: 100,
            totalLineCount: 3,
            userId: otherUserId,
          },
        ]);
      });

      it('returns a PDF-backed document hit via knowledge_base_files join', async () => {
        const results = await searchRepo.searchKnowledgeBaseDocuments('attention transformer', [
          kbA,
        ]);
        const pdfHit = results.find((r) => r.documentId === pdfDocId);
        expect(pdfHit).toBeDefined();
        expect(pdfHit?.knowledgeBaseId).toBe(kbA);
        expect(pdfHit?.fileId).toBe(pdfFileId);
        expect(pdfHit?.title).toBe('Attention Is All You Need');
      });

      it('still matches inline custom/document hits in the same call', async () => {
        await serverDB.insert(documents).values({
          content: 'Attention transformer notes written inline for KB-A',
          fileType: 'custom/document',
          filename: 'inline-notes.md',
          knowledgeBaseId: kbA,
          source: 'internal://document/placeholder',
          sourceType: 'api',
          title: 'Inline Attention Notes',
          totalCharCount: 60,
          totalLineCount: 2,
          userId,
        });

        const results = await searchRepo.searchKnowledgeBaseDocuments('attention', [kbA]);
        expect(results.some((r) => r.title === 'Inline Attention Notes')).toBe(true);
        expect(results.some((r) => r.documentId === pdfDocId)).toBe(true);
      });

      it('excludes folder documents even when they match the query', async () => {
        const results = await searchRepo.searchKnowledgeBaseDocuments('transformer folder', [kbA]);
        expect(results.every((r) => r.documentId !== folderDocId)).toBe(true);
      });

      it('does not surface another user PDF when querying their KB', async () => {
        const results = await searchRepo.searchKnowledgeBaseDocuments('attention', ['kb-other-1']);
        expect(results).toEqual([]);
      });
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

  // Regression guard: the BM25 scans were split into an inner
  // single-table subquery (so ParadeDB can pick its TopN custom scan) with the
  // joins and — in personal mode — the `workspace_id IS NULL` check moved above
  // it. These tests pin the two things that split could break: rows leaking
  // across the personal/workspace boundary, and enrichment lost with the joins.
  describe('search - workspace scoping', () => {
    const workspaceId = 'search-test-workspace';
    let workspaceAgentId: string;
    let personalAgentId: string;

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Search Test Workspace',
        primaryOwnerId: userId,
        slug: 'search-test-workspace',
      });

      const insertedAgents = await serverDB
        .insert(agents)
        .values([
          { title: 'Kubernetes Personal Agent', userId, workspaceId: null },
          { title: 'Kubernetes Workspace Agent', userId, workspaceId },
        ])
        .returning({ id: agents.id, workspaceId: agents.workspaceId });

      personalAgentId = insertedAgents.find((a) => !a.workspaceId)!.id;
      workspaceAgentId = insertedAgents.find((a) => a.workspaceId)!.id;

      await serverDB.insert(topics).values([
        { agentId: personalAgentId, title: 'Kubernetes personal topic', userId, workspaceId: null },
        { agentId: workspaceAgentId, title: 'Kubernetes workspace topic', userId, workspaceId },
      ]);

      await serverDB.insert(messages).values([
        {
          agentId: personalAgentId,
          content: 'Kubernetes personal message',
          role: 'user',
          userId,
          workspaceId: null,
        },
        {
          agentId: workspaceAgentId,
          content: 'Kubernetes workspace message',
          role: 'user',
          userId,
          workspaceId,
        },
      ]);

      await serverDB.insert(files).values([
        {
          fileType: 'text/plain',
          name: 'kubernetes-personal.txt',
          size: 10,
          url: 'file://kubernetes-personal.txt',
          userId,
          workspaceId: null,
        },
        {
          fileType: 'text/plain',
          name: 'kubernetes-workspace.txt',
          size: 10,
          url: 'file://kubernetes-workspace.txt',
          userId,
          workspaceId,
        },
      ]);

      await serverDB.insert(documents).values([
        {
          content: 'Kubernetes personal page body',
          fileType: 'custom/document',
          filename: 'kubernetes-personal-page',
          source: 'internal://ws-page-1',
          sourceType: 'file',
          title: 'Kubernetes personal page',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          workspaceId: null,
        },
        {
          content: 'Kubernetes workspace page body',
          fileType: 'custom/document',
          filename: 'kubernetes-workspace-page',
          source: 'internal://ws-page-2',
          sourceType: 'file',
          title: 'Kubernetes workspace page',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          workspaceId,
        },
        {
          fileType: DOCUMENT_FOLDER_TYPE,
          filename: 'kubernetes-personal-folder',
          source: 'internal://ws-folder-1',
          sourceType: 'file',
          title: 'Kubernetes personal folder',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          workspaceId: null,
        },
        {
          fileType: DOCUMENT_FOLDER_TYPE,
          filename: 'kubernetes-workspace-folder',
          source: 'internal://ws-folder-2',
          sourceType: 'file',
          title: 'Kubernetes workspace folder',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
          workspaceId,
        },
      ]);

      await serverDB.insert(chatGroups).values([
        { title: 'Kubernetes personal group', userId, workspaceId: null },
        { title: 'Kubernetes workspace group', userId, workspaceId },
      ]);

      await serverDB.insert(knowledgeBases).values([
        { name: 'Kubernetes personal base', userId, workspaceId: null },
        { name: 'Kubernetes workspace base', userId, workspaceId },
      ]);
    });

    /**
     * Every fixture titles itself after the scope it belongs to, so asserting
     * that each hit *is* from the expected scope catches a leak whatever its
     * title says — stricter than asserting the other scope's word is absent,
     * which a differently-worded row could slip past. Case is normalised
     * because the fixtures are not consistently cased.
     */
    const expectEveryHitScopedTo = (results: SearchResult[], scope: 'personal' | 'workspace') => {
      expect(results.length).toBeGreaterThan(0);

      const foreign = results.filter((r) => !r.title.toLowerCase().includes(scope));
      expect(foreign.map((r) => `${r.type}: ${r.title}`)).toEqual([]);

      // every rewritten search method is represented
      expect(new Set(results.map((r) => r.type))).toEqual(new Set(REWRITTEN_RESULT_TYPES));
    };

    it('should never surface workspace-scoped rows in personal mode', async () => {
      const results = await new SearchRepo(serverDB, userId).search({ query: 'Kubernetes' });

      expectEveryHitScopedTo(results, 'personal');
    });

    it('should never surface personal rows in workspace mode', async () => {
      const results = await new SearchRepo(serverDB, userId, workspaceId).search({
        query: 'Kubernetes',
      });

      expectEveryHitScopedTo(results, 'workspace');
    });

    it('keeps agent-scoped search exact in workspace mode', async () => {
      const results = await new SearchRepo(serverDB, userId, workspaceId).search({
        agentId: workspaceAgentId,
        query: 'Kubernetes',
      });

      const scoped = results.filter((r) => r.type === 'topic' || r.type === 'message');
      expect(scoped.length).toBeGreaterThan(0);
      for (const r of scoped) {
        if (r.type === 'topic' || r.type === 'message') expect(r.agentId).toBe(workspaceAgentId);
      }
    });

    it('should keep joined agent metadata on topics and messages after the scan split', async () => {
      const results = await new SearchRepo(serverDB, userId).search({ query: 'Kubernetes' });

      const topic = results.find((r) => r.type === 'topic');
      expect(topic).toBeDefined();
      if (topic?.type === 'topic') {
        expect(topic.agentId).toBe(personalAgentId);
        expect(topic.agent?.title).toBe('Kubernetes Personal Agent');
      }

      const message = results.find((r) => r.type === 'message');
      expect(message).toBeDefined();
      if (message?.type === 'message') {
        expect(message.agentId).toBe(personalAgentId);
        // messages render the owning agent's title as their subtitle
        expect(message.description).toBe('Kubernetes Personal Agent');
      }
    });

    it('should keep knowledgeBaseId on files after the scan split', async () => {
      const [file] = await serverDB
        .select({ id: files.id })
        .from(files)
        .where(eq(files.name, 'kubernetes-personal.txt'));
      const [base] = await serverDB
        .select({ id: knowledgeBases.id })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.name, 'Kubernetes personal base'));

      await serverDB
        .insert(knowledgeBaseFiles)
        .values({ fileId: file.id, knowledgeBaseId: base.id, userId });

      const results = await new SearchRepo(serverDB, userId).search({
        query: 'kubernetes',
        type: 'file',
      });

      const hit = results.find((r) => r.type === 'file' && r.id === file.id);
      expect(hit).toBeDefined();
      if (hit?.type === 'file') expect(hit.knowledgeBaseId).toBe(base.id);
    });
  });
  // Regression guard: the agent filter on topics/messages moved
  // from inside the BM25 scan to above it (over-fetching through a deep
  // candidate pool). These tests pin the result semantics that move could
  // break: rows leaking across agents, and the filter being lost entirely.
  describe('search - agent scoping', () => {
    let agentAId: string;
    let agentBId: string;

    beforeEach(async () => {
      const insertedAgents = await serverDB
        .insert(agents)
        .values([
          { title: 'Terraform Agent A', userId },
          { title: 'Terraform Agent B', userId },
        ])
        .returning({ id: agents.id, title: agents.title });

      agentAId = insertedAgents.find((a) => a.title === 'Terraform Agent A')!.id;
      agentBId = insertedAgents.find((a) => a.title === 'Terraform Agent B')!.id;

      await serverDB.insert(topics).values([
        { agentId: agentAId, title: 'Terraform topic from agent A', userId },
        { agentId: agentBId, title: 'Terraform topic from agent B', userId },
        { title: 'Terraform topic without agent', userId },
      ]);

      await serverDB.insert(messages).values([
        { agentId: agentAId, content: 'Terraform message from agent A', role: 'user', userId },
        { agentId: agentBId, content: 'Terraform message from agent B', role: 'user', userId },
        { content: 'Terraform message without agent', role: 'user', userId },
      ]);
    });

    it('should only surface the requested agent rows in topics and messages', async () => {
      const results = await searchRepo.search({ agentId: agentAId, query: 'Terraform' });

      const scoped = results.filter((r) => r.type === 'topic' || r.type === 'message');
      expect(scoped.length).toBeGreaterThan(0);

      const foreign = scoped.filter(
        (r) => (r.type === 'topic' || r.type === 'message') && r.agentId !== agentAId,
      );
      expect(foreign.map((r) => `${r.type}: ${r.title}`)).toEqual([]);
    });

    it('should not leak rows between two agent-scoped searches', async () => {
      const [forA, forB] = await Promise.all([
        searchRepo.search({ agentId: agentAId, query: 'Terraform' }),
        searchRepo.search({ agentId: agentBId, query: 'Terraform' }),
      ]);

      const idsOf = (results: SearchResult[]) =>
        results.filter((r) => r.type === 'topic' || r.type === 'message').map((r) => r.id);

      expect(idsOf(forA)).toHaveLength(2);
      expect(idsOf(forB)).toHaveLength(2);
      expect(idsOf(forA).filter((id) => idsOf(forB).includes(id))).toEqual([]);
    });

    it('should keep agent-less rows reachable without an agent filter', async () => {
      const results = await searchRepo.search({ query: 'Terraform' });

      const scoped = results.filter((r) => r.type === 'topic' || r.type === 'message');
      const agentIds = new Set(
        scoped.map((r) => (r.type === 'topic' || r.type === 'message' ? r.agentId : null)),
      );
      expect(agentIds).toEqual(new Set([agentAId, agentBId, null]));
    });

    it('should keep joined agent metadata after the agent filter moved above the scan', async () => {
      const results = await searchRepo.search({ agentId: agentAId, query: 'Terraform' });

      const topic = results.find((r) => r.type === 'topic');
      expect(topic).toBeDefined();
      if (topic?.type === 'topic') expect(topic.agent?.title).toBe('Terraform Agent A');

      const message = results.find((r) => r.type === 'message');
      expect(message).toBeDefined();
      if (message?.type === 'message') expect(message.description).toBe('Terraform Agent A');
    });
  });

  // The workspace-scoping tests above pin *results*, and this change is
  // deliberately result-neutral — they pass against the pre-fix implementation
  // too. What actually fixes the regression is the *shape* of the emitted SQL, so
  // it needs its own guard: ParadeDB only picks `TopNScanExecState` when the
  // scan node itself carries the whole `ORDER BY paradedb.score() LIMIT n`.
  //
  // Asserting the plan directly is not an option in CI: the container runs a
  // newer pg_search than production, and its `heap_filter` keeps TopN even with
  // a non-indexed qual — the exact regression would be invisible. So we assert
  // the structural invariant that makes TopN reachable instead, which fails on
  // the pre-fix single-level query regardless of engine version.
  describe('search - BM25 scan shape', () => {
    let loggingPool: NodePool | undefined;

    afterAll(async () => {
      await loggingPool?.end();
    });

    interface CapturedStatement {
      params: unknown[];
      sql: string;
    }

    /** Runs a search against the test DB and returns every BM25 statement it emitted. */
    const captureScanSql = async (options?: {
      agentId?: string;
      workspaceId?: string;
    }): Promise<CapturedStatement[]> => {
      const captured: CapturedStatement[] = [];
      loggingPool ??= new NodePool({ connectionString: process.env.DATABASE_TEST_URL });
      const db = nodeDrizzle(loggingPool, {
        logger: {
          logQuery: (query: string, params: unknown[]) => captured.push({ params, sql: query }),
        },
        schema,
      });

      await new SearchRepo(db as unknown as LobeChatDatabase, userId, options?.workspaceId).search({
        agentId: options?.agentId,
        query: 'kubernetes',
      });

      return captured.filter(({ sql }) => sql.includes('@@@'));
    };

    /** Body of the first parenthesised subquery, i.e. the isolated BM25 scan. */
    const innerScanOf = (query: string): string | undefined => {
      const open = query.indexOf('from (');
      if (open === -1) return undefined;

      const start = open + 'from ('.length;
      let depth = 1;
      for (let i = start; i < query.length; i++) {
        if (query[i] === '(') depth++;
        else if (query[i] === ')' && --depth === 0) return query.slice(start, i);
      }
      return undefined;
    };

    /** Locates one method's statement and returns its isolated scan, failing loudly if absent. */
    const scanOf = (statements: CapturedStatement[], alias: string): string => {
      const statement = statements.find(({ sql }) => sql.includes(`"${alias}"`));
      expect(statement, `no statement produced the ${alias} subquery`).toBeDefined();

      const scan = innerScanOf(statement!.sql);
      expect(scan, `${alias}: BM25 scan is not isolated in a subquery`).toBeDefined();

      return scan!;
    };

    const whereClauseOf = (scan: string): string =>
      scan.slice(scan.indexOf(' where '), scan.indexOf(' order by '));

    it('gives every rewritten method a join-free single-table BM25 scan', async () => {
      const statements = await captureScanSql();

      // memories is the one BM25 search that was intentionally left unsplit
      expect(statements).toHaveLength(SCAN_ALIASES.length + 1);

      for (const alias of SCAN_ALIASES) {
        const scan = scanOf(statements, alias);

        // the scan node owns the whole ranking clause …
        expect(scan).toContain('@@@');
        expect(scan).toContain('order by paradedb.score');
        expect(scan).toContain('limit');

        // … and nothing sits between it and that clause
        expect(scan, `${alias}: a join moved back inside the BM25 scan`).not.toContain(' join ');
      }
    });

    it('keeps the non-indexed workspace filter above the scan in personal mode', async () => {
      const statements = await captureScanSql();

      for (const alias of SCAN_ALIASES) {
        const where = whereClauseOf(scanOf(statements, alias));

        // `workspace_id` is not a BM25 field, so a qual on it inside the scan
        // is what costs TopN. It is still selected as a column for the outer
        // filter — only the scan's predicate has to stay clear of it.
        expect(where, `${alias}: workspace qual moved back into the BM25 scan`).not.toContain(
          'workspace_id',
        );
        expect(where).toContain('user_id');

        // the filter must survive somewhere, or scoping would silently break
        const statement = statements.find(({ sql }) => sql.includes(`"${alias}"`))!;
        expect(statement.sql).toContain(`"${alias}"."workspace_id" is null`);
      }
    });

    it('keeps the ownership predicate exact and inline in workspace mode', async () => {
      const statements = await captureScanSql({
        agentId: 'agent-under-test',
        workspaceId: 'search-test-workspace',
      });

      for (const alias of SCAN_ALIASES) {
        const where = whereClauseOf(scanOf(statements, alias));

        // Workspace mode has no pushdown-able owner column, so over-fetching
        // would silently drop rows. It keeps the exact predicate instead and
        // stays on the slower plan until the column is indexed.
        expect(where, `${alias}: workspace mode must not lift its own filter`).toContain(
          'workspace_id',
        );
      }

      // With the workspace qual inline, paradedb.score() is NULL for the whole
      // statement (pg_search 0.15.26), so a score-ordered pool cut would be an
      // arbitrary slice. The agent filter must therefore stay inline too —
      // exact, on the already-degraded plan.
      for (const alias of ['message_hits', 'topic_hits']) {
        const where = whereClauseOf(scanOf(statements, alias));
        expect(where, `${alias}: workspace mode must keep the agent filter inline`).toContain(
          'agent_id',
        );
      }
    });

    // Guard: `agent_id` is not a BM25 field either — inside the
    // scan it costs TopN and, on production pg_search 0.15.26, NULLs out every
    // score (arbitrary order, flat relevance 3). The agent filter must sit
    // above the scan, backed by a deepened candidate pool.
    it('keeps the non-indexed agent filter above the scan in agent context', async () => {
      const statements = await captureScanSql({ agentId: 'agent-under-test' });

      for (const alias of ['message_hits', 'topic_hits']) {
        const where = whereClauseOf(scanOf(statements, alias));
        expect(where, `${alias}: agent qual moved back into the BM25 scan`).not.toContain(
          'agent_id',
        );

        const statement = statements.find(({ sql }) => sql.includes(`"${alias}"`))!;

        // the filter must survive above the scan, or agent scoping would break
        expect(statement.sql).toContain(`"${alias}"."agent_id" = `);

        // and the pool deepens so small agents survive the lifted filter
        expect(statement.params, `${alias}: agent-scoped scan pool`).toContain(20_000);
      }
    });
  });
});
