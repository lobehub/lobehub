import { describe, expect, it } from 'vitest';

import { KnowledgeBaseManifest } from './manifest';
import { KnowledgeBaseApiName } from './types';

describe('KnowledgeBaseManifest deleteFile', () => {
  it('declares deleteFile with a required id', () => {
    const api = KnowledgeBaseManifest.api.find((a) => a.name === KnowledgeBaseApiName.deleteFile);

    expect(api).toBeDefined();
    expect(api?.parameters.required).toEqual(['id']);
    expect(api?.description).toContain('irreversible');
  });
});
