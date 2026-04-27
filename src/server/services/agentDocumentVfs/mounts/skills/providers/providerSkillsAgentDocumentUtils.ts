import type { AgentDocument } from '@/database/models/agentDocuments';
import { PolicyLoad } from '@/database/models/agentDocuments';
import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';
import { exportEditorDataSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import { getUnifiedSkillNamespaceRootPath } from '../path';
import type { SkillMountNode } from '../types';

export interface AgentSkillDocumentModelLike {
  associate: (params: {
    agentId: string;
    documentId: string;
    policyLoad?: PolicyLoad;
    uniqueSibling?: boolean;
  }) => Promise<{
    id: string;
  }>;
  delete: (documentId: string, deleteReason?: string) => Promise<void>;
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
  createDocument: (params: {
    content?: string;
    editorData: Record<string, any>;
    fileType?: string;
    metadata?: Record<string, any>;
    parentId?: string;
    title: string;
  }) => Promise<{
    content: string | null;
    documentId?: string;
    editorData: Record<string, any> | null;
    fileType: string;
    filename: string | null;
    id: string;
    metadata: Record<string, any> | null;
    parentId: string | null;
    title: string | null;
  }>;
  deleteDocument: (id: string) => Promise<unknown>;
  trySaveCurrentDocumentHistory: (documentId: string, saveSource: 'llm_call') => Promise<unknown>;
  updateDocument: (
    id: string,
    params: {
      content?: string;
      editorData?: Record<string, any>;
      metadata?: Record<string, any>;
      parentId?: string | null;
      saveSource?: 'llm_call';
      title?: string;
    },
  ) => Promise<unknown>;
}

export interface ProviderSkillsAgentDocumentDeps {
  agentDocumentModel: AgentSkillDocumentModelLike;
  documentService: DocumentTreeServiceLike;
}

export interface CreateSkillTreeInput {
  agentDocumentModel: AgentSkillDocumentModelLike;
  agentId: string;
  content: string;
  documentService: DocumentTreeServiceLike;
  editorData: Record<string, any>;
  lineage?: LobeSkillMetadata['lineage'];
  namespace: 'agent' | 'agent-topic';
  skillName: string;
  topicId?: string;
}

export interface LobeSkillMetadata {
  lineage?: {
    sourceDocumentId: string;
    sourceNamespace: 'agent-topic';
    sourceSkillName?: string;
    sourceTopicId?: string;
  };
  namespace: 'agent' | 'agent-topic';
  role: 'namespace-root' | 'skill-file' | 'skill-folder';
  skillName?: string;
  topicId?: string;
}

export const EMPTY_EDITOR_DATA = { root: { children: [], type: 'root' } };

export const SKILL_FILE_NAME = 'SKILL.md';

export const buildSkillDirectoryNode = (
  namespace: Extract<SkillMountNode['namespace'], 'agent' | 'agent-topic'>,
  skillName: string,
): SkillMountNode => ({
  name: skillName,
  namespace,
  path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillName}`,
  readOnly: false,
  type: 'directory',
});

export const buildSkillNamespaceRootNode = (
  namespace: Extract<SkillMountNode['namespace'], 'agent' | 'agent-topic'>,
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
  namespace: Extract<SkillMountNode['namespace'], 'agent' | 'agent-topic'>;
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

export const getRequiredTopicId = (topicId?: string) => {
  if (!topicId) {
    throw new AgentDocumentVfsError(
      'Topic ID is required for the agent-topic namespace',
      'BAD_REQUEST',
    );
  }

  return topicId;
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

export const getSkillMetadata = (document: Pick<AgentDocument, 'metadata'>) => {
  const metadata = document.metadata as { lobeSkill?: LobeSkillMetadata } | null;
  return metadata?.lobeSkill;
};

export const isManagedSkillDocument = (document: Pick<AgentDocument, 'metadata'>) =>
  Boolean(getSkillMetadata(document));

export const isSkillDocumentInScope = (
  document: Pick<AgentDocument, 'metadata'>,
  namespace: 'agent' | 'agent-topic',
  topicId?: string,
) => {
  const metadata = getSkillMetadata(document);

  if (!metadata || metadata.namespace !== namespace) {
    return false;
  }

  if (namespace === 'agent-topic') {
    return metadata.topicId === topicId;
  }

  return !metadata.topicId;
};

export const getScopedSkillDocuments = (
  documents: AgentDocument[],
  namespace: 'agent' | 'agent-topic',
  topicId?: string,
) => documents.filter((document) => isSkillDocumentInScope(document, namespace, topicId));

export const getNamespaceRoot = (
  documents: AgentDocument[],
  namespace: 'agent' | 'agent-topic',
  topicId?: string,
) =>
  getScopedSkillDocuments(documents, namespace, topicId).find(
    (document) => getSkillMetadata(document)?.role === 'namespace-root',
  );

export const getSkillFolder = (
  documents: AgentDocument[],
  namespace: 'agent' | 'agent-topic',
  skillName: string,
  topicId?: string,
) => {
  const root = getNamespaceRoot(documents, namespace, topicId);

  return getScopedSkillDocuments(documents, namespace, topicId).find((document) => {
    const metadata = getSkillMetadata(document);

    return (
      metadata?.role === 'skill-folder' &&
      metadata.skillName === skillName &&
      (!root || document.parentId === root.documentId)
    );
  });
};

export const getSkillFile = (
  documents: AgentDocument[],
  namespace: 'agent' | 'agent-topic',
  skillName: string,
  topicId?: string,
) => {
  const folder = getSkillFolder(documents, namespace, skillName, topicId);

  return getScopedSkillDocuments(documents, namespace, topicId).find((document) => {
    const metadata = getSkillMetadata(document);

    return (
      metadata?.role === 'skill-file' &&
      metadata.skillName === skillName &&
      (!folder || document.parentId === folder.documentId)
    );
  });
};

export const listScopedSkillFolders = (
  documents: AgentDocument[],
  namespace: 'agent' | 'agent-topic',
  topicId?: string,
) => {
  const root = getNamespaceRoot(documents, namespace, topicId);

  return getScopedSkillDocuments(documents, namespace, topicId).filter((document) => {
    const metadata = getSkillMetadata(document);

    return metadata?.role === 'skill-folder' && (!root || document.parentId === root.documentId);
  });
};

export const assertSkillDocument = <T>(document: T | undefined, message = 'Skill not found') => {
  if (!document) {
    throw new AgentDocumentVfsError(message, 'NOT_FOUND');
  }

  return document;
};

export const createSkillMetadata = ({
  lineage,
  namespace,
  role,
  skillName,
  topicId,
}: LobeSkillMetadata) => ({
  lobeSkill: {
    ...(lineage ? { lineage } : {}),
    namespace,
    role,
    ...(skillName ? { skillName } : {}),
    ...(topicId ? { topicId } : {}),
  } satisfies LobeSkillMetadata,
});

export const ensureNamespaceRoot = async ({
  agentId,
  agentDocumentModel,
  documentService,
  namespace,
  topicId,
}: {
  agentDocumentModel: AgentSkillDocumentModelLike;
  agentId: string;
  documentService: DocumentTreeServiceLike;
  namespace: 'agent' | 'agent-topic';
  topicId?: string;
}): Promise<{ documentId: string }> => {
  const documents = await agentDocumentModel.findByAgent(agentId);
  const existingRoot = getNamespaceRoot(documents, namespace, topicId);

  if (existingRoot) {
    return { documentId: existingRoot.documentId };
  }

  const root = await documentService.createDocument({
    editorData: EMPTY_EDITOR_DATA,
    fileType: DOCUMENT_FOLDER_TYPE,
    metadata: createSkillMetadata({ namespace, role: 'namespace-root', topicId }),
    title: 'skills',
  });

  await agentDocumentModel.associate({
    agentId,
    documentId: root.id,
    policyLoad: PolicyLoad.DISABLED,
    uniqueSibling: false,
  });

  return { documentId: root.id };
};

export const createSkillTree = async ({
  agentDocumentModel,
  agentId,
  content,
  documentService,
  editorData,
  lineage,
  namespace,
  skillName,
  topicId,
}: CreateSkillTreeInput) => {
  const existingDocuments = await agentDocumentModel.findByAgent(agentId);
  const existingRoot = getNamespaceRoot(existingDocuments, namespace, topicId);
  const existingFolder = getSkillFolder(existingDocuments, namespace, skillName, topicId);

  const root = existingRoot
    ? { documentId: existingRoot.documentId }
    : await ensureNamespaceRoot({
        agentDocumentModel,
        agentId,
        documentService,
        namespace,
        topicId,
      });

  const createdRootId: string | undefined = existingRoot ? undefined : root.documentId;
  let createdFolderId: string | undefined;
  let createdFileId: string | undefined;

  try {
    const folder = existingFolder
      ? { id: existingFolder.documentId }
      : await documentService.createDocument({
          editorData: EMPTY_EDITOR_DATA,
          fileType: DOCUMENT_FOLDER_TYPE,
          metadata: createSkillMetadata({
            lineage,
            namespace,
            role: 'skill-folder',
            skillName,
            topicId,
          }),
          parentId: root.documentId,
          title: skillName,
        });

    if (!existingFolder) {
      createdFolderId = folder.id;
      await agentDocumentModel.associate({
        agentId,
        documentId: folder.id,
        policyLoad: PolicyLoad.DISABLED,
        uniqueSibling: false,
      });
    }

    const file = await documentService.createDocument({
      content,
      editorData,
      metadata: createSkillMetadata({
        lineage,
        namespace,
        role: 'skill-file',
        skillName,
        topicId,
      }),
      parentId: folder.id,
      title: SKILL_FILE_NAME,
    });

    createdFileId = file.id;
    await agentDocumentModel.associate({ agentId, documentId: file.id, uniqueSibling: false });

    return { fileDocumentId: file.id, folderDocumentId: folder.id };
  } catch (error) {
    if (createdFileId) {
      await documentService.deleteDocument(createdFileId);
    }

    if (createdFolderId) {
      await documentService.deleteDocument(createdFolderId);
    }

    if (createdRootId) {
      await documentService.deleteDocument(createdRootId);
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
