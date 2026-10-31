import debug from 'debug';
import * as Y from 'yjs';

import type { LobeChatDatabase } from '@/database/type';
import { DocumentService } from '@/server/services/document';
import type { DocumentHistorySaveSource } from '@/server/services/document/types';
import { assertDocumentWriteWithinLimit } from '@/server/services/document/writeLimit';

import { editorDataFromRow } from './editorData';
import { openPageFork, PAGE_META_KEY, type PageFork, readPageTitle } from './fork';
import { persistPageState } from './persist';
import {
  createPageRoomClient,
  type PageRoomClient,
  PageRoomConflictError,
  type PageRoomState,
} from './roomClient';
import {
  historyAttributionOf,
  type PageSession,
  type PageSessions,
  type PageWriter,
} from './session';

const log = debug('lobe-server:page-collab:room');

export interface RoomPageSession extends PageSession {
  /** Stores the room's current state as a version, edited or not. */
  persistAs: (saveSource: DocumentHistorySaveSource) => Promise<void>;
}

export class PageCollabUnavailableError extends Error {
  constructor() {
    super('Page collaboration requires the agent gateway');
    this.name = 'PageCollabUnavailableError';
  }
}

/** Edits a collaborative page as one more collaborator of its live room. */
export class RoomPageSessions implements PageSessions {
  private readonly documentService: DocumentService;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly writer: PageWriter,
  ) {
    this.documentService = new DocumentService(db, writer.userId, writer.workspaceId);
  }

  async openSession(documentId: string): Promise<PageSession> {
    const room = createPageRoomClient();
    if (!room) throw new PageCollabUnavailableError();

    let state = await room.getState(documentId);
    if (!state.bootstrapped) {
      await this.bootstrap(documentId, room);
      state = await room.getState(documentId);
    }
    return this.sessionOf(documentId, room, state);
  }

  /**
   * Opens a session only on a room someone already uses. A room that was never
   * bootstrapped seeds itself from the stored page later, so a write to the
   * stored page loses nothing and needs no room.
   */
  async openLiveSession(documentId: string): Promise<RoomPageSession | undefined> {
    const room = createPageRoomClient();
    if (!room) return;

    const state = await room.getState(documentId);
    return state.bootstrapped ? this.sessionOf(documentId, room, state) : undefined;
  }

  private async sessionOf(
    documentId: string,
    room: PageRoomClient,
    state: PageRoomState,
  ): Promise<RoomPageSession> {
    const fork = await openPageFork(state.update);
    const title = readPageTitle(fork.doc) ?? (await this.getStoredTitle(documentId));
    // Length when the session opened, so a commit that does not grow the page passes.
    const initialCharCount =
      this.writer.writeSource === 'system' ? 0 : fork.editor.export().markdown.length;
    const actor = `${this.writer.saveSource === 'llm_call' ? 'agent' : 'external'}:${this.writer.userId}`;

    return {
      commit: async () => {
        if (!fork.hasChanges()) return false;
        // Refuse before anything reaches the room, so a refused write leaves no partial state.
        await assertDocumentWriteWithinLimit({
          charCount: fork.editor.export().markdown.length,
          previousCharCount: initialCharCount,
          source: this.writer.writeSource,
          userId: this.writer.userId,
          workspaceId: this.writer.workspaceId,
        });
        await room.pushUpdate(documentId, fork.diff(), { actor });
        await this.persist(documentId, fork);
        return true;
      },
      draft: fork,
      persistAs: (saveSource) => this.persist(documentId, fork, saveSource),
      setTitle: (next) => fork.doc.getMap(PAGE_META_KEY).set('title', next),
      title,
    };
  }

  // The room projects on its own schedule, always as autosave. Persisting here
  // records this edit as its own version, attributed to its writer, and lets the
  // caller read its write back right away.
  private async persist(
    documentId: string,
    fork: PageFork,
    saveSource: DocumentHistorySaveSource = this.writer.saveSource,
  ) {
    try {
      await persistPageState(this.db, documentId, Y.encodeStateAsUpdate(fork.doc), {
        history: historyAttributionOf(this.writer),
        saveSource,
      });
    } catch (error) {
      // The room already holds the edit, and its next projection persists it.
      log('persist after commit failed for %s: %O', documentId, error);
    }
  }

  private async getStoredTitle(documentId: string) {
    const row = await this.documentService.getDocumentById(documentId);
    if (!row) throw new Error(`Page document not found: ${documentId}`);
    return row.title ?? 'Untitled';
  }

  private async bootstrap(documentId: string, room: PageRoomClient) {
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
