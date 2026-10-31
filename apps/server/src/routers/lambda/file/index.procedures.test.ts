// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fileRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('fileRouter procedures', () => {
  const procedures = (fileRouter as any)._def.procedures as Record<string, any>;

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
    ['checkFileHash', 'mutation', 14],
    ['copyEntityToWorkspace', 'mutation', 13],
    ['createFile', 'mutation', 13],
    ['deleteKnowledgeItemsByQuery', 'mutation', 13],
    ['findById', 'query', 12],
    ['getFileItemById', 'query', 12],
    ['getFiles', 'query', 12],
    ['getKnowledgeItemStatusesByIds', 'query', 12],
    ['getKnowledgeItems', 'query', 12],
    ['getReadableUrl', 'query', 12],
    ['homeItems', 'query', 12],
    ['publishFileToWorkspace', 'mutation', 13],
    ['recentFiles', 'query', 12],
    ['recentPages', 'query', 12],
    ['rehostImage', 'mutation', 14],
    ['removeFile', 'mutation', 13],
    ['removeFileAsyncTask', 'mutation', 13],
    ['removeFiles', 'mutation', 13],
    ['removeUnreferencedFile', 'mutation', 13],
    ['resolveKnowledgeItemIds', 'query', 12],
    ['setFileVisibility', 'mutation', 13],
    ['transferEntity', 'mutation', 13],
    ['updateFile', 'mutation', 13],
  ];
}
