import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { BoardMode, BoardTool, CameraTarget, VerifyView } from '../types';
import { type ArtboardState, initialState } from './initialState';
import { useArtboardStore } from './store';

const n = setNamespace('artboard');

type Setter = StoreSetter<ArtboardState>;
type CameraRequest = { kind: 'all' } | { kind: 'journey' } | { id: string; kind: 'group' | 'item' };

const FLASH_MS = 1700;

export class ArtboardActionImpl {
  readonly #get: () => ArtboardState;
  readonly #set: Setter;
  #cameraSeq = 0;
  #flashTimer: ReturnType<typeof setTimeout> | undefined;
  #narrow = false;

  constructor(set: Setter, get: () => ArtboardState) {
    this.#set = set;
    this.#get = get;
  }

  bindBoard = (boardId: string) => {
    if (this.#get().boardId === boardId) return;
    clearTimeout(this.#flashTimer);
    this.#set(
      {
        ...initialState,
        boardId,
        gallery: this.#get().gallery,
        outlineOpen: false,
        pageByBoard: this.#get().pageByBoard,
        pageId: this.#get().pageByBoard[boardId] ?? null,
        verifyOpen: !this.#narrow,
      },
      false,
      n('bindBoard'),
    );
  };

  focus = (request: CameraRequest) => {
    this.#cameraSeq += 1;
    this.#set({ camera: { ...request, seq: this.#cameraSeq } as CameraTarget }, false, n('focus'));
  };

  focusItem = (id: string) => {
    this.#set({ selected: id }, false, n('focusItem'));
    this.focus({ id, kind: 'item' });
  };

  flashItems = (ids: string[]) => {
    if (!ids.length) return;
    clearTimeout(this.#flashTimer);
    this.#set({ flash: ids }, false, n('flash'));
    this.#flashTimer = setTimeout(() => this.#set({ flash: [] }, false, n('flashDone')), FLASH_MS);
  };

  setGallery = (gallery: boolean) => this.#set({ gallery }, false, n('gallery'));

  setPage = (pageId: string) => {
    const { boardId, pageByBoard, pageId: current } = this.#get();
    if (pageId === current) return;
    this.#set(
      {
        openThreadId: null,
        pageByBoard: boardId ? { ...pageByBoard, [boardId]: pageId } : pageByBoard,
        pageId,
        selected: null,
      },
      false,
      n('setPage'),
    );
  };

  goTo = (target: { id: string; kind: 'group' | 'item'; pageId?: string | null }) => {
    if (this.#get().mode !== 'discuss') this.setMode('discuss');
    if (target.pageId) this.setPage(target.pageId);
    if (target.kind === 'item') return this.focusItem(target.id);
    this.focus({ id: target.id, kind: 'group' });
  };

  setTool = (tool: BoardTool) => this.#set({ selected: null, tool }, false, n('setTool'));

  openThread = (openThreadId: string | null) => this.#set({ openThreadId }, false, n('openThread'));

  showThread = (thread: { boardId: string | null; id: string; pageId: string | null }) => {
    if (this.#get().mode !== 'discuss') this.setMode('discuss');
    if (thread.pageId) this.setPage(thread.pageId);
    this.#set({ openThreadId: thread.id, selected: null }, false, n('showThread'));
    if (thread.boardId) this.focus({ id: thread.boardId, kind: 'item' });
  };

  setFullscreen = (fullscreen: boolean) => this.#set({ fullscreen }, false, n('fullscreen'));

  setStaleRevision = (staleRevision: number | null) =>
    this.#set({ staleRevision }, false, n('staleRevision'));

  setNarrow = (narrow: boolean) => {
    if (narrow === this.#narrow) return;
    this.#narrow = narrow;
    this.#set(
      narrow ? { outlineOpen: false, verifyOpen: false } : { verifyOpen: true },
      false,
      n('narrow'),
    );
  };

  setVerifyOpen = (verifyOpen: boolean) => this.#set({ verifyOpen }, false, n('setVerifyOpen'));

  setOutlineOpen = (outlineOpen: boolean) => this.#set({ outlineOpen }, false, n('outline'));

  setShowReal = (showReal: boolean) => this.#set({ showReal }, false, n('setShowReal'));

  setVerifyView = (verifyView: VerifyView) => {
    this.#set({ verifyView }, false, n('setVerifyView'));
    if (verifyView === 'board') this.focus({ kind: 'journey' });
  };

  select = (id: string | null) => {
    this.#set({ selected: id }, false, n('select'));
    if (id && this.#get().mode === 'verify') this.setVerifyOpen(true);
  };

  setMode = (mode: BoardMode) => {
    this.#set({ mode, openThreadId: null, selected: null, tool: 'select' }, false, n('setMode'));
    if (mode === 'verify') {
      this.#set({ outlineOpen: false, verifyOpen: !this.#narrow }, false, n('verifyEnter'));
      this.focus({ kind: 'journey' });
    } else {
      this.focus({ kind: 'all' });
    }
  };

  reset = () => {
    clearTimeout(this.#flashTimer);
    this.#narrow = false;
    this.#set({ ...initialState }, false, n('reset'));
  };
}

const { getState, setState } = useArtboardStore;

export const artboardActions = new ArtboardActionImpl(setState, getState);
