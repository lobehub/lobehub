type DiffType =
  | 'add'
  | 'listItemAdd'
  | 'listItemModify'
  | 'listItemRemove'
  | 'modify'
  | 'remove'
  | 'unchanged';

const REMOVED_NODE = Symbol('removed-diff-origin');

type RemovedNode = typeof REMOVED_NODE;
type NormalizedNode =
  | RemovedNode
  | Record<string, unknown>
  | unknown[]
  | boolean
  | null
  | number
  | string
  | undefined;

interface SerializedDiffNodeLike extends Record<string, unknown> {
  children?: unknown[];
  diffType?: DiffType;
  type: 'diff';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDiffNode = (value: unknown): value is SerializedDiffNodeLike =>
  isRecord(value) && value.type === 'diff';

const getChildren = (node: Record<string, unknown>): unknown[] =>
  Array.isArray(node.children) ? node.children : [];

const normalizeChildren = (children: unknown[]): unknown[] =>
  children.flatMap((child) => {
    const normalized = normalizeNode(child);

    if (normalized === REMOVED_NODE) return [];

    return Array.isArray(normalized) ? normalized : [normalized];
  });

const normalizeFirstChild = (node: SerializedDiffNodeLike): NormalizedNode => {
  const [origin] = getChildren(node);

  return origin === undefined ? REMOVED_NODE : normalizeNode(origin);
};

const normalizeFirstChildChildren = (node: SerializedDiffNodeLike): NormalizedNode => {
  const [origin] = getChildren(node);

  if (origin === undefined) return REMOVED_NODE;

  return isRecord(origin) && Array.isArray(origin.children)
    ? normalizeChildren(origin.children)
    : normalizeNode(origin);
};

const normalizeDiffNodeOrigin = (node: SerializedDiffNodeLike): NormalizedNode => {
  switch (node.diffType) {
    case 'add':
    case 'listItemAdd': {
      return REMOVED_NODE;
    }

    case 'listItemModify': {
      return normalizeFirstChildChildren(node);
    }

    case 'listItemRemove':
    case 'unchanged': {
      return normalizeChildren(getChildren(node));
    }

    default: {
      return normalizeFirstChild(node);
    }
  }
};

const normalizeNode = (value: unknown): NormalizedNode => {
  if (Array.isArray(value)) return normalizeChildren(value);

  if (!isRecord(value)) return value as NormalizedNode;

  if (isDiffNode(value)) return normalizeDiffNodeOrigin(value);

  const normalized: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    const normalizedChild =
      key === 'children' && Array.isArray(child) ? normalizeChildren(child) : normalizeNode(child);

    if (normalizedChild !== REMOVED_NODE) {
      normalized[key] = normalizedChild;
    }
  }

  return normalized;
};

export const normalizeEditorDataDiffNodes = <T extends Record<string, unknown>>(
  editorData: T,
): T => {
  const normalized = normalizeNode(editorData);

  return isRecord(normalized) ? (normalized as T) : ({} as T);
};
