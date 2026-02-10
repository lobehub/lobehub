// @vitest-environment node
import { LobeChatDatabase } from '@lobechat/database';
import { agentSkills } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSkillsRouter } from '../../agentSkills';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Mock FileService to avoid S3 dependency
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    createFileRecord: vi.fn().mockResolvedValue({ fileId: 'mock-file-id', url: '/f/mock-file-id' }),
    downloadFileToLocal: vi.fn(),
    getFileContent: vi.fn(),
    uploadBuffer: vi.fn().mockResolvedValue({ key: 'mock-key' }),
    uploadMedia: vi.fn().mockResolvedValue({ key: 'mock-key' }),
  })),
}));

// Mock SkillResourceService to avoid S3 dependency
vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn().mockImplementation(() => ({
    storeResources: vi.fn().mockResolvedValue({}),
    readResource: vi.fn().mockRejectedValue(new Error('Resource not found')),
    listResources: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock GitHub module
const mockGitHubInstance = {
  downloadRepoZip: vi.fn(),
  parseRepoUrl: vi.fn(),
};
vi.mock('@/server/modules/GitHub', () => ({
  GitHub: vi.fn().mockImplementation(() => mockGitHubInstance),
  GitHubNotFoundError: class extends Error {},
  GitHubParseError: class extends Error {},
}));

// Mock SkillParser
const mockParserInstance = {
  parseSkillMd: vi.fn(),
  parseZipPackage: vi.fn(),
};
vi.mock('@/server/services/skill/parser', () => ({
  SkillParser: vi.fn().mockImplementation(() => mockParserInstance),
}));

// Mock global fetch for URL imports
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Skill Router Integration Tests', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  describe('create', () => {
    it('should create a new skill', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const result = await caller.create({
        name: 'Test Skill',
        content: '# Test Skill\n\nThis is a test skill.',
        description: 'A skill for testing',
      });

      expect(result).toBeDefined();
      expect(result!.name).toBe('Test Skill');
      expect(result!.content).toBe('# Test Skill\n\nThis is a test skill.');
      expect(result!.description).toBe('A skill for testing');
      expect(result!.source).toBe('user');
      expect(result!.identifier).toMatch(/^user\./);
    });

    it('should create skill with custom identifier', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const result = await caller.create({
        name: 'Custom ID Skill',
        content: '# Custom',
        description: 'Custom identifier skill',
        identifier: 'custom.skill.id',
      });

      expect(result!.identifier).toBe('custom.skill.id');
    });

    it('should throw error for duplicate identifier', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      await caller.create({
        name: 'First Skill',
        content: '# First',
        description: 'First skill',
        identifier: 'duplicate.id',
      });

      await expect(
        caller.create({
          name: 'Second Skill',
          content: '# Second',
          description: 'Second skill',
          identifier: 'duplicate.id',
        }),
      ).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('should list all skills for user', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      await caller.create({ name: 'Skill 1', content: '# Skill 1', description: 'Skill 1 desc' });
      await caller.create({ name: 'Skill 2', content: '# Skill 2', description: 'Skill 2 desc' });

      const result = await caller.list();

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter skills by source', async () => {
      // Insert skills with different sources directly
      await serverDB.insert(agentSkills).values([
        {
          name: 'User Skill',
          description: 'User skill description',
          identifier: 'user.skill',
          source: 'user',
          manifest: { name: 'User Skill', description: 'User skill description' },
          userId,
        },
        {
          name: 'Market Skill',
          description: 'Market skill description',
          identifier: 'market.skill',
          source: 'market',
          manifest: { name: 'Market Skill', description: 'Market skill description' },
          userId,
        },
      ]);

      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const userSkills = await caller.list({ source: 'user' });
      expect(userSkills.data).toHaveLength(1);
      expect(userSkills.data[0].source).toBe('user');

      const marketSkills = await caller.list({ source: 'market' });
      expect(marketSkills.data).toHaveLength(1);
      expect(marketSkills.data[0].source).toBe('market');
    });
  });

  describe('getById', () => {
    it('should get skill by id', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const created = await caller.create({
        name: 'Get By ID Skill',
        content: '# Get By ID',
        description: 'Get by ID skill',
      });

      const result = await caller.getById({ id: created!.id });

      expect(result).toBeDefined();
      expect(result?.id).toBe(created!.id);
      expect(result?.name).toBe('Get By ID Skill');
    });

    it('should return undefined for non-existent id', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const result = await caller.getById({ id: 'non-existent-id' });

      expect(result).toBeUndefined();
    });
  });

  describe('getByIdentifier', () => {
    it('should get skill by identifier', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      await caller.create({
        name: 'By Identifier',
        content: '# By Identifier',
        description: 'By identifier skill',
        identifier: 'test.by.identifier',
      });

      const result = await caller.getByIdentifier({ identifier: 'test.by.identifier' });

      expect(result).toBeDefined();
      expect(result?.identifier).toBe('test.by.identifier');
    });
  });

  describe('getByName', () => {
    it('should get skill by name', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      await caller.create({
        name: 'Unique Skill Name',
        content: '# By Name',
        description: 'By name skill',
      });

      const result = await caller.getByName({ name: 'Unique Skill Name' });

      expect(result).toBeDefined();
      expect(result?.name).toBe('Unique Skill Name');
    });

    it('should return undefined for non-existent name', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const result = await caller.getByName({ name: 'non-existent-name' });

      expect(result).toBeUndefined();
    });
  });

  describe('search', () => {
    it('should search skills by name', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      await caller.create({ name: 'TypeScript Expert', content: '# TS', description: 'TS expert' });
      await caller.create({ name: 'Python Master', content: '# Py', description: 'Py master' });

      const result = await caller.search({ query: 'TypeScript' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('TypeScript Expert');
    });

    it('should search skills by description', async () => {
      await serverDB.insert(agentSkills).values([
        {
          name: 'Skill A',
          description: 'Helps with coding tasks',
          identifier: 'search.a',
          source: 'user',
          manifest: { name: 'Skill A', description: 'Helps with coding tasks' },
          userId,
        },
        {
          name: 'Skill B',
          description: 'Helps with writing',
          identifier: 'search.b',
          source: 'user',
          manifest: { name: 'Skill B', description: 'Helps with writing' },
          userId,
        },
      ]);

      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const result = await caller.search({ query: 'coding' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Skill A');
    });
  });

  describe('update', () => {
    it('should update skill content', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const created = await caller.create({
        name: 'Original Name',
        content: '# Original',
        description: 'Original description',
      });

      await caller.update({
        id: created!.id,
        content: '# Updated Content',
      });

      const updated = await caller.getById({ id: created!.id });

      expect(updated?.content).toBe('# Updated Content');
      // Name should remain unchanged
      expect(updated?.name).toBe('Original Name');
    });

    it('should update skill via manifest and sync to top-level fields', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const created = await caller.create({
        name: 'Original Name',
        content: '# Test',
        description: 'Original description',
      });

      await caller.update({
        id: created!.id,
        manifest: {
          name: 'Updated Name',
          description: 'Updated description',
          version: '2.0.0',
        },
      });

      const updated = await caller.getById({ id: created!.id });

      // Top-level fields should be synced from manifest
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.description).toBe('Updated description');
      // Manifest should contain all fields
      expect(updated?.manifest).toMatchObject({
        name: 'Updated Name',
        description: 'Updated description',
        version: '2.0.0',
      });
    });

    it('should merge manifest instead of replacing', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const created = await caller.create({
        name: 'Merge Test',
        content: '# Test',
        description: 'Merge test skill',
      });

      // First update: add version
      await caller.update({
        id: created!.id,
        manifest: {
          version: '1.0.0',
        },
      });

      // Second update: add license (should keep version)
      await caller.update({
        id: created!.id,
        manifest: {
          license: 'MIT',
        },
      });

      const updated = await caller.getById({ id: created!.id });

      // Both version and license should exist
      expect(updated?.manifest).toMatchObject({
        name: 'Merge Test',
        description: 'Merge test skill',
        version: '1.0.0',
        license: 'MIT',
      });
    });
  });

  describe('delete', () => {
    it('should delete skill', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const created = await caller.create({
        name: 'To Delete',
        content: '# Delete Me',
        description: 'To delete skill',
      });

      await caller.delete({ id: created!.id });

      const deleted = await caller.getById({ id: created!.id });

      expect(deleted).toBeUndefined();
    });

    it('should not affect other skills when deleting', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const skill1 = await caller.create({
        name: 'Skill 1',
        content: '# 1',
        description: 'Skill 1',
      });
      const skill2 = await caller.create({
        name: 'Skill 2',
        content: '# 2',
        description: 'Skill 2',
      });

      await caller.delete({ id: skill1!.id });

      const remaining = await caller.list();

      expect(remaining.data).toHaveLength(1);
      expect(remaining.data[0].id).toBe(skill2!.id);
    });
  });

  describe('listResources', () => {
    it('should return empty array for skill without resources', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const created = await caller.create({
        name: 'No Resources',
        content: '# No Resources',
        description: 'Skill without resources',
      });

      const result = await caller.listResources({ id: created!.id });

      // Mock returns empty array
      expect(result).toEqual([]);
    });

    it('should throw for non-existent skill', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      // getById returns undefined, which triggers NOT_FOUND TRPCError
      await expect(caller.listResources({ id: 'non-existent' })).rejects.toThrow();
    });
  });

  describe('readResource', () => {
    it('should throw for non-existent skill', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      // getById returns undefined, which triggers NOT_FOUND TRPCError
      await expect(
        caller.readResource({ id: 'non-existent', path: 'readme.md' }),
      ).rejects.toThrow();
    });

    it('should throw for skill without resources', async () => {
      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const created = await caller.create({
        name: 'No Resources',
        content: '# No Resources',
        description: 'Skill without resources',
      });

      // Skill exists but has no resources, triggers BAD_REQUEST with message
      await expect(caller.readResource({ id: created!.id, path: 'readme.md' })).rejects.toThrow(
        'Skill has no resources',
      );
    });
  });

  describe('importFromGitHub', () => {
    it('should import skill from GitHub with subdirectory path', async () => {
      // Setup mocks
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'openclaw',
        path: 'skills/skill-creator',
        repo: 'openclaw',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip-content'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Skill Creator\n\nCreate skills easily.',
        manifest: { name: 'skill-creator', description: 'Create skills' },
        resources: new Map(),
        // zipHash undefined to skip globalFiles foreign key (FileService is mocked)
        zipHash: undefined,
      });

      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const result = await caller.importFromGitHub({
        gitUrl: 'https://github.com/openclaw/openclaw/tree/main/skills/skill-creator',
      });

      expect(result).toBeDefined();
      expect(result!.skill.name).toBe('skill-creator');
      expect(result!.skill.identifier).toBe('github.openclaw.openclaw.skills.skill-creator');
      expect(result!.skill.source).toBe('market');
      expect(result!.skill.manifest).toMatchObject({
        repository: 'https://github.com/openclaw/openclaw',
        sourceUrl: 'https://github.com/openclaw/openclaw/tree/main/skills/skill-creator',
      });

      // Verify parseRepoUrl was called with correct URL
      expect(mockGitHubInstance.parseRepoUrl).toHaveBeenCalledWith(
        'https://github.com/openclaw/openclaw/tree/main/skills/skill-creator',
        undefined,
      );

      // Verify parseZipPackage was called with basePath and repackSkillZip
      expect(mockParserInstance.parseZipPackage).toHaveBeenCalledWith(expect.any(Buffer), {
        basePath: 'skills/skill-creator',
        repackSkillZip: true,
      });
    });

    it('should update existing skill when re-importing from same GitHub path', async () => {
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        path: 'skills/demo',
        repo: 'skills',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));

      let callCount = 0;
      mockParserInstance.parseZipPackage.mockImplementation(() => {
        callCount++;
        return {
          content: callCount === 1 ? '# Original' : '# Updated Content',
          manifest: {
            name: callCount === 1 ? 'Original Name' : 'Updated Name',
            description: callCount === 1 ? 'Original desc' : 'Updated desc',
          },
          resources: new Map(),
          // zipHash undefined to skip globalFiles foreign key
          zipHash: undefined,
        };
      });

      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      // First import
      const first = await caller.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skills/tree/main/skills/demo',
      });
      expect(first!.skill.name).toBe('Original Name');
      expect(first!.skill.content).toBe('# Original');

      // Re-import (should update)
      const second = await caller.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skills/tree/main/skills/demo',
      });
      expect(second!.skill.id).toBe(first!.skill.id); // Same skill updated
      expect(second!.skill.name).toBe('Updated Name');
      expect(second!.skill.content).toBe('# Updated Content');
    });
  });

  describe('importFromUrl', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('should import skill from URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => `---
name: URL Skill
description: A skill from URL
---
# URL Skill Content`,
      });

      mockParserInstance.parseSkillMd.mockReturnValue({
        content: '# URL Skill Content',
        manifest: { name: 'URL Skill', description: 'A skill from URL' },
        raw: 'raw',
      });

      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      const result = await caller.importFromUrl({
        url: 'https://example.com/skill.md',
      });

      expect(result).toBeDefined();
      expect(result!.status).toBe('created');
      expect(result!.skill.name).toBe('URL Skill');
      expect(result!.skill.identifier).toBe('url.example.com.skill');
      expect(result!.skill.source).toBe('market');
      expect(result!.skill.manifest).toMatchObject({
        sourceUrl: 'https://example.com/skill.md',
      });
    });

    it('should update existing skill when re-importing from same URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'content',
      });

      let callCount = 0;
      mockParserInstance.parseSkillMd.mockImplementation(() => {
        callCount++;
        return {
          content: callCount === 1 ? '# Original' : '# Updated',
          manifest: {
            name: callCount === 1 ? 'Original Name' : 'Updated Name',
            description: callCount === 1 ? 'Original desc' : 'Updated desc',
          },
          raw: 'raw',
        };
      });

      const caller = agentSkillsRouter.createCaller(createTestContext(userId));

      // First import
      const first = await caller.importFromUrl({
        url: 'https://example.com/update-test.md',
      });
      expect(first!.status).toBe('created');
      expect(first!.skill.content).toBe('# Original');

      // Re-import (should update)
      const second = await caller.importFromUrl({
        url: 'https://example.com/update-test.md',
      });
      expect(second!.skill.id).toBe(first!.skill.id); // Same skill updated
      expect(second!.skill.name).toBe('Updated Name');
      expect(second!.skill.content).toBe('# Updated');
    });
  });

  describe('user isolation', () => {
    it('should not access skills from other users', async () => {
      // Create skill for original user
      const caller1 = agentSkillsRouter.createCaller(createTestContext(userId));
      await caller1.create({
        name: 'User 1 Skill',
        content: '# User 1',
        description: 'User 1 skill',
      });

      // Create another user
      const otherUserId = await createTestUser(serverDB);
      const caller2 = agentSkillsRouter.createCaller(createTestContext(otherUserId));

      // Other user should not see original user's skills
      const otherUserSkills = await caller2.list();
      expect(otherUserSkills.data).toHaveLength(0);

      // Cleanup other user
      await cleanupTestUser(serverDB, otherUserId);
    });

    it('should not update skills from other users', async () => {
      const caller1 = agentSkillsRouter.createCaller(createTestContext(userId));
      const created = await caller1.create({
        name: 'Original',
        content: '# Original',
        description: 'Original skill',
      });

      // Create another user
      const otherUserId = await createTestUser(serverDB);
      const caller2 = agentSkillsRouter.createCaller(createTestContext(otherUserId));

      // Try to update (should not affect the skill due to userId filter)
      await caller2.update({ id: created!.id, manifest: { name: 'Hacked' } });

      // Original skill should be unchanged
      const unchanged = await caller1.getById({ id: created!.id });
      expect(unchanged?.name).toBe('Original');

      await cleanupTestUser(serverDB, otherUserId);
    });

    it('should not delete skills from other users', async () => {
      const caller1 = agentSkillsRouter.createCaller(createTestContext(userId));
      const created = await caller1.create({
        name: 'Protected',
        content: '# Protected',
        description: 'Protected skill',
      });

      // Create another user
      const otherUserId = await createTestUser(serverDB);
      const caller2 = agentSkillsRouter.createCaller(createTestContext(otherUserId));

      // Try to delete (should not affect the skill due to userId filter)
      await caller2.delete({ id: created!.id });

      // Original skill should still exist
      const stillExists = await caller1.getById({ id: created!.id });
      expect(stillExists).toBeDefined();

      await cleanupTestUser(serverDB, otherUserId);
    });
  });
});
