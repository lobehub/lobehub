import type { LobeChatDatabase } from '@lobechat/database';

import { AgentDocumentModel, PolicyLoad } from '@/database/models/agentDocuments';

import type { AgentDocumentEditorSnapshot } from '../agentDocuments/headlessEditor';
import { DocumentService } from '../document';
import {
  AGENT_SKILL_TEMPLATE_ID,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
  SKILL_INDEX_FILENAME,
  SKILL_MANAGEMENT_SOURCE,
  SKILL_MANAGEMENT_SOURCE_TYPE,
} from './constants';
import {
  normalizeSkillIndexContent,
  parseSkillFrontmatter,
  renderSkillIndexContent,
  validateSkillName,
} from './frontmatter';
import type {
  CreateSkillInput,
  GetSkillInput,
  ListSkillsInput,
  RenameSkillInput,
  ReplaceSkillIndexInput,
  SkillAgentDocument,
  SkillDetail,
  SkillDocumentRef,
  SkillSummary,
  SkillTargetInput,
} from './types';

type SkillManagementAgentDocumentModel = Pick<
  AgentDocumentModel,
  | 'convertAgentDocumentToSkillIndex'
  | 'convertAgentDocumentToSkillIndexWithTx'
  | 'create'
  | 'createWithTx'
  | 'findByDocumentId'
  | 'findById'
  | 'listByParent'
  | 'listByParentAndFilename'
  | 'update'
  | 'updateDocumentIdentity'
>;

/**
 * Optional dependency overrides used by focused service tests and alternate runtimes.
 */
interface SkillManagementDocumentServiceDeps {
  /** Agent document persistence adapter. */
  agentDocumentModel: SkillManagementAgentDocumentModel;
  /** Markdown-to-editor snapshot projector. */
  createMarkdownEditorSnapshot?: (content: string) => Promise<AgentDocumentEditorSnapshot>;
  /** Document history service dependency. */
  documentService: Pick<DocumentService, 'trySaveCurrentDocumentHistory'>;
}

const createEmptyEditorData = (): Record<string, unknown> => ({
  root: { children: [], type: 'root' },
});

const toDocumentRef = (doc: SkillAgentDocument): SkillDocumentRef => ({
  agentDocumentId: doc.id,
  documentId: doc.documentId,
  filename: doc.filename,
  title: doc.title,
});

const buildSkillMetadata = (
  frontmatter: ReturnType<typeof parseSkillFrontmatter>,
): Record<string, unknown> => ({
  skill: { frontmatter },
});

/**
 * Owns managed skill bundle and index document invariants.
 *
 * Use when:
 * - Creating, reading, replacing, or renaming Agent Signal managed skills.
 * - Callers need stable `agentDocumentId` and backing `documentId` semantics.
 *
 * Expects:
 * - Managed skills are represented as a `skills/bundle` parent document and one `skills/index` child.
 * - `agentDocumentId` values refer to `agent_documents.id`.
 *
 * Returns:
 * - Skill summaries/details that preserve both binding ids and backing document ids.
 */
export class SkillManagementDocumentService {
  private agentDocumentModel: SkillManagementAgentDocumentModel;
  private documentService: Pick<DocumentService, 'trySaveCurrentDocumentHistory'>;

  constructor(
    private db: LobeChatDatabase,
    userId: string,
    deps?: SkillManagementDocumentServiceDeps,
  ) {
    this.agentDocumentModel = deps?.agentDocumentModel ?? new AgentDocumentModel(db, userId);
    this.documentService = deps?.documentService ?? new DocumentService(db, userId);
  }

  /**
   * Creates a managed skill bundle and its SKILL.md index.
   *
   * Use when:
   * - Agent Signal needs to persist a new managed skill.
   * - A hinted ordinary agent document should be converted into the index while keeping ids.
   *
   * Expects:
   * - `name` is a stable lowercase skill name.
   * - `bodyMarkdown` is Markdown body content without YAML frontmatter.
   *
   * Returns:
   * - The created skill detail with normalized frontmatter content.
   */
  async createSkill(input: CreateSkillInput): Promise<SkillDetail> {
    const name = validateSkillName(input.name);
    const normalizedContent = renderSkillIndexContent({
      bodyMarkdown: input.bodyMarkdown,
      description: input.description,
      name,
    });
    const frontmatter = parseSkillFrontmatter(normalizedContent);
    const metadata = buildSkillMetadata(frontmatter);
    const duplicateBundles = (
      await this.agentDocumentModel.listByParentAndFilename(input.agentId, null, name)
    ).filter((doc) => doc.fileType === SKILL_BUNDLE_FILE_TYPE);

    if (duplicateBundles.length > 0) {
      throw new Error('Skill already exists');
    }

    // REVIEW(@nekomeowww):
    // Direct Agent Document VFS writes, including `lb agent space fs`, can create skill-shaped
    // bundle/index documents without going through this service. Should we support importing or
    // normalizing those compatibility documents here so they become first-class managed skills?
    const sourceDocument = input.sourceAgentDocumentId
      ? await this.agentDocumentModel.findById(input.sourceAgentDocumentId)
      : undefined;

    if (input.sourceAgentDocumentId && !sourceDocument) {
      throw new Error(`Source agent document not found: ${input.sourceAgentDocumentId}`);
    }

    if (sourceDocument && sourceDocument.agentId !== input.agentId) {
      throw new Error(
        `Source agent document does not belong to agent ${input.agentId}: ${input.sourceAgentDocumentId}`,
      );
    }

    const { bundle, index } = await this.db.transaction(async (trx) => {
      const bundle = await this.agentDocumentModel.createWithTx(trx, input.agentId, name, '', {
        editorData: createEmptyEditorData(),
        fileType: SKILL_BUNDLE_FILE_TYPE,
        metadata,
        policyLoad: PolicyLoad.DISABLED,
        source: SKILL_MANAGEMENT_SOURCE,
        sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: input.title,
      });

      if (input.sourceAgentDocumentId) {
        const index = await this.agentDocumentModel.convertAgentDocumentToSkillIndexWithTx(trx, {
          agentDocumentId: input.sourceAgentDocumentId,
          content: normalizedContent,
          filename: SKILL_INDEX_FILENAME,
          metadata,
          parentId: bundle.documentId,
          source: SKILL_MANAGEMENT_SOURCE,
          sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
          title: SKILL_INDEX_FILENAME,
        });

        if (!index) {
          throw new Error(`Source agent document not found: ${input.sourceAgentDocumentId}`);
        }

        return { bundle, index };
      }

      const index = await this.agentDocumentModel.createWithTx(
        trx,
        input.agentId,
        SKILL_INDEX_FILENAME,
        normalizedContent,
        {
          fileType: SKILL_INDEX_FILE_TYPE,
          metadata,
          parentId: bundle.documentId,
          policyLoad: PolicyLoad.DISABLED,
          source: SKILL_MANAGEMENT_SOURCE,
          sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
          templateId: AGENT_SKILL_TEMPLATE_ID,
          title: SKILL_INDEX_FILENAME,
        },
      );

      return { bundle, index };
    });

    return this.toSkillDetail(bundle, index, { includeContent: true });
  }

  /**
   * Lists managed skills owned by an agent.
   *
   * Use when:
   * - Rendering a skill picker or preparing worker context.
   * - Callers need summaries without index document content.
   *
   * Expects:
   * - Corrupt bundles should be surfaced as errors instead of hidden.
   *
   * Returns:
   * - Skill summaries sorted by stable skill name.
   */
  async listSkills(input: ListSkillsInput): Promise<SkillSummary[]> {
    const bundles = (await this.agentDocumentModel.listByParent(input.agentId, null)).filter(
      (doc) => doc.fileType === SKILL_BUNDLE_FILE_TYPE,
    );
    const duplicateNames = new Set<string>();
    const seenNames = new Set<string>();

    for (const bundle of bundles) {
      if (seenNames.has(bundle.filename)) duplicateNames.add(bundle.filename);
      seenNames.add(bundle.filename);
    }

    if (duplicateNames.size > 0) {
      throw new Error(
        `Corrupt managed skills: duplicate bundle names ${[...duplicateNames].join(', ')}`,
      );
    }

    const summaries = await Promise.all(
      bundles.map(async (bundle) => {
        const index = await this.getSingleIndex(input.agentId, bundle);
        return this.toSkillSummary(bundle, index);
      }),
    );

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Reads one managed skill by stable name or agent document binding id.
   *
   * Use when:
   * - A tool call targets a skill by name.
   * - A tool outcome references a known `agentDocumentId`.
   *
   * Expects:
   * - Exactly one identifier is useful; `agentDocumentId` takes precedence when both are present.
   *
   * Returns:
   * - The matching skill detail, or `undefined` when no bundle is found.
   */
  async getSkill(input: GetSkillInput): Promise<SkillDetail | undefined> {
    const resolved = await this.resolveBundle(input.agentId, input);
    if (!resolved) return undefined;

    const index = await this.getSingleIndex(input.agentId, resolved);
    return this.toSkillDetail(resolved, index, { includeContent: input.includeContent });
  }

  /**
   * Replaces a managed skill index while preserving document ids.
   *
   * Use when:
   * - Agent Signal refines an existing skill.
   * - The current backing document needs a history snapshot before mutation.
   *
   * Expects:
   * - The target resolves to a live managed skill bundle.
   * - Incoming bodyMarkdown has no YAML frontmatter.
   *
   * Returns:
   * - Updated skill detail with index content included.
   */
  async replaceSkillIndex(input: ReplaceSkillIndexInput): Promise<SkillDetail | undefined> {
    const resolved = await this.resolveBundle(input.agentId, input);
    if (!resolved) return undefined;

    const index = await this.getSingleIndex(input.agentId, resolved);
    const description = input.description ?? parseSkillFrontmatter(index.content).description;
    const normalizedContent = renderSkillIndexContent({
      bodyMarkdown: input.bodyMarkdown,
      description,
      name: resolved.filename,
    });
    const frontmatter = parseSkillFrontmatter(normalizedContent);
    const metadata = buildSkillMetadata(frontmatter);

    await this.documentService.trySaveCurrentDocumentHistory(index.documentId, 'llm_call');
    const updatedBundle =
      (await this.agentDocumentModel.updateDocumentIdentity(resolved.id, {
        metadata,
      })) ?? resolved;
    await this.agentDocumentModel.update(index.id, {
      content: normalizedContent,
      metadata,
      policyLoad: PolicyLoad.DISABLED,
    });

    const updated = await this.agentDocumentModel.findById(index.id);
    if (!updated) throw new Error(`Skill index disappeared during replace: ${index.id}`);

    return this.toSkillDetail(updatedBundle, updated, { includeContent: true });
  }

  /**
   * Renames a managed skill bundle and synchronizes its index frontmatter projection.
   *
   * Use when:
   * - A caller changes the stable skill name or human-readable bundle title.
   * - Existing document ids and history must be preserved.
   *
   * Expects:
   * - The target resolves to a live managed skill bundle.
   * - `newName`, when provided, is a valid stable skill name.
   *
   * Returns:
   * - Updated skill detail with content included.
   */
  async renameSkill(input: RenameSkillInput): Promise<SkillDetail | undefined> {
    const resolved = await this.resolveBundle(input.agentId, input);
    if (!resolved) return undefined;

    const index = await this.getSingleIndex(input.agentId, resolved);
    const name = input.newName ? validateSkillName(input.newName) : resolved.filename;
    const title = input.newTitle?.trim() || resolved.title;
    const normalizedContent = normalizeSkillIndexContent({
      bundleName: name,
      content: index.content,
    });
    const frontmatter = parseSkillFrontmatter(normalizedContent);
    const metadata = buildSkillMetadata(frontmatter);

    if (normalizedContent !== index.content) {
      await this.documentService.trySaveCurrentDocumentHistory(index.documentId, 'llm_call');
    }

    const updatedBundle =
      (await this.agentDocumentModel.updateDocumentIdentity(resolved.id, {
        filename: name,
        metadata,
        title,
      })) ?? resolved;

    await this.agentDocumentModel.updateDocumentIdentity(index.id, {
      filename: SKILL_INDEX_FILENAME,
      metadata,
      title: SKILL_INDEX_FILENAME,
    });
    await this.agentDocumentModel.update(index.id, {
      content: normalizedContent,
      metadata,
      policyLoad: PolicyLoad.DISABLED,
    });

    const updatedIndex = await this.agentDocumentModel.findById(index.id);
    if (!updatedIndex) throw new Error(`Skill index disappeared during rename: ${index.id}`);

    return this.toSkillDetail(updatedBundle, updatedIndex, { includeContent: true });
  }

  private async resolveBundle(
    agentId: string,
    target: SkillTargetInput,
  ): Promise<SkillAgentDocument | undefined> {
    if (target.agentDocumentId) {
      const doc = await this.agentDocumentModel.findById(target.agentDocumentId);
      if (!doc) return undefined;
      if (doc.agentId !== agentId) return undefined;
      if (doc.fileType === SKILL_BUNDLE_FILE_TYPE) return doc;

      if (doc.fileType === SKILL_INDEX_FILE_TYPE && doc.parentId) {
        const bundle = await this.agentDocumentModel.findByDocumentId(agentId, doc.parentId);
        if (bundle?.fileType === SKILL_BUNDLE_FILE_TYPE) return bundle;
      }

      return undefined;
    }

    if (!target.name) return undefined;

    const name = validateSkillName(target.name);
    const matches = (
      await this.agentDocumentModel.listByParentAndFilename(agentId, null, name)
    ).filter((doc) => doc.fileType === SKILL_BUNDLE_FILE_TYPE);

    if (matches.length > 1) {
      throw new Error(
        `Corrupt managed skill bundle "${name}": expected one bundle, found ${matches.length}`,
      );
    }

    return matches[0];
  }

  private async getSingleIndex(
    agentId: string,
    bundle: SkillAgentDocument,
  ): Promise<SkillAgentDocument> {
    const indexes = (
      await this.agentDocumentModel.listByParentAndFilename(
        agentId,
        bundle.documentId,
        SKILL_INDEX_FILENAME,
      )
    ).filter((doc) => doc.fileType === SKILL_INDEX_FILE_TYPE);

    if (indexes.length !== 1) {
      throw new Error(
        `Corrupt managed skill bundle "${bundle.filename}": expected one ${SKILL_INDEX_FILENAME} index, found ${indexes.length}`,
      );
    }

    return indexes[0]!;
  }

  private toSkillSummary(bundle: SkillAgentDocument, index: SkillAgentDocument): SkillSummary {
    const frontmatter = parseSkillFrontmatter(index.content);

    return {
      bundle: toDocumentRef(bundle),
      description: frontmatter.description,
      index: toDocumentRef(index),
      name: bundle.filename,
      title: bundle.title,
    };
  }

  private toSkillDetail(
    bundle: SkillAgentDocument,
    index: SkillAgentDocument,
    options?: { includeContent?: boolean },
  ): SkillDetail {
    const frontmatter = parseSkillFrontmatter(index.content);

    return {
      ...this.toSkillSummary(bundle, index),
      ...(options?.includeContent && { content: index.content }),
      frontmatter,
    };
  }
}

export type { SkillManagementAgentDocumentModel, SkillManagementDocumentServiceDeps };
