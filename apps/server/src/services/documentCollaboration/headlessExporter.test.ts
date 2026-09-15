// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createImmutableRoomSnapshotFromEditorData,
  readOnlyHeadlessExporter,
} from './headlessExporter';

// A real v1 binding update produced by @lobehub/editor/headless. Keeping this
// fixture here avoids importing the transport/provider into the persistence
// test while still exercising the production exporter end to end.
const LEXICAL_ROOM_UPDATE = Uint8Array.from(
  Buffer.from(
    'ARDzibTiCwAoAQRyb290BV9fZGlyAXcDbHRyBwEEcm9vdAYoAPOJtOILAQZfX3R5cGUBdwlwYXJhZ3JhcGgoAPOJtOILAQhfX2Zvcm1hdAF9ACgA84m04gsBB19fc3R5bGUBdwAoAPOJtOILAQhfX2luZGVudAF9ACgA84m04gsBBV9fZGlyAXcDbHRyKADzibTiCwEMX190ZXh0Rm9ybWF0AX0AKADzibTiCwELX190ZXh0U3R5bGUBdwAHAPOJtOILAQEoAPOJtOILCQZfX3R5cGUBdwR0ZXh0KADzibTiCwkIX19mb3JtYXQBfQAoAPOJtOILCQdfX3N0eWxlAXcAKADzibTiCwkGX19tb2RlAX0AKADzibTiCwkIX19kZXRhaWwBfQCE84m04gsJDXNuYXBzaG90IHRleHQA',
    'base64',
  ),
);

describe('readOnlyHeadlessExporter', () => {
  it('exports an immutable room update through the real editor headless helper', async () => {
    const update = new Uint8Array(LEXICAL_ROOM_UPDATE);
    const projection = await readOnlyHeadlessExporter.exportProjection({
      documentId: 'document-1',
      readOnly: true,
      revision: 1,
      roomId: 'room-1',
      snapshot: {
        stateVector: new Uint8Array(),
        update,
      },
    });

    expect(projection).toEqual(
      expect.objectContaining({ editorData: expect.any(Object), markdown: expect.any(String) }),
    );
    expect(projection.markdown).toContain('snapshot text');
    expect(update).toEqual(LEXICAL_ROOM_UPDATE);
  });

  it('rebuilds a DB editor projection into an immutable Yjs bootstrap update', async () => {
    const { createHeadlessEditor } = await import('@lobehub/editor');
    const source = createHeadlessEditor();
    source.hydrateMarkdown('database bootstrap');
    const editorData = source.export().editorData;
    source.destroy();

    const snapshot = await createImmutableRoomSnapshotFromEditorData({
      content: 'unused fallback',
      editorData,
      revision: 9,
      roomId: 'database-bootstrap-room',
    });
    const projection = await readOnlyHeadlessExporter.exportProjection({
      documentId: 'database-bootstrap-room',
      readOnly: true,
      revision: snapshot.revision,
      roomId: 'database-bootstrap-room',
      snapshot,
    });

    expect(snapshot.revision).toBe(9);
    expect(snapshot.update.byteLength).toBeGreaterThan(0);
    expect(projection.markdown).toContain('database bootstrap');
  }, 15_000);

  it.each([
    { editorData: {}, label: 'an empty object' },
    { editorData: null, label: 'null' },
    { label: 'an absent value' },
  ])('seeds a new room from Markdown when editorData is $label', async ({ editorData }) => {
    const snapshot = await createImmutableRoomSnapshotFromEditorData({
      content: '',
      editorData,
      revision: 0,
      roomId: `empty-editor-data-${Math.random()}`,
    });

    expect(snapshot.update.byteLength).toBeGreaterThan(0);
    expect(snapshot.stateVector.byteLength).toBeGreaterThan(0);
  });

  it('accepts a legal empty Lexical root as the initial room state', async () => {
    const snapshot = await createImmutableRoomSnapshotFromEditorData({
      content: 'ignored because the JSON root is valid',
      editorData: {
        root: {
          children: [],
          direction: null,
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      },
      revision: 0,
      roomId: 'empty-editor-data-root',
    });
    const projection = await readOnlyHeadlessExporter.exportProjection({
      documentId: 'empty-editor-data-root',
      readOnly: true,
      revision: snapshot.revision,
      roomId: 'empty-editor-data-root',
      snapshot,
    });

    expect(snapshot.update.byteLength).toBeGreaterThan(0);
    expect(projection.editorData).toMatchObject({
      root: { children: [expect.objectContaining({ type: 'paragraph' })] },
    });
  });

  it.each([
    { editorData: { root: { children: 'not-an-array' } }, label: 'an object' },
    { editorData: '{"root":{"children":"not-an-array"}}', label: 'a JSON string' },
  ])('rejects malformed editorData in $label even with a Markdown body', async ({ editorData }) => {
    await expect(
      createImmutableRoomSnapshotFromEditorData({
        content: '# Legacy body',
        editorData,
        revision: 0,
        roomId: `malformed-editor-data-${Math.random()}`,
      }),
    ).rejects.toThrow('editorData is malformed');
  });
});
