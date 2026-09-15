import type { DocumentRewriteSelection } from '../schemas/documentRewriteRequest';

export const DOCUMENT_REWRITE_REQUEST_INVALID = 'DOCUMENT_REWRITE_REQUEST_INVALID';
export const DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH = 32_768;
export const DOCUMENT_REWRITE_QUOTED_TEXT_MAX_LENGTH = 32_768;
export const DOCUMENT_REWRITE_ERROR_MAX_LENGTH = 16_384;
export const DOCUMENT_REWRITE_SELECTION_MAX_BYTES = 128 * 1024;
export const DOCUMENT_REWRITE_SELECTION_MAX_DEPTH = 12;
export const DOCUMENT_REWRITE_SELECTION_MAX_KEYS = 256;
export const DOCUMENT_REWRITE_SELECTION_MAX_ARRAY_LENGTH = 512;
export const DOCUMENT_REWRITE_TARGET_NODE_IDS_MAX_LENGTH = 512;
export const DOCUMENT_REWRITE_TARGET_KEY_MAX_LENGTH = 767;
export const DOCUMENT_REWRITE_SESSION_MAX_LENGTH = 255;
export const DOCUMENT_REWRITE_ADAPTER_ID_MAX_LENGTH = 128;
export const DOCUMENT_REWRITE_SOURCE_HASH_MAX_LENGTH = 128;
/** Reserved target used when a caller cannot provide a complete block range. */
export const DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET = '__document__';
export const DOCUMENT_REWRITE_DEFAULT_LEASE_MS = 60_000;
export const DOCUMENT_REWRITE_MAX_LEASE_MS = 15 * 60_000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === '23505' || isUniqueViolation(candidate.cause);
};

export const cloneJson = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // JSONB values are serializable; use the compatibility path below.
    }
  }
  // eslint-disable-next-line unicorn/prefer-structured-clone
  return JSON.parse(JSON.stringify(value)) as T;
};

export const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
    );
  }
  return false;
};

const jsonByteLength = (value: unknown): number => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection`);
  }
  if (typeof serialized !== 'string') {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection`);
  }
  return typeof TextEncoder === 'undefined'
    ? serialized.length
    : new TextEncoder().encode(serialized).byteLength;
};

const validateJSONValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection`);
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection`);
  }
  if (depth >= DOCUMENT_REWRITE_SELECTION_MAX_DEPTH) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.depth`);
  }
  if (seen.has(value)) throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > DOCUMENT_REWRITE_SELECTION_MAX_ARRAY_LENGTH) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.array`);
    }
    value.forEach((item) => validateJSONValue(item, depth + 1, seen));
  } else {
    const entries = Object.entries(value);
    if (entries.length > DOCUMENT_REWRITE_SELECTION_MAX_KEYS) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.keys`);
    }
    entries.forEach(([key, item]) => {
      if (key.length > 128) throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.key`);
      validateJSONValue(item, depth + 1, seen);
    });
  }
  seen.delete(value);
};

export const normalizeString = (value: unknown, field: string, maxLength = 255): string => {
  if (typeof value !== 'string') {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}`);
  }
  return normalized;
};

/** Keep the continuation proof independent from the editor package. */
export const normalizeRewriteText = (text: string): string =>
  text.replaceAll(/\r\n?/g, '\n').replaceAll('\n', ' ');

export interface AISessionProjection {
  /** Number of text nodes carrying this session's AI provenance. */
  rangeCount: number;
  /** Current durable block ids containing the marked text, in document order. */
  targetNodeIds?: string[];
  /** Text reconstructed in serialized editor/tree order. */
  text: string;
}

/**
 * Request-scoped proof projection. The text fields preserve the historical
 * session hash contract; generatedEditorData is an optional, structure-
 * preserving subtree used only when a Markdown rewrite contains non-text
 * nodes such as fenced code or tables.
 */
export interface AIRequestProjection extends AISessionProjection {
  generatedEditorData?: { root: Record<string, unknown> };
  generatedNodeCount?: number;
}

/**
 * Projection for an adapter-owned atomic node. Unlike text rewrites, the
 * provenance is stamped on the block node itself, so looking only for
 * `value.text` would incorrectly report a deleted Artifact/code/card after a
 * refresh. The returned text is the adapter-independent persisted source
 * representation used by the request row's continuation proof.
 */
export interface AIBlockSessionProjection extends AISessionProjection {
  nodeCount: number;
}

/**
 * Canonical persisted context for one adapter-owned rewrite target. This is
 * intentionally derived from the document snapshot rather than the request's
 * captured sourceHash: a continuation may be opened after the first atomic
 * apply has changed the node's source.
 */
export interface PersistedBlockRewriteContext {
  adapterId: string;
  nodeId: string;
  nodeType: string;
  quotedText: string;
  source: string;
  sourceHash: string;
  title?: string;
}

export type PersistedBlockRewriteContextResult =
  | { context: PersistedBlockRewriteContext; status: 'found' }
  | { status: 'adapter-mismatch' }
  | { status: 'missing' };

const getPersistedTextContent = (value: unknown, seen = new WeakSet<object>()): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value))
    return value.map((child) => getPersistedTextContent(child, seen)).join('');
  if (!isRecord(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if (value.type === 'linebreak') return '\n';
  return Array.isArray(value.children)
    ? value.children.map((child) => getPersistedTextContent(child, seen)).join('')
    : '';
};

const getPersistedNodeId = (value: Record<string, unknown>): string | undefined => {
  const properties = isRecord(value.$) && isRecord(value.$.properties) ? value.$.properties : {};
  const nodeId = properties.nodeId ?? value.id;
  if (typeof nodeId === 'string' && nodeId.trim().length > 0) return nodeId.trim();
  if (typeof nodeId === 'number' && Number.isSafeInteger(nodeId)) return String(nodeId);
  return undefined;
};

const getPersistedBlockSource = (value: Record<string, unknown>): string => {
  const type = typeof value.type === 'string' ? value.type : '';
  if (type === 'block-image') {
    const src = typeof value.src === 'string' ? value.src : '';
    const status = value.status;
    return JSON.stringify({
      altText: typeof value.altText === 'string' ? value.altText : '',
      height: typeof value.height === 'number' ? value.height : null,
      maxWidth: typeof value.maxWidth === 'number' ? value.maxWidth : null,
      placeholder: (status === 'loading' || status === 'error') && src.length === 0,
      src,
      width: typeof value.width === 'number' ? value.width : null,
    });
  }
  // LinkBlockCard uses patch output. A stable, bounded JSON representation
  // gives continuation the same source proof as the editor adapter without
  // allowing a URL field to be interpreted as executable content.
  if (type === 'link-block-card') {
    return JSON.stringify({
      description: typeof value.description === 'string' ? value.description : '',
      title: typeof value.title === 'string' ? value.title : '',
      url: typeof value.url === 'string' ? value.url : '',
    });
  }
  for (const key of ['html', 'code', 'source'] as const) {
    if (typeof value[key] === 'string') return value[key];
  }
  if (typeof value.text === 'string') return value.text;
  return getPersistedTextContent(value);
};

const getPersistedBlockLanguage = (value: Record<string, unknown>): string | undefined => {
  const language = value.language ?? value.lang;
  return typeof language === 'string' && language.trim().length > 0 ? language.trim() : undefined;
};

const getPersistedBlockTitle = (value: Record<string, unknown>): string | undefined => {
  if (typeof value.title === 'string' && value.title.trim().length > 0) {
    return value.title.trim();
  }
  const properties = isRecord(value.$) && isRecord(value.$.properties) ? value.$.properties : {};
  return typeof properties.title === 'string' && properties.title.trim().length > 0
    ? properties.title.trim()
    : undefined;
};

const getPersistedBlockSummary = (
  value: Record<string, unknown>,
  adapterId: string,
  title?: string,
): string => {
  const language = getPersistedBlockLanguage(value);
  if (adapterId === 'artifact') return title || 'Artifact';
  if (adapterId === 'codemirror') return language ? `Code (${language})` : 'Code';
  if (adapterId === 'codeblock') return language ? `Code block (${language})` : 'Code block';
  if (adapterId === 'link-block-card') {
    return typeof value.description === 'string' && value.description.trim().length > 0
      ? value.description.trim()
      : title || 'Link';
  }
  if (adapterId === 'block-image') {
    return typeof value.altText === 'string' && value.altText.trim().length > 0
      ? value.altText.trim()
      : 'Image';
  }
  return title || (typeof value.type === 'string' && value.type.trim()) || 'Block';
};

/**
 * Keep adapter identity explicit at the server boundary. The two code
 * adapters intentionally share Lexical type `code`, so CodeMirror's durable
 * `code` field is the discriminator and the regular code block's child text
 * is the fallback representation.
 */
const persistedNodeMatchesAdapter = (
  value: Record<string, unknown>,
  adapterId: string,
): boolean => {
  const type = typeof value.type === 'string' ? value.type : '';
  switch (adapterId) {
    case 'artifact': {
      return type === 'artifact';
    }
    case 'codemirror': {
      return type === 'code' && typeof value.code === 'string';
    }
    case 'codeblock': {
      return type === 'code' && typeof value.code !== 'string';
    }
    case 'link-block-card': {
      return type === 'link-block-card';
    }
    case 'block-image': {
      return type === 'block-image';
    }
    default: {
      const properties =
        isRecord(value.$) && isRecord(value.$.properties) ? value.$.properties : {};
      return type === adapterId || properties.adapterId === adapterId;
    }
  }
};

/**
 * Resolve an adapter-owned node from persisted editorData. `status` lets the
 * request model distinguish a deleted target from a node whose adapter/type
 * identity has changed, while the context contains only canonical source
 * fields understood by the corresponding editor adapter.
 */
export const resolvePersistedBlockRewriteContext = (
  editorData: unknown,
  sessionId: string,
  targetNodeId: string,
  adapterId: string,
): PersistedBlockRewriteContextResult => {
  if (!sessionId || !targetNodeId || !adapterId) return { status: 'missing' };

  let nodeFound = false;
  let adapterMismatch = false;
  let result: PersistedBlockRewriteContext | undefined;
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (result || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    if (getPersistedNodeId(value) === targetNodeId) {
      nodeFound = true;
      const nodeState = isRecord(value.$) ? value.$ : null;
      const properties = nodeState && isRecord(nodeState.properties) ? nodeState.properties : null;
      const provenance =
        properties && isRecord(properties.provenance) ? properties.provenance : null;
      if (provenance?.sessionId === sessionId) {
        if (!persistedNodeMatchesAdapter(value, adapterId)) {
          adapterMismatch = true;
        } else {
          const source = getPersistedBlockSource(value);
          const title = getPersistedBlockTitle(value);
          result = {
            adapterId,
            nodeId: targetNodeId,
            nodeType: typeof value.type === 'string' ? value.type : 'block',
            quotedText: getPersistedBlockSummary(value, adapterId, title),
            source,
            sourceHash: hashRewriteText(source),
            ...(title ? { title } : {}),
          };
          return;
        }
      }
    }

    Object.values(value).forEach(visit);
  };

  visit(editorData);
  if (result) return { context: result, status: 'found' };
  if (nodeFound && adapterMismatch) return { status: 'adapter-mismatch' };
  return { status: 'missing' };
};

/** Read one adapter-owned node's durable session provenance from editorData. */
export const collectAIBlockSessionProjection = (
  editorData: unknown,
  sessionId: string,
  targetNodeId: string,
): AIBlockSessionProjection => {
  if (!sessionId || !targetNodeId) return { nodeCount: 0, rangeCount: 0, text: '' };

  let nodeCount = 0;
  const textParts: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const nodeState = isRecord(value.$) ? value.$ : null;
    const properties = nodeState && isRecord(nodeState.properties) ? nodeState.properties : null;
    const provenance = properties && isRecord(properties.provenance) ? properties.provenance : null;
    if (provenance?.sessionId === sessionId && getPersistedNodeId(value) === targetNodeId) {
      nodeCount += 1;
      textParts.push(getPersistedBlockSource(value));
    }
    // The persisted root is held under `editorData.root`, while custom
    // serializers may nest children under other container keys. Traverse
    // object values just like the text projection and let the WeakSet avoid
    // revisiting shared JSON subtrees.
    Object.values(value).forEach(visit);
  };

  visit(editorData);
  return { nodeCount, rangeCount: nodeCount, text: textParts.join('') };
};

/**
 * Read the persisted Lexical NodeState projection used by Page documents.
 * NodeState is serialized under `$.properties`, so this deliberately does
 * not trust DOM attributes or a browser-side AISessionService projection.
 */
export const collectAISessionProjection = (
  editorData: unknown,
  sessionId: string,
): AISessionProjection => {
  if (!sessionId) return { rangeCount: 0, text: '' };

  const textParts: string[] = [];
  const targetNodeIds: string[] = [];
  const targetNodeIdSet = new Set<string>();
  const blockTypes = new Set([
    'blockquote',
    'collapsible',
    'heading',
    'list',
    'listitem',
    'paragraph',
    'quote',
  ]);
  const seen = new WeakSet<object>();
  const visit = (value: unknown, inheritedBlockId?: string): void => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, inheritedBlockId));
      return;
    }

    if (!isRecord(value)) return;
    const nextBlockId =
      typeof value.type === 'string' && blockTypes.has(value.type)
        ? (getPersistedNodeId(value) ?? inheritedBlockId)
        : inheritedBlockId;
    const nodeState = isRecord(value.$) ? value.$ : null;
    const properties = nodeState && isRecord(nodeState.properties) ? nodeState.properties : null;
    const provenance = properties && isRecord(properties.provenance) ? properties.provenance : null;
    // Cursor nodes are invisible FEFF sentinels used by Code/adapter blocks.
    // They can inherit AI provenance during recursive marking, but the live
    // AISessionService intentionally excludes them from rewrite ranges.
    if (
      provenance?.sessionId === sessionId &&
      value.type !== 'cursor' &&
      typeof value.text === 'string'
    ) {
      textParts.push(value.text);
      if (nextBlockId && !targetNodeIdSet.has(nextBlockId)) {
        targetNodeIdSet.add(nextBlockId);
        targetNodeIds.push(nextBlockId);
      }
    }

    Object.values(value).forEach((child) => visit(child, nextBlockId));
  };

  visit(editorData);
  return {
    rangeCount: textParts.length,
    ...(targetNodeIds.length > 0 ? { targetNodeIds } : {}),
    text: textParts.join(''),
  };
};

/**
 * Read only the generated leaves belonging to one request/generation. This is
 * deliberately narrower than the continuation session projection: a session
 * may contain prior turns, while direct-apply proof must compare the current
 * request's complete output and never a prefix/previous turn mixture.
 */
export const collectAIRequestProjection = (
  editorData: unknown,
  requestId: string,
  generationId?: string | null,
): AIRequestProjection => {
  if (!requestId) return { rangeCount: 0, text: '' };

  const textParts: string[] = [];
  let generatedNodeCount = 0;
  const seen = new WeakSet<object>();

  const matchesRequestProvenance = (value: Record<string, unknown>): boolean => {
    const nodeState = isRecord(value.$) ? value.$ : null;
    const properties = nodeState && isRecord(nodeState.properties) ? nodeState.properties : null;
    const provenance = properties && isRecord(properties.provenance) ? properties.provenance : null;
    return (
      provenance?.source === 'ai' &&
      provenance.requestId === requestId &&
      (generationId === undefined ||
        generationId === null ||
        provenance.generationId === generationId) &&
      value.type !== 'cursor'
    );
  };

  /** Keep only request-owned descendants while retaining their original tree shape. */
  const flattenProjectedNodes = (entries: Array<{ node: unknown; count: number }>): unknown[] =>
    entries.flatMap((entry) => (Array.isArray(entry.node) ? entry.node : [entry.node]));

  const projectGeneratedNode = (value: unknown): { node: unknown; count: number } | null => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const children = value
        .map(projectGeneratedNode)
        .filter((entry): entry is { node: unknown; count: number } => Boolean(entry));
      if (children.length === 0) return null;
      return {
        count: children.reduce((total, child) => total + child.count, 0),
        node: flattenProjectedNodes(children),
      };
    }
    if (!isRecord(value)) return null;

    const ownMatch = matchesRequestProvenance(value);
    const childValues = Array.isArray(value.children) ? value.children : undefined;
    const children = childValues
      ? childValues
          .map(projectGeneratedNode)
          .filter((entry): entry is { node: unknown; count: number } => Boolean(entry))
      : [];
    if (children.length > 0) {
      const projectedChildren = flattenProjectedNodes(children);
      if (!ownMatch && value.type !== 'root') {
        return {
          count: children.reduce((total, child) => total + child.count, 0),
          node: projectedChildren,
        };
      }
      return {
        count: children.reduce((total, child) => total + child.count, 0) + (ownMatch ? 1 : 0),
        node: { ...value, children: projectedChildren },
      };
    }
    if (childValues) {
      if (!ownMatch) return null;
      return { count: 1, node: { ...value, children: [] } };
    }
    if (!ownMatch) return null;
    // A generated leaf may carry source in fields such as `code`, `html`, or
    // adapter-owned metadata instead of `text`; preserve it wholesale.
    return { count: 1, node: { ...value } };
  };

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (matchesRequestProvenance(value) && typeof value.text === 'string') {
      textParts.push(value.text);
    }
    if (matchesRequestProvenance(value)) {
      generatedNodeCount += 1;
    }
    Object.values(value).forEach(visit);
  };
  visit(editorData);

  const projection: AIRequestProjection = {
    rangeCount: textParts.length,
    text: textParts.join(''),
  };
  if (generatedNodeCount > 0 && isRecord(editorData)) {
    const root = isRecord(editorData.root) ? editorData.root : null;
    const projectedRoot = root ? projectGeneratedNode(root)?.node : null;
    if (root && projectedRoot) {
      const projectedRootRecord =
        isRecord(projectedRoot) && projectedRoot.type === 'root' ? projectedRoot : null;
      projection.generatedEditorData = {
        root: projectedRootRecord ?? {
          ...root,
          children: Array.isArray(projectedRoot) ? projectedRoot : [projectedRoot],
        },
      };
      projection.generatedNodeCount = generatedNodeCount;
    }
  }
  return projection;
};

/** Same stable FNV-1a proof used by the editor's rewrite command. */
export const hashRewriteText = (text: string): string => {
  let hash = 2_166_136_261;
  for (const character of normalizeRewriteText(text)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const normalizeRelativePosition = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}`);
  const normalized: Record<string, unknown> = {};
  if (value.assoc !== undefined) {
    if (typeof value.assoc !== 'number' || !Number.isSafeInteger(value.assoc)) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}.assoc`);
    }
    normalized.assoc = value.assoc;
  }

  for (const key of ['item', 'type'] as const) {
    const part = value[key];
    if (part === undefined) continue;
    if (
      !isRecord(part) ||
      typeof part.client !== 'number' ||
      !Number.isSafeInteger(part.client) ||
      part.client < 0 ||
      typeof part.clock !== 'number' ||
      !Number.isSafeInteger(part.clock) ||
      part.clock < 0
    ) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}.${key}`);
    }
    normalized[key] = { client: part.client, clock: part.clock };
  }

  if (value.tname !== undefined) {
    if (value.tname !== null && typeof value.tname !== 'string') {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}.tname`);
    }
    if (typeof value.tname === 'string' && value.tname.length > 255) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}.tname`);
    }
    normalized.tname = value.tname;
  }
  return normalized;
};

const normalizeOffset = (value: unknown, field: string): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000_000
  ) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: ${field}`);
  }
  return value;
};

const normalizeTargetNodeIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.targetNodeIds`);
  }
  if (value.length > DOCUMENT_REWRITE_TARGET_NODE_IDS_MAX_LENGTH) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.targetNodeIds`);
  }
  const ids = value.map((nodeId) => normalizeString(nodeId, 'selection.targetNodeIds'));
  if (ids.includes(DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET)) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.targetNodeIds`);
  }
  // `targetNodeIds` is also the durable document-order projection used by the
  // headless resolver. Deduplicate without sorting: UUID/string order is not
  // document order. Concurrency reservation may canonicalize a separate copy
  // when building its target key, but the persisted selection must stay in the
  // order captured by the browser.
  return [...new Set(ids)];
};

export const normalizeSelection = (selection: unknown): DocumentRewriteSelection => {
  if (!isRecord(selection)) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection`);
  }
  validateJSONValue(selection);
  if (jsonByteLength(selection) > DOCUMENT_REWRITE_SELECTION_MAX_BYTES) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.bytes`);
  }

  const kind = selection.kind;
  if (kind !== 'relative' && kind !== 'block') {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.kind`);
  }

  const targetKind = selection.targetKind ?? 'text-range';
  if (targetKind !== 'text-range' && targetKind !== 'node') {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.targetKind`);
  }

  const quotedText = selection.quotedText;
  if (
    typeof quotedText !== 'string' ||
    quotedText.length > DOCUMENT_REWRITE_QUOTED_TEXT_MAX_LENGTH
  ) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.quotedText`);
  }
  const quotedTextHash = normalizeString(selection.quotedTextHash, 'selection.quotedTextHash', 128);
  if (selection.appliedTextHash !== undefined) {
    // This proof is written only by markDirectApplied after the durable Agent
    // history exists. Never accept it from a public create/continuation wire
    // payload, where it would let a caller bless an already changed range.
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.appliedTextHash`);
  }
  let normalizedRoomId: string | undefined;
  let normalizedAnchorPos: Record<string, unknown> | undefined;
  let normalizedFocusPos: Record<string, unknown> | undefined;
  let normalizedStartNodeId: string | undefined;
  let normalizedEndNodeId: string | undefined;
  let normalizedBaseStateVector: string | undefined;
  let normalizedCapturedAt: string | undefined;
  let normalizedStartOffset: number | undefined;
  let normalizedEndOffset: number | undefined;
  let normalizedTargetNodeIds: string[] | undefined;
  let normalizedAdapterId: string | undefined;
  let normalizedTargetNodeId: string | undefined;
  let normalizedSourceHash: string | undefined;

  if (selection.targetNodeIds !== undefined) {
    normalizedTargetNodeIds = normalizeTargetNodeIds(selection.targetNodeIds);
  }

  if (selection.baseStateVector !== undefined) {
    normalizeString(selection.baseStateVector, 'selection.baseStateVector', 65_536);
  }
  if (selection.capturedAt !== undefined) {
    const capturedAt = normalizeString(selection.capturedAt, 'selection.capturedAt', 128);
    if (Number.isNaN(Date.parse(capturedAt))) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.capturedAt`);
    }
  }

  if (targetKind === 'node') {
    if (kind !== 'block') {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.targetKind`);
    }
    normalizedRoomId = normalizeString(selection.roomId, 'selection.roomId');
    normalizedAdapterId = normalizeString(
      selection.adapterId,
      'selection.adapterId',
      DOCUMENT_REWRITE_ADAPTER_ID_MAX_LENGTH,
    );
    normalizedTargetNodeId = normalizeString(selection.targetNodeId, 'selection.targetNodeId');
    normalizedSourceHash = normalizeString(
      selection.sourceHash,
      'selection.sourceHash',
      DOCUMENT_REWRITE_SOURCE_HASH_MAX_LENGTH,
    );
    normalizedTargetNodeIds = normalizeTargetNodeIds(
      selection.targetNodeIds ?? [normalizedTargetNodeId],
    );
    if (
      normalizedTargetNodeIds.length !== 1 ||
      normalizedTargetNodeIds[0] !== normalizedTargetNodeId
    ) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.targetNodeIds`);
    }
    normalizedStartNodeId = normalizedTargetNodeId;
    normalizedEndNodeId = normalizedTargetNodeId;
    normalizedStartOffset = 0;
    normalizedEndOffset = 1;
  } else if (kind === 'relative') {
    const roomId = normalizeString(selection.roomId, 'selection.roomId');
    const baseStateVector = normalizeString(
      selection.baseStateVector,
      'selection.baseStateVector',
      65_536,
    );
    const capturedAt = normalizeString(selection.capturedAt, 'selection.capturedAt', 128);
    if (Number.isNaN(Date.parse(capturedAt))) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.capturedAt`);
    }
    if (!isRecord(selection.anchorPos) || !isRecord(selection.focusPos)) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.relativePositions`);
    }
    validateJSONValue(selection.anchorPos);
    validateJSONValue(selection.focusPos);
    normalizedRoomId = roomId;
    normalizedBaseStateVector = baseStateVector;
    normalizedCapturedAt = capturedAt;
    normalizedAnchorPos = normalizeRelativePosition(selection.anchorPos, 'selection.anchorPos');
    normalizedFocusPos = normalizeRelativePosition(selection.focusPos, 'selection.focusPos');
    // Relative positions are authoritative for resolving the text range, but
    // an optional durable block projection lets the server conservatively
    // claim the same target across reconnects and concurrent requests.
    if (selection.startNodeId !== undefined) {
      normalizedStartNodeId = normalizeString(selection.startNodeId, 'selection.startNodeId');
    }
    if (selection.endNodeId !== undefined) {
      normalizedEndNodeId = normalizeString(selection.endNodeId, 'selection.endNodeId');
    }
    if (selection.startOffset !== undefined) {
      normalizedStartOffset = normalizeOffset(selection.startOffset, 'selection.startOffset');
    }
    if (selection.endOffset !== undefined) {
      normalizedEndOffset = normalizeOffset(selection.endOffset, 'selection.endOffset');
    }
  } else {
    normalizedStartNodeId = normalizeString(selection.startNodeId, 'selection.startNodeId');
    normalizedEndNodeId = normalizeString(selection.endNodeId, 'selection.endNodeId');
    normalizedStartOffset = normalizeOffset(selection.startOffset, 'selection.offsets');
    normalizedEndOffset = normalizeOffset(selection.endOffset, 'selection.offsets');
  }

  if (normalizedTargetNodeIds) {
    for (const nodeId of [normalizedStartNodeId, normalizedEndNodeId]) {
      if (nodeId === DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.nodeId`);
      }
      if (nodeId && !normalizedTargetNodeIds.includes(nodeId)) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.targetNodeIds`);
      }
    }
  }
  if (
    normalizedStartNodeId === DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET ||
    normalizedEndNodeId === DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET
  ) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.nodeId`);
  }

  // Copy only documented fields. Unknown fields (including room tickets or
  // provider secrets) are intentionally discarded rather than persisted.
  const normalized: DocumentRewriteSelection = {
    kind,
    quotedText,
    quotedTextHash,
    ...(selection.targetKind ? { targetKind } : {}),
  };
  for (const key of [
    'anchorPos',
    'baseStateVector',
    'capturedAt',
    'endNodeId',
    'endOffset',
    'focusPos',
    'roomId',
    'startNodeId',
    'startOffset',
    'targetKind',
    'targetNodeId',
    'targetNodeIds',
    'sourceHash',
    'adapterId',
  ] as const) {
    const value = selection[key];
    if (value !== undefined) {
      (normalized as unknown as Record<string, unknown>)[key] =
        typeof value === 'string' ? value.trim() : cloneJson(value);
    }
  }
  if (targetKind === 'node') {
    normalized.adapterId = normalizedAdapterId;
    normalized.sourceHash = normalizedSourceHash;
    normalized.targetKind = 'node';
    normalized.targetNodeId = normalizedTargetNodeId;
    normalized.startNodeId = normalizedStartNodeId;
    normalized.endNodeId = normalizedEndNodeId;
    normalized.startOffset = normalizedStartOffset;
    normalized.endOffset = normalizedEndOffset;
    normalized.roomId = normalizedRoomId;
  } else if (kind === 'relative') {
    if (normalizedRoomId !== undefined) normalized.roomId = normalizedRoomId;
    if (normalizedAnchorPos !== undefined) normalized.anchorPos = normalizedAnchorPos;
    if (normalizedFocusPos !== undefined) normalized.focusPos = normalizedFocusPos;
    if (normalizedBaseStateVector !== undefined) {
      normalized.baseStateVector = normalizedBaseStateVector;
    }
    if (normalizedCapturedAt !== undefined) normalized.capturedAt = normalizedCapturedAt;
    if (normalizedStartNodeId !== undefined) normalized.startNodeId = normalizedStartNodeId;
    if (normalizedEndNodeId !== undefined) normalized.endNodeId = normalizedEndNodeId;
    if (normalizedStartOffset !== undefined) normalized.startOffset = normalizedStartOffset;
    if (normalizedEndOffset !== undefined) normalized.endOffset = normalizedEndOffset;
  } else {
    normalized.startNodeId = normalizedStartNodeId;
    normalized.endNodeId = normalizedEndNodeId;
    normalized.startOffset = normalizedStartOffset;
    normalized.endOffset = normalizedEndOffset;
  }
  if (normalizedTargetNodeIds) normalized.targetNodeIds = normalizedTargetNodeIds;
  // JSONB has no `undefined`; strip optional properties before comparing an
  // idempotent replay with the value read back from the database.
  return cloneJson(normalized);
};

export const targetNodeIdsFromSelection = (selection: DocumentRewriteSelection): string[] => {
  if (selection.targetNodeIds && selection.targetNodeIds.length > 0) {
    // The persisted target projection is canonicalized for compatibility and
    // never used as document order; never mutate the selection JSON itself.
    return [...new Set(selection.targetNodeIds)].sort();
  }

  const endpoints = [selection.startNodeId, selection.endNodeId].filter(
    (nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0,
  );
  // Endpoints alone cannot prove that a multi-block range does not overlap a
  // request targeting a block in the middle. A complete browser projection
  // is preferred; without one, reserve the whole document conservatively.
  if (endpoints.length === 1 || (endpoints.length === 2 && endpoints[0] === endpoints[1])) {
    return [endpoints[0]];
  }
  return [DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET];
};

export const targetKeyFromNodeIds = (nodeIds: string[]): string | null =>
  nodeIds.length > 0 && nodeIds.join('|').length <= DOCUMENT_REWRITE_TARGET_KEY_MAX_LENGTH
    ? nodeIds.join('|')
    : null;

export const safeLeaseMs = (value?: number): number => {
  if (!Number.isFinite(value)) return DOCUMENT_REWRITE_DEFAULT_LEASE_MS;
  return Math.min(Math.max(Math.trunc(value!), 1_000), DOCUMENT_REWRITE_MAX_LEASE_MS);
};
