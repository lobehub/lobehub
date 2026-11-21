// @vitest-environment node
import { describe, expect, it } from 'vitest';

import * as agentDocumentModule from '.';
import { AgentDocumentModel } from '.';

/**
 * Pins the public surface of `AgentDocumentModel` so a split into helper
 * modules keeps every caller-visible name and keeps instance methods on the
 * prototype.
 */
describe('AgentDocumentModel public surface', () => {
  it('keeps the module exports', () => {
    expect(Object.keys(agentDocumentModule).sort()).toEqual([
      'AgentAccess',
      'AgentDocumentModel',
      'AutoLoadAccess',
      'DocumentLoadFormat',
      'DocumentLoadPosition',
      'DocumentLoadRule',
      'PolicyLoad',
    ]);
  });

  it('keeps every public instance method on the prototype', () => {
    const proto = AgentDocumentModel.prototype as unknown as Record<string, unknown>;
    const missing = [
      'associate',
      'convertAgentDocumentToSkillIndex',
      'convertAgentDocumentToSkillIndexWithTx',
      'copy',
      'countChildrenByParentIds',
      'create',
      'createWithTx',
      'delete',
      'deleteByAgent',
      'deleteByTemplate',
      'deleteSubtreeByDocumentId',
      'findByAgent',
      'findByDocumentId',
      'findByDocumentIds',
      'findByFilename',
      'findById',
      'findByIdWithOptions',
      'findByParentAndFilename',
      'findByTemplate',
      'findContextByAgent',
      'findSkillDocsByAgent',
      'getAgentContext',
      'getDocumentsByPosition',
      'getInjectableDocuments',
      'getLoadableDocuments',
      'hasByAgent',
      'listByAgent',
      'listByDocumentIds',
      'listByParent',
      'listByParentAndFilename',
      'listDeletedByAgent',
      'listSubtreeByDocumentId',
      'movePath',
      'permanentlyDelete',
      'permanentlyDeleteSubtreeByDocumentId',
      'rename',
      'restore',
      'restoreSubtreeByDocumentId',
      'update',
      'updateDocumentIdentity',
      'updateEditorSnapshotIfUnchanged',
      'updateToolLoadRule',
      'upsert',
    ].filter((name) => !Object.hasOwn(proto, name) || typeof proto[name] !== 'function');

    expect(missing).toEqual([]);
  });
});
