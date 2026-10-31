import type { AgentDocument } from '@/database/models/agentDocuments';
import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';

import type { AgentDocumentVfsDeps } from './deps';
import { toOrdinaryNode } from './nodes';
import { applyListLimit, buildOrdinaryPath, splitAgentDocumentPath } from './paths';
import type { AgentDocumentListOptions, AgentDocumentNode } from './types';

const compareAgentDocumentAge = (left: AgentDocument, right: AgentDocument) => {
  const leftCreatedAt = left.createdAt?.getTime?.() ?? 0;
  const rightCreatedAt = right.createdAt?.getTime?.() ?? 0;

  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;

  return left.id.localeCompare(right.id);
};

export const selectOldestAgentDocument = (documents: AgentDocument[]) =>
  [...documents].sort(compareAgentDocumentAge)[0];

export const selectOldestByFilename = (documents: AgentDocument[]) => {
  const visibleByFilename = new Map<string, AgentDocument>();

  for (const document of [...documents].sort(compareAgentDocumentAge)) {
    if (visibleByFilename.has(document.filename)) continue;
    visibleByFilename.set(document.filename, document);
  }

  return [...visibleByFilename.values()];
};

export async function listOrdinaryNodes(
  deps: AgentDocumentVfsDeps,
  agentId: string,
  parentId: string | null,
  parentPath: string,
  options: AgentDocumentListOptions = {},
): Promise<AgentDocumentNode[]> {
  const docs = await deps.agentDocumentModel.listByParent(agentId, parentId, {
    cursor: options.cursor,
  });
  const visibleDocs = selectOldestByFilename(docs);
  return applyListLimit(
    visibleDocs.map((doc) => toOrdinaryNode(doc, buildOrdinaryPath(parentPath, doc.filename))),
    options,
  );
}

export async function resolveOrdinaryPath(
  deps: AgentDocumentVfsDeps,
  path: string,
  agentId: string,
): Promise<AgentDocument | undefined> {
  return resolveOrdinaryPathWithOptions(deps, path, agentId);
}

export async function resolveOrdinaryPathWithOptions(
  deps: AgentDocumentVfsDeps,
  path: string,
  agentId: string,
  options?: { includeDeleted?: boolean },
): Promise<AgentDocument | undefined> {
  if (path === './') return undefined;

  const segments = splitAgentDocumentPath(path);
  let parentId: string | null = null;
  let current: AgentDocument | undefined;

  for (const segment of segments) {
    const candidates = await deps.agentDocumentModel.listByParentAndFilename(
      agentId,
      parentId,
      segment,
      {
        ...options,
      },
    );

    current = selectOldestAgentDocument(candidates);
    if (!current) return undefined;
    parentId = current.documentId;
  }

  return current;
}

export async function collectOrdinarySubtree(
  deps: AgentDocumentVfsDeps,
  root: AgentDocument,
  agentId: string,
  includeDeleted: boolean,
): Promise<AgentDocument[]> {
  const nodes = [root];

  if (root.fileType !== DOCUMENT_FOLDER_TYPE) return nodes;

  const queue: AgentDocument[] = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await deps.agentDocumentModel.listByParent(agentId, current.documentId, {
      includeDeleted,
    });

    for (const child of children) {
      nodes.push(child);
      if (child.fileType === DOCUMENT_FOLDER_TYPE) {
        queue.push(child);
      }
    }
  }

  return nodes;
}

export async function collectDeletedAncestors(
  deps: AgentDocumentVfsDeps,
  node: AgentDocument,
  agentId: string,
): Promise<AgentDocument[]> {
  const ancestors: AgentDocument[] = [];
  let parentId = node.parentId;

  while (parentId) {
    const parent = await deps.agentDocumentModel.findByDocumentId(agentId, parentId, {
      includeDeleted: true,
    });

    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.parentId;
  }

  return ancestors;
}

export async function buildOrdinaryPathFromNode(
  deps: AgentDocumentVfsDeps,
  node: AgentDocument,
  agentId: string,
): Promise<string> {
  const segments = [node.filename];
  let parentId = node.parentId;

  while (parentId) {
    const parent = await deps.agentDocumentModel.findByDocumentId(agentId, parentId, {
      includeDeleted: true,
    });

    if (!parent) break;
    segments.unshift(parent.filename);
    parentId = parent.parentId;
  }

  return `./${segments.join('/')}`;
}
