import { describe, expect, it } from 'vitest';

import { KnowledgeBaseManifest } from './manifest';
import { KnowledgeBaseApiName } from './types';

describe('KnowledgeBaseManifest', () => {
  it('only points searchKnowledgeBase recovery at other APIs when they are available', () => {
    // Graph-agent nodes can expose searchKnowledgeBase alone, so an unconditional
    // "read those with readKnowledge" sends empty-scope recovery into a missing tool.
    const search = KnowledgeBaseManifest.api.find(
      (api) => api.name === KnowledgeBaseApiName.searchKnowledgeBase,
    );

    expect(search?.description).toContain(
      'if readKnowledge or viewKnowledgeBase is among your available tools',
    );
    expect(search?.description).toContain('otherwise tell the user');
    expect(search?.description).not.toContain('read those directly with readKnowledge');
  });

  it('exposes updateDocument with only documentId required and points edits away from createDocument', () => {
    const update = KnowledgeBaseManifest.api.find(
      (api) => api.name === KnowledgeBaseApiName.updateDocument,
    );

    expect(update?.parameters.required).toEqual(['documentId']);
    expect(Object.keys(update?.parameters.properties ?? {}).sort()).toEqual([
      'content',
      'documentId',
      'parentId',
      'title',
    ]);
    expect(update?.description).toContain('Provide at least one of title, content or parentId');
    expect(update?.description).toContain('createDocument only creates new documents');
  });
});
