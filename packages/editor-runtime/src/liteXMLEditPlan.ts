import type { ModifyOperation } from './types';

/**
 * Pure planning helpers shared by every LiteXML node-edit path (the page agent's
 * `EditorRuntime` and the server's headless agent-document editor). They decide
 * the order operations run in, which ids each one needs, and whether it can be
 * applied as a pending review diff.
 */

export const normalizeLiteXMLFragment = (litexml: string) => {
  const trimmed = litexml.trim();

  return trimmed.startsWith('<root>') ? trimmed : `<root>${trimmed}</root>`;
};

const stripRootElement = (litexml: string) => {
  const trimmed = litexml.trim();

  return trimmed.startsWith('<root>') && trimmed.endsWith('</root>')
    ? trimmed.slice('<root>'.length, -'</root>'.length)
    : trimmed;
};

// Attributes stop at `<` as well as `>` (LiteXML escapes `<` in values), so an
// unterminated tag cannot make every later match rescan the rest of the input.
const LITEXML_TAG_PATTERN = /<(\/?)([a-z][\w-]*)(\s[^<>]*)?>/gi;
const LITEXML_ID_ATTRIBUTE = /\bid="([^"]+)"/;
const LIST_TAGS = new Set(['li', 'ol', 'ul']);

export interface LiteXMLDocumentIndex {
  /** Ids of the nodes enclosing each node, nearest first. */
  ancestorIds: Map<string, string[]>;
  ids: Set<string>;
  /** Ids of list containers, list items and every node nested inside them. */
  listIds: Set<string>;
  /** Tag name of every node with an id. */
  tags: Map<string, string>;
}

export const indexLiteXMLDocument = (litexml: string): LiteXMLDocumentIndex => {
  const ancestorIds = new Map<string, string[]>();
  const ids = new Set<string>();
  const listIds = new Set<string>();
  const tags = new Map<string, string>();
  const stack: { id?: string; inList: boolean }[] = [];

  for (const [, closing, tag, attributes = ''] of litexml.matchAll(LITEXML_TAG_PATTERN)) {
    if (closing) {
      stack.pop();
      continue;
    }

    const inList = (stack.at(-1)?.inList ?? false) || LIST_TAGS.has(tag.toLowerCase());
    const id = attributes.match(LITEXML_ID_ATTRIBUTE)?.[1];
    if (id) {
      ids.add(id);
      tags.set(id, tag.toLowerCase());
      if (inList) listIds.add(id);
      const ancestors: string[] = [];
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        const ancestorId = stack[depth].id;
        if (ancestorId) ancestors.push(ancestorId);
      }
      ancestorIds.set(id, ancestors);
    }
    if (!attributes.endsWith('/')) stack.push({ id, inList });
  }

  return { ancestorIds, ids, listIds, tags };
};

/** Tag name and id of each top-level node of a fragment. */
const getTopLevelLiteXMLNodes = (litexml: string): { id?: string; tag: string }[] => {
  const nodes: { id?: string; tag: string }[] = [];
  let depth = 0;

  for (const [, closing, tag, attributes = ''] of normalizeLiteXMLFragment(litexml).matchAll(
    LITEXML_TAG_PATTERN,
  )) {
    if (closing) {
      depth -= 1;
      continue;
    }
    if (depth === 1 && tag !== 'root') {
      nodes.push({ id: attributes.match(LITEXML_ID_ATTRIBUTE)?.[1], tag: tag.toLowerCase() });
    }
    if (!attributes.endsWith('/')) depth += 1;
  }

  return nodes;
};

/** The first closing tag that does not match the open element, if any. */
const findUnbalancedTag = (litexml: string): string | undefined => {
  const stack: string[] = [];

  for (const [, closing, tag, attributes = ''] of normalizeLiteXMLFragment(litexml).matchAll(
    LITEXML_TAG_PATTERN,
  )) {
    const name = tag.toLowerCase();
    if (!closing) {
      if (!attributes.endsWith('/')) stack.push(name);
      continue;
    }
    const open = stack.pop();
    if (open !== name) {
      return open ? `<${open}> is closed by </${name}>` : `</${name}> has no matching opening tag`;
    }
  }

  return stack.length > 0 ? `<${stack.at(-1)}> is never closed` : undefined;
};

/**
 * Nodes the editor can only replace with a node of the same kind: an inline span
 * cannot stand in for a list item or a table cell, and vice versa.
 */
const SAME_TAG_ONLY = new Set(['li', 'span', 'td', 'th', 'tr']);

/** Ids carried by the top-level nodes of a `modify` payload — the nodes it replaces. */
const getTopLevelLiteXMLIds = (litexml: string): (string | undefined)[] => {
  const ids: (string | undefined)[] = [];
  let depth = 0;

  for (const [, closing, tag, attributes = ''] of normalizeLiteXMLFragment(litexml).matchAll(
    LITEXML_TAG_PATTERN,
  )) {
    if (closing) {
      depth -= 1;
      continue;
    }
    if (depth === 1 && tag !== 'root') ids.push(attributes.match(LITEXML_ID_ATTRIBUTE)?.[1]);
    if (!attributes.endsWith('/')) depth += 1;
  }

  return ids;
};

const toFragments = (litexml: string | string[]) => (Array.isArray(litexml) ? litexml : [litexml]);

/**
 * Ids an operation targets. `undefined` marks a top-level node of a `modify`
 * payload without an id — the editor cannot tell which node it should replace.
 */
export const getReferencedIds = (operation: ModifyOperation): (string | undefined)[] => {
  switch (operation.action) {
    case 'insert': {
      const anchor = 'beforeId' in operation ? operation.beforeId : operation.afterId;
      return anchor === 'root' ? [] : [anchor];
    }
    case 'modify': {
      return toFragments(operation.litexml).flatMap(getTopLevelLiteXMLIds);
    }
    case 'remove': {
      return [operation.id];
    }
  }
};

const LIST_MARKUP_PATTERN = /<(?:li|ol|ul)[\s/>]/i;

const fragmentTouchesList = (litexml: string, document: LiteXMLDocumentIndex) =>
  LIST_MARKUP_PATTERN.test(litexml) ||
  getTopLevelLiteXMLIds(litexml).some((id) => id !== undefined && document.listIds.has(id));

/**
 * Pending review diffs (`delay: true`) are not safe for lists in @lobehub/editor:
 * list-item add/remove diffs serialize as empty items, a whole-list modify drops
 * the list, and an inserted list becomes a code block. Edits that touch a list
 * must be applied directly; every other edit can keep the review diff.
 */
export const touchesList = (operation: ModifyOperation, document: LiteXMLDocumentIndex) => {
  if (getReferencedIds(operation).some((id) => id !== undefined && document.listIds.has(id))) {
    return true;
  }
  if (operation.action === 'remove') return false;

  return toFragments(operation.litexml).some((litexml) => LIST_MARKUP_PATTERN.test(litexml));
};

const TABLE_MARKUP_PATTERN = /<(?:table|tr|td|th)[\s/>]/i;

/**
 * Whether the server may apply `operation` as a pending review diff
 * (`delay: true`) and still keep every node id it exposed addressable.
 *
 * @lobehub/editor only keeps ids stable for review diffs around whole top-level
 * blocks. Anything nested breaks the ids the agent was given:
 * - replacing or removing an inline node clones its enclosing block into the
 *   diff, so the block and every sibling come back with fresh ids;
 * - table edits wrap rows in `table-row-diff` nodes, and the editor rejects any
 *   later edit inside them as a nested diff — the rows read fine but cannot be
 *   modified or removed;
 * - lists have the problems described on {@link touchesList}.
 * Such edits are applied directly instead.
 */
export const canApplyAsReviewDiff = (
  operation: ModifyOperation,
  document: LiteXMLDocumentIndex,
) => {
  if (touchesList(operation, document)) return false;

  const nested = getReferencedIds(operation).some(
    (id) => id === undefined || (document.ancestorIds.get(id)?.length ?? 0) > 0,
  );
  if (nested) return false;
  if (operation.action === 'remove') return true;

  return !toFragments(operation.litexml).some((litexml) => TABLE_MARKUP_PATTERN.test(litexml));
};

export interface LiteXMLEditStep {
  /** Positions of the caller's operations this step applies. */
  indexes: number[];
  operation: ModifyOperation;
}

type AfterInsertOperation = Extract<ModifyOperation, { afterId: string }>;

const isAfterInsert = (operation: ModifyOperation): operation is AfterInsertOperation =>
  operation.action === 'insert' && 'afterId' in operation;

const hasListMarkup = (operation: ModifyOperation) =>
  operation.action !== 'remove' &&
  toFragments(operation.litexml).some((litexml) => LIST_MARKUP_PATTERN.test(litexml));

/** An insert with nothing to insert; kept on its own so its no-op is reported. */
const isEmptyInsert = (operation: AfterInsertOperation) =>
  stripRootElement(operation.litexml).trim().length === 0;

/**
 * Whether `operation` can remove or replace `anchorId`: it targets the anchor
 * itself, one of the nodes enclosing it, or a node it cannot identify.
 */
const affectsAnchor = (
  operation: ModifyOperation,
  anchorId: string,
  document: LiteXMLDocumentIndex,
) => {
  const scope = new Set([anchorId, ...(document.ancestorIds.get(anchorId) ?? [])]);

  return getReferencedIds(operation).some((id) => id === undefined || scope.has(id));
};

/**
 * A pair of targets in one `modify` where the first is the second or encloses
 * it. Replacing the outer node re-keys or drops the inner one, so the inner
 * fragment would be lost while the outer change makes the step look applied.
 */
const findOverlappingModifyTargets = (
  operation: ModifyOperation,
  document: LiteXMLDocumentIndex,
): [outer: string, inner: string] | undefined => {
  if (operation.action !== 'modify') return undefined;

  const targets = getReferencedIds(operation).filter((id): id is string => id !== undefined);
  for (const [position, inner] of targets.entries()) {
    const scope = new Set([inner, ...(document.ancestorIds.get(inner) ?? [])]);
    const outer = targets.find((id, other) => other !== position && scope.has(id));
    if (outer) return [outer, inner];
  }

  return undefined;
};

/**
 * A `modify` whose fragments mix list and non-list nodes is split into one step
 * per kind, so only the list fragments skip the review diff. One with
 * overlapping targets stays whole so it is rejected before any part applies.
 */
const splitModifyByList = (
  operation: Extract<ModifyOperation, { action: 'modify' }>,
  document: LiteXMLDocumentIndex,
): ModifyOperation[] => {
  if (!Array.isArray(operation.litexml)) return [operation];
  if (findOverlappingModifyTargets(operation, document)) return [operation];

  const list = operation.litexml.filter((litexml) => fragmentTouchesList(litexml, document));
  const other = operation.litexml.filter((litexml) => !fragmentTouchesList(litexml, document));
  if (list.length === 0 || other.length === 0) return [operation];

  return [
    { ...operation, litexml: other },
    { ...operation, litexml: list },
  ];
};

/**
 * Keep the caller's order. Inserts after the same anchor are merged: applied one
 * by one, each would land directly after the anchor and the batch would come out
 * reversed. The merge reaches past operations in between as long as they leave
 * the anchor alone; one that removes or replaces the anchor or a node enclosing
 * it ends it. A run mixing list and non-list content is split where that
 * changes, so only the list part skips the review diff; the pieces are then
 * applied last-first, each landing after the anchor ahead of the previous piece.
 * An empty insert stays a piece of its own so its no-op fails instead of riding
 * on a neighbour's change.
 *
 * `document` is the LiteXML index of the document before any operation runs.
 */
export const planLiteXMLEditSteps = (
  operations: ModifyOperation[],
  document: LiteXMLDocumentIndex,
): LiteXMLEditStep[] => {
  const steps: LiteXMLEditStep[] = [];
  const merged = new Set<number>();

  operations.forEach((operation, index) => {
    if (merged.has(index)) return;
    if (operation.action === 'modify') {
      for (const part of splitModifyByList(operation, document)) {
        steps.push({ indexes: [index], operation: part });
      }
      return;
    }
    if (!isAfterInsert(operation)) {
      steps.push({ indexes: [index], operation });
      return;
    }

    const pieces: (LiteXMLEditStep & { operation: AfterInsertOperation })[] = [];
    for (let nextIndex = index; nextIndex < operations.length; nextIndex += 1) {
      if (merged.has(nextIndex)) continue;

      const next = operations[nextIndex];
      if (!isAfterInsert(next) || next.afterId !== operation.afterId) {
        if (affectsAnchor(next, operation.afterId, document)) break;
        continue;
      }
      merged.add(nextIndex);

      const piece = pieces.at(-1);
      if (
        piece &&
        !isEmptyInsert(piece.operation) &&
        !isEmptyInsert(next) &&
        hasListMarkup(piece.operation) === hasListMarkup(next)
      ) {
        piece.indexes.push(nextIndex);
        piece.operation = {
          ...next,
          litexml: `<root>${stripRootElement(piece.operation.litexml)}${stripRootElement(next.litexml)}</root>`,
        };
      } else {
        pieces.push({ indexes: [nextIndex], operation: next });
      }
    }

    steps.push(...pieces.reverse());
  });

  return steps;
};

export const describeLiteXMLEditStep = ({ indexes, operation }: LiteXMLEditStep, total: number) => {
  const first = indexes[0] + 1;
  const last = indexes.at(-1)! + 1;
  const positions =
    indexes.length === 1
      ? `Operation ${first}`
      : last - first === indexes.length - 1
        ? `Operations ${first}-${last}`
        : `Operations ${indexes.map((index) => index + 1).join(', ')}`;

  return `${positions} of ${total} (${operation.action})`;
};

/**
 * Why a step cannot run against the current document, or `undefined` when every
 * id it needs is present.
 */
export const findLiteXMLEditStepProblem = (
  operation: ModifyOperation,
  document: LiteXMLDocumentIndex,
): string | undefined => {
  if (!['insert', 'modify', 'remove'].includes(operation.action)) {
    return '`action` must be "insert", "modify" or "remove"';
  }

  if (operation.action !== 'remove') {
    for (const litexml of toFragments(operation.litexml)) {
      const unbalanced = findUnbalancedTag(litexml);
      if (unbalanced) return `the litexml is not well-formed (${unbalanced})`;
    }
  }

  const referencedIds = getReferencedIds(operation);

  if (referencedIds.includes(undefined)) {
    return 'every top-level node in a modify payload needs the id of the node it replaces';
  }

  const missingIds = (referencedIds as string[]).filter((id) => !document.ids.has(id));
  if (missingIds.length > 0) {
    return `node ${missingIds.map((id) => `"${id}"`).join(', ')} not found in the document`;
  }

  if (operation.action === 'modify') {
    for (const { id, tag } of toFragments(operation.litexml).flatMap(getTopLevelLiteXMLNodes)) {
      const target = id && document.tags.get(id);
      if (target && target !== tag && (SAME_TAG_ONLY.has(target) || SAME_TAG_ONLY.has(tag))) {
        return `node "${id}" is a <${target}>, but the modify payload replaces it with a <${tag}>; send a <${target} id="${id}"> fragment`;
      }
    }
  }

  const overlap = findOverlappingModifyTargets(operation, document);
  if (overlap) {
    const [outer, inner] = overlap;
    return outer === inner
      ? `node "${outer}" is targeted by more than one fragment; send one fragment per node`
      : `node "${outer}" encloses node "${inner}", so replacing it would discard the edit to "${inner}"; put the change to "${inner}" inside the "${outer}" fragment instead`;
  }

  return undefined;
};
