import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { BoardMode, CameraTarget, VerifyView } from '../types';
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
        galleryDrafts: this.#get().galleryDrafts,
        galleryRefs: this.#get().galleryRefs,
        galleryText: this.#get().galleryText,
        outlineOpen: false,
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

  setGallery = (gallery: ArtboardState['gallery']) => {
    const state = this.#get();
    const galleryDrafts = { ...state.galleryDrafts };
    if (state.gallery)
      galleryDrafts[state.gallery.topicId] = { refs: state.galleryRefs, text: state.galleryText };
    const draft = gallery ? galleryDrafts[gallery.topicId] : undefined;
    this.#set(
      {
        gallery,
        galleryDrafts,
        galleryRefs: draft?.refs ?? [],
        galleryText: draft?.text ?? '',
      },
      false,
      n('gallery'),
    );
  };

  setGalleryText = (galleryText: string) => this.#set({ galleryText }, false, n('galleryText'));

  addGalleryRef = (ref: ArtboardState['galleryRefs'][number]) =>
    this.#set({ galleryRefs: [...this.#get().galleryRefs, ref] }, false, n('addGalleryRef'));

  removeGalleryRef = (index: number) =>
    this.#set(
      { galleryRefs: this.#get().galleryRefs.filter((_, i) => i !== index) },
      false,
      n('removeGalleryRef'),
    );

  clearGalleryRefs = () => {
    const { gallery, galleryDrafts } = this.#get();
    this.#set(
      {
        galleryDrafts: gallery
          ? { ...galleryDrafts, [gallery.topicId]: { refs: [], text: '' } }
          : galleryDrafts,
        galleryRefs: [],
        galleryText: '',
      },
      false,
      n('clearGalleryRefs'),
    );
  };

  acceptGalleryDraft = (
    topicId: string,
    sent: { refs: ArtboardState['galleryRefs']; text: string },
  ) => {
    const state = this.#get();
    const active = state.gallery?.topicId === topicId;
    const current = active
      ? { refs: state.galleryRefs, text: state.galleryText }
      : state.galleryDrafts[topicId];
    if (!current) return;
    const draft = {
      refs: current.refs.filter((ref) => !sent.refs.includes(ref)),
      text: current.text === sent.text ? '' : current.text,
    };
    this.#set(
      {
        galleryDrafts: { ...state.galleryDrafts, [topicId]: draft },
        ...(active && { galleryRefs: draft.refs, galleryText: draft.text }),
      },
      false,
      n('acceptGalleryDraft'),
    );
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
    this.#set({ mode, selected: null }, false, n('setMode'));
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
