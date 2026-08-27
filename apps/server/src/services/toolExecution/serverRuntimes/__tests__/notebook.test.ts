import { describe, expect, it, vi } from 'vitest';

import { createOwnerPrincipal } from '@/server/services/executionPrincipal';

import { notebookRuntime } from '../notebook';

vi.mock('@/database/models/document');
vi.mock('@/database/models/topicDocument');

describe('notebookRuntime', () => {
  it('should have correct identifier', () => {
    expect(notebookRuntime.identifier).toBe('lobe-notebook');
  });

  it('should create runtime from factory with valid context', () => {
    const context = {
      serverDB: {} as any,
      toolManifestMap: {},
      topicId: 'topic-1',
      principal: createOwnerPrincipal('user-1'),
    };

    const runtime = notebookRuntime.factory(context);

    expect(runtime).toBeDefined();
    expect(typeof runtime.createDocument).toBe('function');
    expect(typeof runtime.updateDocument).toBe('function');
    expect(typeof runtime.getDocument).toBe('function');
    expect(typeof runtime.deleteDocument).toBe('function');
  });

  it('should throw if userId is missing', () => {
    const context = {
      principal: createOwnerPrincipal(undefined),
      serverDB: {} as any,
      toolManifestMap: {},
    };

    expect(() => notebookRuntime.factory(context)).toThrow(
      'userId and serverDB are required for Notebook execution',
    );
  });

  it('should throw if serverDB is missing', () => {
    const context = {
      toolManifestMap: {},
      principal: createOwnerPrincipal('user-1'),
    };

    expect(() => notebookRuntime.factory(context)).toThrow(
      'userId and serverDB are required for Notebook execution',
    );
  });
});
