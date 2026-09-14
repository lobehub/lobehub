import type { AnnotationMutation, AnnotationRecord } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import {
  isPersistableLocalAnnotationMutation,
  mergePageAnnotationRecords,
  type PageAnnotationStorageClient,
  persistPageAnnotationMutation,
  toEditorAnnotationRecord,
  toPageAnnotationWireRecord,
} from './annotationStorage';

const record = (id: string, overrides: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  createdAt: '2026-01-01T00:00:00.000Z',
  id,
  kind: 'comment',
  payload: { text: id },
  quotedText: id,
  status: 'active',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const client = (): PageAnnotationStorageClient => ({
  bulkUpsertLegacy: vi.fn().mockResolvedValue({ records: [] }),
  create: vi.fn().mockResolvedValue({ record: { ...record('created'), version: 1 } }),
  listByDocument: vi.fn().mockResolvedValue([]),
  remove: vi
    .fn()
    .mockResolvedValue({ record: { ...record('removed'), status: 'deleted', version: 2 } }),
  update: vi.fn().mockResolvedValue({ record: { ...record('updated'), version: 2 } }),
});

describe('page annotation storage adapter', () => {
  it('normalizes DB rows and excludes deleted tombstones from the editor cache', () => {
    expect(
      toEditorAnnotationRecord({
        author: { name: 'Ada' },
        createdAt: '2026-01-01T00:00:00.000Z',
        id: 'db-comment',
        nodeKeys: ['split-node'],
        payload: { text: 'hello' },
        quotedText: 'quoted',
        status: 'resolved',
        updatedAt: '2026-01-01T00:00:01.000Z',
        version: 2,
      }),
    ).toMatchObject({ id: 'db-comment', status: 'resolved' });
    expect(
      toEditorAnnotationRecord({ id: 'db-comment', nodeKeys: ['stale-session-key'] })?.nodeKeys,
    ).toBeUndefined();
    expect(toEditorAnnotationRecord({ id: 'deleted', status: 'deleted' })).toBeNull();
  });

  it('lets DB rows win over Yjs fallback while retaining missing fallback rows', () => {
    const merged = mergePageAnnotationRecords(
      [
        {
          id: 'same',
          payload: { text: 'database' },
          status: 'active',
        },
        { id: 'deleted', status: 'deleted' },
      ],
      [record('same', { payload: { text: 'legacy' } }), record('legacy-only'), record('deleted')],
    );

    expect(merged.map((item) => item.id).sort()).toEqual(['legacy-only', 'same']);
    expect(merged.find((item) => item.id === 'same')?.payload).toEqual({ text: 'database' });
  });

  it('persists only local mutations and carries the returned optimistic version', async () => {
    const api = client();
    const versions = new Map([['existing', 4]]);
    const mutation = {
      id: 'existing',
      record: record('existing', { payload: { text: 'changed' } }),
      source: 'local',
      type: 'update',
    } as AnnotationMutation;

    await persistPageAnnotationMutation({
      client: api,
      documentId: 'doc-1',
      mutation,
      versions,
    });

    expect(api.update).toHaveBeenCalledWith({
      documentId: 'doc-1',
      expectedVersion: 4,
      id: 'existing',
      patch: expect.objectContaining({ payload: { text: 'changed' }, status: 'active' }),
    });
    expect((api.update as ReturnType<typeof vi.fn>).mock.calls[0][0].patch).not.toHaveProperty(
      'nodeKeys',
    );
    expect(versions.get('existing')).toBe(2);

    await persistPageAnnotationMutation({
      client: api,
      documentId: 'doc-1',
      mutation: { ...mutation, source: 'import' } as AnnotationMutation,
      versions,
    });
    expect(api.update).toHaveBeenCalledOnce();
    expect(isPersistableLocalAnnotationMutation({ source: 'migration', type: 'migration' })).toBe(
      false,
    );
  });

  it('maps create and remove mutations to idempotent API operations', async () => {
    const api = client();
    const versions = new Map<string, number>();
    await persistPageAnnotationMutation({
      client: api,
      documentId: 'doc-1',
      mutation: { record: record('new'), source: 'local', type: 'create' } as AnnotationMutation,
      versions,
    });
    expect(api.create).toHaveBeenCalledWith({
      documentId: 'doc-1',
      record: toPageAnnotationWireRecord(record('new')),
    });
    expect((api.create as ReturnType<typeof vi.fn>).mock.calls[0][0].record).not.toHaveProperty(
      'nodeKeys',
    );

    versions.set('new', 1);
    await persistPageAnnotationMutation({
      client: api,
      documentId: 'doc-1',
      mutation: { id: 'new', source: 'local', type: 'remove' } as AnnotationMutation,
      versions,
    });
    expect(api.remove).toHaveBeenCalledWith({ documentId: 'doc-1', expectedVersion: 1, id: 'new' });
    expect(versions.get('new')).toBe(2);
  });
});
