import type {
  AgentDocumentPolicy,
  DOCUMENT_TEMPLATES,
  DocumentLoadRules,
  DocumentTemplateSet,
} from '@lobechat/agent-templates';
import { DocumentLoadPosition, getDocumentTemplate, PolicyLoad } from '@lobechat/agent-templates';
import { buildAgentSkillIdentifier, WEB_DOCUMENT_SOURCE_TYPE } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { DOCUMENT_FOLDER_TYPE } from '@lobechat/database/schemas';
import type { DocumentAccessScope, DocumentWriteSource } from '@lobechat/types';
import { FileSource, ordinaryDocumentAccessScope } from '@lobechat/types';

import type {
  AgentDocument,
  AgentDocumentContextPayload,
  AgentDocumentListItem,
  AgentDocumentListSourceType,
  AgentDocumentWithRules,
  ToolUpdateLoadRule,
} from '@/database/models/agentDocuments';
import {
  AgentDocumentModel,
  buildDocumentFilename,
  deriveAgentDocumentFields,
  extractMarkdownH1Title,
} from '@/database/models/agentDocuments';
import { FileModel } from '@/database/models/file';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { isUuid } from '@/database/utils/uuid';

import { AgentDocumentVfsError } from '../agentDocumentVfs/errors';
import { isManagedSkillDocument } from '../agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';
import { DocumentService } from '../document';
import { assertDocumentWriteWithinLimit } from '../document/writeLimit';
import { FileService } from '../file';
import { TOOL_RESULTS_DIR_NAME } from '../toolExecution/constants';
import { excludeArchivedToolResults } from './archivedToolResults';
import {
  type AgentDocumentBodyWriter,
  writeAgentDocumentBody,
  writeSnapshotThroughRoom,
} from './bodyWrite';
import { isRawTextAgentDocument } from './contentFormat';
import { toAgentDocumentContextPayload } from './contextPayload';
import {
  attachEmptyParseShellLiteXML,
  isEmptyParseShellDocument,
  projectEmptyParseShell,
} from './emptyParseShell';
import {
  appendFilenameSuffix,
  appendSpacedFilenameSuffix,
  MAX_UNIQUE_FILENAME_ATTEMPTS,
} from './filenames';
import {
  type AgentDocumentLiteXMLOperation,
  applyLiteXMLOperations,
  createAgentMarkdownSnapshot,
  createMarkdownEditorSnapshot,
  exportEditorDataSnapshot,
} from './headlessEditor';

/** Guards the ancestor walk against a corrupt parent cycle. */
const MAX_TREE_DEPTH = 64;

/**
 * Whether a document may hold children. Folders group; an ordinary document can
 * also be a parent — e.g. a workflow/SOP with its execution records nested under
 * it. Skills keep their own bundle layout and web clips are not tree-managed.
 */
const canHoldChildren = (doc: AgentDocument) =>
  !isManagedSkillDocument(doc) &&
  !doc.fileType.startsWith('skills/') &&
  doc.sourceType !== WEB_DOCUMENT_SOURCE_TYPE;

export type MoveAgentDocumentStatus = 'failed' | 'moved' | 'unchanged';

export interface MoveAgentDocumentResult {
  documentId?: string;
  error?: string;
  /** The agent-document row id when resolved, otherwise the reference the caller passed. */
  id: string;
  status: MoveAgentDocumentStatus;
  title?: string;
}

export interface CreateAgentFolderResult {
  /** False when a folder with the same name already existed under the same parent. */
  created: boolean;
  folder: AgentDocument;
}

interface UpsertDocumentParams {
  agentId: string;
  content: string;
  createdAt?: Date;
  filename: string;
  loadPosition?: DocumentLoadPosition;
  loadRules?: DocumentLoadRules;
  metadata?: Record<string, any>;
  policy?: AgentDocumentPolicy;
  policyLoad?: PolicyLoad;
  /**
   * Who asked for the write. Defaults to `user` (the upsert API); templates,
   * onboarding and clones pass `system` to skip the per-document character limit.
   */
  source?: DocumentWriteSource;
  templateId?: string;
  updatedAt?: Date;
}

interface CreateAgentDocumentOptions {
  hintIsSkill?: boolean;
  parentId?: string;
  /** Defaults to `agent`: these entry points are the agent document tools. */
  source?: DocumentWriteSource;
}

type AgentDocumentWithLiteXML = AgentDocument & { litexml?: string };
type ProjectableAgentDocument = Pick<
  AgentDocument,
  'content' | 'editorData' | 'fileType' | 'templateId'
>;

/**
 * Service for managing agent documents with reusable template sets.
 * Document-level policy controls runtime behavior (context rendering/retrieval).
 */
export class AgentDocumentsService {
  private agentDocumentModel: AgentDocumentModel;
  private bodyWriter: AgentDocumentBodyWriter;
  private documentService: DocumentService;
  private fileModel: FileModel;
  private fileServiceInstance?: FileService;
  private topicDocumentModel: TopicDocumentModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    callerAgentVisibility?: 'private' | 'public' | null,
    documentAccessScope: DocumentAccessScope = ordinaryDocumentAccessScope,
  ) {
    this.agentDocumentModel = new AgentDocumentModel(db, userId, workspaceId, documentAccessScope);
    // Public-agent gate flows through DocumentService → DocumentModel so
    // agentDocuments list / attach / read cannot see the caller's own
    // private documents when the invoking agent itself is workspace-public.
    this.documentService = new DocumentService(
      db,
      userId,
      workspaceId,
      callerAgentVisibility,
      documentAccessScope,
    );
    this.fileModel = new FileModel(db, userId, workspaceId);
    this.topicDocumentModel = new TopicDocumentModel(db, userId, workspaceId, documentAccessScope);
    const { agentDocumentModel, documentService } = this;
    this.bodyWriter = { agentDocumentModel, db, documentService, userId, workspaceId };
  }

  /** Defers storage configuration until upload cleanup; native documents need only the database. */
  private get fileService(): FileService {
    return (this.fileServiceInstance ??= new FileService(this.db, this.userId, this.workspaceId));
  }

  private async projectDocumentContent<T extends ProjectableAgentDocument>(doc: T): Promise<T>;
  private async projectDocumentContent<T extends ProjectableAgentDocument>(
    doc: T | undefined,
  ): Promise<T | undefined>;
  private async projectDocumentContent<T extends ProjectableAgentDocument>(
    doc: T | undefined,
  ): Promise<T | undefined> {
    if (!doc?.editorData) return doc;
    if (doc.fileType === DOCUMENT_FOLDER_TYPE) return doc;
    if (isManagedSkillDocument(doc)) return doc;
    // An empty-parse shell hydrates to an empty Lexical state, which throws
    // Lexical error #38 on every editorData load. Project it as the empty
    // document it is instead of re-entering the editor.
    if (isEmptyParseShellDocument(doc)) return projectEmptyParseShell(doc);

    try {
      const snapshot = await exportEditorDataSnapshot({
        editorData: doc.editorData,
        fallbackContent: doc.content,
      });

      const content =
        snapshot.content.trim().length === 0 && doc.content.trim().length > 0
          ? doc.content
          : snapshot.content;

      return { ...doc, content };
    } catch (error) {
      console.error('[AgentDocumentsService] Failed to project editorData to Markdown:', error);
      return doc;
    }
  }

  private async projectDocuments<T extends AgentDocument | AgentDocumentWithRules>(
    docs: T[],
  ): Promise<T[]> {
    return Promise.all(
      docs.map(async (doc) => {
        const projected = await this.projectDocumentContent(doc);
        return { ...projected, ...deriveAgentDocumentFields(projected) };
      }),
    );
  }

  private async attachLiteXML(
    doc: AgentDocument,
    retriesLeft = 2,
  ): Promise<AgentDocumentWithLiteXML> {
    if (isRawTextAgentDocument(doc)) return doc;

    // Empty-parse shells cannot hydrate (Lexical error #38). Expose the static
    // empty LiteXML document instead of re-entering the editor, so reads and
    // the remove/rename pre-reads stay addressable; a later modifyNodes on
    // these ids still reports a precise "did not change the document" error.
    if (isEmptyParseShellDocument(doc)) return attachEmptyParseShellLiteXML(doc);

    const snapshot = await exportEditorDataSnapshot({
      editorData: doc.editorData,
      fallbackContent: doc.content,
      litexml: true,
    });

    if (snapshot.recoveredFromMarkdown) {
      // Persist the repaired snapshot before exposing its LiteXML IDs. A later
      // node edit must hydrate this exact state or the IDs can no longer target it.
      // The write is conditional on the version this repair was built from: a
      // save that landed after the fetch (e.g. the open page autosaving) must
      // not be overwritten by the stale repair, so re-read and rebuild instead.
      const persisted = await this.agentDocumentModel.updateEditorSnapshotIfUnchanged(
        doc.id,
        { content: doc.content, editorData: doc.editorData ?? null },
        { content: snapshot.content, editorData: snapshot.editorData },
      );

      if (!persisted) {
        const latest = retriesLeft > 0 ? await this.agentDocumentModel.findById(doc.id) : undefined;
        if (!latest) {
          throw new Error(
            'The document changed while it was being read; nothing was overwritten. Read it again.',
          );
        }

        return this.attachLiteXML(latest, retriesLeft - 1);
      }

      return {
        ...doc,
        content: snapshot.content,
        editorData: snapshot.editorData,
        litexml: snapshot.litexml,
      };
    }

    return { ...doc, content: snapshot.content, litexml: snapshot.litexml };
  }

  private async createWithUniqueFilename(
    agentId: string,
    title: string,
    content: string,
    params?: {
      loadPosition?: DocumentLoadPosition;
      loadRules?: DocumentLoadRules;
      metadata?: Record<string, unknown>;
      parentId?: string;
      policy?: AgentDocumentPolicy;
      source?: DocumentWriteSource;
      templateId?: string;
    },
  ) {
    const { source, ...createParams } = params ?? {};
    const baseFilename = buildDocumentFilename(title);

    let filename = baseFilename;
    let suffix = 2;

    while (
      await this.agentDocumentModel.findByParentAndFilename(
        agentId,
        params?.parentId ?? null,
        filename,
      )
    ) {
      if (suffix > MAX_UNIQUE_FILENAME_ATTEMPTS) {
        throw new Error(
          `Unable to generate a unique filename for "${title}" after ${MAX_UNIQUE_FILENAME_ATTEMPTS} attempts.`,
        );
      }

      filename = appendFilenameSuffix(baseFilename, suffix);
      suffix += 1;
    }

    const snapshot = await createAgentMarkdownSnapshot(content);
    await this.assertWithinCharLimit(snapshot.content.length, 0, source ?? 'agent');

    return this.agentDocumentModel.create(agentId, filename, snapshot.content, {
      ...createParams,
      editorData: snapshot.editorData,
      title,
    });
  }

  /**
   * Refuses a write that would leave a document over the plan's character limit,
   * before anything is persisted. A write that does not grow the document passes.
   */
  private assertWithinCharLimit(
    charCount: number,
    previousCharCount: number,
    source: DocumentWriteSource,
  ) {
    return assertDocumentWriteWithinLimit({
      charCount,
      previousCharCount,
      source,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Initialize documents from a specific template set.
   */
  async initializeFromTemplate(
    agentId: string,
    templateId: keyof typeof DOCUMENT_TEMPLATES = 'claw',
  ) {
    const templateSet = getDocumentTemplate(templateId);

    for (const template of templateSet.templates) {
      await this.upsertDocument({
        agentId,
        content: template.content,
        filename: template.filename,
        loadPosition: template.loadPosition,
        loadRules: template.loadRules,
        metadata: template.metadata,
        policy: template.policyLoadFormat
          ? { context: { policyLoadFormat: template.policyLoadFormat } }
          : undefined,
        policyLoad: template.policyLoad,
        source: 'system',
        templateId,
      });
    }
  }

  /**
   * Initialize from a custom template set.
   */
  async initializeFromCustomTemplate(agentId: string, templateSet: DocumentTemplateSet) {
    for (const template of templateSet.templates) {
      await this.upsertDocument({
        agentId,
        content: template.content,
        filename: template.filename,
        loadPosition: template.loadPosition,
        loadRules: template.loadRules,
        metadata: template.metadata,
        policy: template.policyLoadFormat
          ? { context: { policyLoadFormat: template.policyLoadFormat } }
          : undefined,
        policyLoad: template.policyLoad,
        source: 'system',
        templateId: templateSet.id,
      });
    }
  }

  /**
   * Switch agent to a different template set.
   * Optionally preserves custom document modifications.
   */
  async switchTemplate(agentId: string, newTemplateId: string, preserveCustomizations = false) {
    if (!preserveCustomizations) {
      await this.agentDocumentModel.deleteByAgent(agentId);
    }

    await this.initializeFromTemplate(agentId, newTemplateId as keyof typeof DOCUMENT_TEMPLATES);
  }

  async getAgentDocuments(agentId: string): Promise<AgentDocumentWithRules[]> {
    const docs = await this.agentDocumentModel.findByAgent(agentId);
    return this.projectDocuments(excludeArchivedToolResults(docs));
  }

  async getAgentContextDocuments(agentId: string): Promise<AgentDocumentContextPayload[]> {
    const docs = excludeArchivedToolResults(
      await this.agentDocumentModel.findContextByAgent(agentId),
    );

    const projectedDocs = await Promise.all(
      docs.map(async (doc) => {
        if (doc.policyLoad !== PolicyLoad.ALWAYS) return doc;

        const projected = await this.projectDocumentContent(doc);
        return { ...projected, ...deriveAgentDocumentFields(projected) };
      }),
    );

    return projectedDocs.map(toAgentDocumentContextPayload);
  }

  /**
   * Return this agent's skill-bundle documents in a shape ready for the
   * homogeneous skill runtime: identifier is prefixed
   * (`agent-skills:<filename>`) and the body is resolved from the bundle's
   * `SKILL.md` index child (falling back to the bundle row for orphans).
   *
   * Single source of truth for the agent-document skill registry: both the
   * SkillEngine assembly (`<available_skills>` for the model) and the skills
   * `activateSkill` runtime call this; neither re-implements the prefix or the
   * bundle → index child mapping.
   */
  async getAgentSkills(agentId: string): Promise<
    Array<{
      content: string;
      description: string;
      filename: string;
      identifier: string;
      name: string;
      title: string | null;
    }>
  > {
    const docs = await this.agentDocumentModel.findSkillDocsByAgent(agentId);

    const childrenByParent = new Map<string, AgentDocumentWithRules[]>();
    for (const doc of docs) {
      if (!doc.parentId) continue;
      const list = childrenByParent.get(doc.parentId) ?? [];
      list.push(doc);
      childrenByParent.set(doc.parentId, list);
    }

    return docs
      .filter((doc) => doc.isSkillBundle)
      .map((bundle) => {
        const indexChild = (childrenByParent.get(bundle.documentId) ?? []).find(
          (child) => child.isSkillIndex,
        );
        const identifier = buildAgentSkillIdentifier(bundle.filename);
        return {
          content: indexChild?.content ?? bundle.content ?? '',
          description: bundle.description ?? '',
          filename: bundle.filename,
          identifier,
          name: identifier,
          title: bundle.title,
        };
      });
  }

  async getDocumentsByTemplate(
    agentId: string,
    templateId: string,
  ): Promise<AgentDocumentWithRules[]> {
    const docs = await this.agentDocumentModel.findByTemplate(agentId, templateId);
    return this.projectDocuments(docs);
  }

  async getDocumentsByPolicy(agentId: string, policyId: string): Promise<AgentDocumentWithRules[]> {
    return this.getDocumentsByTemplate(agentId, policyId);
  }

  async getDocument(agentId: string, filename: string) {
    const doc = await this.agentDocumentModel.findByFilename(agentId, filename);
    return this.projectDocumentContent(doc);
  }

  async getDocumentById(id: string, expectedAgentId?: string) {
    const doc = await this.findReadableDocumentById(id, expectedAgentId);
    if (!doc) return undefined;

    return this.projectDocumentContent(doc);
  }

  /**
   * Resolve an `agent_documents` row from `(agentId, documentId)`. Use when the
   * caller has a `documents.id` but needs the row id (e.g. when building the
   * `<document agent_document_id ... />` injection from a portal payload).
   * Returns undefined when the agent does not own this document binding.
   */
  async findRowByDocumentId(agentId: string, documentId: string) {
    return this.agentDocumentModel.findByDocumentId(agentId, documentId);
  }

  /** Read-only page projection addressed by the public `(agentId, documentId)` route. */
  async getReaderDocument(agentId: string, documentId: string) {
    const doc = await this.agentDocumentModel.findByDocumentId(agentId, documentId);

    return this.projectDocumentContent(doc);
  }

  async getDocumentSnapshotById(id: string, expectedAgentId?: string) {
    const doc = await this.findReadableDocumentById(id, expectedAgentId);
    if (!doc) return undefined;

    return this.attachLiteXML(doc);
  }

  async getDocumentSnapshotByFilename(agentId: string, filename: string) {
    const doc = await this.agentDocumentModel.findByFilename(agentId, filename);
    if (!doc) return undefined;

    return this.attachLiteXML(doc);
  }

  /**
   * Resolve either the agent-document binding id exposed as `id` or the backing
   * `documents.id` exposed as `documentId`. Both identifiers appear in document
   * discovery results, and older callers may pass the latter back to read APIs.
   * Branch before querying the UUID column so a backing id cannot trigger a
   * PostgreSQL 22P02 error.
   */
  private async findReadableDocumentById(id: string, expectedAgentId?: string) {
    const doc = isUuid(id)
      ? await this.agentDocumentModel.findById(id)
      : expectedAgentId
        ? await this.agentDocumentModel.findByDocumentId(expectedAgentId, id)
        : undefined;
    if (!doc) return undefined;
    if (expectedAgentId && doc.agentId !== expectedAgentId) return undefined;

    return doc;
  }

  private async getDocumentByIdInAgent(documentId: string, expectedAgentId?: string) {
    const doc = await this.agentDocumentModel.findById(documentId);

    if (!doc) return undefined;
    if (expectedAgentId && doc.agentId !== expectedAgentId) return undefined;

    return this.projectDocumentContent(doc);
  }

  async upsertDocument({
    agentId,
    filename,
    content,
    loadPosition,
    loadRules,
    templateId,
    metadata,
    policy,
    policyLoad,
    createdAt,
    updatedAt,
    source = 'user',
  }: UpsertDocumentParams) {
    const snapshot = await createMarkdownEditorSnapshot(content);

    if (source !== 'system') {
      const existing = await this.agentDocumentModel.findByFilename(agentId, filename);
      await this.assertWithinCharLimit(
        snapshot.content.length,
        existing?.content?.length ?? 0,
        source,
      );
    }

    return this.agentDocumentModel.upsert(agentId, filename, snapshot.content, {
      createdAt,
      editorData: snapshot.editorData,
      loadPosition,
      loadRules,
      metadata,
      policy,
      policyLoad,
      templateId,
      updatedAt,
    });
  }

  async associateDocument(agentId: string, documentId: string): Promise<{ id: string }> {
    return this.agentDocumentModel.associate({ agentId, documentId });
  }

  /**
   * Attach an uploaded file to the agent's document tree without converting its bytes.
   *
   * Use when:
   * - An upload has completed and needs an entry in the agent's space.
   *
   * Expects:
   * - An accessible file and, when supplied, a folder belonging to this agent.
   *
   * Returns:
   * - A new file-backed document binding with a unique filename in its parent.
   */
  async importFile(agentId: string, fileId: string, parentId?: string | null) {
    const file = await this.fileModel.findById(fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);

    try {
      if (parentId) {
        const parent = await this.agentDocumentModel.findByDocumentId(agentId, parentId);
        if (!parent) throw new Error(`Parent folder not found: ${parentId}`);
        if (parent.fileType !== DOCUMENT_FOLDER_TYPE) {
          throw new Error(`Parent document is not a folder: ${parentId}`);
        }
      }

      const resolvedParentId = parentId ?? null;
      const baseFilename = buildDocumentFilename(file.name);
      let filename = baseFilename;
      let suffix = 2;

      while (
        await this.agentDocumentModel.findByParentAndFilename(agentId, resolvedParentId, filename)
      ) {
        if (suffix > MAX_UNIQUE_FILENAME_ATTEMPTS) {
          throw new Error(
            `Unable to generate a unique filename for "${file.name}" after ${MAX_UNIQUE_FILENAME_ATTEMPTS} attempts.`,
          );
        }

        filename = appendSpacedFilenameSuffix(baseFilename, suffix);
        suffix += 1;
      }

      const createParams = {
        fileId: file.id,
        fileType: file.fileType || 'application/octet-stream',
        ...(resolvedParentId ? { parentId: resolvedParentId } : {}),
        source: file.url,
        sourceType: 'file' as const,
        title: file.name,
      };

      // Imported bytes stay in files; preview reads the original rather than an editable copy.
      return await this.agentDocumentModel.create(agentId, filename, '', createParams);
    } catch (error) {
      // Only reclaim dedicated uploads created by this caller. Existing Resources imports
      // retain their lifecycle, and committed/concurrent imports are protected by references.
      if (file.source === FileSource.AgentDocument && file.userId === this.userId) {
        await this.fileService
          .removeUnreferencedFile(file.id, FileSource.AgentDocument)
          .catch((cleanupError) => {
            console.error('Failed to reclaim an unbound agent upload', cleanupError);
          });
      }
      throw error;
    }
  }

  async createDocument(
    agentId: string,
    title: string,
    content: string,
    options: CreateAgentDocumentOptions = {},
  ) {
    const parentId = options.parentId
      ? (await this.resolveParent(agentId, options.parentId)).documentId
      : undefined;

    // The caller's explicit title wins; a leading H1 only names untitled documents.
    // The leading H1 is always dropped from the body: the document title renders
    // as the page header on share/editor surfaces, so that first heading would
    // read as a second page title. Deeper body headings are left alone.
    const { title: extractedTitle, content: finalContent } = extractMarkdownH1Title(content);
    // Tool callers do not always send `title` even though the schema asks for it.
    const requestedTitle = typeof title === 'string' ? title.trim() : '';
    const finalTitle = requestedTitle || extractedTitle || '';
    const metadata = options.hintIsSkill
      ? {
          agentSignal: {
            hintedByTool: 'lobe-agent-documents.createDocument',
            hintIsSkill: true,
          },
        }
      : undefined;

    return this.createWithUniqueFilename(agentId, finalTitle, finalContent, {
      ...(metadata ? { metadata } : {}),
      ...(parentId ? { parentId } : {}),
      source: options.source ?? 'agent',
    });
  }

  /**
   * Resolve a parent — a folder or an ordinary document — from either of its ids:
   * the backing `documentId` (`docs_…`, which listDocuments and the context index
   * show) or the agent-document row id (uuid). Models routinely pass the other id
   * of the pair, and a miss used to read back as an empty folder, so an unknown
   * reference, a skill, or a web clip throws.
   */
  async resolveParent(agentId: string, parentRef: string): Promise<AgentDocument> {
    const parent = await this.findReadableDocumentById(parentRef, agentId);
    if (!parent) throw new AgentDocumentVfsError(`Parent not found: ${parentRef}`, 'NOT_FOUND');
    if (!canHoldChildren(parent)) {
      throw new AgentDocumentVfsError(
        `"${parent.title}" cannot contain other documents (skills and web clips cannot be parents).`,
        'BAD_REQUEST',
      );
    }

    return parent;
  }

  /**
   * Live children per parent `documentId`; parents without children are absent.
   * Omit `parentIds` to count every parent of the agent.
   */
  async countChildren(agentId: string, parentIds?: string[]): Promise<Map<string, number>> {
    return this.agentDocumentModel.countChildrenByParentIds(agentId, parentIds);
  }

  /**
   * Create a folder by name under the root or under an existing folder. Idempotent
   * like `mkdir -p`: an existing folder with the same name is returned as-is so a
   * scheduled task can call this on every run.
   */
  async createFolder(
    agentId: string,
    title: string,
    parentRef?: string | null,
  ): Promise<CreateAgentFolderResult> {
    const name = typeof title === 'string' ? title.trim() : '';
    if (!name || /[\\/]/.test(name)) {
      throw new AgentDocumentVfsError(
        'Folder name must be non-empty and cannot contain "/" or "\\".',
        'BAD_REQUEST',
      );
    }

    const parentId = parentRef ? (await this.resolveParent(agentId, parentRef)).documentId : null;
    const existing = await this.agentDocumentModel.findByParentAndFilename(agentId, parentId, name);
    if (existing) {
      if (existing.fileType === DOCUMENT_FOLDER_TYPE) return { created: false, folder: existing };

      throw new AgentDocumentVfsError(
        `A document named "${name}" already exists in that location.`,
        'CONFLICT',
      );
    }

    const folder = await this.agentDocumentModel.create(agentId, name, '', {
      fileType: DOCUMENT_FOLDER_TYPE,
      parentId,
      title: name,
    });

    return { created: true, folder };
  }

  /**
   * Move documents or folders under a parent folder or document (or to the root
   * with `null`). Each
   * entry is applied and reported on its own so one bad id does not abort a bulk
   * reorganisation. Titles, ids, history and load rules are kept.
   */
  async moveDocuments(
    agentId: string,
    refs: string[],
    parentRef: string | null,
  ): Promise<MoveAgentDocumentResult[]> {
    const target = parentRef ? await this.resolveParent(agentId, parentRef) : undefined;
    const targetParentId = target?.documentId ?? null;
    const blockedIds = target ? await this.collectLineage(agentId, target) : new Set<string>();
    const results: MoveAgentDocumentResult[] = [];

    for (const ref of new Set(refs)) {
      const doc = await this.findReadableDocumentById(ref, agentId);
      if (!doc) {
        results.push({ error: `Document not found: ${ref}`, id: ref, status: 'failed' });
        continue;
      }

      const base = { documentId: doc.documentId, id: doc.id, title: doc.title };
      const fail = (error: string) => results.push({ ...base, error, status: 'failed' });

      if (isManagedSkillDocument(doc) || doc.fileType.startsWith('skills/')) {
        fail('Skill documents cannot be moved.');
        continue;
      }
      if ((doc.parentId ?? null) === targetParentId) {
        results.push({ ...base, status: 'unchanged' });
        continue;
      }
      if (blockedIds.has(doc.documentId)) {
        fail('Cannot move a document or folder under itself or one of its descendants.');
        continue;
      }

      const clash = await this.agentDocumentModel.findByParentAndFilename(
        agentId,
        targetParentId,
        doc.filename,
      );
      if (clash && clash.id !== doc.id) {
        fail(`"${doc.filename}" already exists in the destination folder.`);
        continue;
      }

      const moved = await this.agentDocumentModel.movePath(doc.id, {
        filename: doc.filename,
        parentId: targetParentId,
        title: doc.title,
      });
      if (moved) results.push({ ...base, status: 'moved' });
      else fail('Move failed.');
    }

    return results;
  }

  /** The target parent plus every ancestor; moving any of them into the target would loop. */
  private async collectLineage(agentId: string, parent: AgentDocument) {
    const lineage = new Set<string>([parent.documentId]);
    let parentId = parent.parentId;

    for (let depth = 0; parentId && depth < MAX_TREE_DEPTH; depth += 1) {
      if (lineage.has(parentId)) break;
      lineage.add(parentId);
      parentId =
        (await this.agentDocumentModel.findByDocumentId(agentId, parentId))?.parentId ?? null;
    }

    return lineage;
  }

  async createForTopic(
    agentId: string,
    title: string,
    content: string,
    topicId: string,
    options: CreateAgentDocumentOptions = {},
  ) {
    const doc = await this.createDocument(agentId, title, content, options);

    await this.topicDocumentModel.associate({
      documentId: doc.documentId,
      topicId,
    });

    return doc;
  }

  async deleteDocument(documentId: string) {
    return this.agentDocumentModel.delete(documentId);
  }

  async removeDocumentById(
    documentId: string,
    expectedAgentId?: string,
    options: { withChildren?: boolean } = {},
  ): Promise<boolean> {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return false;

    // A parent document carries its nested records (e.g. a workflow and its runs).
    // Removing only the parent would strand them under a deleted row, so the
    // caller has to choose: take the subtree, or move the children out first.
    const childCount =
      (await this.countChildren(doc.agentId, [doc.documentId])).get(doc.documentId) ?? 0;
    if (childCount > 0) {
      if (!options.withChildren) {
        throw new AgentDocumentVfsError(
          `"${doc.title}" has ${childCount} nested document(s). Remove it with withChildren: true to delete them too, or move them out first.`,
          'CONFLICT',
        );
      }

      await this.agentDocumentModel.deleteSubtreeByDocumentId(doc.agentId, doc.documentId);
      return true;
    }

    await this.deleteDocument(documentId);
    return true;
  }

  async deleteAllDocuments(agentId: string) {
    return this.agentDocumentModel.deleteByAgent(agentId);
  }

  async deleteTemplateDocuments(agentId: string, templateId: string) {
    return this.agentDocumentModel.deleteByTemplate(agentId, templateId);
  }

  async deletePolicyDocuments(agentId: string, policyId: string) {
    return this.deleteTemplateDocuments(agentId, policyId);
  }

  async getInjectableDocuments(
    agentId: string,
    context: {
      userMessage?: string;
      currentTime?: Date;
    },
  ): Promise<AgentDocumentWithRules[]> {
    const docs = await this.agentDocumentModel.getInjectableDocuments(agentId, context);
    return this.projectDocuments(docs);
  }

  async getDocumentsByPosition(agentId: string) {
    const grouped = await this.agentDocumentModel.getDocumentsByPosition(agentId);
    const projected = new Map<DocumentLoadPosition, AgentDocumentWithRules[]>();

    for (const [position, docs] of grouped.entries()) {
      projected.set(position, await this.projectDocuments(docs));
    }

    return projected;
  }

  async getAgentContext(agentId: string): Promise<string> {
    const docs = await this.getInjectableDocuments(agentId, {});

    if (docs.length === 0) return '';

    const contextParts: string[] = [];
    for (const doc of docs) {
      if (doc.content) {
        contextParts.push(`--- ${doc.filename} ---`);
        contextParts.push(doc.content);
        contextParts.push('');
      }
    }

    return contextParts.join('\n').trim();
  }

  async getDocumentsMap(agentId: string) {
    const docs = await this.getAgentDocuments(agentId);
    return new Map(docs.map((doc) => [doc.filename, doc.content]));
  }

  async hasDocuments(agentId: string): Promise<boolean> {
    return this.agentDocumentModel.hasByAgent(agentId);
  }

  async getAgentTemplate(agentId: string): Promise<string | null> {
    const docs = await this.getAgentDocuments(agentId);
    if (docs.length === 0) return null;

    const templateCounts = new Map<string, number>();
    for (const doc of docs) {
      if (doc.templateId) {
        templateCounts.set(doc.templateId, (templateCounts.get(doc.templateId) || 0) + 1);
      }
    }

    let maxCount = 0;
    let currentTemplate: string | null = null;
    for (const [templateId, count] of templateCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        currentTemplate = templateId;
      }
    }

    return currentTemplate;
  }

  async getAgentPolicy(agentId: string): Promise<string | null> {
    return this.getAgentTemplate(agentId);
  }

  async cloneDocuments(sourceAgentId: string, targetAgentId: string) {
    const sourceDocs = await this.getAgentDocuments(sourceAgentId);

    for (const doc of sourceDocs) {
      await this.upsertDocument({
        agentId: targetAgentId,
        content: doc.content,
        filename: doc.filename,
        loadPosition:
          (doc.policy?.context?.position as DocumentLoadPosition | undefined) ||
          DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: doc.loadRules,
        metadata: doc.metadata || undefined,
        policy: doc.policy || undefined,
        // A clone copies content the user already stored; it must not be refused.
        source: 'system',
        templateId: doc.templateId || undefined,
      });
    }
  }

  async listDocuments(
    agentId: string,
    sourceType?: AgentDocumentListSourceType,
    options?: { excludeWeb?: boolean; includeArchivedToolResults?: boolean; parentId?: string },
  ) {
    const parentId = options?.parentId
      ? (await this.resolveParent(agentId, options.parentId)).documentId
      : undefined;
    const docs = await this.agentDocumentModel.listByAgent(agentId, {
      excludeWeb: options?.excludeWeb,
      parentId,
      sourceType,
    });

    return options?.includeArchivedToolResults ? docs : excludeArchivedToolResults(docs);
  }

  async listDocumentsForTopic(
    agentId: string,
    topicId: string,
    sourceType?: AgentDocumentListSourceType,
    options?: { includeArchivedToolResults?: boolean },
  ) {
    const topicDocs = await this.topicDocumentModel.findByTopicId(topicId);
    const documentIds = topicDocs.map((doc) => doc.id);
    const docs = sourceType
      ? await this.agentDocumentModel.listByDocumentIds(agentId, documentIds, { sourceType })
      : await this.agentDocumentModel.listByDocumentIds(agentId, documentIds);
    const docsByDocumentId = new Map(docs.map((doc) => [doc.documentId, doc]));

    const ordered = topicDocs
      .map((topicDoc) => docsByDocumentId.get(topicDoc.id))
      .filter((doc): doc is AgentDocumentListItem => Boolean(doc));

    if (options?.includeArchivedToolResults) return ordered;

    // The `.tool-results` folder is never topic-associated (only the archived
    // file is), so it isn't in `ordered`. Look it up directly so the archived
    // file can be filtered out by its parent id.
    const archiveFolder = await this.agentDocumentModel.findByParentAndFilename(
      agentId,
      null,
      TOOL_RESULTS_DIR_NAME,
    );
    const archiveFolderIds =
      archiveFolder?.fileType === DOCUMENT_FOLDER_TYPE
        ? new Set([archiveFolder.documentId])
        : new Set<string>();

    return excludeArchivedToolResults(ordered, archiveFolderIds);
  }

  async getDocumentByFilename(agentId: string, filename: string) {
    const doc = await this.agentDocumentModel.findByFilename(agentId, filename);
    return this.projectDocumentContent(doc);
  }

  /**
   * System write (onboarding documents), exempt from the per-document character limit.
   */
  async upsertDocumentByFilename({
    agentId,
    filename,
    content,
  }: {
    agentId: string;
    content: string;
    filename: string;
  }) {
    const existing = await this.agentDocumentModel.findByFilename(agentId, filename);
    const projectedExisting = await this.projectDocumentContent(existing);
    const snapshot = await createAgentMarkdownSnapshot(content);

    if (existing && projectedExisting?.content !== snapshot.content) {
      if (await writeSnapshotThroughRoom(this.bodyWriter, existing.documentId, snapshot, 'system'))
        return (await this.agentDocumentModel.findById(existing.id)) ?? existing;
      await this.documentService.trySaveCurrentDocumentHistory(existing.documentId, 'llm_call');
    }

    return this.agentDocumentModel.upsert(agentId, filename, snapshot.content, {
      editorData: snapshot.editorData,
    });
  }

  async replaceDocumentContentById(
    documentId: string,
    content: string,
    expectedAgentId?: string,
    source: DocumentWriteSource = 'agent',
  ) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    // Mirror createDocument: the document title renders as the page header, so
    // a leading H1 would show it a second time; deeper headings are kept.
    const { content: finalContent } = extractMarkdownH1Title(content);
    const snapshot = await createAgentMarkdownSnapshot(finalContent);

    const target = { agentDocumentId: documentId, documentId: doc.documentId };
    const recordHistory = doc.content !== snapshot.content;
    await writeAgentDocumentBody(this.bodyWriter, target, snapshot, {
      beforeRowWrite: () =>
        this.assertWithinCharLimit(snapshot.content.length, doc.content?.length ?? 0, source),
      recordHistory,
      writeSource: source,
    });
    return this.getDocumentByIdInAgent(documentId, expectedAgentId);
  }

  async modifyDocumentNodesById(
    documentId: string,
    operations: AgentDocumentLiteXMLOperation[],
    expectedAgentId?: string,
    source: DocumentWriteSource = 'agent',
  ) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    const snapshot = await applyLiteXMLOperations({
      editorData: doc.editorData,
      fallbackContent: doc.content,
      operations,
    });
    // History must capture the successfully hydrated pre-edit state. Persisted
    // editorData may be the stale payload that forced Markdown recovery.
    const target = { agentDocumentId: documentId, documentId: doc.documentId };
    const { previousEditorData } = snapshot;
    await writeAgentDocumentBody(this.bodyWriter, target, snapshot, {
      beforeRowWrite: () =>
        this.assertWithinCharLimit(snapshot.content.length, doc.content?.length ?? 0, source),
      previousEditorData,
      writeSource: source,
    });

    return this.getDocumentByIdInAgent(documentId, expectedAgentId);
  }

  async renameDocumentById(documentId: string, newTitle: string, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;
    if (isManagedSkillDocument(doc)) {
      throw new AgentDocumentVfsError(
        'Skill VFS documents must be renamed through skill-specific APIs',
        'METHOD_NOT_SUPPORTED',
      );
    }

    const trimmedTitle = newTitle.trim();
    if (doc.fileType === DOCUMENT_FOLDER_TYPE || !trimmedTitle) {
      if (trimmedTitle && trimmedTitle !== doc.title) {
        await this.documentService.trySaveCurrentDocumentHistory(doc.documentId, 'llm_call');
      }

      return this.agentDocumentModel.rename(documentId, trimmedTitle);
    }

    const filename = buildDocumentFilename(trimmedTitle);
    if (trimmedTitle !== doc.title || filename !== doc.filename) {
      await this.documentService.trySaveCurrentDocumentHistory(doc.documentId, 'llm_call');
    }

    return this.agentDocumentModel.rename(documentId, trimmedTitle, { filename });
  }

  async copyDocumentById(documentId: string, newTitle?: string, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;
    if (isManagedSkillDocument(doc)) {
      throw new AgentDocumentVfsError(
        'Skill VFS documents must be copied through skill-specific APIs',
        'METHOD_NOT_SUPPORTED',
      );
    }

    // A copy has the length of its source, so it is exempt from the character limit.
    return this.agentDocumentModel.copy(documentId, newTitle);
  }

  async updateLoadRuleById(documentId: string, rule: ToolUpdateLoadRule, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    return this.agentDocumentModel.updateToolLoadRule(documentId, rule);
  }

  async exportAsTemplate(agentId: string, templateName: string): Promise<DocumentTemplateSet> {
    const docs = await this.getAgentDocuments(agentId);

    return {
      id: `custom-${agentId}`,
      name: templateName,
      description: `Custom template exported from agent ${agentId}`,
      tags: ['custom', 'exported'],
      templates: docs.map((doc) => ({
        title: doc.title,
        filename: doc.filename,
        description: `Exported from ${doc.filename}`,
        content: doc.content,
        loadPosition:
          (doc.policy?.context?.position as DocumentLoadPosition | undefined) ||
          DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: doc.loadRules,
        metadata: doc.metadata || undefined,
      })),
    };
  }

  async exportAsPolicy(agentId: string, policyName: string): Promise<DocumentTemplateSet> {
    return this.exportAsTemplate(agentId, policyName);
  }
}
