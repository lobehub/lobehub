import type { AnnotationMutation, AnnotationRecord } from '@lobehub/editor';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import {
  type PageAnnotationStorageClient,
  PageAnnotationStorageProvider,
  usePageAnnotationStorage,
} from './annotationStorage';

const record = (id: string): AnnotationRecord => ({
  createdAt: '2026-01-01T00:00:00.000Z',
  id,
  kind: 'comment',
  payload: { text: id },
  quotedText: id,
  status: 'active',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
);

describe('usePageAnnotationStorage', () => {
  it('imports DB records after a legacy migration and never echoes the import', async () => {
    let mutationListener: ((mutation: AnnotationMutation) => void) | undefined;
    const imported = record('legacy');
    const service = {
      getAll: vi.fn(() => [imported]),
      importSnapshot: vi.fn(),
      requireStorageMode: vi.fn(),
      setStorageMode: vi.fn(),
      subscribeMutations: vi.fn((listener: (mutation: AnnotationMutation) => void) => {
        mutationListener = listener;
        return () => undefined;
      }),
    };
    const editor = {
      requireService: vi.fn(() => service),
    } as any;
    const client: PageAnnotationStorageClient = {
      bulkUpsertLegacy: vi.fn().mockResolvedValue({ records: [{ ...imported, version: 1 }] }),
      create: vi.fn(),
      listByDocument: vi
        .fn()
        .mockResolvedValue([
          { id: 'database', payload: { text: 'database' }, status: 'active', version: 2 },
        ]),
      remove: vi.fn(),
      update: vi.fn(),
    };

    const { result } = renderHook(
      () => usePageAnnotationStorage({ client, documentId: 'doc-1', editor }),
      { wrapper },
    );

    await waitFor(() =>
      expect(client.listByDocument).toHaveBeenCalledWith({
        documentId: 'doc-1',
        includeDeleted: true,
      }),
    );
    expect(client.bulkUpsertLegacy).toHaveBeenCalledWith({
      documentId: 'doc-1',
      records: [expect.objectContaining({ id: 'legacy' })],
    });
    expect(service.setStorageMode).toHaveBeenCalledWith('external');
    expect(service.importSnapshot).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'database' })],
      { replace: true, source: 'import' },
    );
    expect(result.current.error).toBeNull();

    await act(async () => {
      mutationListener?.({
        id: 'database',
        record: record('database'),
        source: 'import',
        type: 'import',
      });
    });
    expect(client.create).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });

  it('persists a local service mutation optimistically without importing its echo', async () => {
    let mutationListener: ((mutation: AnnotationMutation) => void) | undefined;
    const service = {
      getAll: vi.fn(() => []),
      importSnapshot: vi.fn(),
      setStorageMode: vi.fn(),
      subscribeMutations: vi.fn((listener: (mutation: AnnotationMutation) => void) => {
        mutationListener = listener;
        return () => undefined;
      }),
    };
    const editor = { requireService: vi.fn(() => service) } as any;
    const client: PageAnnotationStorageClient = {
      bulkUpsertLegacy: vi.fn().mockResolvedValue({ records: [] }),
      create: vi.fn().mockResolvedValue({ record: { ...record('new'), version: 1 } }),
      listByDocument: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
      update: vi.fn(),
    };
    renderHook(() => usePageAnnotationStorage({ client, documentId: 'doc-1', editor }), {
      wrapper,
    });

    await waitFor(() => expect(client.listByDocument).toHaveBeenCalled());
    await act(async () => {
      mutationListener?.({
        id: 'new',
        record: record('new'),
        source: 'local',
        type: 'create',
      });
    });
    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          record: expect.objectContaining({ id: 'new' }),
        }),
      ),
    );
    expect(client.update).not.toHaveBeenCalled();
  });

  it('does not migrate a legacy row over an existing DB row', async () => {
    const legacy = record('same');
    const service = {
      getAll: vi.fn(() => [legacy]),
      importSnapshot: vi.fn(),
      setStorageMode: vi.fn(),
      subscribeMutations: vi.fn(() => () => undefined),
    };
    const editor = { requireService: vi.fn(() => service) } as any;
    const client: PageAnnotationStorageClient = {
      bulkUpsertLegacy: vi.fn().mockResolvedValue({ records: [] }),
      create: vi.fn(),
      listByDocument: vi.fn().mockResolvedValue([
        {
          id: 'same',
          payload: { text: 'database' },
          status: 'active',
          version: 3,
        },
      ]),
      remove: vi.fn(),
      update: vi.fn(),
    };

    renderHook(() => usePageAnnotationStorage({ client, documentId: 'doc-1', editor }), {
      wrapper,
    });

    await waitFor(() => expect(client.listByDocument).toHaveBeenCalled());
    expect(client.bulkUpsertLegacy).not.toHaveBeenCalled();
    expect(service.importSnapshot).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'same', payload: { text: 'database' } })],
      { replace: true, source: 'import' },
    );
  });

  it('keeps persistence mounted when the comments tab unmounts', async () => {
    let mutationListener: ((mutation: AnnotationMutation) => void) | undefined;
    const service = {
      getAll: vi.fn(() => []),
      importSnapshot: vi.fn(),
      setStorageMode: vi.fn(),
      subscribeMutations: vi.fn((listener: (mutation: AnnotationMutation) => void) => {
        mutationListener = listener;
        return () => undefined;
      }),
    };
    const editor = { requireService: vi.fn(() => service) } as any;
    const client: PageAnnotationStorageClient = {
      bulkUpsertLegacy: vi.fn().mockResolvedValue({ records: [] }),
      create: vi.fn().mockResolvedValue({ record: { ...record('new'), version: 1 } }),
      listByDocument: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
      update: vi.fn(),
    };
    const Panel = ({ mounted }: { mounted: boolean }) => (mounted ? <div /> : null);
    const Harness = ({ mounted }: { mounted: boolean }) => (
      <PageAnnotationStorageProvider client={client} documentId="doc-1" editor={editor}>
        <Panel mounted={mounted} />
      </PageAnnotationStorageProvider>
    );

    const { rerender } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Harness mounted />
      </SWRConfig>,
    );
    await waitFor(() => expect(client.listByDocument).toHaveBeenCalled());
    rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Harness mounted={false} />
      </SWRConfig>,
    );
    await act(async () => {
      mutationListener?.({
        id: 'new',
        record: record('new'),
        source: 'local',
        type: 'create',
      });
    });
    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
        }),
      ),
    );
  });

  it('clears the old scope when the page document changes', async () => {
    const listeners: Array<(mutation: AnnotationMutation) => void> = [];
    const service = {
      getAll: vi.fn(() => []),
      importSnapshot: vi.fn(),
      setStorageMode: vi.fn(),
      subscribeMutations: vi.fn((listener: (mutation: AnnotationMutation) => void) => {
        listeners.push(listener);
        return () => undefined;
      }),
    };
    const editor = { requireService: vi.fn(() => service) } as any;
    const client: PageAnnotationStorageClient = {
      bulkUpsertLegacy: vi.fn().mockResolvedValue({ records: [] }),
      create: vi.fn().mockResolvedValue({ record: { ...record('new'), version: 1 } }),
      listByDocument: vi.fn().mockResolvedValue([]),
      remove: vi.fn(),
      update: vi.fn(),
    };
    const ProviderHarness = ({ documentId }: { documentId: string }) => (
      <PageAnnotationStorageProvider client={client} documentId={documentId} editor={editor}>
        <div />
      </PageAnnotationStorageProvider>
    );

    const { rerender } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ProviderHarness documentId="doc-1" />
      </SWRConfig>,
    );
    await waitFor(() =>
      expect(client.listByDocument).toHaveBeenCalledWith({
        documentId: 'doc-1',
        includeDeleted: true,
      }),
    );
    rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ProviderHarness documentId="doc-2" />
      </SWRConfig>,
    );
    await waitFor(() =>
      expect(client.listByDocument).toHaveBeenCalledWith({
        documentId: 'doc-2',
        includeDeleted: true,
      }),
    );

    await act(async () => {
      listeners[0]?.({
        id: 'stale',
        record: record('stale'),
        source: 'local',
        type: 'create',
      });
      listeners.at(-1)?.({
        id: 'current',
        record: record('current'),
        source: 'local',
        type: 'create',
      });
    });
    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-2',
          record: expect.objectContaining({ id: 'current' }),
        }),
      ),
    );
    expect(client.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        record: expect.objectContaining({ id: 'stale' }),
      }),
    );
  });
});
