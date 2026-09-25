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

const LITEXML_TAG_PATTERN = /<(\/?)([a-z][\w-]*)(\s[^>]*)?>/gi;
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

/**
 * Keep the caller's order. Consecutive inserts after the same anchor are merged
 * into one insert: applied one by one, each would land directly after the
 * anchor and the batch would come out reversed.
 */
export const planLiteXMLEditSteps = (operations: ModifyOperation[]): LiteXMLEditStep[] => {
  const steps: LiteXMLEditStep[] = [];

  for (const [index, operation] of operations.entries()) {
    const step = steps.at(-1);
    const previous = step?.operation;
    if (
      step &&
      operation.action === 'insert' &&
      'afterId' in operation &&
      previous?.action === 'insert' &&
      'afterId' in previous &&
      previous.afterId === operation.afterId
    ) {
      step.indexes.push(index);
      step.operation = {
        ...previous,
        litexml: `<root>${stripRootElement(previous.litexml)}${stripRootElement(operation.litexml)}</root>`,
      };
      continue;
    }

    steps.push({ indexes: [index], operation });
  }

  return steps;
};

export const describeLiteXMLEditStep = ({ indexes, operation }: LiteXMLEditStep, total: number) =>
  indexes.length === 1
    ? `Operation ${indexes[0] + 1} of ${total} (${operation.action})`
    : `Operations ${indexes[0] + 1}-${indexes.at(-1)! + 1} of ${total} (${operation.action})`;

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
