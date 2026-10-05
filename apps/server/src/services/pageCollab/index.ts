import { createHeadlessEditor } from '@lobehub/editor/headless';
import debug from 'debug';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import type * as Y from 'yjs';

import type { LobeChatDatabase } from '@/database/type';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { DocumentService } from '@/server/services/document';
import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';

import { openPageFork, type PageFork, projectPageState } from './fork';
import { createPageRoomClient, PageRoomConflictError } from './roomClient';

const log = debug('lobe-server:page-collab');

type SerializedEditor = SerializedEditorState<SerializedLexicalNode>;

export type PageAccess = 'edit' | 'none' | 'view';

export class PageCollabUnavailableError extends Error {
  constructor() {
    super('Page collaboration requires the agent gateway');
    this.name = 'PageCollabUnavailableError';
  }
}

export const resolvePageAccess = async (
  db: LobeChatDatabase,
  userId: string,
  documentId: string,
): Promise<PageAccess> => {
  const meta = await getResourceMeta(db, 'document', documentId);
  if (!meta) return 'none';
  if (!meta.workspaceId) return meta.userId === userId ? 'edit' : 'none';

  const can = (action: 'edit' | 'view') =>
    canPerformResourceAction({
      action,
      db,
      meta,
      resourceId: documentId,
      resourceType: 'document',
      userId,
      workspaceId: meta.workspaceId!,
    });

  if (await can('edit')) return 'edit';
  return (await can('view')) ? 'view' : 'none';
};

export const projectPageRoom = async (
  db: LobeChatDatabase,
  documentId: string,
  update: Uint8Array,
): Promise<boolean> => {
  const meta = await getResourceMeta(db, 'document', documentId);
  if (!meta) return false;

  const { editorData, markdown, title } = await projectPageState(update);
  const service = new DocumentService(db, meta.userId, meta.workspaceId ?? undefined);
  await service.updateDocument(documentId, {
    bypassEditLock: true,
    content: markdown,
    editorData: editorData as unknown as Record<string, unknown>,
    saveSource: 'autosave',
    ...(title ? { title } : {}),
  });
  return true;
};

const editorDataFromRow = (row: {
  content: string | null;
  editorData: unknown;
}): SerializedEditor | null => {
  if (isValidEditorData(row.editorData)) return row.editorData as unknown as SerializedEditor;
  if (!row.content?.trim()) return null;

  const editor = createHeadlessEditor();
  try {
    editor.hydrateMarkdown(row.content, { keepId: true });
    return editor.export().editorData;
  } finally {
    editor.destroy();
  }
};

export interface PageSession {
  commit: () => Promise<boolean>;
  fork: PageFork;
  setTitle: (title: string) => void;
  title: string;
}

export const PAGE_META_KEY = 'meta';

export const readRoomTitle = (doc: Y.Doc) => {
  const title = doc.getMap(PAGE_META_KEY).get('title');
  return typeof title === 'string' ? title : undefined;
};

export class PageCollabService {
  private readonly documentService: DocumentService;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.documentService = new DocumentService(db, userId, workspaceId);
  }

  async openSession(documentId: string): Promise<PageSession> {
    const room = createPageRoomClient();
    if (!room) throw new PageCollabUnavailableError();

    let state = await room.getState(documentId);
    if (!state.bootstrapped) {
      await this.bootstrap(documentId, room);
      state = await room.getState(documentId);
    }

    const fork = await openPageFork(state.update);
    const actor = `agent:${this.userId}`;
    const title = readRoomTitle(fork.doc) ?? (await this.getStoredTitle(documentId));

    return {
      commit: async () => {
        if (!fork.hasChanges()) return false;
        await room.pushUpdate(documentId, fork.diff(), { actor });
        return true;
      },
      fork,
      setTitle: (next) => fork.doc.getMap(PAGE_META_KEY).set('title', next),
      title,
    };
  }

  private async getStoredTitle(documentId: string) {
    const row = await this.documentService.getDocumentById(documentId);
    if (!row) throw new Error(`Page document not found: ${documentId}`);
    return row.title ?? 'Untitled';
  }

  private async bootstrap(
    documentId: string,
    room: NonNullable<ReturnType<typeof createPageRoomClient>>,
  ) {
    const row = await this.documentService.getDocumentById(documentId);
    if (!row) throw new Error(`Page document not found: ${documentId}`);

    const editorData = editorDataFromRow(row);
    if (!editorData) return;

    const seed = await openPageFork(undefined, editorData);
    if (row.title) seed.doc.getMap(PAGE_META_KEY).set('title', row.title);
    try {
      await room.pushUpdate(documentId, seed.diff(), { actor: 'bootstrap', bootstrap: true });
    } catch (error) {
      if (!(error instanceof PageRoomConflictError)) throw error;
      log('room %s bootstrapped concurrently', documentId);
    } finally {
      seed.destroy();
    }
  }
}

export { openPageFork, projectPageState } from './fork';
export { createPageRoomClient } from './roomClient';
