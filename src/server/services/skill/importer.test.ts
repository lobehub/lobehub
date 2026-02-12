// @vitest-environment node
import { LobeChatDatabase } from '@lobechat/database';
import { agentSkills, files, globalFiles, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillImportError } from './errors';
import { SkillImporter } from './importer';

// Mock external dependencies only (GitHub, S3, parser)
const mockGitHubInstance = {
  downloadRepoZip: vi.fn(),
  parseRepoUrl: vi.fn(),
};
vi.mock('@/server/modules/GitHub', () => ({
  GitHub: vi.fn().mockImplementation(() => mockGitHubInstance),
  GitHubNotFoundError: class GitHubNotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'GitHubNotFoundError';
    }
  },
  GitHubParseError: class GitHubParseError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'GitHubParseError';
    }
  },
}));

const mockParserInstance = {
  parseSkillMd: vi.fn(),
  parseZipPackage: vi.fn(),
};
vi.mock('./parser', () => ({
  SkillParser: vi.fn().mockImplementation(() => mockParserInstance),
}));

// Mock global fetch for URL imports
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock S3 operations in FileService implementation
vi.mock('@/server/services/file/impls', () => ({
  createFileServiceModule: vi.fn().mockImplementation(() => ({
    createPreSignedUrl: vi.fn().mockResolvedValue('mock-presigned-url'),
    createPreSignedUrlForPreview: vi.fn().mockResolvedValue('mock-preview-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFiles: vi.fn().mockResolvedValue(undefined),
    getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])), // Non-empty content
    getFileContent: vi.fn().mockResolvedValue('mock-content'),
    getFileMetadata: vi.fn().mockResolvedValue({ contentLength: 100 }),
    getFullFileUrl: vi.fn().mockResolvedValue('mock-full-url'),
    getKeyFromFullUrl: vi.fn().mockResolvedValue(null),
    uploadBuffer: vi.fn().mockResolvedValue({ key: 'mock-key' }),
    uploadContent: vi.fn().mockResolvedValue(undefined),
    uploadMedia: vi.fn().mockResolvedValue({ key: 'mock-key' }),
  })),
}));

// Mock fs/promises readFile
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('mock-zip-content')),
}));

describe('SkillImporter', () => {
  let db: LobeChatDatabase;
  let userId: string;
  let importer: SkillImporter;

  beforeEach(async () => {
    vi.clearAllMocks();

    db = await getTestDB();
    userId = `test-user-${Date.now()}`;

    // Create test user
    await db.insert(users).values({ id: userId });

    importer = new SkillImporter(db, userId);
  });

  afterEach(async () => {
    // Cleanup: delete user (cascade deletes agentSkills and files)
    await db.delete(users).where(eq(users.id, userId));
    // Clean up orphaned globalFiles
    await db.delete(globalFiles);
  });

  describe('createUserSkill', () => {
    it('should create a user skill with generated identifier', async () => {
      const result = await importer.createUserSkill({
        content: '# Test content',
        name: 'Test Skill',
        description: 'A test skill',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Skill');
      expect(result.identifier).toMatch(/^user\./);
      expect(result.source).toBe('user');

      // Verify in database
      const dbSkill = await db.query.agentSkills.findFirst({
        where: eq(agentSkills.id, result.id),
      });
      expect(dbSkill).toBeDefined();
      expect(dbSkill?.name).toBe('Test Skill');
      expect(dbSkill?.content).toBe('# Test content');
      expect(dbSkill?.description).toBe('A test skill');
    });

    it('should create a user skill with custom identifier', async () => {
      const result = await importer.createUserSkill({
        content: '# Test content',
        description: 'A test skill',
        identifier: 'custom-identifier',
        name: 'Test Skill',
      });

      expect(result.identifier).toBe('custom-identifier');

      // Verify in database
      const dbSkill = await db.query.agentSkills.findFirst({
        where: eq(agentSkills.identifier, 'custom-identifier'),
      });
      expect(dbSkill).toBeDefined();
      expect(dbSkill?.identifier).toBe('custom-identifier');
    });

    it('should throw CONFLICT error when identifier exists', async () => {
      // Create first skill
      await importer.createUserSkill({
        content: '# First',
        description: 'First skill',
        identifier: 'duplicate-id',
        name: 'First Skill',
      });

      // Try to create second skill with same identifier
      await expect(
        importer.createUserSkill({
          content: '# Second',
          description: 'Second skill',
          identifier: 'duplicate-id',
          name: 'Second Skill',
        }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.createUserSkill({
          content: '# Third',
          description: 'Third skill',
          identifier: 'duplicate-id',
          name: 'Third Skill',
        });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('CONFLICT');
      }
    });

    it('should store manifest with description', async () => {
      const result = await importer.createUserSkill({
        content: '# Content',
        description: 'This is a description',
        name: 'Skill with Description',
      });

      // Verify manifest in database
      const dbSkill = await db.query.agentSkills.findFirst({
        where: eq(agentSkills.id, result.id),
      });
      expect(dbSkill?.manifest).toMatchObject({
        description: 'This is a description',
        name: 'Skill with Description',
      });
    });
  });

  describe('importFromZip', () => {
    it('should import skill from ZIP file', async () => {
      // Create a mock file record for the ZIP file
      const zipFileId = `zip-file-${Date.now()}`;
      const zipHash = `zip-hash-${Date.now()}`;

      // Insert mock file record
      await db.insert(globalFiles).values({
        creator: userId,
        fileType: 'application/zip',
        hashId: zipHash,
        size: 1000,
        url: 'mock/path/skill.zip',
      });

      await db.insert(files).values({
        fileHash: zipHash,
        fileType: 'application/zip',
        id: zipFileId,
        name: 'skill.zip',
        size: 1000,
        url: 'mock/path/skill.zip',
        userId,
      });

      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# ZIP Skill content',
        manifest: { name: 'ZIP Skill', description: 'A ZIP skill' },
        resources: new Map(),
        // zipHash undefined to skip globalFiles foreign key (file already exists from user upload)
        zipHash: undefined,
      });

      const result = await importer.importFromZip({ zipFileId });

      expect(result).toBeDefined();
      expect(result.status).toBe('created');
      expect(result.skill.name).toBe('ZIP Skill');
      expect(result.skill.source).toBe('user');
      expect(result.skill.identifier).toMatch(/^user\./);

      // Verify in database
      const dbSkill = await db.query.agentSkills.findFirst({
        where: eq(agentSkills.id, result.skill.id),
      });
      expect(dbSkill).toBeDefined();
      expect(dbSkill?.content).toBe('# ZIP Skill content');
      expect(dbSkill?.description).toBe('A ZIP skill');
    });

    it('should store resources from ZIP file', async () => {
      const zipFileId = `zip-file-res-${Date.now()}`;
      const zipHash = `zip-hash-res-${Date.now()}`;
      const parsedZipHash = `parsed-hash-${Date.now()}`;

      await db.insert(globalFiles).values({
        creator: userId,
        fileType: 'application/zip',
        hashId: zipHash,
        size: 1000,
        url: 'mock/path/skill.zip',
      });

      await db.insert(files).values({
        fileHash: zipHash,
        fileType: 'application/zip',
        id: zipFileId,
        name: 'skill.zip',
        size: 1000,
        url: 'mock/path/skill.zip',
        userId,
      });

      // Also create globalFiles for the parsed hash (for foreign key reference)
      await db.insert(globalFiles).values({
        creator: userId,
        fileType: 'application/zip',
        hashId: parsedZipHash,
        size: 1000,
        url: 'mock/path/parsed-skill.zip',
      });

      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Skill with resources',
        manifest: { name: 'Resource Skill', description: 'Has resources' },
        resources: new Map([
          ['readme.md', Buffer.from('# README')],
          ['docs/guide.md', Buffer.from('# Guide')],
        ]),
        zipHash: parsedZipHash,
      });

      const result = await importer.importFromZip({ zipFileId });

      expect(result).toBeDefined();
      expect(result.status).toBe('created');
      expect(result.skill.resources).toBeDefined();

      // Verify resources mapping was stored
      const dbSkill = await db.query.agentSkills.findFirst({
        where: eq(agentSkills.id, result.skill.id),
      });
      expect(dbSkill?.resources).toBeDefined();
      expect(Object.keys(dbSkill?.resources || {})).toHaveLength(2);
    });

    it('should throw CONFLICT error when skill name already exists', async () => {
      const zipFileId = `zip-file-conflict-${Date.now()}`;
      const zipHash = `zip-hash-conflict-${Date.now()}`;

      await db.insert(globalFiles).values({
        creator: userId,
        fileType: 'application/zip',
        hashId: zipHash,
        size: 1000,
        url: 'mock/path/skill.zip',
      });

      await db.insert(files).values({
        fileHash: zipHash,
        fileType: 'application/zip',
        id: zipFileId,
        name: 'skill.zip',
        size: 1000,
        url: 'mock/path/skill.zip',
        userId,
      });

      // First, create a skill with the same name
      await importer.createUserSkill({
        content: '# Existing Skill',
        description: 'Already exists',
        name: 'Duplicate Name',
      });

      // Now try to import a ZIP with the same name
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# New Skill from ZIP',
        manifest: { name: 'Duplicate Name', description: 'From ZIP' },
        resources: new Map(),
        zipHash: undefined,
      });

      await expect(importer.importFromZip({ zipFileId })).rejects.toThrow(SkillImportError);

      try {
        await importer.importFromZip({ zipFileId });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('CONFLICT');
        expect((e as SkillImportError).message).toContain('Duplicate Name');
      }
    });
  });

  describe('importFromGitHub', () => {
    it('should import skill from GitHub repository', async () => {
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-demo',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# GitHub Skill content',
        manifest: { name: 'GitHub Skill', description: 'A GitHub skill' },
        resources: new Map(),
        zipHash: `github-hash-${Date.now()}`,
      });

      const result = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-demo',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('created');
      expect(result.skill.name).toBe('GitHub Skill');
      expect(result.skill.identifier).toBe('github.lobehub.skill-demo');
      expect(result.skill.source).toBe('market');

      // Verify manifest contains repository info
      const dbSkill = await db.query.agentSkills.findFirst({
        where: eq(agentSkills.id, result.skill.id),
      });
      expect(dbSkill?.manifest).toMatchObject({
        repository: 'https://github.com/lobehub/skill-demo',
        sourceUrl: 'https://github.com/lobehub/skill-demo',
      });
    });

    it('should import skill from GitHub subdirectory', async () => {
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'openclaw',
        path: 'skills/skill-creator',
        repo: 'openclaw',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Skill Creator content',
        manifest: { name: 'skill-creator', description: 'Create skills' },
        resources: new Map(),
        zipHash: `subdirectory-hash-${Date.now()}`,
      });

      const result = await importer.importFromGitHub({
        gitUrl: 'https://github.com/openclaw/openclaw/tree/main/skills/skill-creator',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('created');
      expect(result.skill.identifier).toBe('github.openclaw.openclaw.skills.skill-creator');

      // Verify parseZipPackage was called with basePath and repackSkillZip
      expect(mockParserInstance.parseZipPackage).toHaveBeenCalledWith(expect.any(Buffer), {
        basePath: 'skills/skill-creator',
        repackSkillZip: true,
      });
    });

    it('should update existing skill when re-importing from same repo', async () => {
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-update',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));

      // First import
      mockParserInstance.parseZipPackage.mockResolvedValueOnce({
        content: '# Original content',
        manifest: { name: 'Original Name', description: 'Original desc' },
        resources: new Map(),
        zipHash: `update-hash-1-${Date.now()}`,
      });

      const first = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-update',
      });

      expect(first.status).toBe('created');
      expect(first.skill.name).toBe('Original Name');
      expect(first.skill.content).toBe('# Original content');

      // Second import (should update)
      mockParserInstance.parseZipPackage.mockResolvedValueOnce({
        content: '# Updated content',
        manifest: { name: 'Updated Name', description: 'Updated desc' },
        resources: new Map(),
        zipHash: `update-hash-2-${Date.now()}`,
      });

      const second = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-update',
      });

      expect(second.status).toBe('updated');
      expect(second.skill.id).toBe(first.skill.id); // Same skill updated
      expect(second.skill.name).toBe('Updated Name');
      expect(second.skill.content).toBe('# Updated content');

      // Verify only one skill exists in database
      const dbSkills = await db
        .select()
        .from(agentSkills)
        .where(
          and(
            eq(agentSkills.userId, userId),
            eq(agentSkills.identifier, 'github.lobehub.skill-update'),
          ),
        );
      expect(dbSkills).toHaveLength(1);
    });

    it('should throw INVALID_URL error for invalid GitHub URL', async () => {
      const { GitHubParseError } = await import('@/server/modules/GitHub');
      mockGitHubInstance.parseRepoUrl.mockImplementation(() => {
        throw new GitHubParseError('Invalid GitHub URL');
      });

      await expect(
        importer.importFromGitHub({ gitUrl: 'https://invalid-url.com/repo' }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.importFromGitHub({ gitUrl: 'https://invalid-url.com/repo' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('INVALID_URL');
      }
    });

    it('should throw NOT_FOUND error when repository does not exist', async () => {
      const { GitHubNotFoundError } = await import('@/server/modules/GitHub');
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'non-existent',
      });
      mockGitHubInstance.downloadRepoZip.mockImplementation(() => {
        throw new GitHubNotFoundError('Repository not found');
      });

      await expect(
        importer.importFromGitHub({ gitUrl: 'https://github.com/lobehub/non-existent' }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.importFromGitHub({ gitUrl: 'https://github.com/lobehub/non-existent' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('NOT_FOUND');
      }
    });

    it('should use custom branch when provided', async () => {
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'develop',
        owner: 'lobehub',
        repo: 'skill-branch',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Branch Skill',
        manifest: { name: 'Branch Skill', description: 'From develop branch' },
        resources: new Map(),
        zipHash: `branch-hash-${Date.now()}`,
      });

      await importer.importFromGitHub({
        branch: 'develop',
        gitUrl: 'https://github.com/lobehub/skill-branch',
      });

      expect(mockGitHubInstance.parseRepoUrl).toHaveBeenCalledWith(
        'https://github.com/lobehub/skill-branch',
        'develop',
      );
    });

    it('should only keep globalFiles record, not user files record for ZIP', async () => {
      const zipHash = `only-global-${Date.now()}`;

      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-global-only',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Skill Content',
        manifest: { name: 'Global Only Skill', description: 'Test global files' },
        resources: new Map(),
        zipHash,
      });

      const result = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-global-only',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('created');
      expect(result.skill.zipFileHash).toBe(zipHash);

      // Verify: globalFiles should have the record
      const globalFileRecord = await db.query.globalFiles.findFirst({
        where: eq(globalFiles.hashId, zipHash),
      });
      expect(globalFileRecord).toBeDefined();
      expect(globalFileRecord?.hashId).toBe(zipHash);

      // Verify: user's files table should NOT have the ZIP record (deleted)
      const userFileRecords = await db
        .select()
        .from(files)
        .where(and(eq(files.userId, userId), eq(files.fileHash, zipHash)));
      expect(userFileRecords).toHaveLength(0);
    });

    it('should store ZIP file at correct path', async () => {
      const zipHash = `path-test-${Date.now()}`;
      const { createFileServiceModule } = await import('@/server/services/file/impls');
      const mockUploadBuffer = vi.fn().mockResolvedValue({ key: 'mock-key' });
      (createFileServiceModule as any).mockReturnValue({
        createPreSignedUrl: vi.fn(),
        createPreSignedUrlForPreview: vi.fn(),
        deleteFile: vi.fn(),
        deleteFiles: vi.fn(),
        getFileByteArray: vi.fn(),
        getFileContent: vi.fn(),
        getFileMetadata: vi.fn(),
        getFullFileUrl: vi.fn(),
        getKeyFromFullUrl: vi.fn(),
        uploadBuffer: mockUploadBuffer,
        uploadContent: vi.fn(),
        uploadMedia: vi.fn(),
      });

      // Create new importer to pick up the mock
      const freshImporter = new SkillImporter(db, userId);

      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-path-test',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Content',
        manifest: { name: 'Path Test Skill', description: 'Test path' },
        resources: new Map(),
        zipHash,
      });

      await freshImporter.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-path-test',
      });

      // Verify uploadBuffer was called with correct path
      expect(mockUploadBuffer).toHaveBeenCalledWith(
        `skills/zip/${zipHash}.zip`,
        expect.any(Buffer),
        'application/zip',
      );
    });

    it('should call parseZipPackage with repackSkillZip: true', async () => {
      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'repack-test',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('large-repo-zip'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Skill',
        manifest: { name: 'Test', description: 'Test' },
        resources: new Map(),
        skillZipBuffer: Buffer.from('small-skill-zip'),
        zipHash: 'skill-hash',
      });

      await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/repack-test',
      });

      // Verify parseZipPackage was called with repackSkillZip: true
      expect(mockParserInstance.parseZipPackage).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ repackSkillZip: true }),
      );
    });

    it('should upload skillZipBuffer instead of full repo ZIP', async () => {
      const { createFileServiceModule } = await import('@/server/services/file/impls');
      const mockUploadBuffer = vi.fn().mockResolvedValue({ key: 'mock-key' });
      (createFileServiceModule as any).mockReturnValue({
        createPreSignedUrl: vi.fn(),
        createPreSignedUrlForPreview: vi.fn(),
        deleteFile: vi.fn(),
        deleteFiles: vi.fn(),
        getFileByteArray: vi.fn(),
        getFileContent: vi.fn(),
        getFileMetadata: vi.fn(),
        getFullFileUrl: vi.fn(),
        getKeyFromFullUrl: vi.fn(),
        uploadBuffer: mockUploadBuffer,
        uploadContent: vi.fn(),
        uploadMedia: vi.fn(),
      });

      const freshImporter = new SkillImporter(db, userId);
      const largeRepoZip = Buffer.alloc(10_000_000); // 10MB repo ZIP
      const smallSkillZip = Buffer.from('small-repacked-skill-zip');

      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'large-repo',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(largeRepoZip);
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Skill',
        manifest: { name: 'Test', description: 'Test' },
        resources: new Map(),
        skillZipBuffer: smallSkillZip,
        zipHash: 'skill-content-hash',
      });

      await freshImporter.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/large-repo',
      });

      // Verify uploadBuffer was called with skillZipBuffer, not the large repo ZIP
      expect(mockUploadBuffer).toHaveBeenCalledWith(
        expect.stringContaining('skills/zip/'),
        smallSkillZip, // Should be the small repacked ZIP
        'application/zip',
      );
    });

    it('should skip import when skill exists with same zipHash (deduplication)', async () => {
      const zipHash = `dedup-hash-${Date.now()}`;

      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-dedup',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));
      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# Skill Content',
        manifest: { name: 'Dedup Skill', description: 'Test deduplication' },
        resources: new Map([
          ['readme.md', Buffer.from('# README')],
          ['docs/guide.md', Buffer.from('# Guide')],
        ]),
        zipHash,
      });

      // First import
      const first = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-dedup',
      });

      expect(first).toBeDefined();
      expect(first.status).toBe('created');
      expect(first.skill.zipFileHash).toBe(zipHash);

      // Record how many times parseZipPackage was called
      const parseCallCountAfterFirst = mockParserInstance.parseZipPackage.mock.calls.length;

      // Second import with same zipHash should skip
      const second = await importer.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-dedup',
      });

      // Should return the existing skill with 'unchanged' status
      expect(second.status).toBe('unchanged');
      expect(second.skill.id).toBe(first.skill.id);
      expect(second.skill.zipFileHash).toBe(zipHash);

      // parseZipPackage should be called again (to get the new hash)
      // but we should verify no resource storage happened
      expect(mockParserInstance.parseZipPackage.mock.calls.length).toBe(
        parseCallCountAfterFirst + 1,
      );

      // Verify only one skill exists in database
      const dbSkills = await db
        .select()
        .from(agentSkills)
        .where(eq(agentSkills.identifier, 'github.lobehub.skill-dedup'));
      expect(dbSkills).toHaveLength(1);
    });

    it('should update skill when content changes (different zipHash)', async () => {
      const { createFileServiceModule } = await import('@/server/services/file/impls');
      const mockUploadBuffer = vi.fn().mockResolvedValue({ key: 'mock-key' });
      (createFileServiceModule as any).mockReturnValue({
        createPreSignedUrl: vi.fn(),
        createPreSignedUrlForPreview: vi.fn(),
        deleteFile: vi.fn(),
        deleteFiles: vi.fn(),
        getFileByteArray: vi.fn(),
        getFileContent: vi.fn(),
        getFileMetadata: vi.fn(),
        getFullFileUrl: vi.fn(),
        getKeyFromFullUrl: vi.fn(),
        uploadBuffer: mockUploadBuffer,
        uploadContent: vi.fn(),
        uploadMedia: vi.fn(),
      });

      const freshImporter = new SkillImporter(db, userId);

      mockGitHubInstance.parseRepoUrl.mockReturnValue({
        branch: 'main',
        owner: 'lobehub',
        repo: 'skill-update-content',
      });
      mockGitHubInstance.downloadRepoZip.mockResolvedValue(Buffer.from('mock-zip'));

      // First import
      mockParserInstance.parseZipPackage.mockResolvedValueOnce({
        content: '# Original Content',
        manifest: { name: 'Update Skill', description: 'Version 1' },
        resources: new Map(),
        zipHash: 'hash-v1',
      });

      const first = await freshImporter.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-update-content',
      });

      expect(first.status).toBe('created');
      expect(first.skill.content).toBe('# Original Content');
      expect(first.skill.zipFileHash).toBe('hash-v1');
      const uploadCountAfterFirst = mockUploadBuffer.mock.calls.length;

      // Second import with different zipHash (content changed)
      mockParserInstance.parseZipPackage.mockResolvedValueOnce({
        content: '# Updated Content',
        manifest: { name: 'Update Skill', description: 'Version 2' },
        resources: new Map(),
        zipHash: 'hash-v2',
      });

      const second = await freshImporter.importFromGitHub({
        gitUrl: 'https://github.com/lobehub/skill-update-content',
      });

      // Should update the existing skill
      expect(second.status).toBe('updated');
      expect(second.skill.id).toBe(first.skill.id);
      expect(second.skill.content).toBe('# Updated Content');
      expect(second.skill.zipFileHash).toBe('hash-v2');

      // uploadBuffer should be called again for the new ZIP
      expect(mockUploadBuffer.mock.calls.length).toBe(uploadCountAfterFirst + 1);
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
# URL Skill Content

This is the skill content.`,
      });

      mockParserInstance.parseSkillMd.mockReturnValue({
        content: '# URL Skill Content\n\nThis is the skill content.',
        manifest: { name: 'URL Skill', description: 'A skill from URL' },
        raw: 'raw content',
      });

      const result = await importer.importFromUrl({
        url: 'https://example.com/skill.md',
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('created');
      expect(result.skill.name).toBe('URL Skill');
      expect(result.skill.identifier).toBe('url.example.com.skill');
      expect(result.skill.source).toBe('market');
      expect(result.skill.content).toBe('# URL Skill Content\n\nThis is the skill content.');

      // Verify manifest contains source URL
      const dbSkill = await db.query.agentSkills.findFirst({
        where: eq(agentSkills.id, result.skill.id),
      });
      expect(dbSkill?.manifest).toMatchObject({
        sourceUrl: 'https://example.com/skill.md',
      });
    });

    it('should handle URL with path', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => `---
name: Nested Skill
description: A nested skill
---
# Content`,
      });

      mockParserInstance.parseSkillMd.mockReturnValue({
        content: '# Content',
        manifest: { name: 'Nested Skill', description: 'A nested skill' },
        raw: 'raw',
      });

      const result = await importer.importFromUrl({
        url: 'https://pinchwork.dev/skills/my-skill/SKILL.md',
      });

      expect(result.skill.identifier).toBe('url.pinchwork.dev.skills.my-skill.SKILL');
    });

    it('should update existing skill when re-importing from same URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'content',
      });

      // First import
      mockParserInstance.parseSkillMd.mockReturnValueOnce({
        content: '# Original',
        manifest: { name: 'Original Name', description: 'Original desc' },
        raw: 'raw',
      });

      const first = await importer.importFromUrl({
        url: 'https://example.com/update-test.md',
      });

      expect(first.status).toBe('created');
      expect(first.skill.content).toBe('# Original');

      // Second import with updated content
      mockParserInstance.parseSkillMd.mockReturnValueOnce({
        content: '# Updated',
        manifest: { name: 'Updated Name', description: 'Updated desc' },
        raw: 'raw',
      });

      const second = await importer.importFromUrl({
        url: 'https://example.com/update-test.md',
      });

      expect(second.status).toBe('updated');
      expect(second.skill.id).toBe(first.skill.id);
      expect(second.skill.content).toBe('# Updated');
      expect(second.skill.name).toBe('Updated Name');
    });

    it('should return unchanged when content is the same', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'content',
      });

      mockParserInstance.parseSkillMd.mockReturnValue({
        content: '# Same Content',
        manifest: { name: 'Same Skill', description: 'Same desc' },
        raw: 'raw',
      });

      const first = await importer.importFromUrl({
        url: 'https://example.com/same-content.md',
      });

      expect(first.status).toBe('created');

      // Second import with same content
      const second = await importer.importFromUrl({
        url: 'https://example.com/same-content.md',
      });

      expect(second.status).toBe('unchanged');
      expect(second.skill.id).toBe(first.skill.id);
    });

    it('should throw INVALID_URL error for invalid URL', async () => {
      await expect(importer.importFromUrl({ url: 'not-a-valid-url' })).rejects.toThrow(
        SkillImportError,
      );

      try {
        await importer.importFromUrl({ url: 'not-a-valid-url' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('INVALID_URL');
      }
    });

    it('should throw NOT_FOUND error when URL returns 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        importer.importFromUrl({ url: 'https://example.com/not-found.md' }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.importFromUrl({ url: 'https://example.com/not-found.md' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('NOT_FOUND');
      }
    });

    it('should throw DOWNLOAD_FAILED error when fetch fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(importer.importFromUrl({ url: 'https://example.com/error.md' })).rejects.toThrow(
        SkillImportError,
      );

      try {
        await importer.importFromUrl({ url: 'https://example.com/error.md' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('DOWNLOAD_FAILED');
      }
    });

    it('should throw DOWNLOAD_FAILED error when network error occurs', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        importer.importFromUrl({ url: 'https://example.com/network-error.md' }),
      ).rejects.toThrow(SkillImportError);

      try {
        await importer.importFromUrl({ url: 'https://example.com/network-error.md' });
      } catch (e) {
        expect((e as SkillImportError).code).toBe('DOWNLOAD_FAILED');
      }
    });
  });

  describe('importFromZip without repacking', () => {
    it('should NOT pass repackSkillZip option for user uploaded ZIP', async () => {
      // Reset the mock to ensure it returns non-empty content (previous tests may have overwritten it)
      const { createFileServiceModule } = await import('@/server/services/file/impls');
      (createFileServiceModule as any).mockReturnValue({
        createPreSignedUrl: vi.fn().mockResolvedValue('mock-presigned-url'),
        createPreSignedUrlForPreview: vi.fn().mockResolvedValue('mock-preview-url'),
        deleteFile: vi.fn().mockResolvedValue(undefined),
        deleteFiles: vi.fn().mockResolvedValue(undefined),
        getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
        getFileContent: vi.fn().mockResolvedValue('mock-content'),
        getFileMetadata: vi.fn().mockResolvedValue({ contentLength: 100 }),
        getFullFileUrl: vi.fn().mockResolvedValue('mock-full-url'),
        getKeyFromFullUrl: vi.fn().mockResolvedValue(null),
        uploadBuffer: vi.fn().mockResolvedValue({ key: 'mock-key' }),
        uploadContent: vi.fn().mockResolvedValue(undefined),
        uploadMedia: vi.fn().mockResolvedValue({ key: 'mock-key' }),
      });

      // Create a fresh importer instance to pick up the reset mock
      const freshImporter = new SkillImporter(db, userId);

      const zipFileId = `zip-no-repack-${Date.now()}`;
      const zipHash = `hash-no-repack-${Date.now()}`;

      await db.insert(globalFiles).values({
        creator: userId,
        fileType: 'application/zip',
        hashId: zipHash,
        size: 1000,
        url: 'mock/path/skill.zip',
      });

      await db.insert(files).values({
        fileHash: zipHash,
        fileType: 'application/zip',
        id: zipFileId,
        name: 'skill.zip',
        size: 1000,
        url: 'mock/path/skill.zip',
        userId,
      });

      mockParserInstance.parseZipPackage.mockResolvedValue({
        content: '# User Skill',
        manifest: { name: 'User Skill', description: 'User uploaded' },
        resources: new Map(),
        zipHash: undefined, // User uploaded ZIP doesn't need to track hash for foreign key
      });

      await freshImporter.importFromZip({ zipFileId });

      // Verify parseZipPackage was called WITHOUT repackSkillZip option
      expect(mockParserInstance.parseZipPackage).toHaveBeenCalledTimes(1);
      const callArgs = mockParserInstance.parseZipPackage.mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(Buffer);
      // Second argument should be undefined (no options passed)
      expect(callArgs[1]).toBeUndefined();
    });
  });

  describe('user isolation', () => {
    it('should not find skills from other users', async () => {
      // Create skill for first user
      await importer.createUserSkill({
        content: '# User 1 Skill',
        description: 'User 1 skill',
        identifier: 'isolation-test-skill',
        name: 'User 1 Skill',
      });

      // Create second user
      const otherUserId = `other-user-${Date.now()}`;
      await db.insert(users).values({ id: otherUserId });

      // Create importer for second user
      const otherImporter = new SkillImporter(db, otherUserId);

      // Second user should not be able to create skill with same identifier
      // because findByIdentifier filters by userId
      const otherResult = await otherImporter.createUserSkill({
        content: '# User 2 Skill',
        description: 'User 2 skill',
        identifier: 'isolation-test-skill', // Same identifier, different user
        name: 'User 2 Skill',
      });

      // Both skills should exist (different users)
      const allSkills = await db
        .select()
        .from(agentSkills)
        .where(eq(agentSkills.identifier, 'isolation-test-skill'));
      expect(allSkills).toHaveLength(2);

      // Clean up other user
      await db.delete(users).where(eq(users.id, otherUserId));
    });
  });
});
