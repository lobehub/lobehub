import { readFile } from 'node:fs/promises';

import { type LobeChatDatabase } from '@lobechat/database';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import {
  type CreateSkillInput,
  type ImportGitHubInput,
  type ImportUrlInput,
  type ImportZipInput,
  type ParsedZipSkill,
  type SkillImportResult,
  type SkillManifest,
  type SkillResourceMeta,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import {
  GitHub,
  GitHubNotFoundError,
  GitHubParseError,
  type GitHubRepoInfo,
  type GitHubTreeFile,
  stripSlashes,
} from '@/server/modules/GitHub';
import { FileService } from '@/server/services/file';

import { SkillImportError, SkillManifestError } from './errors';
import { SkillParser } from './parser';
import { SkillResourceService } from './resource';

const log = debug('lobe-chat:service:skill-importer');

/**
 * Repositories whose working-tree size (in MB) exceeds this threshold skip the
 * "download the whole archive" path and instead fetch only the skill
 * subdirectory file-by-file (raw + authenticated Contents API). Downloading +
 * decompressing an entire monorepo in memory is what previously triggered "ran
 * out of available memory" (OOM). Override via env for ops tuning.
 */
const GITHUB_ARCHIVE_MAX_SIZE_MB = Number(process.env.SKILL_IMPORT_MAX_REPO_SIZE_MB) || 30;

/** Max concurrent per-file fetches when downloading a subdirectory. */
const RAW_FETCH_CONCURRENCY = Number(process.env.SKILL_IMPORT_FETCH_CONCURRENCY) || 16;

/**
 * Safety cap on the skill subdirectory's total size for the per-file path. The
 * subdir is held in memory (Map of file buffers + the repacked ZIP), so this
 * bounds peak memory. ~58MB skill dirs import fine; anything beyond this is
 * rejected with a clear error instead of risking OOM. Override via env.
 */
const SUBDIR_MAX_SIZE_MB = Number(process.env.SKILL_IMPORT_MAX_SUBDIR_SIZE_MB) || 150;

export class SkillImporter {
  private skillModel: AgentSkillModel;
  private parser: SkillParser;
  private resourceService: SkillResourceService;
  private fileService: FileService;
  private github: GitHub;
  private userId: string;
  private workspaceId?: string;
  private workspaceRole?: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    options?: { workspaceRole?: string },
  ) {
    this.skillModel = new AgentSkillModel(db, userId, workspaceId);
    this.parser = new SkillParser();
    this.resourceService = new SkillResourceService(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
    // Tokens resolved from GITHUB_TOKENS / GITHUB_TOKEN inside GitHub.
    this.github = new GitHub({ userAgent: 'LobeHub-Skill-Importer' });
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.workspaceRole = options?.workspaceRole;
  }

  /**
   * Re-importing an identifier that resolves to a teammate's shared skill is
   * an overwrite — same creator/owner rule as the explicit update procedure.
   */
  private assertCanOverwrite(existing: { userId?: string | null }) {
    if (!this.workspaceId) return;
    if (this.workspaceRole === 'owner') return;
    if (existing.userId !== this.userId) {
      throw new SkillImportError(
        'Only the creator or a workspace owner can update this skill',
        'FORBIDDEN',
      );
    }
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
   * Import skill from GitHub repository.
   *
   * Routing (see {@link GITHUB_ARCHIVE_MAX_SIZE_MB}):
   * - Small repos → download the whole archive once and parse it in memory
   *   (one request; the original behavior, still the default).
   * - Large or unknown-size repos with a subdirectory path → fetch ONLY that
   *   subdirectory file-by-file (raw CDN, with an authenticated Contents-API
   *   fallback per file) and repack it. This downloads tens of MB instead of a
   *   multi-hundred-MB archive — the whole-archive buffer is what previously
   *   OOM-ed. A size cap guards against pathologically large subdirs.
   * - Large repos imported at the root → cannot be bounded to a subdir, rejected
   *   with a clear error instead of OOM-ing.
   *
   * GITHUB_TOKEN(S) is strongly recommended for large repos: subtree listing and
   * the per-file Contents-API fallback use the authenticated API (5000/h per
   * token vs 60/h anonymous), which is what makes fetching a many-file
   * subdirectory reliable.
   *
   * @param input - GitHub repository info
   * @returns SkillImportResult with status: 'created' | 'updated' | 'unchanged'
   */
  async importFromGitHub(input: ImportGitHubInput): Promise<SkillImportResult> {
    log('importFromGitHub: starting with gitUrl=%s, branch=%s', input.gitUrl, input.branch);

    // 1. Parse GitHub URL
    let repoInfo: GitHubRepoInfo;
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

    // 2. Probe repo size to decide between the whole-archive path (small) and the
    // per-file subdir path (large / unknown). A probe failure (rate-limited or
    // any API error) is non-fatal — `sizeKb` stays null (treated as unknown).
    let sizeKb: number | null = null;
    try {
      sizeKb = await this.github.getRepoSizeKb(repoInfo);
    } catch (error) {
      if (error instanceof GitHubNotFoundError) {
        throw new SkillImportError(error.message, 'NOT_FOUND');
      }
      log('importFromGitHub: repo size probe failed (non-fatal): %s', (error as Error).message);
    }
    const thresholdKb = GITHUB_ARCHIVE_MAX_SIZE_MB * 1024;
    const isLarge = sizeKb != null && sizeKb > thresholdKb;
    const unknownSize = sizeKb == null;
    log('importFromGitHub: sizeKb=%o thresholdKb=%d isLarge=%s', sizeKb, thresholdKb, isLarge);

    // 3. Acquire the parsed skill via the appropriate path.
    let parsed: ParsedZipSkill;
    if ((isLarge || unknownSize) && repoInfo.path) {
      parsed = await this.fetchSkillViaRawFiles(repoInfo, stripSlashes(repoInfo.path));
    } else if (isLarge) {
      throw new SkillImportError(
        `Repository is too large (~${Math.round((sizeKb as number) / 1024)}MB) to import at the ` +
          `root. Import a specific skill subdirectory instead, e.g. ` +
          `https://github.com/${repoInfo.owner}/${repoInfo.repo}/tree/${repoInfo.branch}/<path>`,
        'DOWNLOAD_FAILED',
      );
    } else {
      // Known-small repo, or root import with unknown size (best-effort, capped).
      parsed = await this.fetchSkillViaArchive(repoInfo);
    }

    return this.persistGitHubSkill(repoInfo, input, parsed);
  }

  /**
   * Subdirectory path for large/unknown repos: list the subtree, then fetch
   * SKILL.md and each resource file individually — raw CDN first, with an
   * authenticated Contents-API fallback per file (raw.githubusercontent.com
   * intermittently returns transient 400s under concurrent load even for valid
   * files; the authenticated API does not). Repacks in memory; only the
   * subdirectory is downloaded, and a size cap guards peak memory.
   */
  private async fetchSkillViaRawFiles(
    repoInfo: GitHubRepoInfo,
    basePath: string,
  ): Promise<ParsedZipSkill> {
    let files: GitHubTreeFile[];
    try {
      files = await this.github.listSubtree(repoInfo, basePath);
    } catch (error) {
      if (error instanceof GitHubNotFoundError) {
        throw new SkillImportError(error.message, 'NOT_FOUND');
      }
      throw new SkillImportError(
        `Failed to list repository subdirectory: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    const skillMdPath = `${basePath}/SKILL.md`;
    if (!files.some((file) => file.path === skillMdPath)) {
      throw new SkillImportError(`SKILL.md not found at ${basePath}`, 'NOT_FOUND');
    }

    const resourceFiles = files.filter(
      (file) => file.path !== skillMdPath && !file.path.includes('__MACOSX'),
    );

    // Guard peak memory: the subdir is held in memory (file buffers + repacked
    // ZIP). Reject pathologically large subdirs instead of risking OOM. `size`
    // is reported by the Tree API; missing sizes are treated as 0 (best-effort).
    const knownBytes = resourceFiles.reduce((sum, file) => sum + (file.size ?? 0), 0);
    const knownMb = Math.round(knownBytes / 1024 / 1024);
    if (knownBytes > SUBDIR_MAX_SIZE_MB * 1024 * 1024) {
      throw new SkillImportError(
        `Skill directory is too large (~${knownMb}MB > ${SUBDIR_MAX_SIZE_MB}MB limit). ` +
          `Set SKILL_IMPORT_MAX_SUBDIR_SIZE_MB to override.`,
        'DOWNLOAD_FAILED',
      );
    }

    const prefixLen = basePath.length + 1; // strip "basePath/"
    let skillMdContent: string;
    const resources = new Map<string, Buffer>();
    try {
      skillMdContent = await this.github.downloadRawFile({ ...repoInfo, filePath: skillMdPath });
      const buffers = await this.mapWithConcurrency(resourceFiles, RAW_FETCH_CONCURRENCY, (file) =>
        this.github.downloadRawFileBuffer({ ...repoInfo, filePath: file.path }),
      );
      resourceFiles.forEach((file, index) => {
        resources.set(file.path.slice(prefixLen), buffers[index]);
      });
      log('fetchSkillViaRawFiles: fetched %d files (~%dMB)', resources.size, knownMb);
    } catch (error) {
      if (error instanceof GitHubNotFoundError) {
        throw new SkillImportError(error.message, 'NOT_FOUND');
      }
      throw new SkillImportError(
        `Failed to download skill files: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    // Parser errors (invalid manifest etc.) propagate as-is, matching the
    // whole-archive path.
    return this.parser.packSkillFiles(skillMdContent, resources);
  }

  /**
   * Archive path: download the whole repo ZIP (with a size cap as a backstop)
   * and parse it, repacking only the skill files.
   */
  private async fetchSkillViaArchive(repoInfo: GitHubRepoInfo): Promise<ParsedZipSkill> {
    let zipBuffer: Buffer;
    try {
      log('importFromGitHub: downloading repository ZIP...');
      zipBuffer = await this.github.downloadRepoZip(repoInfo, {
        maxBytes: GITHUB_ARCHIVE_MAX_SIZE_MB * 1024 * 1024,
      });
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

    log('importFromGitHub: parsing ZIP package with basePath=%s', repoInfo.path);
    const parsed = await this.parser.parseZipPackage(zipBuffer, {
      basePath: repoInfo.path,
      repackSkillZip: true,
    });
    log(
      'importFromGitHub: parsed manifest=%o, resources count=%d, zipHash=%s, skillZipSize=%d',
      parsed.manifest,
      parsed.resources.size,
      parsed.zipHash,
      parsed.skillZipBuffer?.length ?? 0,
    );
    return parsed;
  }

  /**
   * Persist a skill parsed fully in memory (small-repo archive path): dedup,
   * store resources, upload the repacked skill ZIP, and create/update the record.
   */
  private async persistGitHubSkill(
    repoInfo: GitHubRepoInfo,
    input: ImportGitHubInput,
    parsed: ParsedZipSkill,
  ): Promise<SkillImportResult> {
    const { manifest, content, resources, zipHash, skillZipBuffer } = parsed;
    const identifier = this.github.generateIdentifier(repoInfo);

    const existing = await this.skillModel.findByIdentifier(identifier);
    // Dedup by zipHash; also re-import if content is missing (prior buggy import).
    if (existing && existing.zipFileHash === zipHash && existing.content != null) {
      log('importFromGitHub: skill unchanged (same zipHash=%s), id=%s', zipHash, existing.id);
      return { skill: existing, status: 'unchanged' };
    }

    log('importFromGitHub: storing %d resources...', resources.size);
    const resourceIds = zipHash
      ? await this.resourceService.storeResources(zipHash, resources)
      : {};

    const zipFileHash =
      zipHash && skillZipBuffer ? await this.uploadSkillZip(zipHash, skillZipBuffer) : undefined;

    return this.finalizeSkillRecord(repoInfo, input, {
      content,
      existing,
      identifier,
      manifest,
      resourceIds,
      zipFileHash,
    });
  }

  /**
   * Upload the repacked skill-only ZIP to S3 and create its globalFiles record
   * (for the zipFileHash foreign key). Returns the zip hash.
   */
  private async uploadSkillZip(zipHash: string, buffer: Buffer): Promise<string> {
    const zipKey = `skills/zip/${zipHash}.zip`;
    await this.fileService.uploadBuffer(zipKey, buffer, 'application/zip');
    // Use createGlobalFile directly - no need to create then delete user file record
    await this.fileService.createGlobalFile({
      fileHash: zipHash,
      fileType: 'application/zip',
      metadata: { dirname: 'skills/zip', filename: `${zipHash}.zip`, path: zipKey },
      size: buffer.length,
      url: zipKey,
    });
    log('importFromGitHub: uploaded ZIP file, hash=%s, size=%d bytes', zipHash, buffer.length);
    return zipHash;
  }

  /**
   * Shared tail for both GitHub persistence paths: build the full manifest and
   * create or update the skill record.
   */
  private async finalizeSkillRecord(
    repoInfo: GitHubRepoInfo,
    input: ImportGitHubInput,
    params: {
      content: string;
      existing: Awaited<ReturnType<AgentSkillModel['findByIdentifier']>>;
      identifier: string;
      manifest: SkillManifest;
      resourceIds: Record<string, SkillResourceMeta>;
      zipFileHash: string | undefined;
    },
  ): Promise<SkillImportResult> {
    const { content, existing, identifier, manifest, resourceIds, zipFileHash } = params;

    const fullManifest: SkillManifest = {
      ...manifest,
      repository: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
      sourceUrl: input.gitUrl,
    };

    if (existing) {
      this.assertCanOverwrite(existing);
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

    log('importFromGitHub: creating new skill...');
    const skill = await this.skillModel.create({
      content,
      description: manifest.description,
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
   * Map over items with a bounded number of concurrent async operations,
   * preserving input order in the result.
   */
  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = Array.from({ length: items.length }) as R[];
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  /**
   * Import skill from a direct URL pointing to SKILL.md
   * @param input - URL to SKILL.md file
   * @returns SkillImportResult with status: 'created' | 'updated' | 'unchanged'
   */
  async importFromUrl(
    input: ImportUrlInput,
    options?: { identifier?: string; source?: 'market' | 'user' },
  ): Promise<SkillImportResult> {
    log('importFromUrl: starting with url=%s', input.url);

    // 1. Validate URL
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new SkillImportError('Invalid URL format', 'INVALID_URL');
    }

    // 1.5. Detect GitHub repo/tree/blob URLs and delegate to importFromGitHub for full directory support
    // Only delegate URLs that parseRepoUrl can handle (owner/repo, tree, blob patterns).
    // Let direct download URLs (e.g. /archive/*.zip, /releases/download/*) fall through
    // to the generic fetch logic below which handles ZIP files correctly.
    if (
      url.hostname === 'github.com' &&
      /^\/[^/]+\/[^/]+(?:\/(?:tree|blob)\/.+)?$/.test(url.pathname.replace(/\/+$/, ''))
    ) {
      log('importFromUrl: detected GitHub repo URL, delegating to importFromGitHub');
      return this.importFromGitHub({ gitUrl: input.url });
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
        // Use ssrfSafeFetch (not raw global fetch): input.url is fully user-controlled,
        // so a raw fetch would let an authenticated user make the server request arbitrary
        // internal hosts / cloud metadata (SSRF), and the body is stored and returned to the
        // caller — a full-read SSRF. ssrfSafeFetch blocks private/link-local IPs at connect
        // time and re-checks every redirect hop. See GHSA-53h9-fmjf-frwr / #16536.
        response = await ssrfSafeFetch(input.url, { signal: controller.signal });
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
    const identifier = options?.identifier || `url.${url.host}.${pathPart || 'skill'}`;
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

      this.assertCanOverwrite(existing);
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
      source: options?.source || 'market', // URL source defaults to market
      ...(zipFileHash && { zipFileHash }),
    });
    log('importFromUrl: created skill id=%s', skill.id);
    return { skill, status: 'created' };
  }
}
