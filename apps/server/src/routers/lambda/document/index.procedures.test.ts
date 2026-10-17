// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { documentRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('documentRouter procedures', () => {
  const procedures = (documentRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['acquireDocumentLock', 'mutation', 13],
    ['compareDocumentHistoryItems', 'query', 12],
    ['copyDocumentToWorkspace', 'mutation', 13],
    ['createDocument', 'mutation', 13],
    ['createDocuments', 'mutation', 13],
    ['deleteDocument', 'mutation', 13],
    ['deleteDocuments', 'mutation', 13],
    ['getDocumentById', 'query', 12],
    ['getDocumentHistoryItem', 'query', 12],
    ['getDocumentLock', 'query', 13],
    ['getFolderBreadcrumb', 'query', 12],
    ['listDocumentHistory', 'query', 12],
    ['parseDocument', 'mutation', 13],
    ['parseFileContent', 'mutation', 13],
    ['publishDocumentToWorkspace', 'mutation', 13],
    ['queryDocuments', 'query', 12],
    ['releaseDocumentLock', 'mutation', 13],
    ['saveDocumentHistory', 'mutation', 13],
    ['setDocumentVisibility', 'mutation', 13],
    ['transferDocument', 'mutation', 13],
    ['updateDocument', 'mutation', 13],
  ];
}
