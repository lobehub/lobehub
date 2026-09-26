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
  ids: Set<string>;
  /** Ids of list containers, list items and every node nested inside them. */
  listIds: Set<string>;
}

export const indexLiteXMLDocument = (litexml: string): LiteXMLDocumentIndex => {
  const ids = new Set<string>();
  const listIds = new Set<string>();
  const stack: boolean[] = [];

  for (const [, closing, tag, attributes = ''] of litexml.matchAll(LITEXML_TAG_PATTERN)) {
    if (closing) {
      stack.pop();
      continue;
    }

    const inList = (stack.at(-1) ?? false) || LIST_TAGS.has(tag.toLowerCase());
    const id = attributes.match(LITEXML_ID_ATTRIBUTE)?.[1];
    if (id) {
      ids.add(id);
      if (inList) listIds.add(id);
    }
    if (!attributes.endsWith('/')) stack.push(inList);
  }

  return { ids, listIds };
};

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

/**
 * Keep the caller's order. Inserts after the same anchor are merged: applied one
 * by one, each would land directly after the anchor and the batch would come out
 * reversed. The merge reaches past operations in between as long as they leave
 * the anchor alone; one that removes or replaces the anchor ends it. A run mixing
 * list and non-list content is split where that changes, so only the list part
 * skips the review diff; the pieces are then applied last-first, each landing
 * after the anchor ahead of the previous piece.
 */
export const planLiteXMLEditSteps = (operations: ModifyOperation[]): LiteXMLEditStep[] => {
  const steps: LiteXMLEditStep[] = [];
  const merged = new Set<number>();

  operations.forEach((operation, index) => {
    if (merged.has(index)) return;
    if (!isAfterInsert(operation)) {
      steps.push({ indexes: [index], operation });
      return;
    }

    const pieces: (LiteXMLEditStep & { operation: AfterInsertOperation })[] = [];
    for (let nextIndex = index; nextIndex < operations.length; nextIndex += 1) {
      if (merged.has(nextIndex)) continue;

      const next = operations[nextIndex];
      if (!isAfterInsert(next) || next.afterId !== operation.afterId) {
        if (getReferencedIds(next).includes(operation.afterId)) break;
        continue;
      }
      merged.add(nextIndex);

      const piece = pieces.at(-1);
      if (piece && hasListMarkup(piece.operation) === hasListMarkup(next)) {
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
  const referencedIds = getReferencedIds(operation);

  if (referencedIds.includes(undefined)) {
    return 'every top-level node in a modify payload needs the id of the node it replaces';
  }

  const missingIds = (referencedIds as string[]).filter((id) => !document.ids.has(id));
  if (missingIds.length > 0) {
    return `node ${missingIds.map((id) => `"${id}"`).join(', ')} not found in the document`;
  }

  return undefined;
};
