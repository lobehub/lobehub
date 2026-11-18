// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { projectPageState } from '../fork';
import { buildPageSeed, getPageRoomStatus } from '../seed';

const rows = vi.hoisted(() => new Map<string, any>());

vi.mock('@/server/services/resourcePermission', () => ({
  getResourceMeta: async (_db: unknown, _type: string, id: string) => {
    const row = rows.get(id);
    return row ? { userId: row.userId, workspaceId: row.workspaceId } : undefined;
  },
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async (id: string) => rows.get(id);
  },
}));

const editorDataOf = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return editorData;
};

const page = (overrides: Record<string, unknown>) => ({
  content: null,
  editorData: null,
  title: 'Plan',
  userId: 'u1',
  workspaceId: 'ws_1',
  ...overrides,
});

describe('buildPageSeed', () => {
  beforeEach(() => rows.clear());

  it('builds the room state from the stored body and title of a workspace page', async () => {
    rows.set('doc_1', page({ editorData: editorDataOf('# Plan\n\nfirst paragraph\n') }));

    const seed = await buildPageSeed({} as any, 'doc_1');

    expect(seed.status).toBe('ok');
    if (seed.status !== 'ok') return;
    expect(seed.workspaceId).toBe('ws_1');
    const projected = await projectPageState(seed.update);
    expect(projected.markdown).toBe('# Plan\n\nfirst paragraph\n');
    expect(projected.title).toBe('Plan');
  });

  it('recovers the body from Markdown for a row saved without editor data', async () => {
    rows.set('doc_1', page({ content: 'only markdown\n' }));

    const seed = await buildPageSeed({} as any, 'doc_1');

    expect(seed.status).toBe('ok');
    if (seed.status !== 'ok') return;
    expect((await projectPageState(seed.update)).markdown).toBe('only markdown\n');
  });

  it('gives an empty page a root, so no later writer creates a second one', async () => {
    rows.set('doc_1', page({}));

    const seed = await buildPageSeed({} as any, 'doc_1');

    expect(seed.status).toBe('ok');
    if (seed.status !== 'ok') return;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.update);
    expect(doc.get('root', Y.XmlText).length).toBeGreaterThan(0);
  });

  it('refuses a personal page', async () => {
    rows.set('doc_1', page({ workspaceId: null }));

    expect(await buildPageSeed({} as any, 'doc_1')).toEqual({ status: 'not_allowed' });
  });

  it('reports a missing page', async () => {
    expect(await buildPageSeed({} as any, 'doc_404')).toEqual({ status: 'not_found' });
  });
});

describe('getPageRoomStatus', () => {
  beforeEach(() => rows.clear());

  it('reports whether the page exists and belongs to a workspace', async () => {
    rows.set('doc_ws', page({}));
    rows.set('doc_personal', page({ workspaceId: null }));

    expect(await getPageRoomStatus({} as any, 'doc_ws')).toEqual({
      exists: true,
      inWorkspace: true,
      workspaceId: 'ws_1',
    });
    expect(await getPageRoomStatus({} as any, 'doc_personal')).toEqual({
      exists: true,
      inWorkspace: false,
      workspaceId: null,
    });
    expect(await getPageRoomStatus({} as any, 'doc_404')).toEqual({
      exists: false,
      inWorkspace: false,
      workspaceId: null,
    });
  });
});
