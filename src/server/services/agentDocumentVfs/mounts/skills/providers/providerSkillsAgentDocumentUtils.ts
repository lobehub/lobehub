import type { AgentDocument } from '@/database/models/agentDocuments';
import { PolicyLoad } from '@/database/models/agentDocuments';
import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';
import { exportEditorDataSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import { getUnifiedSkillNamespaceRootPath } from '../path';
import type { SkillMountNode } from '../types';

export interface AgentSkillDocumentModelLike {
  create: (
    agentId: string,
    filename: string,
    content: string,
    params?: {
      editorData?: Record<string, any>;
      fileType?: string;
      parentId?: string | null;
      policyLoad?: PolicyLoad;
      templateId?: string;
      title?: string;
    },
  ) => Promise<AgentDocument>;
  delete: (documentId: string, deleteReason?: string) => Promise<void>;
  deleteSubtreeByDocumentId: (
    agentId: string,
    rootDocumentId: string,
    deleteReason?: string,
  ) => Promise<void>;
  findByAgent: (agentId: string) => Promise<AgentDocument[]>;
  update: (
    documentId: string,
    params?: {
      content?: string;
      editorData?: Record<string, any>;
      metadata?: Record<string, any>;
      policyLoad?: PolicyLoad;
    },
  ) => Promise<void>;
}

export interface DocumentTreeServiceLike {
  trySaveCurrentDocumentHistory: (documentId: string, saveSource: 'llm_call') => Promise<unknown>;
}

export interface ProviderSkillsAgentDocumentDeps {
  agentDocumentModel: AgentSkillDocumentModelLike;
  documentService: DocumentTreeServiceLike;
}

export interface CreateSkillTreeInput {
  agentDocumentModel: AgentSkillDocumentModelLike;
  agentId: string;
  content: string;
  editorData: Record<string, any>;
  namespace: 'agent';
  skillName: string;
}

export const EMPTY_EDITOR_DATA = { root: { children: [], type: 'root' } };

export const AGENT_SKILL_TEMPLATE_ID = 'agent-skill';

export const SKILL_FILE_NAME = 'SKILL.md';

export const SKILL_INDEX_FILE_TYPE = 'skill/index';

export const buildSkillDirectoryNode = (
  namespace: Extract<SkillMountNode['namespace'], 'agent'>,
  skillName: string,
): SkillMountNode => ({
  name: skillName,
  namespace,
  path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillName}`,
  readOnly: false,
  type: 'directory',
});

export const buildSkillNamespaceRootNode = (
  namespace: Extract<SkillMountNode['namespace'], 'agent'>,
): SkillMountNode => ({
  name: 'skills',
  namespace,
  path: getUnifiedSkillNamespaceRootPath(namespace),
  readOnly: false,
  type: 'directory',
});

export const buildSkillFileNode = ({
  content,
  namespace,
  skillName,
}: {
  content?: string;
  namespace: Extract<SkillMountNode['namespace'], 'agent'>;
  skillName: string;
}): SkillMountNode => ({
  ...(content !== undefined ? { content } : {}),
  contentType: 'text/markdown',
  name: SKILL_FILE_NAME,
  namespace,
  path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillName}/${SKILL_FILE_NAME}`,
  readOnly: false,
  type: 'file',
});

export const getValidatedSkillName = (
  name: string,
  fieldName: 'skillName' | 'targetName',
): string => {
  const trimmed = name.trim();

  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\')
  ) {
    throw new AgentDocumentVfsError(
      `Invalid ${fieldName}: expected a non-empty single path segment`,
      'BAD_REQUEST',
    );
  }

  return trimmed;
};

export const getResolvedSkillName = (skillName?: string, filePath?: string) => {
  if (!skillName) {
    throw new AgentDocumentVfsError('Skill path must include a skill name', 'BAD_REQUEST');
  }

  if (filePath && filePath !== SKILL_FILE_NAME) {
    throw new AgentDocumentVfsError(`Unsupported skill file path "${filePath}"`, 'BAD_REQUEST');
  }

  return skillName;
};

export const projectDocumentContent = async (document: AgentDocument) => {
  try {
    const snapshot = await exportEditorDataSnapshot({
      editorData: document.editorData,
      fallbackContent: document.content,
    });

    if (snapshot.content.trim().length === 0 && document.content.trim().length > 0) {
      return document.content;
    }

    return snapshot.content;
  } catch {
    return document.content;
  }
};

export const isManagedSkillDocument = (document: Pick<AgentDocument, 'templateId'>) =>
  document.templateId === AGENT_SKILL_TEMPLATE_ID;

export const getScopedSkillDocuments = (documents: AgentDocument[], namespace: 'agent') =>
  namespace === 'agent' ? documents.filter(isManagedSkillDocument) : [];

export const getNamespaceRoot = (documents: AgentDocument[], namespace: 'agent') =>
  getScopedSkillDocuments(documents, namespace).find(
    (document) =>
      document.fileType === DOCUMENT_FOLDER_TYPE &&
      document.filename === 'skills' &&
      document.parentId === null,
  );

export const getSkillFolder = (
  documents: AgentDocument[],
  namespace: 'agent',
  skillName: string,
) => {
  const root = getNamespaceRoot(documents, namespace);
  if (!root) return undefined;

  return getScopedSkillDocuments(documents, namespace).find(
    (document) =>
      document.fileType === DOCUMENT_FOLDER_TYPE &&
      document.filename === skillName &&
      document.parentId === root.documentId,
  );
};

export const getSkillFile = (documents: AgentDocument[], namespace: 'agent', skillName: string) => {
  const folder = getSkillFolder(documents, namespace, skillName);
  if (!folder) return undefined;

  return getScopedSkillDocuments(documents, namespace).find(
    (document) => document.filename === SKILL_FILE_NAME && document.parentId === folder.documentId,
  );
};

export const listScopedSkillFolders = (documents: AgentDocument[], namespace: 'agent') => {
  const root = getNamespaceRoot(documents, namespace);
  if (!root) return [];

  return getScopedSkillDocuments(documents, namespace).filter(
    (document) =>
      document.fileType === DOCUMENT_FOLDER_TYPE && document.parentId === root.documentId,
  );
};

export const assertSkillDocument = <T>(document: T | undefined, message = 'Skill not found') => {
  if (!document) {
    throw new AgentDocumentVfsError(message, 'NOT_FOUND');
  }

  return document;
};

export const ensureNamespaceRoot = async ({
  agentId,
  agentDocumentModel,
  namespace,
}: {
  agentDocumentModel: AgentSkillDocumentModelLike;
  agentId: string;
  namespace: 'agent';
}): Promise<{ documentId: string }> => {
  const documents = await agentDocumentModel.findByAgent(agentId);
  const existingRoot = getNamespaceRoot(documents, namespace);

  if (existingRoot) {
    return { documentId: existingRoot.documentId };
  }

  const root = await agentDocumentModel.create(agentId, 'skills', '', {
    editorData: EMPTY_EDITOR_DATA,
    fileType: DOCUMENT_FOLDER_TYPE,
    policyLoad: PolicyLoad.DISABLED,
    templateId: AGENT_SKILL_TEMPLATE_ID,
    title: 'skills',
  });

  return { documentId: root.documentId };
};

export const createSkillTree = async ({
  agentDocumentModel,
  agentId,
  content,
  editorData,
  namespace,
  skillName,
}: CreateSkillTreeInput) => {
  const existingDocuments = await agentDocumentModel.findByAgent(agentId);
  const existingRoot = getNamespaceRoot(existingDocuments, namespace);
  const existingFolder = getSkillFolder(existingDocuments, namespace, skillName);
  const existingFile = getSkillFile(existingDocuments, namespace, skillName);

  if (existingFolder || existingFile) {
    throw new AgentDocumentVfsError('Skill already exists', 'CONFLICT');
  }

  const root = existingRoot
    ? { documentId: existingRoot.documentId }
    : await ensureNamespaceRoot({
        agentDocumentModel,
        agentId,
        namespace,
      });

  const createdRootId: string | undefined = existingRoot ? undefined : root.documentId;
  let createdFolderId: string | undefined;
  let createdFileId: string | undefined;

  try {
    const folder = await agentDocumentModel.create(agentId, skillName, '', {
      editorData: EMPTY_EDITOR_DATA,
      fileType: DOCUMENT_FOLDER_TYPE,
      parentId: root.documentId,
      policyLoad: PolicyLoad.DISABLED,
      templateId: AGENT_SKILL_TEMPLATE_ID,
      title: skillName,
    });

    createdFolderId = folder.id;

    const file = await agentDocumentModel.create(agentId, SKILL_FILE_NAME, content, {
      editorData,
      fileType: SKILL_INDEX_FILE_TYPE,
      parentId: folder.documentId,
      templateId: AGENT_SKILL_TEMPLATE_ID,
      title: SKILL_FILE_NAME,
    });

    createdFileId = file.id;

    return { fileDocumentId: file.documentId, folderDocumentId: folder.documentId };
  } catch (error) {
    if (createdFileId) {
      await agentDocumentModel.delete(createdFileId, 'skill-create-rollback');
    }

    if (createdFolderId) {
      await agentDocumentModel.delete(createdFolderId, 'skill-create-rollback');
    }

    if (createdRootId) {
      const rootBinding = await agentDocumentModel
        .findByAgent(agentId)
        .then((documents) => documents.find((document) => document.documentId === createdRootId));

      if (rootBinding) {
        await agentDocumentModel.delete(rootBinding.id, 'skill-create-rollback');
      }
    }

    throw error;
  }
};

export const sortSkillFolders = (documents: AgentDocument[]) =>
  [...documents].sort((left, right) => left.filename.localeCompare(right.filename));

export const collectSubtreeBindings = (documents: AgentDocument[], rootDocumentId: string) => {
  const byParent = new Map<string, AgentDocument[]>();

  for (const document of documents) {
    if (!document.parentId) continue;

    const children = byParent.get(document.parentId) ?? [];
    children.push(document);
    byParent.set(document.parentId, children);
  }

  const collected: AgentDocument[] = [];
  const visit = (documentId: string) => {
    const children = byParent.get(documentId) ?? [];

    for (const child of children) {
      visit(child.documentId);
      collected.push(child);
    }
  };

  visit(rootDocumentId);

  const root = documents.find((document) => document.documentId === rootDocumentId);

  if (root) {
    collected.push(root);
  }

  return collected;
};
