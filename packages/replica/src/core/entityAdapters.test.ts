import { describe, expect, it } from 'vitest';

import { defineReplica } from './defineReplica';
import { createReplicaEngine, type ReplicaStorePort } from './engine';
import { linkReplicaEntity } from './entity';
import { arrayEntity, singleEntity } from './entityAdapters';
import { createReplicaState } from './reducer';
import type { ReplicaState } from './types';

interface Row {
  id: string;
  name: string;
}
interface Detail {
  members: string[];
  project: Row;
}

/** A host without Zustand: a plain object behind the store port. */
const createHost = <T>() => {
  const host = { slot: createReplicaState<T>() as ReplicaState<T>, views: {} as Record<string, T> };
  const port: ReplicaStorePort<T> = {
    commit: (writes, state) => {
      for (const write of writes) {
        if ('type' in write) host.views = {};
        else if (write.data === undefined) delete host.views[write.key];
        else host.views[write.key] = write.data;
      }
      host.slot = state;
    },
    getState: () => host.slot,
    keys: () => Object.keys(host.views),
    read: (key) => host.views[key],
  };
  return { host, port };
};

const rowById = (id: string) => (row: Row) => row.id === id;

describe('arrayEntity', () => {
  const adapter = arrayEntity<Row>((row) => row.id);
  const list = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];

  it('patches and removes one row', () => {
    expect(adapter.has(list, 'b')).toBe(true);
    expect(adapter.map(list, 'b', (row) => ({ ...row, name: 'B2' }))).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B2' },
    ]);
    expect(adapter.map(list, 'a', () => undefined)).toEqual([{ id: 'b', name: 'B' }]);
  });

  it('keeps the reference when nothing changed', () => {
    expect(adapter.map(list, 'missing', (row) => ({ ...row, name: 'x' }))).toBe(list);
    expect(adapter.map(list, 'a', (row) => row)).toBe(list);
  });
});

describe('singleEntity with a lens', () => {
  const adapter = singleEntity<Detail, Row>((row) => row.id, {
    get: (detail) => detail.project,
    set: (detail, project) => ({ ...detail, project }),
  });
  const detail: Detail = { members: ['m'], project: { id: 'p', name: 'P' } };

  it('patches the wrapped entity and keeps the rest of the value', () => {
    expect(adapter.map(detail, 'p', (row) => ({ ...row, name: 'P2' }))).toEqual({
      members: ['m'],
      project: { id: 'p', name: 'P2' },
    });
  });

  it('drops the whole value when the entity is deleted', () => {
    expect(adapter.map(detail, 'p', () => undefined)).toBeUndefined();
  });
});

describe('entity link over non-paged replicas (engine without Zustand)', () => {
  const setup = () => {
    const listHost = createHost<Row[]>();
    const detailHost = createHost<Detail>();
    const list = createReplicaEngine(
      defineReplica<void, Row[]>({ key: () => 'all', name: 'rows', version: 1 }),
      { entity: arrayEntity<Row>((row) => row.id), port: listHost.port },
    );
    const detail = createReplicaEngine(
      defineReplica<string, Detail>({ key: (id) => id, name: 'rowDetail', version: 1 }),
      {
        entity: singleEntity<Detail, Row>((row) => row.id, {
          get: (value) => value.project,
          set: (value, project) => ({ ...value, project }),
        }),
        port: detailHost.port,
      },
    );
    list.replace(undefined, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    detail.replace('b', { members: ['m'], project: { id: 'b', name: 'B' } });
    return { detailHost, link: linkReplicaEntity<Row>([list, detail]), listHost };
  };

  it('patches the row in the list and the wrapped entity in the detail', () => {
    const { detailHost, link, listHost } = setup();

    link.update('b', (row) => ({ ...row, name: 'B2' }));

    expect(listHost.host.views.all.find(rowById('b'))?.name).toBe('B2');
    expect(detailHost.host.views.b.project.name).toBe('B2');
    expect(detailHost.host.views.b.members).toEqual(['m']);
  });

  it('rolls both back when the server call fails', async () => {
    const { detailHost, link, listHost } = setup();

    const pending = link.optimistic(
      'b',
      (row) => ({ ...row, name: 'B2' }),
      async () => {
        expect(listHost.host.views.all.find(rowById('b'))?.name).toBe('B2');
        expect(detailHost.host.views.b.project.name).toBe('B2');
        throw new Error('boom');
      },
    );

    await expect(pending).rejects.toThrow('boom');
    expect(listHost.host.views.all.find(rowById('b'))?.name).toBe('B');
    expect(detailHost.host.views.b.project.name).toBe('B');
  });

  it('removes the list row and the detail value on delete', async () => {
    const { detailHost, link, listHost } = setup();

    await link.optimistic('b', 'remove', async () => undefined);

    expect(listHost.host.views.all.map((row) => row.id)).toEqual(['a']);
    expect(detailHost.host.views.b).toBeUndefined();
  });
});
