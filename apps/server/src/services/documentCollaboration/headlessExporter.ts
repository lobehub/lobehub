import {
  createImmutableYjsSnapshotFromEditorData,
  exportYjsSnapshotProjection,
} from '@lobehub/editor/headless';

import type { CollaborationRoomSnapshot, ReadOnlyHeadlessExporter } from './persistence';

/**
 * Production exporter for room persistence.
 *
 * `exportYjsSnapshotProjection` creates a temporary DOM-free Headless Editor
 * from the immutable Yjs update and destroys it before returning. Passing a
 * copied byte array here makes the adapter's no-live-Doc contract explicit.
 */
export const readOnlyHeadlessExporter: ReadOnlyHeadlessExporter = {
  exportProjection: async ({ roomId, snapshot }) => {
    const projection = await exportYjsSnapshotProjection({
      roomId,
      update: new Uint8Array(snapshot.update),
    });

    return {
      editorData: projection.editorData,
      markdown: projection.markdown,
    };
  },
};

export const createReadOnlyHeadlessExporter = (): ReadOnlyHeadlessExporter =>
  readOnlyHeadlessExporter;

/**
 * Rebuild an immutable room bootstrap from the durable document projection.
 *
 * This is an infrastructure-only adapter: the temporary Y.Doc/provider never
 * leaves this function and callers receive only copied update bytes. The
 * public Agent facade still has no snapshot or raw-Yjs access. Keeping the
 * conversion here also means a new relay instance can recover a room even if
 * its Redis snapshot key expired, while document ACL checks remain at the DB
 * repository boundary.
 */
export const createImmutableRoomSnapshotFromEditorData = async (input: {
  content?: string | null;
  editorData?: unknown;
  revision: number;
  roomId: string;
}) => {
  return createImmutableYjsSnapshotFromEditorData(input);
};

export type { CollaborationRoomSnapshot };
