import { readFile } from 'node:fs/promises';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  type CreateSkillInput,
  type ImportGitHubInput,
  type ImportUrlInput,
  type ImportZipInput,
  type SkillImportResult,
  type SkillManifest,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { GitHub, GitHubNotFoundError, GitHubParseError } from '@/server/modules/GitHub';
import { FileService } from '@/server/services/file';

import { SkillImportError, SkillManifestError } from './errors';
import { SkillParser } from './parser';
import { SkillResourceService } from './resource';

const log = debug('lobe-chat:service:skill-importer');

export class SkillImporter {
  private skillModel: AgentSkillModel;
  private parser: SkillParser;
  private resourceService: SkillResourceService;
  private fileService: FileService;
  private github: GitHub;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.skillModel = new AgentSkillModel(db, userId);
    this.parser = new SkillParser();
    this.resourceService = new SkillResourceService(db, userId);
    this.fileService = new FileService(db, userId);
    this.github = new GitHub({ userAgent: 'LobeHub-Skill-Importer' });
    this.userId = userId;
  }

  /**
   * Create a skill manually by user
   */
  async createUserSkill(input: CreateSkillInput) {
    // Check if name already exists for this user
    const existingByName = await this.skillModel.findByName(input.name);
    if (existingByName) {
      throw new SkillImportError(`Skill with name "${input.name}" already exists`, 'CONFLICT');
    }

    const identifier = input.identifier || `user.${nanoid(12)}`;

    // Check if identifier already exists
    const existingByIdentifier = await this.skillModel.findByIdentifier(identifier);
    if (existingByIdentifier) {
      throw new SkillImportError(
        `Skill with identifier "${identifier}" already exists`,
        'CONFLICT',
      );
    }

    const manifest: SkillManifest = {
      description: input.description || '',
      name: input.name,
    };

    return this.skillModel.create({
      content: input.content,
      description: input.description,
      identifier,
      manifest,
      name: input.name,
      source: 'user',
    });
  }

  /**
   * Import skill from ZIP file
   * @param input - Contains zipFileId from files table
   * @returns SkillImportResult with status: 'created'
   */
  async importFromZip(input: ImportZipInput): Promise<SkillImportResult> {
    log('importFromZip: starting with zipFileId=%s', input.zipFileId);

    // 1. Download ZIP file to local
    const { filePath, cleanup } = await this.fileService.downloadFileToLocal(input.zipFileId);
    log('importFromZip: downloaded to filePath=%s', filePath);

    try {
      const buffer = await readFile(filePath);
      log('importFromZip: read buffer size=%d bytes', buffer.length);

      // 2. Parse ZIP package
      const { manifest, content, resources, zipHash } = await this.parser.parseZipPackage(buffer);
      log(
        'importFromZip: parsed manifest=%o, resources count=%d, zipHash=%s',
        manifest,
        resources.size,
        zipHash,
      );

      // 3. Check if name already exists for this user
      const existingByName = await this.skillModel.findByName(manifest.name);
      if (existingByName) {
        throw new SkillImportError(`Skill with name "${manifest.name}" already exists`, 'CONFLICT');
      }

      // 4. Store resource files
      const resourceIds = zipHash
        ? await this.resourceService.storeResources(zipHash, resources)
        : {};
      log('importFromZip: stored resources=%o', resourceIds);

      // 5. Generate identifier
      const identifier = `user.${nanoid(12)}`;
      log('importFromZip: generated identifier=%s', identifier);

      // 6. Create skill record
      const skill = await this.skillModel.create({
        content,
        description: manifest.description,
        identifier,
        manifest,
        name: manifest.name,
        resources: resourceIds,
        source: 'user',
        zipFileHash: zipHash,
      });
      log('importFromZip: created skill id=%s', skill.id);
      return { skill, status: 'created' };
    } finally {
      cleanup();
      log('importFromZip: cleaned up temp file');
    }
  }

  /**
   * Import skill from GitHub repository
   * @param input - GitHub repository info
   * @returns SkillImportResult with status: 'created' | 'updated' | 'unchanged'
   */
  async importFromGitHub(input: ImportGitHubInput): Promise<SkillImportResult> {
    log('importFromGitHub: starting with gitUrl=%s, branch=%s', input.gitUrl, input.branch);

    // 1. Parse GitHub URL
    let repoInfo;
    try {
      repoInfo = this.github.parseRepoUrl(input.gitUrl, input.branch);
      log('importFromGitHub: parsed repoInfo=%o', repoInfo);
    } catch (error) {
      log('importFromGitHub: failed to parse URL, error=%s', (error as Error).message);
      if (error instanceof GitHubParseError) {
        throw new SkillImportError(error.message, 'INVALID_URL');
      }
      throw error;
    }

    // 2. Download repository ZIP
    let zipBuffer;
    try {
      log('importFromGitHub: downloading repository ZIP...');
      zipBuffer = await this.github.downloadRepoZip(repoInfo);
      log('importFromGitHub: downloaded ZIP size=%d bytes', zipBuffer.length);
    } catch (error) {
      log('importFromGitHub: download failed, error=%s', (error as Error).message);
      if (error instanceof GitHubNotFoundError) {
        throw new SkillImportError(error.message, 'NOT_FOUND');
      }
      throw new SkillImportError(
        `Failed to download GitHub repository: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    // 3. Parse ZIP package (pass basePath for subdirectory imports, repack to save only skill files)
    log('importFromGitHub: parsing ZIP package with basePath=%s', repoInfo.path);
    const { manifest, content, resources, zipHash, skillZipBuffer } =
      await this.parser.parseZipPackage(zipBuffer, {
        basePath: repoInfo.path,
        repackSkillZip: true,
      });
    log(
      'importFromGitHub: parsed manifest=%o, resources count=%d, zipHash=%s, skillZipSize=%d',
      manifest,
      resources.size,
      zipHash,
      skillZipBuffer?.length ?? 0,
    );

    // 4. Generate identifier (use GitHub info for uniqueness, include path for subdirectory imports)
    const identifier = this.github.generateIdentifier(repoInfo);
    log('importFromGitHub: identifier=%s', identifier);

    // 5. Check for existing skill with same zipHash (deduplication)
    const existing = await this.skillModel.findByIdentifier(identifier);
    if (existing && existing.zipFileHash === zipHash) {
      log(
        'importFromGitHub: skill unchanged (same zipHash=%s), skipping update id=%s',
        zipHash,
        existing.id,
      );
      return { skill: existing, status: 'unchanged' };
    }

    // 6. Store resource files (only if skill is new or changed)
    log('importFromGitHub: storing %d resources...', resources.size);
    const resourceIds = zipHash
      ? await this.resourceService.storeResources(zipHash, resources)
      : {};
    log('importFromGitHub: stored resources=%o', resourceIds);

    // 7. Build manifest with repository info
    const fullManifest: SkillManifest = {
      ...manifest,
      repository: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
      sourceUrl: input.gitUrl,
    };

    // 8. Upload ZIP file to S3 and create globalFiles record (for zipFileHash foreign key)
    // Use skillZipBuffer (repacked skill-only ZIP) instead of full repo zipBuffer
    let zipFileHash: string | undefined;
    const zipToUpload = skillZipBuffer ?? zipBuffer;
    if (zipHash && zipToUpload) {
      const zipKey = `skills/zip/${zipHash}.zip`;
      await this.fileService.uploadBuffer(zipKey, zipToUpload, 'application/zip');
      // Use createGlobalFile directly - no need to create then delete user file record
      await this.fileService.createGlobalFile({
        fileHash: zipHash,
        fileType: 'application/zip',
        metadata: {
          dirname: 'skills/zip',
          filename: `${zipHash}.zip`,
          path: zipKey,
        },
        size: zipToUpload.length,
        url: zipKey,
      });
      zipFileHash = zipHash;
      log(
        'importFromGitHub: uploaded ZIP file, hash=%s, size=%d bytes',
        zipFileHash,
        zipToUpload.length,
      );
    }

    // 9. Update existing skill or create new
    if (existing) {
      log('importFromGitHub: skill exists but content changed, updating id=%s', existing.id);
      const skill = await this.skillModel.update(existing.id, {
        content,
        description: manifest.description,
        manifest: fullManifest,
        name: manifest.name,
        resources: resourceIds,
        zipFileHash,
      });
      log('importFromGitHub: updated skill id=%s', skill.id);
      return { skill, status: 'updated' };
    }

    // 10. Create new skill record
    log('importFromGitHub: creating new skill...');
    const skill = await this.skillModel.create({
      content,
      description: (manifest as any).description,
      identifier,
      manifest: fullManifest,
      name: manifest.name,
      resources: resourceIds,
      source: 'market', // GitHub source marked as market
      zipFileHash,
    });
    log('importFromGitHub: created skill id=%s', skill.id);
    return { skill, status: 'created' };
  }

  /**
   * Import skill from a direct URL pointing to SKILL.md
   * @param input - URL to SKILL.md file
   * @returns SkillImportResult with status: 'created' | 'updated' | 'unchanged'
   */
  async importFromUrl(input: ImportUrlInput): Promise<SkillImportResult> {
    log('importFromUrl: starting with url=%s', input.url);

    // 1. Validate URL
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new SkillImportError('Invalid URL format', 'INVALID_URL');
    }

    // 2. Fetch content (auto-detect SKILL.md or ZIP)
    let manifest: SkillManifest;
    let skillContent: string;
    let zipHash: string | undefined;
    let resources: Map<string, Buffer> | undefined;
    let zipBuffer: Buffer | undefined;

    try {
      log('importFromUrl: fetching URL...');
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

      let response: Response;
      try {
        response = await fetch(input.url, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new SkillImportError(`Resource not found at ${input.url}`, 'NOT_FOUND');
        }
        throw new SkillImportError(
          `Failed to fetch URL: ${response.status} ${response.statusText}`,
          'DOWNLOAD_FAILED',
        );
      }

      // Detect if it's a ZIP file based on URL or content-type
      // Use optional chaining for headers to handle mock responses in tests
      const contentType = response.headers?.get?.('content-type') || '';
      const isZip =
        url.pathname.endsWith('.zip') ||
        url.pathname.includes('/download') ||
        contentType.includes('application/zip') ||
        contentType.includes('application/octet-stream');

      if (isZip) {
        // Handle ZIP file
        log('importFromUrl: detected ZIP file, parsing as package...');
        zipBuffer = Buffer.from(await response.arrayBuffer());
        const parsed = await this.parser.parseZipPackage(zipBuffer);
        manifest = parsed.manifest;
        skillContent = parsed.content;
        zipHash = parsed.zipHash;
        resources = parsed.resources;
        log('importFromUrl: parsed ZIP, manifest=%o, resources count=%d', manifest, resources.size);
      } else {
        // Handle plain SKILL.md
        log('importFromUrl: detected SKILL.md, parsing as markdown...');
        const content = await response.text();
        const parsed = this.parser.parseSkillMd(content);
        manifest = parsed.manifest;
        skillContent = parsed.content;
        log('importFromUrl: parsed SKILL.md, manifest=%o', manifest);
      }
    } catch (error) {
      if (error instanceof SkillImportError || error instanceof SkillManifestError) throw error;
      log('importFromUrl: fetch error: %O', error);
      log('importFromUrl: error type: %s', error?.constructor?.name);
      log('importFromUrl: error message: %s', (error as Error).message);
      log('importFromUrl: error stack: %s', (error as Error).stack);
      throw new SkillImportError(
        `Failed to process URL: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    log('importFromUrl: parsed manifest=%o', manifest);

    // 4. Generate identifier based on URL host and path
    const pathPart = url.pathname
      .replace(/^\//, '') // Remove leading slash
      .replace(/\.md$/i, '') // Remove .md extension
      .replaceAll('/', '.'); // Replace slashes with dots
    const identifier = `url.${url.host}.${pathPart || 'skill'}`;
    log('importFromUrl: identifier=%s', identifier);

    // 5. Check for existing skill
    const existing = await this.skillModel.findByIdentifier(identifier);

    // 6. Build manifest with source URL
    const fullManifest: SkillManifest = {
      ...manifest,
      sourceUrl: input.url,
    };

    // 7. Handle ZIP resources if present
    let resourceMap: Record<string, { fileHash: string; size: number }> | undefined;
    if (resources && resources.size > 0 && zipHash) {
      log('importFromUrl: storing %d resource files...', resources.size);
      resourceMap = await this.resourceService.storeResources(zipHash, resources);
      log('importFromUrl: stored resource files');
    }

    // 8. Upload ZIP file to S3 and create globalFiles record (for zipFileHash foreign key)
    let zipFileHash: string | undefined;
    if (zipHash && zipBuffer) {
      const zipKey = `skills/zip/${zipHash}.zip`;
      await this.fileService.uploadBuffer(zipKey, zipBuffer, 'application/zip');
      // Use createGlobalFile directly - no need to create then delete user file record
      await this.fileService.createGlobalFile({
        fileHash: zipHash,
        fileType: 'application/zip',
        metadata: {
          dirname: 'skills/zip',
          filename: `${zipHash}.zip`,
          path: zipKey,
        },
        size: zipBuffer.length,
        url: zipKey,
      });
      zipFileHash = zipHash;
      log(
        'importFromUrl: uploaded ZIP file, hash=%s, size=%d bytes',
        zipFileHash,
        zipBuffer.length,
      );
    }

    // 9. Update existing skill or create new
    if (existing) {
      // Check if content is the same (simple deduplication based on content and zipHash)
      // Use nullish coalescing to handle null/undefined comparison correctly
      const existingHash = existing.zipFileHash ?? undefined;
      const isSameContent = existing.content === skillContent && existingHash === zipFileHash;
      if (isSameContent) {
        log('importFromUrl: skill unchanged, skipping update id=%s', existing.id);
        return { skill: existing, status: 'unchanged' };
      }

      log('importFromUrl: skill exists but content changed, updating id=%s', existing.id);
      const skill = await this.skillModel.update(existing.id, {
        content: skillContent,
        description: manifest.description,
        manifest: fullManifest,
        name: manifest.name,
        ...(resourceMap && { resources: resourceMap }),
        ...(zipFileHash && { zipFileHash }),
      });
      log('importFromUrl: updated skill id=%s', skill.id);
      return { skill, status: 'updated' };
    }

    // 10. Create new skill record
    log('importFromUrl: creating new skill...');
    const skill = await this.skillModel.create({
      content: skillContent,
      description: manifest.description,
      identifier,
      manifest: fullManifest,
      name: manifest.name,
      ...(resourceMap && { resources: resourceMap }),
      source: 'market', // URL source marked as market
      ...(zipFileHash && { zipFileHash }),
    });
    log('importFromUrl: created skill id=%s', skill.id);
    return { skill, status: 'created' };
  }
}
