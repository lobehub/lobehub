import { createMarkdownEditorSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import type {
  CreateSkillInput,
  DeleteSkillInput,
  SkillMountProviderRequest,
  UpdateSkillInput,
  WritableSkillMountProvider,
} from '../SkillMount';
import { SkillMountPathResolver } from '../SkillMountPathResolver';
import type { SkillMountNode } from '../types';
import type { ProviderSkillsAgentDocumentDeps } from './providerSkillsAgentDocumentUtils';
import {
  assertSkillDocument,
  buildSkillDirectoryNode,
  buildSkillFileNode,
  buildSkillNamespaceRootNode,
  createSkillTree,
  getResolvedSkillName,
  getScopedSkillDocuments,
  getSkillFile,
  getSkillFolder,
  getSkillMetadata,
  getValidatedSkillName,
  listScopedSkillFolders,
  projectDocumentContent,
  sortSkillFolders,
} from './providerSkillsAgentDocumentUtils';

interface ProviderSkillsAgentDocumentConfig {
  namespace: 'agent';
}

const DOCUMENT_SKILL_PROVIDER_CONFIGS = {
  agent: {
    namespace: 'agent',
  },
} as const satisfies Record<'agent', ProviderSkillsAgentDocumentConfig>;

/**
 * Provides writable VFS operations for document-backed skills.
 *
 * Use when:
 * - Serving agent-level skills from agent documents.
 *
 * Expects:
 * - Managed skill documents carry `metadata.lobeSkill` with namespace and role.
 *
 * Returns:
 * - Skill VFS nodes whose paths use the target unified `./lobe/skills/...` layout.
 */
export class ProviderSkillsAgentDocument implements WritableSkillMountProvider {
  private readonly config: ProviderSkillsAgentDocumentConfig;

  constructor(
    namespace: ProviderSkillsAgentDocumentConfig['namespace'],
    private readonly deps: ProviderSkillsAgentDocumentDeps,
  ) {
    this.config = DOCUMENT_SKILL_PROVIDER_CONFIGS[namespace];
  }

  async get(input: SkillMountProviderRequest): Promise<SkillMountNode> {
    if (!input.resolvedPath.skillName) {
      return buildSkillNamespaceRootNode(this.config.namespace);
    }

    const skillName = getResolvedSkillName(
      input.resolvedPath.skillName,
      input.resolvedPath.filePath,
    );
    const documents = await this.deps.agentDocumentModel.findByAgent(input.agentId);

    if (!input.resolvedPath.filePath) {
      assertSkillDocument(getSkillFolder(documents, this.config.namespace, skillName));
      return buildSkillDirectoryNode(this.config.namespace, skillName);
    }

    const document = assertSkillDocument(getSkillFile(documents, this.config.namespace, skillName));
    const content = await projectDocumentContent(document);

    return buildSkillFileNode({
      content,
      namespace: this.config.namespace,
      skillName,
    });
  }

  async list(input: SkillMountProviderRequest): Promise<SkillMountNode[]> {
    const documents = getScopedSkillDocuments(
      await this.deps.agentDocumentModel.findByAgent(input.agentId),
      this.config.namespace,
    );

    if (!input.resolvedPath.skillName) {
      return sortSkillFolders(listScopedSkillFolders(documents, this.config.namespace)).map(
        (document) =>
          buildSkillDirectoryNode(
            this.config.namespace,
            getSkillMetadata(document)?.skillName ?? document.filename,
          ),
      );
    }

    const skillName = getResolvedSkillName(
      input.resolvedPath.skillName,
      input.resolvedPath.filePath,
    );
    assertSkillDocument(getSkillFolder(documents, this.config.namespace, skillName));

    return [
      buildSkillFileNode({
        namespace: this.config.namespace,
        skillName,
      }),
    ];
  }

  async create(input: CreateSkillInput): Promise<SkillMountNode> {
    const skillName = getValidatedSkillName(input.skillName, 'skillName');
    const documents = await this.deps.agentDocumentModel.findByAgent(input.agentId);

    if (getSkillFolder(documents, this.config.namespace, skillName)) {
      throw new AgentDocumentVfsError('Skill already exists', 'CONFLICT');
    }

    const snapshot = await createMarkdownEditorSnapshot(input.content);

    await createSkillTree({
      agentDocumentModel: this.deps.agentDocumentModel,
      agentId: input.agentId,
      content: snapshot.content,
      documentService: this.deps.documentService,
      editorData: snapshot.editorData,
      namespace: this.config.namespace,
      skillName,
    });

    return buildSkillFileNode({
      content: snapshot.content,
      namespace: this.config.namespace,
      skillName,
    });
  }

  async update(input: UpdateSkillInput): Promise<SkillMountNode> {
    const resolvedPath = SkillMountPathResolver.resolve(input.path);
    const skillName = getResolvedSkillName(resolvedPath.skillName, resolvedPath.filePath);
    const documents = await this.deps.agentDocumentModel.findByAgent(input.agentId);
    const document = assertSkillDocument(getSkillFile(documents, this.config.namespace, skillName));
    const existingContent = await projectDocumentContent(document);
    const snapshot = await createMarkdownEditorSnapshot(input.content);

    if (existingContent !== snapshot.content) {
      await this.deps.documentService.trySaveCurrentDocumentHistory(
        document.documentId,
        'llm_call',
      );
    }

    await this.deps.agentDocumentModel.update(document.id, {
      content: snapshot.content,
      editorData: snapshot.editorData,
    });

    return buildSkillFileNode({
      content: snapshot.content,
      namespace: this.config.namespace,
      skillName,
    });
  }

  async delete(input: DeleteSkillInput): Promise<void> {
    const resolvedPath = SkillMountPathResolver.resolve(input.path);
    const skillName = getResolvedSkillName(resolvedPath.skillName, resolvedPath.filePath);
    const documents = getScopedSkillDocuments(
      await this.deps.agentDocumentModel.findByAgent(input.agentId),
      this.config.namespace,
    );
    const folder = assertSkillDocument(getSkillFolder(documents, this.config.namespace, skillName));

    await this.deps.documentService.deleteDocument(folder.documentId);
  }
}
