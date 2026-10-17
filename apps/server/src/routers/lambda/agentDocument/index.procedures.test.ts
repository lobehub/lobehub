// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentDocumentRouter } from './index';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('agentDocumentRouter procedures', () => {
  const procedures = (agentDocumentRouter as any)._def.procedures as Record<string, any>;

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
    ['associateDocument', 'mutation', 13],
    ['cloneDocuments', 'mutation', 13],
    ['convertDocumentToSkill', 'mutation', 13],
    ['copyDocument', 'mutation', 13],
    ['copyDocumentByPath', 'mutation', 13],
    ['createDocument', 'mutation', 13],
    ['createFolder', 'mutation', 13],
    ['createForTopic', 'mutation', 13],
    ['createSkillByPath', 'mutation', 13],
    ['deleteAllDocuments', 'mutation', 13],
    ['deleteDocument', 'mutation', 13],
    ['deleteDocumentByPath', 'mutation', 13],
    ['deleteDocumentPermanentlyByPath', 'mutation', 13],
    ['deleteSkillByPath', 'mutation', 13],
    ['generateSkillMeta', 'mutation', 13],
    ['getContext', 'query', 12],
    ['getContextDocuments', 'query', 12],
    ['getDocument', 'query', 12],
    ['getDocuments', 'query', 12],
    ['getDocumentsMap', 'query', 12],
    ['getOrCreateChatTopic', 'mutation', 12],
    ['getReaderDocument', 'query', 12],
    ['getTemplates', 'query', 11],
    ['hasDocuments', 'query', 12],
    ['importFile', 'mutation', 13],
    ['initializeFromTemplate', 'mutation', 13],
    ['listDocuments', 'query', 12],
    ['listDocumentsByPath', 'query', 12],
    ['listTrashDocumentsByPath', 'query', 12],
    ['mkdirDocumentByPath', 'mutation', 13],
    ['modifyNodes', 'mutation', 13],
    ['moveDocuments', 'mutation', 13],
    ['readDocument', 'query', 12],
    ['readDocumentByPath', 'query', 12],
    ['removeDocument', 'mutation', 13],
    ['renameDocument', 'mutation', 13],
    ['renameDocumentByPath', 'mutation', 13],
    ['replaceDocumentContent', 'mutation', 13],
    ['restoreDocumentFromTrashByPath', 'mutation', 13],
    ['statDocumentByPath', 'query', 12],
    ['updateLoadRule', 'mutation', 13],
    ['updateSkillByPath', 'mutation', 13],
    ['upsertDocument', 'mutation', 13],
    ['writeDocumentByPath', 'mutation', 13],
  ];
}
