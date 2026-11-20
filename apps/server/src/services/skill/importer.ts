import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { type LobeChatDatabase } from '@lobechat/database';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import {
  type CreateSkillInput,
  type GitHubSkillBatchInput,
  type GitHubSkillCandidate,
  type GitHubSkillDiscovery,
  type GitHubSkillOutcome,
  type ImportGitHubInput,
  type ImportUrlInput,
  type ImportZipInput,
  type ParsedZipSkill,
  type SkillImportResult,
  type SkillItem,
  type SkillManifest,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import {
  GitHub,
  GitHubError,
  GitHubNotFoundError,
  GitHubParseError,
  GitHubRateLimitError,
  type GitHubRepoInfo,
} from '@/server/modules/GitHub';
import { FileService } from '@/server/services/file';
import type { MarketService } from '@/server/services/market';
import { redisService } from '@/server/services/redis';

import { SkillImportError, SkillManifestError, SkillParseError } from './errors';
import { readGitHubArchive } from './githubArchive';
import { GitHubSkillRepository } from './githubRepository';
import {
  checkGitHubRows,
  installedFingerprint,
  isCommit,
  needsTrackingRef,
  revisionOf as installedRevision,
} from './githubUpdates';
import { SkillParser } from './parser';
import { SkillResourceService } from './resource';

const sourceKey = (info: GitHubRepoInfo) =>
  JSON.stringify([info.owner.toLowerCase(), info.repo.toLowerCase(), info.path ?? '']);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const revisionOf = (skill?: SkillItem) => (skill ? installedRevision(skill) : null);
const unchanged = (skill: SkillItem, parsed: ParsedZipSkill) =>
  !!parsed.zipHash &&
  skill.zipFileHash === parsed.zipHash &&
  skill.content === parsed.content &&
  skill.name === parsed.manifest.name &&
  skill.description === parsed.manifest.description;

const log = debug('lobe-chat:service:skill-importer');

/** GitHub and package failures reach the client as import errors, not as a 500. */
const asImportError = (error: unknown): never => {
  if (error instanceof GitHubNotFoundError) throw new SkillImportError(error.message, 'NOT_FOUND');
  if (error instanceof GitHubParseError) throw new SkillImportError(error.message, 'INVALID_URL');
  if (
    error instanceof GitHubError ||
    error instanceof SkillParseError ||
    error instanceof SkillManifestError
  )
    throw new SkillImportError(error.message, 'DOWNLOAD_FAILED');
  throw error;
};

export class SkillImporter {
  private skillModel: AgentSkillModel;
  private parser: SkillParser;
  private resourceService: SkillResourceService;
  private fileService: FileService;
  private github: GitHub;
  private repository: GitHubSkillRepository;
  private userId: string;
  private workspaceId?: string;
  private workspaceRole?: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    options?: { githubProxy?: MarketService['proxyOAuthRequest']; workspaceRole?: string },
  ) {
    this.skillModel = new AgentSkillModel(db, userId, workspaceId);
    this.parser = new SkillParser();
    this.resourceService = new SkillResourceService(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
    this.github = new GitHub({ userAgent: 'LobeHub-Skill-Importer' });
    this.repository = new GitHubSkillRepository(this.github, options?.githubProxy);
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
      await cleanup();
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
      repoInfo = this.github.parseRepoUrl(input.gitUrl, input.branch ?? 'HEAD');
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
    let commit: string;
    try {
      log('importFromGitHub: downloading repository ZIP...');
      ({ buffer: zipBuffer, commit } = await this.downloadRef(repoInfo));
      log('importFromGitHub: downloaded ZIP size=%d bytes', zipBuffer.length);
    } catch (error) {
      log('importFromGitHub: download failed, error=%s', (error as Error).message);
      if (error instanceof SkillImportError) throw error;
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
    const parsed = await this.parser.parseZipPackage(zipBuffer, {
      basePath: repoInfo.path,
      fallbackName: repoInfo.path?.split('/').at(-1) || repoInfo.repo,
      repackSkillZip: true,
    });
    return this.saveGitHubSkill(repoInfo, input.gitUrl, parsed, commit, zipBuffer);
  }

  /**
   * Resolve a ref live. Update checks share the answer, so they never offer an
   * older commit than the one this import is about to install.
   */
  private async resolveCommit(info: GitHubRepoInfo) {
    return (await this.repository.resolveCommit(info)).commit;
  }

  private async downloadRef(info: GitHubRepoInfo) {
    try {
      const commit = await this.resolveCommit(info);
      return { buffer: await this.repository.downloadCommitZip(info, commit), commit };
    } catch (error) {
      if (!(error instanceof GitHubRateLimitError)) throw error;
      // The REST quota is shared by everyone behind this server's address. The
      // ref's archive needs none of it and names the commit it was cut from.
      log('downloadRef: rate limited, reading the commit from the ref archive');
      const archive = await this.github.downloadRefZip(info).catch((fallback) => {
        log('downloadRef: ref archive failed, error=%s', (fallback as Error).message);
        throw error;
      });
      await redisService.gitHubRefs.record(info, archive.commit);
      return archive;
    }
  }

  private gitHubIdentifiers(info: GitHubRepoInfo) {
    const legacy = this.github.generateIdentifier(info);
    return { legacy, identifier: `${legacy}-${digest(sourceKey(info)).slice(0, 20)}` };
  }

  private installedSource(skill: SkillItem): GitHubRepoInfo | undefined {
    if (skill.upstream) {
      const { owner, repo, path, ref } = skill.upstream;
      return { branch: ref, owner, path, repo };
    }
    if (skill.source !== 'market' || !skill.manifest.sourceUrl) return;
    // A manifest may contain an author's repository link. Match the importer's
    // identity as well before adopting a legacy row. Preserve a missing ref:
    // older clients could send the branch separately from the URL.
    try {
      const info = this.github.parseRepoUrl(skill.manifest.sourceUrl, '');
      const { identifier, legacy } = this.gitHubIdentifiers(info);
      if (skill.identifier === identifier || skill.identifier === legacy) return info;
    } catch {
      return;
    }
  }

  async checkGitHubUpdates() {
    const rows = await this.skillModel.findGitHubInstalls();
    return checkGitHubRows(
      rows.flatMap((skill) => {
        const info = this.installedSource(skill);
        return info ? [{ info, skill }] : [];
      }),
      this.repository,
      this.parser,
    );
  }

  private async installedForUpdate(id: string, revision: string) {
    const skill = await this.skillModel.findById(id);
    const info = skill && this.installedSource(skill);
    if (!skill || !info) throw new SkillImportError('GitHub installation not found', 'NOT_FOUND');
    this.assertCanOverwrite(skill);
    if (revisionOf(skill) !== revision)
      throw new SkillImportError(
        'The installed skill changed. Check for updates again.',
        'CONFLICT',
      );
    return { info, skill };
  }

  async trackLegacyGitHubSkill(id: string, revision: string, ref: string) {
    const { info, skill } = await this.installedForUpdate(id, revision);
    if (!needsTrackingRef(skill, info))
      throw new SkillImportError('This skill already has a tracking ref', 'CONFLICT');
    if (isCommit(ref)) throw new SkillImportError('Choose a tracking branch', 'INVALID_URL');
    const tracking = { ...info, branch: ref };
    const archive = await this.resolveCommit(tracking)
      .then(async (commit) =>
        readGitHubArchive(await this.repository.downloadCommitZip(info, commit), info.path),
      )
      .catch(asImportError);
    if (!archive.get(info.path ?? ''))
      throw new SkillImportError('Skill not found on this branch', 'NOT_FOUND');
    const row = await this.skillModel.replaceImportedSkill(skill, {
      upstream: {
        owner: info.owner,
        repo: info.repo,
        path: info.path ?? '',
        ref,
        installedCommit: info.branch || undefined,
      },
    });
    if (!row) throw new SkillImportError('The installed skill changed', 'CONFLICT');
    return row;
  }

  async applyGitHubUpdate(input: {
    id: string;
    commit: string;
    revision: string;
    overwriteLocal?: boolean;
  }) {
    const { info, skill } = await this.installedForUpdate(input.id, input.revision);
    if (needsTrackingRef(skill, info))
      throw new SkillImportError('Choose a tracking branch before updating', 'CONFLICT');
    if (isCommit(info.branch))
      throw new SkillImportError('This installation is pinned', 'CONFLICT');
    if (
      !input.overwriteLocal &&
      skill.upstream?.installedFingerprint !== installedFingerprint(skill)
    )
      throw new SkillImportError('Confirm replacement of local changes', 'CONFLICT');
    const parsed = await this.repository
      .downloadCommitZip(info, input.commit)
      .then((buffer) =>
        this.parser.parseZipPackage(buffer, {
          basePath: info.path,
          fallbackName: info.path?.split('/').at(-1) || info.repo,
          repackSkillZip: true,
        }),
      )
      .catch(asImportError);
    return this.saveGitHubSkill(
      info,
      this.snapshotUrl(info, input.commit),
      parsed,
      input.commit,
      undefined,
      input.revision,
    );
  }

  private snapshotUrl(info: GitHubRepoInfo, commit: string) {
    return `https://github.com/${info.owner}/${info.repo}/tree/${commit}${info.path ? '/' + info.path.split('/').map(encodeURIComponent).join('/') : ''}`;
  }

  private gitHubTarget(info: GitHubRepoInfo, byIdentifier: Map<string, SkillItem>) {
    const { identifier, legacy } = this.gitHubIdentifiers(info);
    const exact = byIdentifier.get(identifier);
    const existing = exact ?? byIdentifier.get(legacy);
    const stored = existing && this.installedSource(existing);
    if (existing && stored && sourceKey(stored) === sourceKey(info))
      return { existing, identifier: existing.identifier };
    if (exact) throw new SkillImportError('Source identifier already in use', 'CONFLICT');
    return { existing: undefined, identifier };
  }

  private async saveGitHubSkill(
    info: GitHubRepoInfo,
    sourceUrl: string,
    parsed: ParsedZipSkill,
    commit: string,
    originalZip?: Buffer,
    expectedRevision?: string | null,
  ): Promise<SkillImportResult> {
    const { content, manifest, resources, zipHash, skillZipBuffer } = parsed;
    const upstream = {
      owner: info.owner,
      repo: info.repo,
      path: info.path ?? '',
      ref: info.branch,
      installedCommit: commit,
    };
    // Replaying a create-only batch may find the same package already installed.
    // Leave its subsequent tracking choice alone.
    const matches = (skill: SkillItem) =>
      unchanged(skill, parsed) &&
      (expectedRevision === null ||
        (skill.upstream?.ref === info.branch && skill.upstream.installedCommit === commit));
    const inspect = async (model: AgentSkillModel, expected?: string | null) => {
      const { identifier, legacy } = this.gitHubIdentifiers(info);
      const rows = await model.findImportMatches([identifier, legacy], [manifest.name]);
      const target = this.gitHubTarget(info, new Map(rows.map((row) => [row.identifier, row])));

      const { existing } = target;
      if (existing && matches(existing)) return target;
      if (expected !== undefined && revisionOf(existing) !== expected)
        throw new SkillImportError('The installed skill changed. Find skills again.', 'CONFLICT');
      if (existing) this.assertCanOverwrite(existing);
      const named = rows.find((row) => row.name.toLowerCase() === manifest.name.toLowerCase());
      if (named && named.id !== existing?.id)
        throw new SkillImportError('Skill name already in use', 'CONFLICT');
      return target;
    };
    const before = await inspect(this.skillModel, expectedRevision);
    if (before.existing && matches(before.existing))
      return { skill: before.existing, status: 'unchanged' };

    // An unchanged package can acquire tracking (or follow another branch)
    // without uploading its resources again or replacing local metadata.
    if (before.existing && unchanged(before.existing, parsed)) {
      const skill = await this.skillModel.replaceImportedSkill(before.existing, {
        upstream: {
          ...upstream,
          installedFingerprint: before.existing.upstream?.installedFingerprint,
        },
      });
      if (!skill)
        throw new SkillImportError('The installed skill changed. Find skills again.', 'CONFLICT');
      return { skill, status: 'unchanged' };
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
      repository: `https://github.com/${info.owner}/${info.repo}`,
      sourceUrl,
    };

    // 8. Upload ZIP file to S3 and create globalFiles record (for zipFileHash foreign key)
    // Use skillZipBuffer (repacked skill-only ZIP) instead of full repo zipBuffer
    let zipFileHash: string | undefined;
    const zipToUpload = skillZipBuffer ?? originalZip;
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

    return this.skillModel.withImportLock(async (model) => {
      const { identifier, existing } = await inspect(model, revisionOf(before.existing));
      if (existing && matches(existing)) return { skill: existing, status: 'unchanged' };
      const data = {
        content,
        description: manifest.description,
        manifest: fullManifest,
        name: manifest.name,
        resources: resourceIds,
        zipFileHash,
      };
      const tracking = { ...upstream, installedFingerprint: installedFingerprint(data) };
      if (existing) {
        const skill = await model.replaceImportedSkill(existing, {
          ...data,
          upstream: tracking,
        });
        if (!skill)
          throw new SkillImportError('The installed skill changed. Find skills again.', 'CONFLICT');
        return { skill, status: unchanged(existing, parsed) ? 'unchanged' : 'updated' };
      }
      const skill = await model.create({
        ...data,
        identifier,
        source: 'market',
        upstream: tracking,
      });
      return { skill, status: 'created' };
    });
  }

  private get importScope() {
    return digest(JSON.stringify([this.userId, this.workspaceId ?? null]));
  }

  private async gitHubCollection(gitUrl: string, pinnedCommit?: string) {
    const url = new URL(gitUrl);
    const info = this.github.parseRepoUrl(url.origin + url.pathname.replace(/\/+$/, ''), 'HEAD');
    const commit = pinnedCommit ?? (await this.resolveCommit(info));
    const base = info.path ?? '';
    const archive = await readGitHubArchive(
      await this.repository.downloadCommitZip(info, commit),
      base,
    );
    const exact = url.pathname.split('/')[3] === 'blob' || (!!base && archive.has(base));
    const directories = [...archive].filter(([path]) =>
      exact ? path === base : !base || path === base || path.startsWith(base + '/'),
    );
    return { commit, directories, info };
  }

  async discoverGitHubSkills(gitUrl: string): Promise<GitHubSkillDiscovery> {
    const { commit, directories, info } = await this.gitHubCollection(gitUrl).catch(asImportError);
    const entries = directories.map(([path, directory]) => {
      const fallbackName = path.split('/').at(-1) || info.repo;
      const source = { ...info, path };
      try {
        const { manifest } = this.parser.parseSkillMd(directory.markdown, { fallbackName });
        return { path, directory, source, fallbackName, manifest };
      } catch {
        return { path, directory, source, fallbackName };
      }
    });
    const rows = await this.skillModel.findImportMatches(
      entries.flatMap(({ source }) => Object.values(this.gitHubIdentifiers(source))),
      entries.flatMap(({ manifest }) => (manifest ? [manifest.name] : [])),
    );
    const byIdentifier = new Map(rows.map((row) => [row.identifier, row]));
    const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
    const candidates: GitHubSkillCandidate[] = [];
    for (const { path, directory, source, manifest, fallbackName } of entries) {
      if (!manifest) {
        candidates.push({
          description: '',
          name: fallbackName,
          path,
          revision: null,
          status: 'invalid',
        });
        continue;
      }
      const named = byName.get(manifest.name.toLowerCase());
      let existing: SkillItem | undefined;
      try {
        existing = this.gitHubTarget(source, byIdentifier).existing;
      } catch (error) {
        if (!(error instanceof SkillImportError)) throw error;
        candidates.push({
          description: manifest.description,
          name: manifest.name,
          path,
          revision: null,
          status: 'conflict',
        });
        continue;
      }
      let status: GitHubSkillCandidate['status'] = 'new';
      if (named && named.id !== existing?.id) status = 'conflict';
      else if (existing) {
        const parsed = await this.parser.parseGitHubDirectory(directory, fallbackName);
        if (unchanged(existing, parsed)) status = 'unchanged';
        else if (
          this.workspaceId &&
          this.workspaceRole !== 'owner' &&
          existing.userId !== this.userId
        )
          status = 'forbidden';
        else status = 'update';
      }
      candidates.push({
        description: manifest.description,
        name: manifest.name,
        path,
        revision: revisionOf(existing),
        status,
      });
    }
    candidates.sort((a, b) => a.path.localeCompare(b.path));
    return { candidates, commit, scope: this.importScope };
  }

  async importGitHubSkills(input: GitHubSkillBatchInput): Promise<GitHubSkillOutcome[]> {
    if (this.importScope !== input.scope)
      throw new SkillImportError('The active library changed. Find skills again.', 'CONFLICT');
    const { directories, info } = await this.gitHubCollection(input.gitUrl, input.commit).catch(
      asImportError,
    );
    const available = new Map(directories);
    const results: GitHubSkillOutcome[] = [];
    for (const { path, revision } of input.selections) {
      try {
        const directory = available.get(path);
        if (!directory) throw new SkillImportError('Skill outside selected scope', 'NOT_FOUND');
        const parsed = await this.parser.parseGitHubDirectory(
          directory,
          path.split('/').at(-1) || info.repo,
        );
        const sourceUrl = this.snapshotUrl({ ...info, path }, input.commit);
        const result = await this.saveGitHubSkill(
          { ...info, path },
          sourceUrl,
          parsed,
          input.commit,
          undefined,
          revision,
        );
        results.push({ path, status: result.status });
      } catch (error) {
        log('GitHub skill import failed for %s: %O', path, error);
        const code = error instanceof SkillImportError ? error.code : undefined;
        results.push({
          path,
          status: code === 'CONFLICT' ? 'conflict' : code === 'FORBIDDEN' ? 'forbidden' : 'failed',
        });
      }
    }
    return results;
  }

  /**
   * Import skill from a direct URL pointing to SKILL.md
   * @param input - URL to SKILL.md file
   * @returns SkillImportResult with status: 'created' | 'updated' | 'unchanged'
   */
  async importFromUrl(
    input: ImportUrlInput,
    options?: { identifier?: string; overwrite?: boolean; source?: 'market' | 'user' },
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

    // Create abort controller for timeout. It stays armed until the body has been read:
    // ssrfSafeFetch resolves at the headers and streams the body under the same signal.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    try {
      log('importFromUrl: fetching URL...');
      // Use ssrfSafeFetch (not raw global fetch): input.url is fully user-controlled,
      // so a raw fetch would let an authenticated user make the server request arbitrary
      // internal hosts / cloud metadata (SSRF), and the body is stored and returned to the
      // caller — a full-read SSRF. ssrfSafeFetch blocks private/link-local IPs at connect
      // time and re-checks every redirect hop. See GHSA-53h9-fmjf-frwr / #16536.
      const response = await ssrfSafeFetch(input.url, { signal: controller.signal });

      if (!response.ok) {
        // The error body is never read; release its connection now rather than at GC.
        await response.body?.cancel().catch(() => {});
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
        const parsed = await this.parser.parseZipPackage(zipBuffer, {
          fallbackName: options?.identifier,
        });
        manifest = parsed.manifest;
        skillContent = parsed.content;
        zipHash = parsed.zipHash;
        resources = parsed.resources;
        log('importFromUrl: parsed ZIP, manifest=%o, resources count=%d', manifest, resources.size);
      } else {
        // Handle plain SKILL.md
        log('importFromUrl: detected SKILL.md, parsing as markdown...');
        const content = await response.text();
        const parsed = this.parser.parseSkillMd(content, { fallbackName: options?.identifier });
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
    } finally {
      clearTimeout(timeoutId);
    }

    log('importFromUrl: parsed manifest=%o', manifest);

    // 4. Generate identifier based on URL host and path
    const pathPart = url.pathname
      .replace(/^\//, '') // Remove leading slash
      .replace(/\.md$/i, '') // Remove .md extension
      .replaceAll('/', '.'); // Replace slashes with dots
    const urlIdentifier = `url.${url.host}.${pathPart || 'skill'}`;
    const identifier = options?.identifier || urlIdentifier;
    log('importFromUrl: identifier=%s', identifier);

    // 5. Check for existing skill
    let existing = await this.skillModel.findByIdentifier(identifier);

    // Dependency installation never updates an installed row, including user
    // imports that happen to carry the same source URL. Recheck here after the
    // download as another request may have installed the skill in the meantime.
    if (existing && options?.overwrite === false) {
      if (existing.source === 'market') return { skill: existing, status: 'unchanged' };
      throw new SkillImportError(
        `A skill with identifier "${identifier}" is already installed from another source`,
        'CONFLICT',
      );
    }

    // A user may have authored a skill under this very identifier. Only treat
    // the row as this import when it came from the market or from this same
    // URL; otherwise updating it would overwrite the user's own skill.
    if (existing && existing.source !== 'market' && existing.manifest?.sourceUrl !== input.url) {
      throw new SkillImportError(
        `A skill with identifier "${identifier}" is already installed from another source (name: ${existing.name}). Delete it before importing this one.`,
        'CONFLICT',
      );
    }

    // Older agent-tool imports keyed market skills by the URL-derived
    // identifier. Look that row up too, so a skill whose manifest name changed
    // since then is still updated in place rather than installed twice. Only
    // take it when it was fetched from this same URL: a user skill may carry
    // that identifier explicitly and must not be overwritten.
    if (!existing && identifier !== urlIdentifier && options?.overwrite !== false) {
      const legacy = await this.skillModel.findByIdentifier(urlIdentifier);
      if (legacy?.manifest?.sourceUrl === input.url) existing = legacy;
    }

    // Names are unique per scope, so the same skill already installed under yet
    // another identifier would fail the insert below with a raw DB error. A
    // same-name row fetched from the same URL is this skill; any other
    // same-name row is a real conflict the caller must resolve.
    if (!existing) {
      const sameName = await this.skillModel.findByName(manifest.name);
      if (sameName) {
        if (options?.overwrite === false || sameName.manifest?.sourceUrl !== input.url) {
          throw new SkillImportError(
            `A skill named "${manifest.name}" is already installed (identifier: ${sameName.identifier}). Use the installed skill, or delete it before importing this one.`,
            'CONFLICT',
          );
        }
        existing = sameName;
      }
    }

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
