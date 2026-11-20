import type { AgentDocument } from '@/database/models/agentDocuments';
import { AgentAccess } from '@/database/models/agentDocuments';
import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';

import { getAgentDocumentContentType } from '../agentDocuments/contentFormat';
import { getUnifiedSkillNamespaceRootPath } from './mounts/skills/path';
import type { SkillMountNode } from './mounts/skills/types';
import { LOBE_PATH, LOBE_SKILLS_PATH } from './paths';
import {
  buildSkillMountInfo,
  getSkillNamespaceCollectionParent,
  getSkillNamespaceDirectory,
  resolveSkillMountSource,
  skillNodeToMode,
} from './skillPaths';
import type { AgentDocumentNode, AgentDocumentStats } from './types';

const SYNTHETIC_DIRECTORY_MODE = AgentAccess.LIST | AgentAccess.READ;

export function toOrdinaryNode(doc: AgentDocument, path: string): AgentDocumentNode {
  return {
    agentDocumentId: doc.id,
    createdAt: doc.createdAt,
    documentId: doc.documentId,
    id: doc.id,
    mode: doc.accessSelf,
    mount: {
      driver: 'agent-documents',
      source: 'documents',
    },
    name: doc.filename,
    path,
    size: doc.content.length,
    type: doc.fileType === DOCUMENT_FOLDER_TYPE ? 'directory' : 'file',
    updatedAt: doc.updatedAt,
  };
}

export function toOrdinaryStats(doc: AgentDocument, path: string): AgentDocumentStats {
  return {
    ...toOrdinaryNode(doc, path),
    contentType:
      doc.fileType === DOCUMENT_FOLDER_TYPE ? undefined : getAgentDocumentContentType(doc),
    deleteReason: doc.deleteReason,
    deletedAt: doc.deletedAt,
    metadata: doc.metadata ?? undefined,
  };
}

export function toMountedNode(node: SkillMountNode): AgentDocumentNode {
  return {
    id: `skills:${node.namespace}:${node.path}`,
    mode: skillNodeToMode(node),
    mount: {
      driver: 'skills',
      namespace: node.namespace,
      source: resolveSkillMountSource(node.namespace),
    },
    name: node.name,
    path: node.path,
    size: node.size ?? (node.type === 'file' ? node.content?.length : undefined),
    type: node.type,
  };
}

export function toMountedStats(node: SkillMountNode): AgentDocumentStats {
  return {
    ...toMountedNode(node),
    contentType: node.contentType,
  };
}

export function createSyntheticDirectoryNode(path: string, name: string): AgentDocumentNode {
  return {
    id: `synthetic:${path}`,
    mode: SYNTHETIC_DIRECTORY_MODE,
    mount: {
      driver: 'synthetic',
      source: 'virtual',
    },
    name,
    path,
    type: 'directory',
  };
}

export function getSyntheticNode(path: string): AgentDocumentStats | undefined {
  if (path === './') return { ...createSyntheticDirectoryNode('./', '') };
  if (path === LOBE_PATH) return { ...createSyntheticDirectoryNode(LOBE_PATH, 'lobe') };
  if (path === LOBE_SKILLS_PATH) {
    return { ...createSyntheticDirectoryNode(LOBE_SKILLS_PATH, 'skills') };
  }

  const namespace = getSkillNamespaceDirectory(path);

  if (namespace) {
    const name = path.split('/').at(-1)!;
    return {
      ...createSyntheticDirectoryNode(path, name),
      mount: buildSkillMountInfo(namespace),
    };
  }

  return undefined;
}

export function listSyntheticChildren(path: string): AgentDocumentNode[] | undefined {
  if (path === LOBE_PATH) {
    return [createSyntheticDirectoryNode(LOBE_SKILLS_PATH, 'skills')];
  }

  if (path === LOBE_SKILLS_PATH) {
    return [
      createSyntheticDirectoryNode('./lobe/skills/builtin', 'builtin'),
      createSyntheticDirectoryNode('./lobe/skills/installed', 'installed'),
      createSyntheticDirectoryNode('./lobe/skills/agent', 'agent'),
    ];
  }

  if (path === './lobe/skills/installed') {
    return [
      createSyntheticDirectoryNode('./lobe/skills/installed/all', 'all'),
      createSyntheticDirectoryNode('./lobe/skills/installed/active', 'active'),
    ];
  }

  const namespace = getSkillNamespaceCollectionParent(path);

  if (namespace) {
    return [
      {
        ...createSyntheticDirectoryNode(getUnifiedSkillNamespaceRootPath(namespace), 'skills'),
        mount: buildSkillMountInfo(namespace),
      },
    ];
  }

  return undefined;
}
